// Rollback/abort (P-085): full suite. Real git proves per-op aborts
// (merge/cherry-pick/rebase conflicts cleared, marker gone, tree
// restored), idempotent no-ops, resetTo (clean reset, unstashed refusal,
// stash-first flow, bad-ref refusal), and end-to-end rollbackJob
// (abort + reset + pop + worktree removal). Scripted runners prove the
// detection dispatch plus every failure arm.
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
  abortGitOp,
  resetTo,
  rollbackJob,
  exitCodeOf,
  DEFAULT_ROLLBACK_TIMEOUT_MS,
  DEFAULT_RESET_STASH_MESSAGE,
  type AbortKind,
  type RollbackRunner,
  type RollbackRunResult,
  type JobSnapshot,
} from './rollback.js';

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', [...args], { cwd });
  return stdout.trim();
}

/** Hermetic fixture repo (P-072 precedent: local identity + lf). */
async function makeRepo(): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), 'stitch-rollback-'));
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

async function dispose(repo: string): Promise<void> {
  await rm(repo, { recursive: true, force: true });
}

/** Marker probe: exit 0 iff that op is in progress. */
async function marker(repo: string, head: string): Promise<boolean> {
  const result = await execFileAsync('git', ['rev-parse', '--verify', '--quiet', head], {
    cwd: repo,
  }).then(
    () => true,
    () => false
  );
  return result;
}

async function headSha(repo: string): Promise<string> {
  return git(repo, ['rev-parse', 'HEAD']);
}

/** Leave a merge conflict in progress on main. */
async function makeMergeConflict(repo: string): Promise<void> {
  await git(repo, ['checkout', '-qb', 'side']);
  await writeFile(join(repo, 'a.txt'), 'side\n');
  await git(repo, ['commit', '-qam', 'side']);
  await git(repo, ['checkout', '-q', 'main']);
  await writeFile(join(repo, 'a.txt'), 'main\n');
  await git(repo, ['commit', '-qam', 'main']);
  await execFileAsync('git', ['merge', 'side'], { cwd: repo }).catch(() => undefined);
}

/** Leave a cherry-pick conflict in progress on main. Returns the SHA. */
async function makeCherryConflict(repo: string): Promise<string> {
  await git(repo, ['checkout', '-qb', 'side']);
  await writeFile(join(repo, 'a.txt'), 'side\n');
  await git(repo, ['commit', '-qam', 'side']);
  const sha = await headSha(repo);
  await git(repo, ['checkout', '-q', 'main']);
  await writeFile(join(repo, 'a.txt'), 'main\n');
  await git(repo, ['commit', '-qam', 'main']);
  await execFileAsync('git', ['cherry-pick', sha], { cwd: repo }).catch(() => undefined);
  return sha;
}

/** Leave a stopped rebase in progress on side. */
async function makeRebaseConflict(repo: string): Promise<void> {
  await git(repo, ['checkout', '-qb', 'side']);
  await writeFile(join(repo, 'a.txt'), 'side\n');
  await git(repo, ['commit', '-qam', 'side']);
  await git(repo, ['checkout', '-q', 'main']);
  await writeFile(join(repo, 'a.txt'), 'main\n');
  await git(repo, ['commit', '-qam', 'main']);
  await git(repo, ['checkout', '-q', 'side']);
  await execFileAsync('git', ['rebase', 'main'], { cwd: repo }).catch(() => undefined);
}

// ─── Scripted seams ────────────────────────────────────────────────────

function okRun(stdout: string | Buffer = ''): RollbackRunResult {
  return {
    exitCode: 0,
    stdout: typeof stdout === 'string' ? Buffer.from(stdout) : stdout,
    stderr: '',
  };
}

function failRun(exitCode: number, stderr: string): RollbackRunResult {
  return { exitCode, stdout: Buffer.from(''), stderr };
}

function scriptedRun(
  handler: (args: readonly string[], cwd: string) => RollbackRunResult
): RollbackRunner {
  return async (args, cwd) => handler(args, cwd);
}

function throwingRun(message: string): RollbackRunner {
  return async () => {
    throw new Error(message);
  };
}

const SHA_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const SHA_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

/** Detection table: absent markers (exit 1) unless overridden. */
function detectRun(overrides: Partial<Record<string, RollbackRunResult>> = {}): RollbackRunner {
  return scriptedRun(args => {
    const key = args.join(' ');
    const hit = overrides[key];
    if (hit !== undefined) return hit;
    if (args[0] === 'rev-parse') return failRun(1, '');
    throw new Error(`unexpected git call: ${key}`);
  });
}

// ─── Real git: abortGitOp ──────────────────────────────────────────────

describe('abortGitOp (real git)', () => {
  it('aborts op', async () => {
    const repo = await makeRepo();
    try {
      await makeMergeConflict(repo);
      expect(await marker(repo, 'MERGE_HEAD')).toBe(true);
      const result = await abortGitOp(repo, 'merge');
      expect(result.isOk()).toBe(true);
      expect(await marker(repo, 'MERGE_HEAD')).toBe(false);
      // Pre-merge state restored: a.txt back to main's committed content.
      const { readFile } = await import('node:fs/promises');
      expect(await readFile(join(repo, 'a.txt'), 'utf8')).toBe('main\n');
    } finally {
      await dispose(repo);
    }
  }, 30_000);

  it('aborts cherry-pick', async () => {
    const repo = await makeRepo();
    try {
      await makeCherryConflict(repo);
      expect(await marker(repo, 'CHERRY_PICK_HEAD')).toBe(true);
      expect((await abortGitOp(repo, 'cherry-pick')).isOk()).toBe(true);
      expect(await marker(repo, 'CHERRY_PICK_HEAD')).toBe(false);
    } finally {
      await dispose(repo);
    }
  }, 30_000);

  it('aborts rebase', async () => {
    const repo = await makeRepo();
    try {
      await makeRebaseConflict(repo);
      expect(await marker(repo, 'REBASE_HEAD')).toBe(true);
      expect((await abortGitOp(repo, 'rebase')).isOk()).toBe(true);
      expect(await marker(repo, 'REBASE_HEAD')).toBe(false);
    } finally {
      await dispose(repo);
    }
  }, 30_000);

  it('no-ops when nothing is in progress', async () => {
    const repo = await makeRepo();
    try {
      for (const kind of ['merge', 'cherry-pick', 'rebase'] as const) {
        expect((await abortGitOp(repo, kind)).isOk()).toBe(true);
      }
    } finally {
      await dispose(repo);
    }
  }, 30_000);

  it('aborts worktree via P-076 removal', async () => {
    const repo = await makeRepo();
    const wt = join(repo, 'wt');
    try {
      await mkdir(wt);
      await git(repo, ['worktree', 'add', '--detach', wt]);
      const listed = await git(repo, ['worktree', 'list', '--porcelain']);
      // Porcelain prints forward slashes even on Windows (probed).
      expect(listed).toContain(wt.replace(/\\/g, '/'));
      const result = await abortGitOp(repo, 'worktree', { worktreePath: wt });
      expect(result.isOk()).toBe(true);
      expect(await git(repo, ['worktree', 'list', '--porcelain'])).not.toContain(
        wt.replace(/\\/g, '/')
      );
    } finally {
      await dispose(repo);
    }
  }, 30_000);

  it('worktree kind requires its path', async () => {
    const repo = await makeRepo();
    try {
      const result = await abortGitOp(repo, 'worktree');
      expect(result.isErr()).toBe(true);
      if (result.isOk()) return;
      expect(result.error.code).toBe('CONFIG_ERROR');
      if (result.error.code !== 'CONFIG_ERROR') return;
      expect(result.error.field).toBe('worktreePath');
    } finally {
      await dispose(repo);
    }
  }, 30_000);
});

// ─── Real git: resetTo ─────────────────────────────────────────────────

describe('resetTo (real git)', () => {
  it('resets ref', async () => {
    const repo = await makeRepo();
    try {
      const before = await headSha(repo);
      await writeFile(join(repo, 'b.txt'), 'v2\n');
      await git(repo, ['add', '-A']);
      await git(repo, ['commit', '-qam', 'two']);
      expect(await headSha(repo)).not.toBe(before);
      const result = await resetTo(repo, before);
      expect(result.isOk()).toBe(true);
      if (result.isErr()) return;
      expect(result.value.ref).toBe(before);
      expect(result.value.stashed).toBe(false);
      expect(await headSha(repo)).toBe(before);
    } finally {
      await dispose(repo);
    }
  }, 30_000);

  it('refuses unstashed', async () => {
    const repo = await makeRepo();
    try {
      await writeFile(join(repo, 'a.txt'), 'v2\n');
      const before = await headSha(repo);
      const result = await resetTo(repo, before);
      expect(result.isErr()).toBe(true);
      if (result.isOk()) return;
      expect(result.error.code).toBe('GIT_ERROR');
      if (result.error.code !== 'GIT_ERROR') return;
      expect(result.error.message).toContain('a.txt');
      expect(result.error.message).toContain('stash');
      // Nothing moved: the refusal is pre-mutation.
      expect(await headSha(repo)).toBe(before);
    } finally {
      await dispose(repo);
    }
  }, 30_000);

  it('stashes first when asked', async () => {
    const repo = await makeRepo();
    try {
      const before = await headSha(repo);
      await writeFile(join(repo, 'b.txt'), 'v2\n');
      await git(repo, ['add', '-A']);
      await git(repo, ['commit', '-qam', 'two']);
      await writeFile(join(repo, 'a.txt'), 'dirty\n');
      const result = await resetTo(repo, before, { stash: true });
      expect(result.isOk()).toBe(true);
      if (result.isErr()) return;
      expect(result.value.stashed).toBe(true);
      expect(result.value.stashRef).not.toBeNull();
      expect(await headSha(repo)).toBe(before);
      // The work survives in the stash entry (nothing clobbered).
      expect(await git(repo, ['stash', 'list'])).toContain('stitch resetTo');
      // Object form honors a custom message and the message-less form
      // falls back to the default.
      await writeFile(join(repo, 'a.txt'), 'dirty-again\n');
      const custom = await resetTo(repo, before, { stash: { message: 'custom-msg' } });
      expect(custom.isOk()).toBe(true);
      expect(await git(repo, ['stash', 'list'])).toContain('custom-msg');
      await writeFile(join(repo, 'a.txt'), 'dirty-third\n');
      const fallback = await resetTo(repo, before, { stash: {} });
      expect(fallback.isOk()).toBe(true);
      expect(await git(repo, ['stash', 'list'])).toContain('stitch resetTo');
    } finally {
      await dispose(repo);
    }
  }, 30_000);

  it('rejects unresolvable refs without moving', async () => {
    const repo = await makeRepo();
    try {
      const before = await headSha(repo);
      const result = await resetTo(repo, 'nope-not-a-ref');
      expect(result.isErr()).toBe(true);
      if (result.isOk()) return;
      expect(result.error.code).toBe('CONFIG_ERROR');
      if (result.error.code !== 'CONFIG_ERROR') return;
      expect(result.error.field).toBe('ref');
      expect(await headSha(repo)).toBe(before);
    } finally {
      await dispose(repo);
    }
  }, 30_000);

  it('maps non-repos to CONFIG_ERROR', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'stitch-rollback-norepo-'));
    try {
      const result = await resetTo(dir, 'HEAD');
      expect(result.isErr()).toBe(true);
      if (result.isOk()) return;
      expect(result.error.code).toBe('CONFIG_ERROR');
    } finally {
      await dispose(dir);
    }
  }, 30_000);
});

// ─── Real git: rollbackJob ─────────────────────────────────────────────

describe('rollbackJob (real git)', () => {
  it('job rollback', async () => {
    const repo = await makeRepo();
    try {
      const snapshot = await headSha(repo);
      await makeMergeConflict(repo);
      expect(await marker(repo, 'MERGE_HEAD')).toBe(true);
      const outcome = await rollbackJob(repo, { ref: snapshot });
      expect(outcome.isOk()).toBe(true);
      if (outcome.isErr()) return;
      expect(outcome.value.aborted).toEqual(['merge']);
      expect(outcome.value.worktreeRemoved).toBe(false);
      expect(outcome.value.resetRef).toBe(snapshot);
      expect(outcome.value.popped).toBe(false);
      expect(await marker(repo, 'MERGE_HEAD')).toBe(false);
      expect(await headSha(repo)).toBe(snapshot);
    } finally {
      await dispose(repo);
    }
  }, 30_000);

  it('job rollback restores stashed work via expectedRef', async () => {
    const repo = await makeRepo();
    try {
      const snapshot = await headSha(repo);
      await writeFile(join(repo, 'a.txt'), 'dirty-work\n');
      const stashed = await resetTo(repo, snapshot, { stash: true });
      expect(stashed.isOk()).toBe(true);
      if (stashed.isErr()) return;
      const stashRef = stashed.value.stashRef;
      expect(stashRef).not.toBeNull();
      if (stashRef === null) return;
      // Simulate forward drift, then roll the whole job back.
      await writeFile(join(repo, 'drift.txt'), 'x\n');
      await git(repo, ['add', '-A']);
      await git(repo, ['commit', '-qm', 'drift']);
      const snap: JobSnapshot = { ref: snapshot, stashRef };
      const outcome = await rollbackJob(repo, snap);
      expect(outcome.isOk()).toBe(true);
      if (outcome.isErr()) return;
      expect(outcome.value.popped).toBe(true);
      expect(await headSha(repo)).toBe(snapshot);
      const { readFile } = await import('node:fs/promises');
      expect(await readFile(join(repo, 'a.txt'), 'utf8')).toBe('dirty-work\n');
    } finally {
      await dispose(repo);
    }
  }, 30_000);

  it('job rollback removes the staging worktree', async () => {
    const repo = await makeRepo();
    try {
      const snapshot = await headSha(repo);
      const wt = join(repo, 'stage');
      await mkdir(wt);
      await git(repo, ['worktree', 'add', '--detach', wt]);
      const outcome = await rollbackJob(repo, { ref: snapshot, worktreePath: wt });
      expect(outcome.isOk()).toBe(true);
      if (outcome.isErr()) return;
      expect(outcome.value.worktreeRemoved).toBe(true);
      expect(await git(repo, ['worktree', 'list', '--porcelain'])).not.toContain(
        wt.replace(/\\/g, '/')
      );
      expect(await headSha(repo)).toBe(snapshot);
    } finally {
      await dispose(repo);
    }
  }, 30_000);
});

// ─── Scripted: dispatch + failure arms ─────────────────────────────────

describe('abortGitOp dispatch (scripted)', () => {
  it('aborts only the detected kind', async () => {
    const calls: string[] = [];
    let markerPresent = true;
    const run = scriptedRun(args => {
      const key = args.join(' ');
      calls.push(key);
      if (key === 'rev-parse --verify --quiet MERGE_HEAD') {
        return markerPresent ? okRun(`${SHA_A}\n`) : failRun(1, '');
      }
      if (key === 'merge --abort') {
        markerPresent = false;
        return okRun('');
      }
      throw new Error(`unexpected git call: ${key}`);
    });
    const result = await abortGitOp('/tmp/repo', 'merge', {}, { git: run });
    expect(result.isOk()).toBe(true);
    expect(calls).toEqual([
      'rev-parse --verify --quiet MERGE_HEAD',
      'merge --abort',
      'rev-parse --verify --quiet MERGE_HEAD',
    ]);
  });

  it('rejects unknown kinds', async () => {
    const run = scriptedRun(() => okRun(''));
    const result = await abortGitOp('/tmp/repo', 'octopus' as AbortKind, {}, { git: run });
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('CONFIG_ERROR');
    if (result.error.code !== 'CONFIG_ERROR') return;
    expect(result.error.field).toBe('kind');
  });

  it('rejects blank repoPath and bad timeouts', async () => {
    const run = scriptedRun(() => okRun(''));
    const blank = await abortGitOp('  ', 'merge', {}, { git: run });
    expect(blank.isErr()).toBe(true);
    if (blank.isOk()) return;
    expect(blank.error.code).toBe('CONFIG_ERROR');
    const bad = await abortGitOp('/tmp/repo', 'merge', { timeoutMs: 0 }, { git: run });
    expect(bad.isErr()).toBe(true);
    if (bad.isOk()) return;
    expect(bad.error.code).toBe('CONFIG_ERROR');
  });

  it('runner rejections map to INTERNAL', async () => {
    const result = await abortGitOp('/tmp/repo', 'merge', {}, { git: throwingRun('boom') });
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('INTERNAL');
  });

  it('unexpected detection failures stay loud', async () => {
    const run = scriptedRun(() => failRun(128, 'fatal: detected dubious ownership'));
    const result = await abortGitOp('/tmp/repo', 'merge', {}, { git: run });
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GIT_ERROR');
    if (result.error.code !== 'GIT_ERROR') return;
    expect(result.error.message).toContain('dubious ownership');
  });

  it('abort failures surface git output', async () => {
    const run = detectRun({
      'rev-parse --verify --quiet CHERRY_PICK_HEAD': okRun(`${SHA_A}\n`),
      'cherry-pick --abort': failRun(1, 'error: cherry-pick failed'),
    });
    const result = await abortGitOp('/tmp/repo', 'cherry-pick', {}, { git: run });
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GIT_ERROR');
    if (result.error.code !== 'GIT_ERROR') return;
    expect(result.error.message).toContain('cherry-pick failed');
  });

  it('stuck sequencers fail closed', async () => {
    const run = detectRun({
      'rev-parse --verify --quiet REBASE_HEAD': okRun(`${SHA_A}\n`),
      'rebase --abort': okRun(''),
    });
    const result = await abortGitOp('/tmp/repo', 'rebase', {}, { git: run });
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('INTERNAL');
    if (result.error.code !== 'INTERNAL') return;
    expect(result.error.message).toContain('still present');
  });

  it('timeout maps to GIT_ERROR', async () => {
    const run = scriptedRun(() => ({ exitCode: 124, stdout: Buffer.from(''), stderr: '' }));
    const result = await abortGitOp('/tmp/repo', 'merge', { timeoutMs: 25 }, { git: run });
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GIT_ERROR');
    if (result.error.code !== 'GIT_ERROR') return;
    expect(result.error.message).toContain('timed out after 25ms');
  });
});

describe('resetTo (scripted)', () => {
  function resolvingRun(extra: Partial<Record<string, RollbackRunResult>> = {}): RollbackRunner {
    return detectRun({
      [`rev-parse --verify HEAD^{commit}`]: okRun(`${SHA_A}\n`),
      'rev-parse HEAD': okRun(`${SHA_A}\n`),
      [`reset --hard ${SHA_A}`]: okRun('HEAD is now at a one\n'),
      ...extra,
    });
  }

  it('pins the resolved SHA through reset and verify', async () => {
    const calls: string[] = [];
    // Clean tree: P-084 assertClean passes via the clean runtime.
    const clean = {
      run: (async (args: readonly string[]) => {
        expect(args).toEqual(['status', '--porcelain=v1', '-z']);
        return { exitCode: 0, stdout: Buffer.from(''), stderr: '' };
      }) as RollbackRunner,
    };
    const git = resolvingRun();
    const recording: RollbackRunner = async (args, cwd, opts) => {
      calls.push(args.join(' '));
      return git(args, cwd, opts);
    };
    const result = await resetTo('/tmp/repo', 'HEAD', {}, { git: recording, clean });
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.ref).toBe(SHA_A);
    expect(calls).toContain(`reset --hard ${SHA_A}`);
  });

  it('rejects blank refs', async () => {
    const run = scriptedRun(() => okRun(''));
    const result = await resetTo('/tmp/repo', '  ', {}, { git: run });
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('CONFIG_ERROR');
    if (result.error.code !== 'CONFIG_ERROR') return;
    expect(result.error.field).toBe('ref');
  });

  it('rejects malformed SHAs fail-closed', async () => {
    const run = detectRun({ 'rev-parse --verify HEAD^{commit}': okRun('not-a-sha\n') });
    const result = await resetTo('/tmp/repo', 'HEAD', {}, { git: run });
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('INTERNAL');
  });

  it('reset failures surface git output', async () => {
    const run = resolvingRun({ [`reset --hard ${SHA_A}`]: failRun(128, 'fatal: bad thing') });
    const clean = { run: (async () => okRun('')) as RollbackRunner };
    const result = await resetTo('/tmp/repo', 'HEAD', {}, { git: run, clean });
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GIT_ERROR');
    if (result.error.code !== 'GIT_ERROR') return;
    expect(result.error.message).toContain('bad thing');
  });

  it('HEAD drift after reset fails closed', async () => {
    const run = resolvingRun({ 'rev-parse HEAD': okRun(`${SHA_B}\n`) });
    const clean = { run: (async () => okRun('')) as RollbackRunner };
    const result = await resetTo('/tmp/repo', 'HEAD', {}, { git: run, clean });
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('INTERNAL');
    if (result.error.code !== 'INTERNAL') return;
    expect(result.error.message).toContain('drifted');
  });

  it('other resolution failures stay GIT_ERROR', async () => {
    const run = detectRun({
      'rev-parse --verify HEAD^{commit}': failRun(128, 'fatal: detected dubious ownership'),
    });
    const result = await resetTo('/tmp/repo', 'HEAD', {}, { git: run });
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GIT_ERROR');
  });
});

describe('rollbackJob (scripted)', () => {
  it('rejects bad snapshots before any spawn', async () => {
    const calls: string[] = [];
    const run = scriptedRun(args => {
      calls.push(args.join(' '));
      return okRun('');
    });
    const blank = await rollbackJob('/tmp/repo', { ref: '  ' }, {}, { git: run });
    expect(blank.isErr()).toBe(true);
    if (blank.isOk()) return;
    expect(blank.error.code).toBe('CONFIG_ERROR');
    expect(calls).toHaveLength(0);
  });

  it('aborts nothing on a clean tree and resets in place', async () => {
    const calls: string[] = [];
    const git = resolvingRunFor(SHA_A);
    const recording: RollbackRunner = async (args, cwd, opts) => {
      calls.push(args.join(' '));
      return git(args, cwd, opts);
    };
    const clean = { run: (async () => okRun('')) as RollbackRunner };
    const outcome = await rollbackJob('/tmp/repo', { ref: 'HEAD' }, {}, { git: recording, clean });
    expect(outcome.isOk()).toBe(true);
    if (outcome.isErr()) return;
    expect(outcome.value.aborted).toEqual([]);
    expect(outcome.value.resetRef).toBe(SHA_A);
    expect(outcome.value.popped).toBe(false);
    expect(calls).toContain(`reset --hard ${SHA_A}`);
  });
});

describe('rollbackJob failure arms (scripted)', () => {
  it('detection maps non-repos to CONFIG_ERROR', async () => {
    const run = scriptedRun(() => failRun(128, 'fatal: not a git repository: .git'));
    const result = await abortGitOp('/tmp/repo', 'merge', {}, { git: run });
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('CONFIG_ERROR');
    if (result.error.code !== 'CONFIG_ERROR') return;
    expect(result.error.field).toBe('repoPath');
  });

  it('empty-stderr detections fall back to the exit code', async () => {
    const run = scriptedRun(() => failRun(2, ''));
    const result = await abortGitOp('/tmp/repo', 'merge', {}, { git: run });
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GIT_ERROR');
    if (result.error.code !== 'GIT_ERROR') return;
    expect(result.error.message).toContain('exit code 2');
  });

  it('aborts through runner rejections as INTERNAL', async () => {
    let calls = 0;
    const run = scriptedRun(args => {
      calls += 1;
      if (args.join(' ') === 'rev-parse --verify --quiet MERGE_HEAD') return okRun(`${SHA_A}\n`);
      throw new Error('spawn lost');
    });
    const result = await abortGitOp('/tmp/repo', 'merge', {}, { git: run });
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('INTERNAL');
    expect(calls).toBe(2);
  });

  it('verify-stage detection failures stay loud', async () => {
    let calls = 0;
    const run = scriptedRun(args => {
      calls += 1;
      const key = args.join(' ');
      if (key === 'rev-parse --verify --quiet REBASE_HEAD') {
        return calls === 1
          ? okRun(`${SHA_A}\n`)
          : failRun(128, 'fatal: detected dubious ownership');
      }
      if (key === 'rebase --abort') return okRun('');
      throw new Error(`unexpected git call: ${key}`);
    });
    const result = await abortGitOp('/tmp/repo', 'rebase', {}, { git: run });
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GIT_ERROR');
    if (result.error.code !== 'GIT_ERROR') return;
    expect(result.error.message).toContain('dubious ownership');
  });

  it('worktree removal failures propagate', async () => {
    const failing = {
      run: (async () => failRun(128, 'fatal: no such worktree')) as RollbackRunner,
    };
    const git = scriptedRun(() => okRun(''));
    const result = await abortGitOp(
      '/tmp/repo',
      'worktree',
      { worktreePath: '/tmp/wt' },
      { git, worktree: failing }
    );
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GIT_ERROR');
  });

  it('resetTo validates its base', async () => {
    const run = scriptedRun(() => okRun(''));
    const blank = await resetTo('  ', 'HEAD', {}, { git: run });
    expect(blank.isErr()).toBe(true);
    if (blank.isOk()) return;
    expect(blank.error.code).toBe('CONFIG_ERROR');
  });

  it('resetTo propagates stash failures', async () => {
    const git = resolvingRunFor(SHA_A);
    const stash = {
      run: (async () => failRun(128, 'fatal: detected dubious ownership')) as RollbackRunner,
    };
    const result = await resetTo('/tmp/repo', 'HEAD', { stash: true }, { git, stash });
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GIT_ERROR');
    if (result.error.code !== 'GIT_ERROR') return;
    expect(result.error.message).toContain('dubious ownership');
  });

  it('resetTo passes through non-GIT gate failures', async () => {
    const git = resolvingRunFor(SHA_A);
    const clean = {
      run: (async () => okRun('malformed-without-code-but-long-enough\0')) as RollbackRunner,
    };
    const result = await resetTo('/tmp/repo', 'HEAD', {}, { git, clean });
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('INTERNAL');
  });

  it('resetTo fails closed on HEAD read failures', async () => {
    const git = detectRun({
      'rev-parse --verify HEAD^{commit}': okRun(`${SHA_A}\n`),
      [`reset --hard ${SHA_A}`]: okRun('HEAD is now there\n'),
      'rev-parse HEAD': failRun(128, 'fatal: bad object HEAD'),
    });
    const clean = { run: (async () => okRun('')) as RollbackRunner };
    const result = await resetTo('/tmp/repo', 'HEAD', {}, { git, clean });
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GIT_ERROR');
    if (result.error.code !== 'GIT_ERROR') return;
    expect(result.error.message).toContain('bad object');
  });

  it('resetTo fails closed when the final tree is unexpectedly dirty', async () => {
    const git = resolvingRunFor(SHA_A);
    let calls = 0;
    const clean = {
      run: (async () => {
        calls += 1;
        return calls === 1 ? okRun('') : okRun(Buffer.from('?? raced.txt\0'));
      }) as RollbackRunner,
    };
    const result = await resetTo('/tmp/repo', 'HEAD', { jobId: 'test-job' }, { git, clean });
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('INTERNAL');
    if (result.error.code !== 'INTERNAL') return;
    expect(result.error.message).toContain('invariant violated');
  });

  it('rollbackJob validates its base and snapshot', async () => {
    const run = scriptedRun(() => okRun(''));
    const blankRepo = await rollbackJob('  ', { ref: 'HEAD' }, {}, { git: run });
    expect(blankRepo.isErr()).toBe(true);
    if (blankRepo.isOk()) return;
    expect(blankRepo.error.code).toBe('CONFIG_ERROR');
    const missing = await rollbackJob(
      '/tmp/repo',
      null as unknown as JobSnapshot,
      {},
      { git: run }
    );
    expect(missing.isErr()).toBe(true);
    if (missing.isOk()) return;
    expect(missing.error.code).toBe('CONFIG_ERROR');
    const blankWt = await rollbackJob(
      '/tmp/repo',
      { ref: 'HEAD', worktreePath: ' ' },
      {},
      { git: run }
    );
    expect(blankWt.isErr()).toBe(true);
    if (blankWt.isOk()) return;
    expect(blankWt.error.code).toBe('CONFIG_ERROR');
    const blankStash = await rollbackJob(
      '/tmp/repo',
      { ref: 'HEAD', stashRef: ' ' },
      {},
      { git: run }
    );
    expect(blankStash.isErr()).toBe(true);
    if (blankStash.isOk()) return;
    expect(blankStash.error.code).toBe('CONFIG_ERROR');
  });

  it('rollbackJob propagates abort failures', async () => {
    const git = scriptedRun(args => {
      if (args.join(' ') === 'rev-parse --verify --quiet MERGE_HEAD') {
        return failRun(128, 'fatal: detected dubious ownership');
      }
      return failRun(1, '');
    });
    const result = await rollbackJob('/tmp/repo', { ref: 'HEAD' }, {}, { git });
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GIT_ERROR');
  });

  it('rollbackJob propagates worktree failures', async () => {
    const git = resolvingRunFor(SHA_A);
    const failing = { run: (async () => failRun(1, 'fatal: no such worktree')) as RollbackRunner };
    const result = await rollbackJob(
      '/tmp/repo',
      { ref: 'HEAD', worktreePath: '/tmp/wt' },
      {},
      { git, worktree: failing }
    );
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GIT_ERROR');
  });

  it('rollbackJob propagates reset failures', async () => {
    const git = detectRun({
      'rev-parse --verify HEAD^{commit}': okRun(`${SHA_A}\n`),
      [`reset --hard ${SHA_A}`]: failRun(128, 'fatal: cannot reset now'),
    });
    const clean = { run: (async () => okRun('')) as RollbackRunner };
    const result = await rollbackJob('/tmp/repo', { ref: 'HEAD' }, {}, { git, clean });
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GIT_ERROR');
    if (result.error.code !== 'GIT_ERROR') return;
    expect(result.error.message).toContain('cannot reset now');
  });

  it('rollbackJob stashes first when asked', async () => {
    const git = resolvingRunFor(SHA_A);
    const stashCalls: string[] = [];
    const stash = {
      run: (async (args: readonly string[]) => {
        const key = args.join(' ');
        stashCalls.push(key);
        if (key === 'rev-parse --git-dir') return okRun('/tmp/repo/.git\n');
        if (key === 'status --porcelain=v1 -z') return okRun(Buffer.from(' M a.txt\0'));
        if (key === 'stash list --format=%H') {
          return stashCalls.includes(`stash push -u -m ${DEFAULT_RESET_STASH_MESSAGE}`)
            ? okRun(`${SHA_B}\n`)
            : okRun('');
        }
        if (key === `stash push -u -m ${DEFAULT_RESET_STASH_MESSAGE}`) {
          return okRun('Saved working directory\n');
        }
        throw new Error(`unexpected stash call: ${key}`);
      }) as RollbackRunner,
    };
    const clean = { run: (async () => okRun('')) as RollbackRunner };
    const outcome = await rollbackJob(
      '/tmp/repo',
      { ref: 'HEAD' },
      { stash: true },
      { git, stash, clean }
    );
    expect(outcome.isOk()).toBe(true);
    if (outcome.isErr()) return;
    expect(outcome.value.resetRef).toBe(SHA_A);
    expect(stashCalls).toContain(`stash push -u -m ${DEFAULT_RESET_STASH_MESSAGE}`);
  });

  it('rollbackJob propagates pop failures', async () => {
    const git = resolvingRunFor(SHA_A);
    const stash = {
      run: (async (args: readonly string[]) => {
        const key = args.join(' ');
        if (key === 'rev-parse --git-dir') return okRun('/tmp/repo/.git\n');
        if (key === 'status --porcelain=v1 -z') return okRun('');
        if (key === 'stash list --format=%H') return okRun(`${SHA_B}\n`);
        if (key === 'stash pop --index')
          return failRun(1, 'error: could not restore untracked files');
        throw new Error(`unexpected stash call: ${key}`);
      }) as RollbackRunner,
    };
    const clean = { run: (async () => okRun('')) as RollbackRunner };
    const outcome = await rollbackJob(
      '/tmp/repo',
      { ref: 'HEAD', stashRef: SHA_B },
      {},
      { git, stash, clean }
    );
    expect(outcome.isErr()).toBe(true);
    if (outcome.isOk()) return;
    expect(outcome.error.code).toBe('GIT_ERROR');
    if (outcome.error.code !== 'GIT_ERROR') return;
    expect(outcome.error.message).toContain('could not restore');
  });

  it('rollbackJob fails closed on a missing expected entry', async () => {
    const git = resolvingRunFor(SHA_A);
    const stash = {
      run: (async (args: readonly string[]) => {
        const key = args.join(' ');
        if (key === 'rev-parse --git-dir') return okRun('/tmp/repo/.git\n');
        if (key === 'status --porcelain=v1 -z') return okRun('');
        if (key === 'stash list --format=%H') return okRun('');
        throw new Error(`unexpected stash call: ${key}`);
      }) as RollbackRunner,
    };
    const clean = { run: (async () => okRun('')) as RollbackRunner };
    const outcome = await rollbackJob(
      '/tmp/repo',
      { ref: 'HEAD', stashRef: SHA_B },
      {},
      { git, stash, clean }
    );
    expect(outcome.isErr()).toBe(true);
    if (outcome.isOk()) return;
    expect(outcome.error.code).toBe('INTERNAL');
    if (outcome.error.code !== 'INTERNAL') return;
    expect(outcome.error.message).toContain('expected stash entry missing');
  });

  it('rollbackJob fails closed when the final tree is unexpectedly dirty', async () => {
    const git = resolvingRunFor(SHA_A);
    let calls = 0;
    const clean = {
      run: (async () => {
        calls += 1;
        // Gate + final verify inside resetTo, then rollbackJob's own
        // final verify: only the last read sees concurrent drift.
        return calls <= 2 ? okRun('') : okRun(Buffer.from('?? raced.txt\0'));
      }) as RollbackRunner,
    };
    const outcome = await rollbackJob('/tmp/repo', { ref: 'HEAD' }, {}, { git, clean });
    expect(outcome.isErr()).toBe(true);
    if (outcome.isOk()) return;
    expect(outcome.error.code).toBe('INTERNAL');
    if (outcome.error.code !== 'INTERNAL') return;
    expect(outcome.error.message).toContain('invariant violated');
  });
});

// ─── Seams ─────────────────────────────────────────────────────────────

function resolvingRunFor(sha: string): RollbackRunner {
  return detectRun({
    [`rev-parse --verify HEAD^{commit}`]: okRun(`${sha}\n`),
    'rev-parse HEAD': okRun(`${sha}\n`),
    [`reset --hard ${sha}`]: okRun('HEAD is now there\n'),
  });
}

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
    expect(DEFAULT_ROLLBACK_TIMEOUT_MS).toBe(60_000);
  });
});
