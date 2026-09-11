// Clean tree verify (P-084): full suite. Real git proves the preflight
// guard (clean ok, staged/unstaged/untracked/rename/unmerged all dirty,
// ignoreUntracked + allowlist honored, non-repo typed CONFIG); scripted
// runners prove the porcelain-only single-spawn contract plus every
// failure arm (timeout, rejection, empty-stderr, malformed, guards,
// message cap, matcher negation).
//
// Timeout note (P-075 precedent): real-git tests carry an explicit 30s
// budget — the core project resolves vitest's 5s default (the root 30s
// does not inherit into defineProject). Scripted tests keep the strict
// default as a canary. No network is touched.

import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  isClean,
  assertClean,
  parsePorcelainStatus,
  exitCodeOf,
  DEFAULT_CLEAN_TIMEOUT_MS,
  type CleanRunner,
  type CleanRunResult,
} from './clean.js';

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', [...args], { cwd });
  return stdout.trim();
}

/** Hermetic fixture repo (P-072 precedent: local identity + lf). */
async function makeRepo(): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), 'stitch-clean-'));
  await git(repo, ['init', '-q', '-b', 'main']);
  await git(repo, ['config', 'user.email', 'test@stitch.dev']);
  await git(repo, ['config', 'user.name', 'stitch-test']);
  await git(repo, ['config', 'core.autocrlf', 'false']);
  await git(repo, ['config', 'core.eol', 'lf']);
  await writeFile(join(repo, 'a.txt'), 'v1\n');
  await writeFile(join(repo, 'b.txt'), 'v1\n');
  await git(repo, ['add', '-A']);
  await git(repo, ['commit', '-qm', 'one']);
  return repo;
}

async function dispose(repo: string): Promise<void> {
  await rm(repo, { recursive: true, force: true });
}

/** Stage a two-sided conflict so porcelain reports UU. */
async function makeConflict(repo: string): Promise<void> {
  await git(repo, ['checkout', '-qb', 'side']);
  await writeFile(join(repo, 'a.txt'), 'side\n');
  await git(repo, ['commit', '-qam', 'side']);
  await git(repo, ['checkout', '-q', 'main']);
  await writeFile(join(repo, 'a.txt'), 'main\n');
  await git(repo, ['commit', '-qam', 'main']);
  await execFileAsync('git', ['merge', 'side'], { cwd: repo }).catch(() => undefined);
}

// ─── Scripted seams ────────────────────────────────────────────────────

function okRun(stdout: string | Buffer = ''): CleanRunResult {
  return {
    exitCode: 0,
    stdout: typeof stdout === 'string' ? Buffer.from(stdout) : stdout,
    stderr: '',
  };
}

function failRun(exitCode: number, stderr: string): CleanRunResult {
  return { exitCode, stdout: Buffer.from(''), stderr };
}

function scriptedRun(
  handler: (args: readonly string[], cwd: string) => CleanRunResult
): CleanRunner {
  return async (args, cwd) => handler(args, cwd);
}

function throwingRun(message: string): CleanRunner {
  return async () => {
    throw new Error(message);
  };
}

// ─── Real git: isClean ─────────────────────────────────────────────────

describe('isClean (real git)', () => {
  it('clean ok', async () => {
    const repo = await makeRepo();
    try {
      const result = await isClean(repo);
      expect(result.isOk()).toBe(true);
      if (result.isErr()) return;
      expect(result.value).toBe(true);
    } finally {
      await dispose(repo);
    }
  }, 30_000);

  it('dirty staged+unstaged+untracked', async () => {
    const repo = await makeRepo();
    try {
      await writeFile(join(repo, 'a.txt'), 'v2\n');
      await git(repo, ['add', '--', 'a.txt']);
      await writeFile(join(repo, 'b.txt'), 'v2\n');
      await writeFile(join(repo, 'new.txt'), 'untracked\n');
      const result = await isClean(repo);
      expect(result.isOk()).toBe(true);
      if (result.isErr()) return;
      expect(result.value).toBe(false);
    } finally {
      await dispose(repo);
    }
  }, 30_000);

  it('reports staged renames under the new path only', async () => {
    const repo = await makeRepo();
    try {
      await git(repo, ['mv', 'a.txt', 'renamed.txt']);
      const clean = await isClean(repo);
      expect(clean.isOk() && clean.value).toBe(false);
      const asserted = await assertClean(repo, 'rename-check');
      expect(asserted.isErr()).toBe(true);
      if (asserted.isOk()) return;
      expect(asserted.error.code).toBe('GIT_ERROR');
      if (asserted.error.code !== 'GIT_ERROR') return;
      // The rename source (a.txt) no longer exists: only the new path
      // is reported, deterministically sorted.
      expect(asserted.error.message).toContain('renamed.txt');
      expect(asserted.error.message).not.toContain('a.txt');
    } finally {
      await dispose(repo);
    }
  }, 30_000);

  it('unmerged counts as dirty', async () => {
    const repo = await makeRepo();
    try {
      await makeConflict(repo);
      const result = await isClean(repo);
      expect(result.isOk() && result.value).toBe(false);
      const asserted = await assertClean(repo, 'merge-guard');
      expect(asserted.isErr()).toBe(true);
      if (asserted.isOk()) return;
      expect(asserted.error.code).toBe('GIT_ERROR');
      if (asserted.error.code !== 'GIT_ERROR') return;
      expect(asserted.error.message).toContain('a.txt');
    } finally {
      await dispose(repo);
    }
  }, 30_000);

  it('ignoreUntracked drops ?? entries only', async () => {
    const repo = await makeRepo();
    try {
      await writeFile(join(repo, 'loose.txt'), 'untracked\n');
      expect((await isClean(repo)).unwrapOr(true)).toBe(false);
      const ignored = await isClean(repo, { ignoreUntracked: true });
      expect(ignored.isOk() && ignored.value).toBe(true);
      // Tracked dirt still counts even with the flag set.
      await writeFile(join(repo, 'a.txt'), 'v2\n');
      expect((await isClean(repo, { ignoreUntracked: true })).unwrapOr(true)).toBe(false);
    } finally {
      await dispose(repo);
    }
  }, 30_000);

  it('non-repo maps to typed CONFIG_ERROR', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'stitch-clean-norepo-'));
    try {
      const result = await isClean(dir);
      expect(result.isErr()).toBe(true);
      if (result.isOk()) return;
      expect(result.error.code).toBe('CONFIG_ERROR');
      if (result.error.code !== 'CONFIG_ERROR') return;
      expect(result.error.field).toBe('repoPath');
    } finally {
      await dispose(dir);
    }
  }, 30_000);
});

// ─── Real git: assertClean + allowlist ─────────────────────────────────

describe('assertClean (real git)', () => {
  it('clean ok carries no paths', async () => {
    const repo = await makeRepo();
    try {
      const result = await assertClean(repo, 'preflight');
      expect(result.isOk()).toBe(true);
    } finally {
      await dispose(repo);
    }
  }, 30_000);

  it('dirty errors carry sorted paths plus the context', async () => {
    const repo = await makeRepo();
    try {
      await writeFile(join(repo, 'b.txt'), 'v2\n');
      await writeFile(join(repo, 'a.txt'), 'v2\n');
      await writeFile(join(repo, 'z-new.txt'), 'untracked\n');
      const result = await assertClean(repo, 'cherry-pick');
      expect(result.isErr()).toBe(true);
      if (result.isOk()) return;
      expect(result.error.code).toBe('GIT_ERROR');
      if (result.error.code !== 'GIT_ERROR') return;
      expect(result.error.message).toContain('cherry-pick');
      expect(result.error.message).toContain('3 paths');
      const message = result.error.message;
      // Deterministic order regardless of filesystem enumeration.
      expect(message.indexOf('a.txt') < message.indexOf('b.txt')).toBe(true);
      expect(message.indexOf('b.txt') < message.indexOf('z-new.txt')).toBe(true);
    } finally {
      await dispose(repo);
    }
  }, 30_000);

  it('singular path reads 1 path', async () => {
    const repo = await makeRepo();
    try {
      await writeFile(join(repo, 'a.txt'), 'v2\n');
      const result = await assertClean(repo, 'stash-safety');
      expect(result.isErr()).toBe(true);
      if (result.isOk()) return;
      expect(result.error.code).toBe('GIT_ERROR');
      if (result.error.code !== 'GIT_ERROR') return;
      expect(result.error.message).toContain('1 path: a.txt');
    } finally {
      await dispose(repo);
    }
  }, 30_000);

  it('allowlist respects expected-ignored output dirs', async () => {
    const repo = await makeRepo();
    try {
      await mkdir(join(repo, 'dist'));
      await writeFile(join(repo, 'dist', 'out.js'), 'built\n');
      await writeFile(join(repo, 'app.log'), 'noise\n');
      expect((await isClean(repo, { allowlist: ['dist/', '*.log'] })).unwrapOr(false)).toBe(true);
      expect((await assertClean(repo, 'merge', { allowlist: ['dist/', '*.log'] })).isOk()).toBe(
        true
      );
      // Non-allowlisted dirt still fails the guard.
      await writeFile(join(repo, 'a.txt'), 'v2\n');
      expect((await isClean(repo, { allowlist: ['dist/', '*.log'] })).unwrapOr(true)).toBe(false);
    } finally {
      await dispose(repo);
    }
  }, 30_000);

  it('allowlist never excuses unmerged entries', async () => {
    const repo = await makeRepo();
    try {
      await makeConflict(repo);
      const result = await assertClean(repo, 'merge', { allowlist: ['a.txt'] });
      expect(result.isErr()).toBe(true);
      if (result.isOk()) return;
      expect(result.error.code).toBe('GIT_ERROR');
      if (result.error.code !== 'GIT_ERROR') return;
      expect(result.error.message).toContain('a.txt');
    } finally {
      await dispose(repo);
    }
  }, 30_000);
});

// ─── Pure parser ───────────────────────────────────────────────────────

describe('parsePorcelainStatus', () => {
  it('empty output is clean state', () => {
    const parsed = parsePorcelainStatus(Buffer.from(''));
    expect(parsed.isOk()).toBe(true);
    if (parsed.isErr()) return;
    expect(parsed.value).toEqual({ unmerged: [], entries: [] });
  });

  it('splits codes, paths, untracked and unmerged', () => {
    const parsed = parsePorcelainStatus(
      Buffer.from('M  a.txt\0 M b.txt\0?? new.txt\0UU clash.txt\0AA added.txt\0')
    );
    expect(parsed.isOk()).toBe(true);
    if (parsed.isErr()) return;
    expect(parsed.value.unmerged).toEqual(['clash.txt', 'added.txt']);
    expect(parsed.value.entries).toEqual([
      { xy: 'M ', path: 'a.txt' },
      { xy: ' M', path: 'b.txt' },
      { xy: '??', path: 'new.txt' },
    ]);
  });

  it('consumes rename and copy sources without reporting them', () => {
    const parsed = parsePorcelainStatus(Buffer.from('R  new.txt\0old.txt\0C  copy.txt\0src.txt\0'));
    expect(parsed.isOk()).toBe(true);
    if (parsed.isErr()) return;
    expect(parsed.value).toEqual({
      unmerged: [],
      entries: [
        { xy: 'R ', path: 'new.txt' },
        { xy: 'C ', path: 'copy.txt' },
      ],
    });
  });

  it('accepts string input', () => {
    const parsed = parsePorcelainStatus('?? loose.txt\0');
    expect(parsed.isOk()).toBe(true);
    if (parsed.isErr()) return;
    expect(parsed.value.entries).toEqual([{ xy: '??', path: 'loose.txt' }]);
  });

  it('refuses malformed chunks fail-closed', () => {
    for (const bad of ['???\0', 'M\0', 'M no-space-prefix-here-but-long-enough\0']) {
      const parsed = parsePorcelainStatus(Buffer.from(bad));
      expect(parsed.isErr()).toBe(true);
      if (parsed.isOk()) continue;
      expect(parsed.error.code).toBe('INTERNAL');
    }
  });

  it('refuses a trailing rename without its source', () => {
    const parsed = parsePorcelainStatus(Buffer.from('R  new.txt\0'));
    expect(parsed.isErr()).toBe(true);
    if (parsed.isOk()) return;
    expect(parsed.error.code).toBe('INTERNAL');
  });
});

// ─── Scripted: contract + failure arms ─────────────────────────────────

describe('isClean contract (scripted)', () => {
  it('fast porcelain: exactly one status spawn with exact args', async () => {
    const calls: { args: readonly string[]; cwd: string }[] = [];
    const run = scriptedRun((args, cwd) => {
      calls.push({ args, cwd });
      return okRun('');
    });
    // jobId exercises the job-scoped logger arm (same single spawn).
    const result = await isClean('/tmp/repo', { jobId: 'test-job' }, { run });
    expect(result.isOk() && result.value).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.args).toEqual(['status', '--porcelain=v1', '-z']);
    expect(calls[0]?.cwd).toBe('/tmp/repo');
  });

  it('assertClean issues the same single spawn', async () => {
    const calls: { args: readonly string[] }[] = [];
    const run = scriptedRun(args => {
      calls.push({ args });
      return okRun('');
    });
    const result = await assertClean('/tmp/repo', 'preflight', {}, { run });
    expect(result.isOk()).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.args).toEqual(['status', '--porcelain=v1', '-z']);
  });

  it('rename sources never surface as dirty paths', async () => {
    const run = scriptedRun(() => okRun(Buffer.from('R  new.txt\0old.txt\0')));
    const result = await assertClean('/tmp/repo', 'ctx', {}, { run });
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GIT_ERROR');
    if (result.error.code !== 'GIT_ERROR') return;
    expect(result.error.message).toContain('1 path: new.txt');
    expect(result.error.message).not.toContain('old.txt');
  });

  it('timeout maps to GIT_ERROR', async () => {
    const run = scriptedRun(() => ({ exitCode: 124, stdout: Buffer.from(''), stderr: '' }));
    const result = await isClean('/tmp/repo', { timeoutMs: 50 }, { run });
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GIT_ERROR');
    if (result.error.code !== 'GIT_ERROR') return;
    expect(result.error.message).toContain('timed out after 50ms');
  });

  it('runner rejections map to INTERNAL', async () => {
    const result = await isClean('/tmp/repo', {}, { run: throwingRun('spawn ENOENT') });
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('INTERNAL');
  });

  it('empty stderr falls back to the exit code', async () => {
    const run = scriptedRun(() => failRun(129, ''));
    const result = await isClean('/tmp/repo', {}, { run });
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GIT_ERROR');
    if (result.error.code !== 'GIT_ERROR') return;
    expect(result.error.message).toContain('exit code 129');
  });

  it('non-repo stderr maps to typed CONFIG_ERROR', async () => {
    const run = scriptedRun(() =>
      failRun(128, 'fatal: not a git repository (or any of the parent directories): .git')
    );
    const result = await isClean('/tmp/repo', {}, { run });
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('CONFIG_ERROR');
    if (result.error.code !== 'CONFIG_ERROR') return;
    expect(result.error.field).toBe('repoPath');
  });

  it('other git failures stay GIT_ERROR', async () => {
    const run = scriptedRun(() => failRun(128, 'fatal: detected dubious ownership in repository'));
    const result = await assertClean('/tmp/repo', 'ctx', {}, { run });
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GIT_ERROR');
    if (result.error.code !== 'GIT_ERROR') return;
    expect(result.error.message).toContain('dubious ownership');
  });

  it('matcher negation wins last (gitignore semantics)', async () => {
    const run = scriptedRun(() => okRun(Buffer.from('?? keep.log\0?? drop.log\0')));
    const result = await assertClean(
      '/tmp/repo',
      'ctx',
      { allowlist: ['*.log', '!keep.log'] },
      { run }
    );
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GIT_ERROR');
    if (result.error.code !== 'GIT_ERROR') return;
    expect(result.error.message).toContain('keep.log');
    expect(result.error.message).not.toContain('drop.log');
  });

  it('long dirty lists cap the message but count exactly', async () => {
    const paths = Array.from({ length: 21 }, (_, i) => `f${String(i).padStart(2, '0')}.txt`);
    const run = scriptedRun(() => okRun(Buffer.from(paths.map(p => ` M ${p}`).join('\0') + '\0')));
    const result = await assertClean('/tmp/repo', 'ctx', {}, { run });
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GIT_ERROR');
    if (result.error.code !== 'GIT_ERROR') return;
    expect(result.error.message).toContain('21 paths');
    expect(result.error.message).toContain('(+1 more)');
    expect(result.error.message).toContain('f00.txt');
    expect(result.error.message).not.toContain('f20.txt');
  });

  it('malformed porcelain refuses fail-closed', async () => {
    const run = scriptedRun(() => okRun('garbage-without-code-prefix-but-long\0'));
    const result = await isClean('/tmp/repo', {}, { run });
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('INTERNAL');
  });

  it('rejects blank repoPath, bad timeouts and blank context', async () => {
    const run = scriptedRun(() => okRun(''));
    for (const bad of ['isClean', 'assertClean'] as const) {
      const blank =
        bad === 'isClean'
          ? await isClean('   ', {}, { run })
          : await assertClean('   ', 'ctx', {}, { run });
      expect(blank.isErr()).toBe(true);
      if (blank.isOk()) continue;
      expect(blank.error.code).toBe('CONFIG_ERROR');
    }
    for (const timeoutMs of [0, -5, 1.5, Number.NaN]) {
      const bad = await isClean('/tmp/repo', { timeoutMs }, { run });
      expect(bad.isErr()).toBe(true);
      if (bad.isOk()) continue;
      expect(bad.error.code).toBe('CONFIG_ERROR');
    }
    const blankCtx = await assertClean('/tmp/repo', '  ', {}, { run });
    expect(blankCtx.isErr()).toBe(true);
    if (blankCtx.isOk()) return;
    expect(blankCtx.error.code).toBe('CONFIG_ERROR');
    if (blankCtx.error.code !== 'CONFIG_ERROR') return;
    expect(blankCtx.error.field).toBe('context');
  });
});

// ─── Seams ─────────────────────────────────────────────────────────────

describe('exitCodeOf', () => {
  it('pins the timeout sentinel and numeric codes', () => {
    expect(exitCodeOf({ killed: true })).toBe(124);
    expect(exitCodeOf({ code: 'ETIMEDOUT' })).toBe(124);
    expect(exitCodeOf({ code: 128 })).toBe(128);
    expect(exitCodeOf({ status: 1 })).toBe(1);
    expect(exitCodeOf(new Error('boom'))).toBe(1);
    expect(exitCodeOf(null)).toBe(1);
  });

  it('exports the default timeout budget', () => {
    expect(DEFAULT_CLEAN_TIMEOUT_MS).toBe(60_000);
  });
});
