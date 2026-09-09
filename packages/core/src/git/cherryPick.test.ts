import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { ok, err } from 'neverthrow';
import {
  cherryPickRange,
  DEFAULT_CHERRY_PICK_TIMEOUT_MS,
  type CherryPickGit,
  type CherryPickOpts,
  type CherryPickRuntime,
} from './cherryPick.js';
import type { GitFactoryOptions } from './factory.js';
import { generateFixtures, type FixtureSpec } from '../../../../scripts/generate-fixtures.js';

const execFileAsync = promisify(execFile);

function toFileUrl(dir: string): string {
  return `file:///${dir.replace(/\\/g, '/')}`;
}

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', [...args], { cwd });
  return stdout.trim();
}

async function readText(path: string): Promise<string> {
  return readFile(path, 'utf8');
}

/** True when the ref resolves (CHERRY_PICK_HEAD presence checks). */
async function refExists(cwd: string, ref: string): Promise<boolean> {
  try {
    await git(cwd, ['rev-parse', '--verify', ref]);
    return true;
  } catch {
    return false;
  }
}

const PICK_SRC: FixtureSpec = {
  name: 'pick-src',
  commits: [
    {
      message: 'base',
      files: [{ path: 'file.txt', content: { text: 'base\n' } }],
    },
    {
      message: 'feature A',
      files: [{ path: 'file.txt', content: { text: 'base\nA\n' } }],
    },
    {
      message: 'feature B',
      files: [{ path: 'b.txt', content: { text: 'B\n' } }],
    },
  ],
};

const DST_CLEAN: FixtureSpec = {
  name: 'pick-dst',
  commits: [
    {
      message: 'base',
      files: [{ path: 'file.txt', content: { text: 'base\n' } }],
    },
  ],
};

const DST_CLASH: FixtureSpec = {
  name: 'pick-clash',
  commits: [
    {
      message: 'clashing base',
      files: [{ path: 'file.txt', content: { text: 'base\nCLASH\n' } }],
    },
  ],
};

const DST_EMPTY: FixtureSpec = {
  name: 'pick-empty',
  commits: [
    {
      message: 'already has A',
      files: [{ path: 'file.txt', content: { text: 'base\nA\n' } }],
    },
  ],
};

let fixtureRoot = '';
let srcUrl = '';
let srcCommits: string[] = [];

beforeAll(async () => {
  fixtureRoot = await mkdtemp(join(tmpdir(), 'stitch-pick-src-'));
  const generated = await generateFixtures([PICK_SRC], { root: fixtureRoot });
  if (generated.isErr()) throw new Error('source fixture failed');
  const srcDir = generated.value[0];
  if (srcDir === undefined) throw new Error('source fixture generated no dir');
  srcUrl = toFileUrl(srcDir);
  srcCommits = (await git(srcDir, ['rev-list', '--reverse', '--topo-order', 'HEAD'])).split('\n');
  if (srcCommits.length !== 3) throw new Error('source fixture must have 3 commits');
}, 60000);

afterAll(async () => {
  if (fixtureRoot !== '') {
    await rm(fixtureRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
});

async function freshTarget(spec: FixtureSpec): Promise<{ root: string; target: string }> {
  const root = await mkdtemp(join(tmpdir(), 'stitch-pick-'));
  const generated = await generateFixtures([spec], { root });
  if (generated.isErr()) throw new Error('target fixture failed');
  const target = generated.value[0];
  if (target === undefined) throw new Error('target fixture generated no dir');
  // Test-side hermeticity (P-073 precedent): ambient autocrlf must not
  // rewrite the checked-out bytes the assertions compare.
  await git(target, ['config', 'core.autocrlf', 'false']);
  return { root, target };
}

async function cleanup(root: string): Promise<void> {
  await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
}

interface SeenCalls {
  raw: string[][];
  created: GitFactoryOptions[];
}

function commitOf(index: number): string {
  const sha = srcCommits[index];
  if (sha === undefined) throw new Error('source commit missing');
  return sha;
}

describe('cherryPickRange validation (no I/O)', () => {
  it('rejects bad input without spawning', async () => {
    const cases: { name: string; args: [string, string, string | string[]] }[] = [
      { name: 'blank repo', args: ['  ', srcUrl, 'abc'] },
      { name: 'blank remote', args: ['/fake/repo', ' ', 'abc'] },
      { name: 'blank range', args: ['/fake/repo', srcUrl, '  '] },
      { name: 'empty list', args: ['/fake/repo', srcUrl, []] },
      { name: 'blank sha', args: ['/fake/repo', srcUrl, ['  ']] },
    ];
    for (const { name, args } of cases) {
      const seen: SeenCalls = { raw: [], created: [] };
      const runtime: CherryPickRuntime = {
        createGit: options => {
          seen.created.push(options);
          return {
            checkIsRepo: async () => true,
            status: async () => ({ clean: true, conflicted: [], dirty: [] }),
            revparse: async () => '0'.repeat(40),
            raw: async () => '',
          };
        },
      };
      const result = await cherryPickRange(args[0], args[1], args[2], undefined, runtime);
      expect(result.isErr(), name).toBe(true);
      if (!result.isErr()) continue;
      expect(result.error.code, name).toBe('CONFIG_ERROR');
      expect(seen.created, name).toHaveLength(0);
    }
    const badTimeoutSeen: GitFactoryOptions[] = [];
    const badTimeout = await cherryPickRange(
      '/fake/repo',
      srcUrl,
      'abc',
      { timeoutMs: 0 },
      {
        createGit: options => {
          badTimeoutSeen.push(options);
          throw new Error('must not construct');
        },
      }
    );
    expect(badTimeout.isErr()).toBe(true);
    if (!badTimeout.isErr()) return;
    expect(badTimeout.error.code).toBe('CONFIG_ERROR');
    expect(badTimeoutSeen).toHaveLength(0);
  });
});

describe('cherryPickRange guards (real git)', () => {
  it('refuses a dirty worktree', async () => {
    const { root, target } = await freshTarget(DST_CLEAN);
    try {
      await writeFile(join(target, 'dirty.txt'), 'dirty\n', 'utf8');
      const result = await cherryPickRange(target, srcUrl, [commitOf(1)]);
      expect(result.isErr()).toBe(true);
      if (!result.isErr()) return;
      expect(result.error.code).toBe('GIT_ERROR');
      if (result.error.code === 'GIT_ERROR') {
        expect(result.error.message).toContain('not clean');
        expect(result.error.message).toContain('dirty.txt');
      }
    } finally {
      await cleanup(root);
    }
  }, 60000);

  it('refuses an in-progress pick without touching it', async () => {
    const { root, target } = await freshTarget(DST_CLASH);
    try {
      await git(target, ['fetch', srcUrl]);
      await git(target, ['cherry-pick', commitOf(1)]).catch(() => {});
      expect(await refExists(target, 'CHERRY_PICK_HEAD')).toBe(true);
      const result = await cherryPickRange(target, srcUrl, [commitOf(2)]);
      expect(result.isErr()).toBe(true);
      if (!result.isErr()) return;
      expect(result.error.code).toBe('GIT_ERROR');
      if (result.error.code === 'GIT_ERROR') {
        expect(result.error.message).toContain('in progress');
      }
      // Untouched: the pre-existing pick state is still there for its owner.
      expect(await refExists(target, 'CHERRY_PICK_HEAD')).toBe(true);
    } finally {
      await git(target, ['cherry-pick', '--abort']).catch(() => {});
      await cleanup(root);
    }
  }, 60000);

  it('refuses a detached HEAD', async () => {
    const { root, target } = await freshTarget(DST_CLEAN);
    try {
      await git(target, ['checkout', '--detach', 'HEAD']);
      const result = await cherryPickRange(target, srcUrl, [commitOf(1)]);
      expect(result.isErr()).toBe(true);
      if (!result.isErr()) return;
      expect(result.error.code).toBe('GIT_ERROR');
      if (result.error.code === 'GIT_ERROR') {
        expect(result.error.message).toContain('detached');
      }
    } finally {
      await cleanup(root);
    }
  }, 60000);

  it('rejects a non-repo path', async () => {
    const root = await mkdtemp(join(tmpdir(), 'stitch-pick-'));
    try {
      const result = await cherryPickRange(root, srcUrl, [commitOf(1)]);
      expect(result.isErr()).toBe(true);
      if (!result.isErr()) return;
      expect(result.error.code).toBe('GIT_ERROR');
    } finally {
      await cleanup(root);
    }
  }, 60000);

  it('rejects a repo without commits', async () => {
    const root = await mkdtemp(join(tmpdir(), 'stitch-pick-'));
    try {
      await git(root, ['init', '-b', 'main']);
      const result = await cherryPickRange(root, srcUrl, [commitOf(1)]);
      expect(result.isErr()).toBe(true);
      if (!result.isErr()) return;
      expect(result.error.code).toBe('GIT_ERROR');
      if (result.error.code === 'GIT_ERROR') {
        expect(result.error.message).toContain('no commits');
      }
    } finally {
      await cleanup(root);
    }
  }, 60000);
});

describe('cherryPickRange picking (real git)', () => {
  it('applies range', async () => {
    const { root, target } = await freshTarget(DST_CLEAN);
    try {
      const result = await cherryPickRange(target, srcUrl, `${commitOf(0)}..${commitOf(2)}`);
      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;
      expect(result.value).toHaveLength(2);
      const [first, second] = result.value;
      expect(first).toMatch(/^[0-9a-f]{40}$/);
      expect(second).toMatch(/^[0-9a-f]{40}$/);
      // New commits, oldest first — not the source SHAs.
      expect(first).not.toBe(commitOf(1));
      expect(second).not.toBe(commitOf(2));
      expect(await git(target, ['log', '--format=%s', '-1', first ?? ''])).toBe('feature A');
      expect(await git(target, ['log', '--format=%s', '-1', second ?? ''])).toBe('feature B');
      expect(await readText(join(target, 'file.txt'))).toBe('base\nA\n');
      expect(await readText(join(target, 'b.txt'))).toBe('B\n');
    } finally {
      await cleanup(root);
    }
  }, 60000);

  it('returns shas', async () => {
    const { root, target } = await freshTarget(DST_CLEAN);
    try {
      const result = await cherryPickRange(target, srcUrl, [commitOf(1)]);
      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;
      expect(result.value).toHaveLength(1);
      const [only] = result.value;
      // The returned SHA is the new HEAD: what landed, not what was asked.
      expect(only).toBe(await git(target, ['rev-parse', 'HEAD']));
      expect(await git(target, ['log', '--format=%s', '-1', 'HEAD'])).toBe('feature A');
    } finally {
      await cleanup(root);
    }
  }, 60000);

  it('conflict stops', async () => {
    const { root, target } = await freshTarget(DST_CLASH);
    try {
      const before = await git(target, ['rev-parse', 'HEAD']);
      const result = await cherryPickRange(target, srcUrl, [commitOf(1)]);
      expect(result.isErr()).toBe(true);
      if (!result.isErr()) return;
      expect(result.error.code).toBe('GIT_ERROR');
      if (result.error.code === 'GIT_ERROR') {
        // The error carries the stopping commit and the conflicted files.
        expect(result.error.message).toContain(commitOf(1));
        expect(result.error.message).toContain('file.txt');
      }
      // Reverted: HEAD unmoved, tree clean, no sequencer state lingering.
      expect(await git(target, ['rev-parse', 'HEAD'])).toBe(before);
      expect(await git(target, ['status', '--porcelain'])).toBe('');
      expect(await refExists(target, 'CHERRY_PICK_HEAD')).toBe(false);
    } finally {
      await cleanup(root);
    }
  }, 60000);

  it('failure reverts', async () => {
    const { root, target } = await freshTarget(DST_EMPTY);
    try {
      const before = await git(target, ['rev-parse', 'HEAD']);
      const result = await cherryPickRange(target, srcUrl, [commitOf(1)]);
      expect(result.isErr()).toBe(true);
      if (!result.isErr()) return;
      expect(result.error.code).toBe('GIT_ERROR');
      if (result.error.code === 'GIT_ERROR') {
        expect(result.error.message).toContain('empty');
      }
      expect(await git(target, ['rev-parse', 'HEAD'])).toBe(before);
      expect(await git(target, ['status', '--porcelain'])).toBe('');
      expect(await refExists(target, 'CHERRY_PICK_HEAD')).toBe(false);
    } finally {
      await cleanup(root);
    }
  }, 60000);

  it('rejects an unknown commit', async () => {
    const { root, target } = await freshTarget(DST_CLEAN);
    try {
      const result = await cherryPickRange(target, srcUrl, ['0'.repeat(40)]);
      expect(result.isErr()).toBe(true);
      if (!result.isErr()) return;
      expect(result.error.code).toBe('CONFIG_ERROR');
    } finally {
      await cleanup(root);
    }
  }, 60000);

  it('rejects an unresolvable range', async () => {
    const { root, target } = await freshTarget(DST_CLEAN);
    try {
      const result = await cherryPickRange(target, srcUrl, 'nope..also-nope');
      expect(result.isErr()).toBe(true);
      if (!result.isErr()) return;
      expect(result.error.code).toBe('CONFIG_ERROR');
    } finally {
      await cleanup(root);
    }
  }, 60000);

  it('rejects an empty range', async () => {
    const { root, target } = await freshTarget(DST_CLEAN);
    try {
      const result = await cherryPickRange(target, srcUrl, 'HEAD..HEAD');
      expect(result.isErr()).toBe(true);
      if (!result.isErr()) return;
      expect(result.error.code).toBe('CONFIG_ERROR');
      if (result.error.code === 'CONFIG_ERROR') {
        expect(result.error.message).toContain('no commits');
      }
    } finally {
      await cleanup(root);
    }
  }, 60000);

  it('maps a fetch failure', async () => {
    const { root, target } = await freshTarget(DST_CLEAN);
    try {
      const result = await cherryPickRange(target, toFileUrl(join(root, 'does-not-exist')), [
        commitOf(1),
      ]);
      expect(result.isErr()).toBe(true);
      if (!result.isErr()) return;
      expect(result.error.code).toBe('GIT_ERROR');
      if (result.error.code === 'GIT_ERROR') {
        expect(result.error.message).toContain('fetch failed');
      }
    } finally {
      await cleanup(root);
    }
  }, 60000);

  it('resolves through a resolver', async () => {
    const { root, target } = await freshTarget(DST_CLASH);
    try {
      const opts: CherryPickOpts = {
        resolveConflicts: async ({ commit, conflicts }) => {
          expect(commit).toBe(commitOf(1));
          expect(conflicts).toEqual(['file.txt']);
          await writeFile(join(target, 'file.txt'), 'base\nFIXED\n', 'utf8');
          return ok({ resolved: true });
        },
      };
      const result = await cherryPickRange(target, srcUrl, [commitOf(1)], opts);
      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;
      expect(result.value).toHaveLength(1);
      expect(await readText(join(target, 'file.txt'))).toBe('base\nFIXED\n');
      expect(await git(target, ['status', '--porcelain'])).toBe('');
    } finally {
      await cleanup(root);
    }
  }, 60000);

  it('reverts a declined resolution', async () => {
    const { root, target } = await freshTarget(DST_CLASH);
    try {
      const before = await git(target, ['rev-parse', 'HEAD']);
      const result = await cherryPickRange(target, srcUrl, [commitOf(1)], {
        resolveConflicts: async () => ok({ resolved: false }),
      });
      expect(result.isErr()).toBe(true);
      if (!result.isErr()) return;
      expect(result.error.code).toBe('GIT_ERROR');
      expect(await git(target, ['rev-parse', 'HEAD'])).toBe(before);
      expect(await git(target, ['status', '--porcelain'])).toBe('');
    } finally {
      await cleanup(root);
    }
  }, 60000);

  it('reverts a failed resolution', async () => {
    const { root, target } = await freshTarget(DST_CLASH);
    try {
      const before = await git(target, ['rev-parse', 'HEAD']);
      const result = await cherryPickRange(target, srcUrl, [commitOf(1)], {
        resolveConflicts: async () => err({ code: 'USER_CANCELLED', reason: 'nope' }),
      });
      expect(result.isErr()).toBe(true);
      if (!result.isErr()) return;
      expect(result.error.code).toBe('USER_CANCELLED');
      expect(await git(target, ['rev-parse', 'HEAD'])).toBe(before);
      expect(await git(target, ['status', '--porcelain'])).toBe('');
    } finally {
      await cleanup(root);
    }
  }, 60000);

  it('reverts a throwing resolver', async () => {
    const { root, target } = await freshTarget(DST_CLASH);
    try {
      const before = await git(target, ['rev-parse', 'HEAD']);
      const result = await cherryPickRange(target, srcUrl, [commitOf(1)], {
        resolveConflicts: async () => {
          throw new Error('resolver kaboom');
        },
      });
      expect(result.isErr()).toBe(true);
      if (!result.isErr()) return;
      expect(result.error.code).toBe('INTERNAL');
      expect(await git(target, ['rev-parse', 'HEAD'])).toBe(before);
      expect(await git(target, ['status', '--porcelain'])).toBe('');
    } finally {
      await cleanup(root);
    }
  }, 60000);

  it('plumbs the silence timeout', async () => {
    const { root, target } = await freshTarget(DST_CLEAN);
    try {
      const created: GitFactoryOptions[] = [];
      const failing: CherryPickRuntime = {
        createGit: options => {
          created.push(options);
          return {
            checkIsRepo: async () => true,
            status: async () => ({ clean: true, conflicted: [], dirty: [] }),
            revparse: async () => '0'.repeat(40),
            raw: async () => {
              throw new Error('fetch blew up');
            },
          };
        },
      };
      // The target is a real repo, so construction + preflights pass and the
      // failure lands on fetch — after the factory observed the timeout.
      const first = await cherryPickRange(target, srcUrl, [commitOf(1)], undefined, failing);
      expect(first.isErr()).toBe(true);
      const second = await cherryPickRange(
        target,
        srcUrl,
        [commitOf(1)],
        { timeoutMs: 5000 },
        failing
      );
      expect(second.isErr()).toBe(true);
      expect(created).toHaveLength(2);
      expect(created[0]?.timeoutMs).toBe(DEFAULT_CHERRY_PICK_TIMEOUT_MS);
      expect(created[1]?.timeoutMs).toBe(5000);
    } finally {
      await cleanup(root);
    }
  }, 60000);
});

interface PickScript {
  fetchFails?: string;
  pickFails?: string;
  continueFails?: string;
  revListHead?: string;
  revListHeadFails?: string;
  conflicted?: string[];
  skipHeadFile?: boolean;
  dirtyAfter?: boolean;
  dirtyLeftover?: boolean;
  statusFailsFirst?: string;
  inspectFails?: string;
  verifyFails?: string;
  abortFails?: string;
  addFails?: string;
  repoCheckFails?: string;
}

const SCRIPT_TIP = '1'.repeat(40);

/**
 * Scripted git: every method succeeds trivially unless scripted to fail.
 * CHERRY_PICK_HEAD state lives in a real tmp gitDir so classification
 * reads genuine fs state. Status is sequenced like real git: first call
 * clean (preflight), second reflects the pick outcome, later calls clean
 * again (post-abort world) unless dirtyAfter is set.
 */
function scriptedGit(script: PickScript, gitDir: string, calls: string[]): CherryPickGit {
  let statusCalls = 0;
  let verifyThrown = false;
  return {
    checkIsRepo: async () => {
      if (script.repoCheckFails !== undefined) throw new Error(script.repoCheckFails);
      return true;
    },
    status: async () => {
      statusCalls += 1;
      if (statusCalls === 1) {
        if (script.statusFailsFirst !== undefined) throw new Error(script.statusFailsFirst);
        return { clean: true, conflicted: [], dirty: [] };
      }
      if (statusCalls === 2) {
        if (script.inspectFails !== undefined) throw new Error(script.inspectFails);
        if (script.dirtyLeftover === true) {
          return { clean: false, conflicted: [], dirty: ['stray.txt'] };
        }
        const conflicted = script.conflicted ?? [];
        return { clean: conflicted.length === 0, conflicted, dirty: [] };
      }
      // verifyFails fires once: a throwing check followed by a working
      // one models the continue-then-revert sequence (the error that
      // matters is the first).
      if (script.verifyFails !== undefined && statusCalls >= 3 && !verifyThrown) {
        verifyThrown = true;
        throw new Error(script.verifyFails);
      }
      if (script.dirtyAfter === true) return { clean: false, conflicted: [], dirty: ['f.txt'] };
      return { clean: true, conflicted: [], dirty: [] };
    },
    revparse: async ref => {
      calls.push(`revparse:${ref}`);
      return SCRIPT_TIP;
    },
    raw: async commands => {
      calls.push(commands.join(' '));
      if (commands[0] === 'rev-parse') return gitDir;
      if (commands[0] === 'symbolic-ref') return 'refs/heads/main';
      if (commands[0] === 'fetch') {
        if (script.fetchFails !== undefined) throw new Error(script.fetchFails);
        return '';
      }
      if (commands[0] === 'rev-list') {
        if (commands.includes(`${SCRIPT_TIP}..HEAD`)) {
          if (script.revListHeadFails !== undefined) throw new Error(script.revListHeadFails);
          return script.revListHead ?? SCRIPT_TIP;
        }
        return `${'a'.repeat(40)}\n${'b'.repeat(40)}`;
      }
      if (commands[0] === 'add') {
        if (script.addFails !== undefined) throw new Error(script.addFails);
        return '';
      }
      if (commands[0] === 'cherry-pick' && commands[1] === '--abort') {
        if (script.abortFails !== undefined) throw new Error(script.abortFails);
        return '';
      }
      if (
        commands[0] === 'cherry-pick' &&
        commands[1] !== '--abort' &&
        commands[1] !== '--continue'
      ) {
        if (script.pickFails !== undefined) {
          // Simulate git's side effect: a conflicting pick leaves sequencer
          // state, created mid-run (never pre-existing, or the overlap
          // guard would — correctly — refuse). Stateless failures leave
          // nothing behind.
          if (script.conflicted !== undefined && script.skipHeadFile !== true) {
            await writeFile(join(gitDir, 'CHERRY_PICK_HEAD'), `${'c'.repeat(40)}\n`, 'utf8');
          }
          throw new Error(script.pickFails);
        }
        return '';
      }
      if (commands[1] === '--continue') {
        if (script.continueFails !== undefined) throw new Error(script.continueFails);
        return '';
      }
      return '';
    },
  };
}

describe('cherryPickRange scripted (P-074 failure paths)', () => {
  async function runScripted(
    script: PickScript,
    opts?: CherryPickOpts
  ): Promise<{ calls: string[]; result: Awaited<ReturnType<typeof cherryPickRange>> }> {
    const root = await mkdtemp(join(tmpdir(), 'stitch-pick-scripted-'));
    const gitDir = join(root, 'gitdir');
    await mkdir(gitDir, { recursive: true });
    const calls: string[] = [];
    const secretRemote = 'https://user:s3cret@example.com/r.git';
    try {
      const runtime: CherryPickRuntime = {
        createGit: () => scriptedGit(script, gitDir, calls),
      };
      const result = await cherryPickRange(
        join(root, 'repo'),
        secretRemote,
        ['d'.repeat(40)],
        opts,
        runtime
      );
      return { calls, result };
    } finally {
      await cleanup(root);
    }
  }

  it('scrubs secrets from fetch failures', async () => {
    const { result } = await runScripted({ fetchFails: 'fatal: unable to connect' });
    expect(result.isErr()).toBe(true);
    if (!result.isErr()) return;
    expect(result.error.code).toBe('GIT_ERROR');
    expect(JSON.stringify(result.error)).not.toContain('s3cret');
    if (result.error.code === 'GIT_ERROR') {
      expect(result.error.message).toContain('fetch failed');
    }
  });

  it('aborts when continuing fails', async () => {
    const { calls, result } = await runScripted(
      {
        pickFails: 'conflict!',
        conflicted: ['f.txt'],
        continueFails: 'cannot continue',
      },
      { resolveConflicts: async () => ok({ resolved: true }) }
    );
    expect(result.isErr()).toBe(true);
    if (!result.isErr()) return;
    expect(result.error.code).toBe('GIT_ERROR');
    if (result.error.code === 'GIT_ERROR') {
      expect(result.error.message).toContain('continue');
    }
    expect(calls).toContain('cherry-pick --abort');
  });

  it('rejects a pick that left no new commits', async () => {
    const { result } = await runScripted({ revListHead: '' });
    expect(result.isErr()).toBe(true);
    if (!result.isErr()) return;
    expect(result.error.code).toBe('GIT_ERROR');
    if (result.error.code === 'GIT_ERROR') {
      expect(result.error.message).toContain('no new commits');
    }
  });

  it('reports leftover dirt without reverting a landed pick', async () => {
    const { calls, result } = await runScripted(
      { pickFails: 'conflict!', conflicted: ['f.txt'], dirtyAfter: true },
      { resolveConflicts: async () => ok({ resolved: true }) }
    );
    expect(result.isErr()).toBe(true);
    if (!result.isErr()) return;
    expect(result.error.code).toBe('GIT_ERROR');
    if (result.error.code === 'GIT_ERROR') {
      expect(result.error.message).toContain('uncommitted changes after continue');
    }
    expect(calls).not.toContain('cherry-pick --abort');
  });

  it('maps a preflight status failure', async () => {
    const { result } = await runScripted({ statusFailsFirst: 'status blew up' });
    expect(result.isErr()).toBe(true);
    if (!result.isErr()) return;
    expect(result.error.code).toBe('GIT_ERROR');
    if (result.error.code === 'GIT_ERROR') {
      expect(result.error.message).toContain('cherry-pick status');
    }
  });

  it('classifies a stateless failure with the raw detail', async () => {
    const { result } = await runScripted({ pickFails: 'mysterious frontal failure' });
    expect(result.isErr()).toBe(true);
    if (!result.isErr()) return;
    expect(result.error.code).toBe('GIT_ERROR');
    if (result.error.code === 'GIT_ERROR') {
      expect(result.error.message).toContain('mysterious frontal failure');
    }
  });

  it('maps an inspection failure to the pick error', async () => {
    const { result } = await runScripted({
      pickFails: 'the pick itself failed',
      conflicted: ['f.txt'],
      inspectFails: 'cannot inspect',
    });
    expect(result.isErr()).toBe(true);
    if (!result.isErr()) return;
    expect(result.error.code).toBe('GIT_ERROR');
    if (result.error.code === 'GIT_ERROR') {
      expect(result.error.message).toContain('the pick itself failed');
    }
  });

  it('names an unknown stopping commit', async () => {
    const { result } = await runScripted({
      pickFails: 'conflict!',
      conflicted: ['f.txt'],
      skipHeadFile: true,
    });
    expect(result.isErr()).toBe(true);
    if (!result.isErr()) return;
    expect(result.error.code).toBe('GIT_ERROR');
    if (result.error.code === 'GIT_ERROR') {
      expect(result.error.message).toContain('unknown commit');
      expect(result.error.message).toContain('f.txt');
    }
  });

  it('reports an abort failure with context', async () => {
    const { result } = await runScripted({
      pickFails: 'conflict!',
      conflicted: ['f.txt'],
      abortFails: 'cannot abort',
    });
    expect(result.isErr()).toBe(true);
    if (!result.isErr()) return;
    expect(result.error.code).toBe('GIT_ERROR');
    if (result.error.code === 'GIT_ERROR') {
      expect(result.error.message).toContain('abort failed');
      expect(result.error.message).toContain('while reverting');
    }
  });

  it('maps a lookup failure for new commits', async () => {
    const { result } = await runScripted({ revListHeadFails: 'log blew up' });
    expect(result.isErr()).toBe(true);
    if (!result.isErr()) return;
    expect(result.error.code).toBe('GIT_ERROR');
    if (result.error.code === 'GIT_ERROR') {
      expect(result.error.message).toContain('new commits lookup');
    }
  });

  it('maps a stage failure', async () => {
    const { result } = await runScripted(
      { pickFails: 'conflict!', conflicted: ['f.txt'], addFails: 'cannot stage' },
      { resolveConflicts: async () => ok({ resolved: true }) }
    );
    expect(result.isErr()).toBe(true);
    if (!result.isErr()) return;
    expect(result.error.code).toBe('GIT_ERROR');
    if (result.error.code === 'GIT_ERROR') {
      expect(result.error.message).toContain('stage resolved');
    }
  });

  it('maps a factory failure', async () => {
    const root = await mkdtemp(join(tmpdir(), 'stitch-pick-scripted-'));
    try {
      const result = await cherryPickRange(
        join(root, 'repo'),
        'file:///fake',
        ['d'.repeat(40)],
        undefined,
        {
          createGit: (): never => {
            throw new Error('factory blew up');
          },
        }
      );
      expect(result.isErr()).toBe(true);
      if (!result.isErr()) return;
      expect(result.error.code).toBe('GIT_ERROR');
      if (result.error.code === 'GIT_ERROR') {
        expect(result.error.message).toContain('git client init');
      }
    } finally {
      await cleanup(root);
    }
  });

  it('maps a repo check failure', async () => {
    const { result } = await runScripted({ repoCheckFails: 'repo check blew up' });
    expect(result.isErr()).toBe(true);
    if (!result.isErr()) return;
    expect(result.error.code).toBe('GIT_ERROR');
    if (result.error.code === 'GIT_ERROR') {
      expect(result.error.message).toContain('repo check');
    }
  });

  it('reports leftover dirt without conflicts', async () => {
    const { result } = await runScripted({
      pickFails: 'stopped oddly',
      dirtyLeftover: true,
    });
    expect(result.isErr()).toBe(true);
    if (!result.isErr()) return;
    expect(result.error.code).toBe('GIT_ERROR');
    if (result.error.code === 'GIT_ERROR') {
      expect(result.error.message).toContain('uncommitted changes but no conflicts');
      expect(result.error.message).toContain('stray.txt');
    }
  });

  it('reports a verify failure after abort', async () => {
    const { result } = await runScripted({
      pickFails: 'conflict!',
      conflicted: ['f.txt'],
      verifyFails: 'cannot verify',
    });
    expect(result.isErr()).toBe(true);
    if (!result.isErr()) return;
    expect(result.error.code).toBe('GIT_ERROR');
    if (result.error.code === 'GIT_ERROR') {
      expect(result.error.message).toContain('verify status');
    }
  });

  it('reports a verify failure after continue', async () => {
    const { result } = await runScripted(
      { pickFails: 'conflict!', conflicted: ['f.txt'], verifyFails: 'cannot verify' },
      { resolveConflicts: async () => ok({ resolved: true }) }
    );
    expect(result.isErr()).toBe(true);
    if (!result.isErr()) return;
    expect(result.error.code).toBe('GIT_ERROR');
    if (result.error.code === 'GIT_ERROR') {
      expect(result.error.message).toContain('verify resolved');
    }
  });

  it('carries a cancellation through an abort failure', async () => {
    const { result } = await runScripted(
      { pickFails: 'conflict!', conflicted: ['f.txt'], abortFails: 'cannot abort' },
      { resolveConflicts: async () => err({ code: 'USER_CANCELLED', reason: 'nope' }) }
    );
    expect(result.isErr()).toBe(true);
    if (!result.isErr()) return;
    // The abort failure surfaces, with the original cancellation summarized.
    expect(result.error.code).toBe('GIT_ERROR');
    if (result.error.code === 'GIT_ERROR') {
      expect(result.error.message).toContain('abort failed');
      expect(result.error.message).toContain('cancelled: nope');
    }
  });

  it('dumps exotic errors through an abort failure', async () => {
    const { result } = await runScripted(
      { pickFails: 'conflict!', conflicted: ['f.txt'], abortFails: 'cannot abort' },
      { resolveConflicts: async () => err({ code: 'UNKNOWN_LICENSE', id: 'NOASSERTION' }) }
    );
    expect(result.isErr()).toBe(true);
    if (!result.isErr()) return;
    expect(result.error.code).toBe('GIT_ERROR');
    if (result.error.code === 'GIT_ERROR') {
      expect(result.error.message).toContain('UNKNOWN_LICENSE');
    }
  });

  it('maps a lookup failure after continue', async () => {
    const { result } = await runScripted(
      { pickFails: 'conflict!', conflicted: ['f.txt'], revListHeadFails: 'log blew up' },
      { resolveConflicts: async () => ok({ resolved: true }) }
    );
    expect(result.isErr()).toBe(true);
    if (!result.isErr()) return;
    expect(result.error.code).toBe('GIT_ERROR');
    if (result.error.code === 'GIT_ERROR') {
      expect(result.error.message).toContain('new commits lookup');
    }
  });
});
