// Stash safety (P-081): full suite. Real git proves the safety net
// (stash dirty incl. untracked, clean no-op, exact restore incl. staged
// split, conflict-pop refusal preserving the entry); scripted runners
// prove every failure arm.
//
// Timeout note (P-075 precedent): real-git tests carry an explicit 30s
// budget — the core project resolves vitest's 5s default (the root 30s
// does not inherit into defineProject). Scripted tests keep the strict
// default as a canary. No network is touched.

import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  safeStash,
  safeStashPop,
  exitCodeOf,
  DEFAULT_STASH_TIMEOUT_MS,
  type StashRunner,
  type StashRunResult,
} from './stash.js';

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', [...args], { cwd });
  return stdout.trim();
}

/** Hermetic fixture repo (P-072 precedent: local identity + lf). */
async function makeRepo(): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), 'stitch-stash-'));
  await git(repo, ['init', '-q', '-b', 'main']);
  await git(repo, ['config', 'user.email', 'test@stitch.dev']);
  await git(repo, ['config', 'user.name', 'stitch-test']);
  await git(repo, ['config', 'core.autocrlf', 'false']);
  await git(repo, ['config', 'core.eol', 'lf']);
  await writeFile(join(repo, 'a.txt'), 'v1\n');
  await git(repo, ['add', '-A']);
  await git(repo, ['commit', '-qm', 'one']);
  return repo;
}

async function porcelain(repo: string): Promise<string> {
  return git(repo, ['status', '--porcelain']);
}

/** Untrimmed porcelain: leading-space codes (' M modified') survive. */
async function porcelainRaw(repo: string): Promise<string> {
  const { stdout } = await execFileAsync('git', ['status', '--porcelain'], { cwd: repo });
  return stdout;
}

async function stashCount(repo: string): Promise<number> {
  const out = await git(repo, ['stash', 'list', '--format=%H']);
  return out === '' ? 0 : out.split('\n').length;
}

// ─── Scripted seams ────────────────────────────────────────────────────

function okRun(stdout: string | Buffer = ''): StashRunResult {
  return {
    exitCode: 0,
    stdout: typeof stdout === 'string' ? Buffer.from(stdout) : stdout,
    stderr: '',
  };
}

function failRun(exitCode: number, stderr: string): StashRunResult {
  return { exitCode, stdout: Buffer.from(''), stderr };
}

const SHA = '7491943f75317f0699bbe6e1042e469ae91142e1';
const OTHER_SHA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

function scriptedRun(
  handler: (args: readonly string[], cwd: string) => StashRunResult
): StashRunner {
  return async (args, cwd) => handler(args, cwd);
}

function throwingRun(message: string): StashRunner {
  return async () => {
    throw new Error(message);
  };
}

/** Dirty tree, no stash entries yet. */
function dirtyRun(overrides: Partial<Record<string, StashRunResult>> = {}): StashRunner {
  const table: Record<string, StashRunResult> = {
    'rev-parse': okRun('/tmp/repo/.git\n'),
    status: okRun(Buffer.from('M  a.txt\0?? new.txt\0')),
    list: okRun(''),
    push: okRun('Saved working directory and index state On main: stitch safeStash\n'),
    pop: okRun('Dropped refs/stash@{0} (abc)\n'),
    ...overrides,
  };
  return scriptedRun(args => {
    const key = args[0] === 'stash' ? String(args[1]) : String(args[0]);
    const hit = table[key];
    if (hit === undefined) throw new Error(`unexpected git call: ${args.join(' ')}`);
    return hit;
  });
}

describe('stash safety net (real git)', () => {
  it('stashes', async () => {
    const repo = await makeRepo();
    try {
      await writeFile(join(repo, 'a.txt'), 'v2\n');
      await git(repo, ['add', '--', 'a.txt']);
      await writeFile(join(repo, 'b.txt'), 'staged-new\n');
      await git(repo, ['add', '--', 'b.txt']);
      await writeFile(join(repo, 'c.txt'), 'untracked\n');
      const result = await safeStash(repo);
      expect(result.isOk()).toBe(true);
      if (result.isErr()) return;
      expect(result.value.stashed).toBe(true);
      expect(result.value.ref).toMatch(/^[0-9a-f]{40}$/);
      // Tree is clean — tracked, staged, and untracked dirt all stashed.
      expect(await porcelain(repo)).toBe('');
      expect(await stashCount(repo)).toBe(1);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  }, 30_000);

  it('noop clean', async () => {
    const repo = await makeRepo();
    try {
      const result = await safeStash(repo);
      expect(result.isOk()).toBe(true);
      if (result.isErr()) return;
      expect(result.value).toEqual({ stashed: false, ref: null });
      expect(await stashCount(repo)).toBe(0);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  }, 30_000);

  it('stashes unstaged-only modifications', async () => {
    // Leading-space porcelain (' M file') must not be trimmed away: the
    // dirt is real and must be stashed, not no-op'd.
    const repo = await makeRepo();
    try {
      await writeFile(join(repo, 'a.txt'), 'uncommitted edit, never staged\n');
      expect(await porcelainRaw(repo)).toContain(' M a.txt');
      const result = await safeStash(repo);
      expect(result.isOk()).toBe(true);
      if (result.isErr()) return;
      expect(result.value.stashed).toBe(true);
      expect(await porcelain(repo)).toBe('');
      const popped = await safeStashPop(repo);
      expect(popped.isOk()).toBe(true);
      expect(await readFile(join(repo, 'a.txt'), 'utf8')).toBe('uncommitted edit, never staged\n');
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  }, 30_000);

  it('restores exact', async () => {
    const repo = await makeRepo();
    try {
      await writeFile(join(repo, 'a.txt'), 'v2\n');
      await git(repo, ['add', '--', 'a.txt']);
      await writeFile(join(repo, 'b.txt'), 'staged-new\n');
      await git(repo, ['add', '--', 'b.txt']);
      await writeFile(join(repo, 'c.txt'), 'untracked\n');
      const before = await porcelain(repo);
      const stashed = await safeStash(repo);
      expect(stashed.isOk()).toBe(true);
      if (stashed.isErr() || !stashed.value.stashed || stashed.value.ref === null) return;
      const popped = await safeStashPop(repo, { expectedRef: stashed.value.ref });
      expect(popped.isOk()).toBe(true);
      if (popped.isErr()) return;
      expect(popped.value).toEqual({ popped: true, ref: stashed.value.ref });
      // Exact state: same porcelain, same contents, stash consumed.
      expect(await porcelain(repo)).toBe(before);
      expect(await readFile(join(repo, 'a.txt'), 'utf8')).toBe('v2\n');
      expect(await readFile(join(repo, 'b.txt'), 'utf8')).toBe('staged-new\n');
      expect(await readFile(join(repo, 'c.txt'), 'utf8')).toBe('untracked\n');
      expect(await stashCount(repo)).toBe(0);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  }, 30_000);

  it('refuses conflict pop', async () => {
    const repo = await makeRepo();
    try {
      // Stash genuine work first (tree goes clean).
      await writeFile(join(repo, 'work.txt'), 'precious\n');
      const stashed = await safeStash(repo);
      expect(stashed.isOk() && stashed.value.stashed).toBe(true);
      if (stashed.isErr() || !stashed.value.stashed) return;
      // Then manufacture an unresolved merge conflict.
      await git(repo, ['checkout', '-qb', 'side']);
      await writeFile(join(repo, 'a.txt'), 'side\n');
      await git(repo, ['add', '-A']);
      await git(repo, ['commit', '-qm', 'side1']);
      await git(repo, ['checkout', '-q', 'main']);
      await writeFile(join(repo, 'a.txt'), 'main-change\n');
      await git(repo, ['add', '-A']);
      await git(repo, ['commit', '-qm', 'two']);
      await git(repo, ['merge', 'side']).catch(() => {});
      expect(await porcelain(repo)).toContain('UU a.txt');
      const popped = await safeStashPop(repo);
      expect(popped.isErr()).toBe(true);
      if (popped.isOk()) return;
      expect(popped.error.code).toBe('GIT_ERROR');
      // The stash entry is preserved — nothing is lost.
      expect(await stashCount(repo)).toBe(1);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  }, 30_000);

  it('refuses an unexpected stash top', async () => {
    const repo = await makeRepo();
    try {
      await writeFile(join(repo, 'work.txt'), 'precious\n');
      const stashed = await safeStash(repo);
      expect(stashed.isOk() && stashed.value.stashed).toBe(true);
      if (stashed.isErr() || !stashed.value.stashed) return;
      const popped = await safeStashPop(repo, { expectedRef: OTHER_SHA });
      expect(popped.isErr()).toBe(true);
      if (popped.isOk()) return;
      expect(popped.error.code).toBe('GIT_ERROR');
      // Still preserved.
      expect(await stashCount(repo)).toBe(1);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  }, 30_000);

  it('pops nothing when the stash is empty', async () => {
    const repo = await makeRepo();
    try {
      const popped = await safeStashPop(repo);
      expect(popped.isOk()).toBe(true);
      if (popped.isErr()) return;
      expect(popped.value).toEqual({ popped: false, ref: null });
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  }, 30_000);
});

describe('stash validation (no spawn)', () => {
  it('rejects blank repoPath and bad timeouts', async () => {
    const run = throwingRun('must not spawn on validation failure');
    const runtime = { run };
    for (const call of [
      () => safeStash('', {}, runtime),
      () => safeStash('/tmp/repo', { timeoutMs: 0 }, runtime),
      () => safeStashPop('', {}, runtime),
      () => safeStashPop('/tmp/repo', { timeoutMs: -1 }, runtime),
    ]) {
      const result = await call();
      expect(result.isErr()).toBe(true);
      if (result.isOk()) continue;
      expect(result.error.code).toBe('CONFIG_ERROR');
    }
  });

  it('rejects a non-repo directory', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'stitch-stash-plain-'));
    try {
      const result = await safeStash(dir);
      expect(result.isErr()).toBe(true);
      if (result.isOk()) return;
      expect(result.error.code).toBe('CONFIG_ERROR');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 30_000);
});

describe('safeStash failure arms (scripted)', () => {
  it('rejects malformed porcelain as INTERNAL', async () => {
    const result = await safeStash(
      '/tmp/repo',
      {},
      {
        run: dirtyRun({ status: okRun(Buffer.from('bogus\0')) }),
      }
    );
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('INTERNAL');
  });

  it('maps rev-parse failure to CONFIG_ERROR (not a repo)', async () => {
    const result = await safeStash(
      '/tmp/repo',
      {},
      {
        run: dirtyRun({ 'rev-parse': failRun(128, 'fatal: not a git repository') }),
      }
    );
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('CONFIG_ERROR');
  });

  it('maps status failure to GIT_ERROR', async () => {
    const result = await safeStash(
      '/tmp/repo',
      {},
      {
        run: dirtyRun({ status: failRun(128, 'fatal: bad default revision') }),
      }
    );
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GIT_ERROR');
  });

  it('refuses stash over unmerged entries as GIT_ERROR', async () => {
    const result = await safeStash(
      '/tmp/repo',
      {},
      {
        run: dirtyRun({ status: okRun(Buffer.from('UU a.txt\0')) }),
      }
    );
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GIT_ERROR');
    if (result.error.code === 'GIT_ERROR') {
      expect(result.error.message).toContain('unmerged');
    }
  });

  it('maps push failure to GIT_ERROR', async () => {
    const result = await safeStash(
      '/tmp/repo',
      {},
      {
        run: dirtyRun({ push: failRun(1, 'error: could not write index') }),
      }
    );
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GIT_ERROR');
  });

  it('fails an unrecorded push as INTERNAL after re-list', async () => {
    // Push "succeeds" but no entry appears: state did not move.
    const result = await safeStash(
      '/tmp/repo',
      {},
      {
        run: dirtyRun({ list: okRun('') }),
      }
    );
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('INTERNAL');
  });

  it('maps the timeout sentinel to a GIT_ERROR mentioning the timeout', async () => {
    const result = await safeStash(
      '/tmp/repo',
      { timeoutMs: 50 },
      { run: dirtyRun({ 'rev-parse': { exitCode: 124, stdout: Buffer.from(''), stderr: '' } }) }
    );
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GIT_ERROR');
    if (result.error.code === 'GIT_ERROR') {
      expect(result.error.message).toContain('timed out');
      expect(result.error.message).toContain('50');
    }
  });

  it('maps a malformed stash SHA to INTERNAL', async () => {
    const result = await safeStash(
      '/tmp/repo',
      {},
      {
        run: dirtyRun({ list: okRun(Buffer.from('junk\n')) }),
      }
    );
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('INTERNAL');
  });

  it('maps pre-push list failure to GIT_ERROR', async () => {
    const result = await safeStash(
      '/tmp/repo',
      {},
      {
        run: dirtyRun({ list: failRun(128, 'fatal: boom') }),
      }
    );
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GIT_ERROR');
  });

  it('maps post-push list failure to GIT_ERROR', async () => {
    let lists = 0;
    const base = dirtyRun();
    const result = await safeStash(
      '/tmp/repo',
      {},
      {
        run: async (args, cwd, opts) => {
          if (args[0] === 'stash' && args[1] === 'list') {
            lists += 1;
            if (lists > 1) return failRun(128, 'fatal: boom');
          }
          return base(args, cwd, opts);
        },
      }
    );
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GIT_ERROR');
  });

  it('treats a throwing runner as INTERNAL', async () => {
    const result = await safeStash('/tmp/repo', {}, { run: throwingRun('spawn EACCES') });
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('INTERNAL');
  });
});

describe('safeStashPop failure arms (scripted)', () => {
  it('maps rev-parse failure to GIT_ERROR', async () => {
    const result = await safeStashPop(
      '/tmp/repo',
      {},
      {
        run: dirtyRun({ 'rev-parse': failRun(1, 'fatal: boom') }),
      }
    );
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GIT_ERROR');
  });

  it('maps status failure to GIT_ERROR', async () => {
    const result = await safeStashPop(
      '/tmp/repo',
      {},
      {
        run: dirtyRun({ status: failRun(128, 'fatal: boom') }),
      }
    );
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GIT_ERROR');
  });

  it('maps post-pop list failure to GIT_ERROR', async () => {
    let lists = 0;
    const base = dirtyRun({ list: okRun(Buffer.from(`${SHA}\n`)) });
    const result = await safeStashPop(
      '/tmp/repo',
      {},
      {
        run: async (args, cwd, opts) => {
          if (args[0] === 'stash' && args[1] === 'list') {
            lists += 1;
            if (lists > 1) return failRun(128, 'fatal: boom');
          }
          return base(args, cwd, opts);
        },
      }
    );
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GIT_ERROR');
  });

  it('maps list failure to GIT_ERROR', async () => {
    const result = await safeStashPop(
      '/tmp/repo',
      {},
      {
        run: dirtyRun({ list: failRun(128, 'fatal: bad default revision') }),
      }
    );
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GIT_ERROR');
  });

  it('maps pop failure to GIT_ERROR', async () => {
    const result = await safeStashPop(
      '/tmp/repo',
      {},
      {
        run: dirtyRun({
          list: okRun(Buffer.from(`${SHA}\n`)),
          pop: failRun(1, 'could not restore'),
        }),
      }
    );
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GIT_ERROR');
  });

  it('fails an unconsumed pop as INTERNAL after re-list', async () => {
    // Pop "succeeds" but the entry is still listed: state did not move.
    const result = await safeStashPop(
      '/tmp/repo',
      {},
      {
        run: dirtyRun({ list: okRun(Buffer.from(`${SHA}\n`)) }),
      }
    );
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('INTERNAL');
  });
});

describe('exitCodeOf (pure)', () => {
  it('pins the timeout sentinel and numeric codes', () => {
    expect(exitCodeOf({ killed: true })).toBe(124);
    expect(exitCodeOf({ code: 'ETIMEDOUT' })).toBe(124);
    expect(exitCodeOf({ code: 128 })).toBe(128);
    expect(exitCodeOf({ status: 3 })).toBe(3);
    expect(exitCodeOf(new Error('spawn git ENOENT'))).toBe(1);
    expect(exitCodeOf(null)).toBe(1);
  });
});

describe('module constants', () => {
  it('exposes the default timeout', () => {
    expect(DEFAULT_STASH_TIMEOUT_MS).toBeGreaterThan(0);
    expect(Number.isInteger(DEFAULT_STASH_TIMEOUT_MS)).toBe(true);
  });
});
