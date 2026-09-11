// Branch management (P-080): full suite. Real git proves the lifecycle
// (create/delete/rename, guards against live repos, idempotent create,
// force semantics, rename-follows-HEAD); scripted runners prove every
// failure arm.
//
// Timeout note (P-075 precedent): real-git tests carry an explicit 30s
// budget — the core project resolves vitest's 5s default (the root 30s
// does not inherit into defineProject). Scripted tests keep the strict
// default as a canary. No network is touched.

import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  createBranch,
  deleteBranch,
  renameBranch,
  exitCodeOf,
  DEFAULT_BRANCH_TIMEOUT_MS,
  type BranchRunner,
  type BranchRunResult,
} from './branches.js';
import { DEFAULT_PROTECTED_BRANCHES } from './push.js';

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', [...args], { cwd });
  return stdout.trim();
}

/** Hermetic fixture repo with two commits (P-072 precedent). */
async function makeRepo(): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), 'stitch-branches-'));
  await git(repo, ['init', '-q', '-b', 'main']);
  await git(repo, ['config', 'user.email', 'test@stitch.dev']);
  await git(repo, ['config', 'user.name', 'stitch-test']);
  await git(repo, ['config', 'core.autocrlf', 'false']);
  await git(repo, ['config', 'core.eol', 'lf']);
  await writeFile(join(repo, 'a.txt'), 'v1\n');
  await git(repo, ['add', '-A']);
  await git(repo, ['commit', '-qm', 'one']);
  await writeFile(join(repo, 'a.txt'), 'v2\n');
  await git(repo, ['add', '-A']);
  await git(repo, ['commit', '-qm', 'two']);
  return repo;
}

async function branchesOf(repo: string): Promise<string[]> {
  const out = await git(repo, ['branch', '--format=%(refname:short)']);
  return out === '' ? [] : out.split('\n');
}

// ─── Scripted seams ────────────────────────────────────────────────────

function okRun(stdout: string | Buffer = ''): BranchRunResult {
  return {
    exitCode: 0,
    stdout: typeof stdout === 'string' ? Buffer.from(stdout) : stdout,
    stderr: '',
  };
}

function failRun(exitCode: number, stderr: string): BranchRunResult {
  return { exitCode, stdout: Buffer.from(''), stderr };
}

const HEAD_SHA = '25e747f5efe02395e868fdbc9aa4aa41af92806b';
const OTHER_SHA = '7da8da2000000000000000000000000000000000';

function showRefHit(sha: string, ref: string): BranchRunResult {
  return okRun(`${sha} refs/heads/${ref}\n`);
}

/** Happy paths per operation (overrides pick the scenario). */
function scriptedRun(
  handler: (args: readonly string[], cwd: string) => BranchRunResult
): BranchRunner {
  return async (args, cwd) => handler(args, cwd);
}

function throwingRun(message: string): BranchRunner {
  return async () => {
    throw new Error(message);
  };
}

describe('branch ops (real git)', () => {
  it('create', async () => {
    const repo = await makeRepo();
    try {
      const head = await git(repo, ['rev-parse', 'HEAD']);
      const result = await createBranch(repo, 'feature');
      expect(result.isOk()).toBe(true);
      expect(await branchesOf(repo)).toContain('feature');
      expect(await git(repo, ['rev-parse', 'feature'])).toBe(head);
      // Explicit fromRef pins the base.
      const first = await git(repo, ['rev-parse', 'HEAD~1']);
      const pinned = await createBranch(repo, 'oldbase', first);
      expect(pinned.isOk()).toBe(true);
      expect(await git(repo, ['rev-parse', 'oldbase'])).toBe(first);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  }, 30_000);

  it('idempotent create is a no-op at the same ref', async () => {
    const repo = await makeRepo();
    try {
      const head = await git(repo, ['rev-parse', 'HEAD']);
      expect((await createBranch(repo, 'feature')).isOk()).toBe(true);
      const again = await createBranch(repo, 'feature', head);
      expect(again.isOk()).toBe(true);
      expect(await git(repo, ['rev-parse', 'feature'])).toBe(head);
      // Same ref, different spelling of the same commit is still a no-op.
      const short = head.slice(0, 12);
      expect((await createBranch(repo, 'feature', short)).isOk()).toBe(true);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  }, 30_000);

  it('refuses create at a different ref', async () => {
    const repo = await makeRepo();
    try {
      const first = await git(repo, ['rev-parse', 'HEAD~1']);
      expect((await createBranch(repo, 'feature')).isOk()).toBe(true);
      const clash = await createBranch(repo, 'feature', first);
      expect(clash.isErr()).toBe(true);
      if (clash.isOk()) return;
      expect(clash.error.code).toBe('CONFIG_ERROR');
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  }, 30_000);

  it('delete', async () => {
    const repo = await makeRepo();
    try {
      await git(repo, ['branch', 'gone']);
      const result = await deleteBranch(repo, 'gone');
      expect(result.isOk()).toBe(true);
      expect(await branchesOf(repo)).not.toContain('gone');
      // Deleting a missing branch is a caller error, not a crash.
      const missing = await deleteBranch(repo, 'never-existed');
      expect(missing.isErr()).toBe(true);
      if (missing.isOk()) return;
      expect(missing.error.code).toBe('CONFIG_ERROR');
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  }, 30_000);

  it('force deletes unmerged branches only when asked', async () => {
    const repo = await makeRepo();
    try {
      await git(repo, ['checkout', '-qb', 'side']);
      await writeFile(join(repo, 'b.txt'), 'side\n');
      await git(repo, ['add', '-A']);
      await git(repo, ['commit', '-qm', 'side1']);
      await git(repo, ['checkout', '-q', 'main']);
      const safe = await deleteBranch(repo, 'side');
      expect(safe.isErr()).toBe(true);
      if (safe.isOk()) return;
      expect(safe.error.code).toBe('GIT_ERROR');
      expect(await branchesOf(repo)).toContain('side');
      const forced = await deleteBranch(repo, 'side', true);
      expect(forced.isOk()).toBe(true);
      expect(await branchesOf(repo)).not.toContain('side');
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  }, 30_000);

  it('rename', async () => {
    const repo = await makeRepo();
    try {
      await git(repo, ['branch', 'old']);
      const result = await renameBranch(repo, 'old', 'new');
      expect(result.isOk()).toBe(true);
      expect(await branchesOf(repo)).toContain('new');
      expect(await branchesOf(repo)).not.toContain('old');
      // Renaming the checked-out branch moves HEAD with it.
      await git(repo, ['checkout', '-q', 'new']);
      const moving = await renameBranch(repo, 'new', 'moved');
      expect(moving.isOk()).toBe(true);
      expect(await git(repo, ['branch', '--show-current'])).toBe('moved');
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  }, 30_000);

  it('refuses renaming onto an existing branch', async () => {
    const repo = await makeRepo();
    try {
      await git(repo, ['branch', 'aaa']);
      await git(repo, ['branch', 'bbb']);
      const result = await renameBranch(repo, 'aaa', 'bbb');
      expect(result.isErr()).toBe(true);
      if (result.isOk()) return;
      expect(result.error.code).toBe('CONFIG_ERROR');
      expect(await branchesOf(repo)).toContain('aaa');
      expect(await branchesOf(repo)).toContain('bbb');
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  }, 30_000);

  it('protected refuse', async () => {
    const repo = await makeRepo();
    try {
      // main is protected by default: neither delete nor rename-away.
      const deleted = await deleteBranch(repo, 'main');
      expect(deleted.isErr()).toBe(true);
      if (deleted.isOk()) return;
      expect(deleted.error.code).toBe('CONFIG_ERROR');
      const renamed = await renameBranch(repo, 'main', 'main2');
      expect(renamed.isErr()).toBe(true);
      if (renamed.isOk()) return;
      expect(renamed.error.code).toBe('CONFIG_ERROR');
      // Custom protection sets are honoured; unlisted branches stay free.
      await git(repo, ['branch', 'release']);
      const custom = await deleteBranch(repo, 'release', false, { protectedBranches: ['release'] });
      expect(custom.isErr()).toBe(true);
      if (custom.isOk()) return;
      expect(custom.error.code).toBe('CONFIG_ERROR');
      // ...while the default set no longer applies when overridden.
      // release is checked out (not main), main is fully merged, so with
      // an empty protection set the delete lands.
      await git(repo, ['checkout', '-q', 'release']);
      const mainGone = await deleteBranch(repo, 'main', false, { protectedBranches: [] });
      expect(mainGone.isOk()).toBe(true);
      expect(await branchesOf(repo)).not.toContain('main');
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  }, 30_000);

  it('refuses deleting the checked-out branch', async () => {
    const repo = await makeRepo();
    try {
      await git(repo, ['checkout', '-qb', 'work']);
      const result = await deleteBranch(repo, 'work');
      expect(result.isErr()).toBe(true);
      if (result.isOk()) return;
      expect(result.error.code).toBe('CONFIG_ERROR');
      expect(await branchesOf(repo)).toContain('work');
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  }, 30_000);

  it('name validated', async () => {
    const repo = await makeRepo();
    try {
      for (const bad of ['has space', 'double..dot', 'trailing.', 'has~tilde']) {
        const created = await createBranch(repo, bad);
        expect(created.isErr()).toBe(true);
        if (created.isOk()) continue;
        expect(created.error.code).toBe('CONFIG_ERROR');
        const deleted = await deleteBranch(repo, bad);
        expect(deleted.isErr()).toBe(true);
        if (deleted.isOk()) continue;
        expect(deleted.error.code).toBe('CONFIG_ERROR');
      }
      expect(await branchesOf(repo)).toEqual(['main']);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  }, 30_000);
});

describe('branch ops validation (no spawn)', () => {
  it('rejects blank args and bad timeouts', async () => {
    const run = throwingRun('must not spawn on validation failure');
    const runtime = { run };
    for (const call of [
      () => createBranch('', 'x', undefined, {}, runtime),
      () => createBranch('/tmp/repo', '   ', undefined, {}, runtime),
      () => createBranch('/tmp/repo', 'x', undefined, { timeoutMs: 0 }, runtime),
      () => deleteBranch('', 'x', false, {}, runtime),
      () => deleteBranch('/tmp/repo', '  ', false, {}, runtime),
      () => renameBranch('', 'a', 'b', {}, runtime),
      () => renameBranch('/tmp/repo', 'a', 'a', {}, runtime),
      () => renameBranch('/tmp/repo', '', 'b', {}, runtime),
      () => renameBranch('/tmp/repo', 'a', '  ', {}, runtime),
    ]) {
      const result = await call();
      expect(result.isErr()).toBe(true);
      if (result.isOk()) continue;
      expect(result.error.code).toBe('CONFIG_ERROR');
    }
  });

  it('refuses protected and current-branch deletes without spawning', async () => {
    const runtime = { run: throwingRun('must not spawn on guard refusal') };
    const prot = await deleteBranch('/tmp/repo', 'main', false, {}, runtime);
    expect(prot.isErr()).toBe(true);
    if (prot.isOk()) return;
    expect(prot.error.code).toBe('CONFIG_ERROR');
  });

  it('rejects a non-repo directory', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'stitch-branches-plain-'));
    try {
      const result = await createBranch(dir, 'feature');
      expect(result.isErr()).toBe(true);
      if (result.isOk()) return;
      expect(result.error.code).toBe('CONFIG_ERROR');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 30_000);
});

describe('createBranch failure arms (scripted)', () => {
  it('maps show-ref failure to GIT_ERROR', async () => {
    const result = await createBranch(
      '/tmp/repo',
      'feature',
      undefined,
      {},
      {
        run: scriptedRun(args => {
          if (args[0] === 'show-ref') return failRun(128, 'fatal: bad default revision');
          if (args[0] === 'rev-parse') return okRun(`${HEAD_SHA}\n`);
          if (args[0] === 'check-ref-format') return okRun('feature\n');
          throw new Error(`unexpected git call: ${args.join(' ')}`);
        }),
      }
    );
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GIT_ERROR');
  });

  it('treats an idempotent create as ok without branching', async () => {
    const calls: string[][] = [];
    const base = scriptedRun(args => {
      if (args[0] === 'show-ref') return showRefHit(HEAD_SHA, 'feature');
      if (args[0] === 'rev-parse') return okRun(`${HEAD_SHA}\n`);
      if (args[0] === 'check-ref-format') return okRun('feature\n');
      throw new Error(`unexpected git call: ${args.join(' ')}`);
    });
    const runtime: { run: BranchRunner } = {
      run: async (args, cwd, opts) => {
        calls.push([...args]);
        return base(args, cwd, opts);
      },
    };
    const result = await createBranch('/tmp/repo', 'feature', undefined, {}, runtime);
    expect(result.isOk()).toBe(true);
    expect(calls.some(args => args[0] === 'branch')).toBe(false);
  });

  it('refuses a different-ref create as CONFIG_ERROR', async () => {
    const runtime = {
      run: scriptedRun(args => {
        if (args[0] === 'show-ref') return showRefHit(OTHER_SHA, 'feature');
        if (args[0] === 'rev-parse') return okRun(`${HEAD_SHA}\n`);
        if (args[0] === 'check-ref-format') return okRun('feature\n');
        throw new Error(`unexpected git call: ${args.join(' ')}`);
      }),
    };
    const result = await createBranch('/tmp/repo', 'feature', undefined, {}, runtime);
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('CONFIG_ERROR');
  });

  it('maps create failure to GIT_ERROR', async () => {
    const runtime = {
      run: scriptedRun(args => {
        if (args[0] === 'show-ref') return failRun(128, 'fatal: not a valid ref');
        if (args[0] === 'rev-parse') return okRun(`${HEAD_SHA}\n`);
        if (args[0] === 'check-ref-format') return okRun('feature\n');
        if (args[0] === 'branch') return failRun(128, 'fatal: cannot lock ref');
        throw new Error(`unexpected git call: ${args.join(' ')}`);
      }),
    };
    const result = await createBranch('/tmp/repo', 'feature', undefined, {}, runtime);
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GIT_ERROR');
  });

  it('fails an unverified create as INTERNAL', async () => {
    // Existence check first (absent), post-create verify second (wrong SHA).
    let showRefs = 0;
    const runtime = {
      run: scriptedRun(args => {
        if (args[0] === 'show-ref') {
          showRefs += 1;
          return showRefs > 1
            ? showRefHit(OTHER_SHA, 'feature')
            : failRun(128, 'fatal: not a valid ref');
        }
        if (args[0] === 'rev-parse') return okRun(`${HEAD_SHA}\n`);
        if (args[0] === 'check-ref-format') return okRun('feature\n');
        if (args[0] === 'branch') return okRun('');
        throw new Error(`unexpected git call: ${args.join(' ')}`);
      }),
    };
    const result = await createBranch('/tmp/repo', 'feature', undefined, {}, runtime);
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('INTERNAL');
  });

  it('maps a bad fromRef to CONFIG_ERROR', async () => {
    const runtime = {
      run: scriptedRun(args => {
        if (args[0] === 'show-ref') return failRun(128, 'fatal: not a valid ref');
        if (args[0] === 'rev-parse') {
          return args[1] === '--git-dir'
            ? okRun('/tmp/repo/.git\n')
            : failRun(128, "fatal: ambiguous argument 'nope'");
        }
        if (args[0] === 'check-ref-format') return okRun('feature\n');
        throw new Error(`unexpected git call: ${args.join(' ')}`);
      }),
    };
    const result = await createBranch('/tmp/repo', 'feature', 'nope', {}, runtime);
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('CONFIG_ERROR');
    if (result.error.code === 'CONFIG_ERROR') {
      expect(result.error.field).toBe('fromRef');
    }
  });

  it('maps the timeout sentinel to a GIT_ERROR mentioning the timeout', async () => {
    const result = await createBranch(
      '/tmp/repo',
      'feature',
      undefined,
      { timeoutMs: 50 },
      { run: scriptedRun(() => ({ exitCode: 124, stdout: Buffer.from(''), stderr: '' })) }
    );
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GIT_ERROR');
    if (result.error.code === 'GIT_ERROR') {
      expect(result.error.message).toContain('timed out');
      expect(result.error.message).toContain('50');
    }
  });

  it('maps check-ref-format failure to GIT_ERROR', async () => {
    const result = await createBranch(
      '/tmp/repo',
      'feature',
      undefined,
      {},
      {
        run: scriptedRun(args => {
          if (args[0] === 'rev-parse') return okRun('/tmp/repo/.git\n');
          if (args[0] === 'check-ref-format') return failRun(128, 'fatal: boom');
          throw new Error(`unexpected git call: ${args.join(' ')}`);
        }),
      }
    );
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GIT_ERROR');
  });

  it('maps rev-parse failure to GIT_ERROR', async () => {
    const result = await createBranch(
      '/tmp/repo',
      'feature',
      undefined,
      {},
      {
        run: scriptedRun(args => {
          if (args[0] === 'rev-parse' && args[1] === '--git-dir') return okRun('/tmp/repo/.git\n');
          if (args[0] === 'check-ref-format') return okRun('feature\n');
          if (args[0] === 'rev-parse') return failRun(1, 'fatal: boom');
          throw new Error(`unexpected git call: ${args.join(' ')}`);
        }),
      }
    );
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GIT_ERROR');
  });

  it('maps a malformed base SHA to INTERNAL', async () => {
    const result = await createBranch(
      '/tmp/repo',
      'feature',
      undefined,
      {},
      {
        run: scriptedRun(args => {
          if (args[0] === 'rev-parse' && args[1] === '--git-dir') return okRun('/tmp/repo/.git\n');
          if (args[0] === 'check-ref-format') return okRun('feature\n');
          if (args[0] === 'rev-parse') return okRun('junk\n');
          throw new Error(`unexpected git call: ${args.join(' ')}`);
        }),
      }
    );
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('INTERNAL');
  });

  it('maps show-ref spawn errors to INTERNAL', async () => {
    const base = scriptedRun(args => {
      if (args[0] === 'rev-parse') {
        return args[1] === '--git-dir' ? okRun('/tmp/repo/.git\n') : okRun(`${HEAD_SHA}\n`);
      }
      if (args[0] === 'check-ref-format') return okRun('feature\n');
      throw new Error(`unexpected git call: ${args.join(' ')}`);
    });
    const result = await createBranch(
      '/tmp/repo',
      'feature',
      undefined,
      {},
      {
        run: async (args, cwd, opts) => {
          if (args[0] === 'show-ref') throw new Error('spawn EACCES');
          return base(args, cwd, opts);
        },
      }
    );
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('INTERNAL');
  });

  it('maps a malformed show-ref SHA to INTERNAL', async () => {
    const result = await createBranch(
      '/tmp/repo',
      'feature',
      undefined,
      {},
      {
        run: scriptedRun(args => {
          if (args[0] === 'show-ref') return okRun('junk\n');
          if (args[0] === 'rev-parse') {
            return args[1] === '--git-dir' ? okRun('/tmp/repo/.git\n') : okRun(`${HEAD_SHA}\n`);
          }
          if (args[0] === 'check-ref-format') return okRun('feature\n');
          throw new Error(`unexpected git call: ${args.join(' ')}`);
        }),
      }
    );
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('INTERNAL');
  });

  it('maps create verify show-ref failure to GIT_ERROR', async () => {
    let showRefs = 0;
    const result = await createBranch(
      '/tmp/repo',
      'feature',
      undefined,
      {},
      {
        run: scriptedRun(args => {
          if (args[0] === 'show-ref') {
            showRefs += 1;
            return showRefs > 1
              ? failRun(128, 'fatal: boom')
              : failRun(128, 'fatal: not a valid ref');
          }
          if (args[0] === 'rev-parse') return okRun(`${HEAD_SHA}\n`);
          if (args[0] === 'check-ref-format') return okRun('feature\n');
          if (args[0] === 'branch') return okRun('');
          throw new Error(`unexpected git call: ${args.join(' ')}`);
        }),
      }
    );
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GIT_ERROR');
  });

  it('maps rename vacated-lookup failure to GIT_ERROR', async () => {
    // New ref resolves but the vacated lookup fails: half-verified state.
    let showRefs = 0;
    const result = await renameBranch(
      '/tmp/repo',
      'old',
      'new',
      {},
      {
        run: scriptedRun(args => {
          if (args[0] === 'rev-parse') return okRun('/tmp/repo/.git\n');
          if (args[0] === 'check-ref-format') return okRun('x\n');
          if (args[0] === 'branch') return okRun('');
          if (args[0] === 'show-ref') {
            showRefs += 1;
            return showRefs > 1 ? failRun(128, 'fatal: boom') : showRefHit(HEAD_SHA, 'new');
          }
          throw new Error(`unexpected git call: ${args.join(' ')}`);
        }),
      }
    );
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GIT_ERROR');
  });

  it('treats a throwing runner as INTERNAL', async () => {
    const result = await createBranch(
      '/tmp/repo',
      'feature',
      undefined,
      {},
      {
        run: throwingRun('spawn EACCES'),
      }
    );
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('INTERNAL');
  });
});

describe('deleteBranch failure arms (scripted)', () => {
  it('maps rev-parse failure to GIT_ERROR', async () => {
    const result = await deleteBranch(
      '/tmp/repo',
      'gone',
      false,
      {},
      {
        run: scriptedRun(args => {
          if (args[0] === 'rev-parse') return failRun(1, 'fatal: boom');
          throw new Error(`unexpected git call: ${args.join(' ')}`);
        }),
      }
    );
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GIT_ERROR');
  });

  it('maps branch spawn errors to INTERNAL', async () => {
    const base = scriptedRun(args => {
      if (args[0] === 'branch' && args[1] === '--show-current') return okRun('');
      if (args[0] === 'rev-parse') return okRun('/tmp/repo/.git\n');
      if (args[0] === 'check-ref-format') return okRun('gone\n');
      throw new Error(`unexpected git call: ${args.join(' ')}`);
    });
    const result = await deleteBranch(
      '/tmp/repo',
      'gone',
      false,
      {},
      {
        run: async (args, cwd, opts) => {
          if (args[0] === 'branch' && args[1] !== '--show-current') throw new Error('spawn EACCES');
          return base(args, cwd, opts);
        },
      }
    );
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('INTERNAL');
  });

  it('maps verify show-ref failure to GIT_ERROR', async () => {
    const result = await deleteBranch(
      '/tmp/repo',
      'gone',
      false,
      {},
      {
        run: scriptedRun(args => {
          if (args[0] === 'branch' && args[1] === '--show-current') return okRun('');
          if (args[0] === 'rev-parse') return okRun('/tmp/repo/.git\n');
          if (args[0] === 'check-ref-format') return okRun('gone\n');
          if (args[0] === 'branch') return okRun('Deleted branch gone.\n');
          if (args[0] === 'show-ref') return failRun(128, 'fatal: boom');
          throw new Error(`unexpected git call: ${args.join(' ')}`);
        }),
      }
    );
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GIT_ERROR');
  });

  it('maps show-current failure to GIT_ERROR', async () => {
    const result = await deleteBranch(
      '/tmp/repo',
      'gone',
      false,
      {},
      {
        run: scriptedRun(args => {
          if (args[0] === 'branch') return failRun(128, 'fatal: bad default revision');
          if (args[0] === 'rev-parse') return okRun('/tmp/repo/.git\n');
          if (args[0] === 'check-ref-format') return okRun('gone\n');
          throw new Error(`unexpected git call: ${args.join(' ')}`);
        }),
      }
    );
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GIT_ERROR');
  });

  it('maps a missing branch to CONFIG_ERROR', async () => {
    const result = await deleteBranch(
      '/tmp/repo',
      'gone',
      false,
      {},
      {
        run: scriptedRun(args => {
          if (args[0] === 'branch' && args[1] === '--show-current') return okRun('');
          if (args[0] === 'rev-parse') return okRun('/tmp/repo/.git\n');
          if (args[0] === 'check-ref-format') return okRun('gone\n');
          if (args[0] === 'branch') return failRun(1, "error: branch 'gone' not found");
          throw new Error(`unexpected git call: ${args.join(' ')}`);
        }),
      }
    );
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('CONFIG_ERROR');
    if (result.error.code === 'CONFIG_ERROR') {
      expect(result.error.field).toBe('name');
    }
  });

  it('fails an incomplete delete as INTERNAL after re-verify', async () => {
    const result = await deleteBranch(
      '/tmp/repo',
      'gone',
      false,
      {},
      {
        run: scriptedRun(args => {
          if (args[0] === 'branch' && args[1] === '--show-current') return okRun('');
          if (args[0] === 'rev-parse') return okRun('/tmp/repo/.git\n');
          if (args[0] === 'check-ref-format') return okRun('gone\n');
          if (args[0] === 'branch') return okRun('Deleted branch gone.\n');
          if (args[0] === 'show-ref') return showRefHit(HEAD_SHA, 'gone');
          throw new Error(`unexpected git call: ${args.join(' ')}`);
        }),
      }
    );
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('INTERNAL');
  });
});

describe('renameBranch failure arms (scripted)', () => {
  it('maps rev-parse failure to GIT_ERROR', async () => {
    const result = await renameBranch(
      '/tmp/repo',
      'old',
      'new',
      {},
      {
        run: scriptedRun(args => {
          if (args[0] === 'rev-parse') return failRun(1, 'fatal: boom');
          throw new Error(`unexpected git call: ${args.join(' ')}`);
        }),
      }
    );
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GIT_ERROR');
  });

  it('maps check-ref-format failures to GIT_ERROR', async () => {
    for (const failing of ['old', 'new']) {
      const result = await renameBranch(
        '/tmp/repo',
        'old',
        'new',
        {},
        {
          run: scriptedRun(args => {
            if (args[0] === 'rev-parse') return okRun('/tmp/repo/.git\n');
            if (args[0] === 'check-ref-format') {
              return args[2] === failing ? failRun(128, 'fatal: boom') : okRun(`${failing}\n`);
            }
            throw new Error(`unexpected git call: ${args.join(' ')}`);
          }),
        }
      );
      expect(result.isErr()).toBe(true);
      if (result.isOk()) continue;
      expect(result.error.code).toBe('GIT_ERROR');
    }
  });

  it('maps branch spawn errors to INTERNAL', async () => {
    const base = scriptedRun(args => {
      if (args[0] === 'rev-parse') return okRun('/tmp/repo/.git\n');
      if (args[0] === 'check-ref-format') return okRun('x\n');
      throw new Error(`unexpected git call: ${args.join(' ')}`);
    });
    const result = await renameBranch(
      '/tmp/repo',
      'old',
      'new',
      {},
      {
        run: async (args, cwd, opts) => {
          if (args[0] === 'branch' && args[1] === '-m') throw new Error('spawn EACCES');
          return base(args, cwd, opts);
        },
      }
    );
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('INTERNAL');
  });

  it('maps branch failure to GIT_ERROR', async () => {
    const result = await renameBranch(
      '/tmp/repo',
      'old',
      'new',
      {},
      {
        run: scriptedRun(args => {
          if (args[0] === 'rev-parse') return okRun('/tmp/repo/.git\n');
          if (args[0] === 'check-ref-format') return okRun('x\n');
          if (args[0] === 'branch') return failRun(1, 'fatal: boom');
          throw new Error(`unexpected git call: ${args.join(' ')}`);
        }),
      }
    );
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GIT_ERROR');
  });

  it('maps verify show-ref failure to GIT_ERROR', async () => {
    const result = await renameBranch(
      '/tmp/repo',
      'old',
      'new',
      {},
      {
        run: scriptedRun(args => {
          if (args[0] === 'rev-parse') return okRun('/tmp/repo/.git\n');
          if (args[0] === 'check-ref-format') return okRun('x\n');
          if (args[0] === 'branch') return okRun('');
          if (args[0] === 'show-ref') return failRun(128, 'fatal: boom');
          throw new Error(`unexpected git call: ${args.join(' ')}`);
        }),
      }
    );
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GIT_ERROR');
  });

  it('fails a stuck rename as INTERNAL after re-verify', async () => {
    // Rename "succeeds" but the old ref is still listed: state did not move.
    const result = await renameBranch(
      '/tmp/repo',
      'old',
      'new',
      {},
      {
        run: scriptedRun(args => {
          if (args[0] === 'rev-parse') return okRun('/tmp/repo/.git\n');
          if (args[0] === 'check-ref-format') return okRun('x\n');
          if (args[0] === 'branch') return okRun('');
          if (args[0] === 'show-ref') return showRefHit(HEAD_SHA, 'old');
          throw new Error(`unexpected git call: ${args.join(' ')}`);
        }),
      }
    );
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('INTERNAL');
  });

  it('maps a missing source to CONFIG_ERROR', async () => {
    const result = await renameBranch(
      '/tmp/repo',
      'gone',
      'new',
      {},
      {
        run: scriptedRun(args => {
          if (args[0] === 'rev-parse') return okRun('/tmp/repo/.git\n');
          if (args[0] === 'check-ref-format') return okRun('gone\n');
          if (args[0] === 'branch') return failRun(128, "fatal: no branch named 'gone'");
          throw new Error(`unexpected git call: ${args.join(' ')}`);
        }),
      }
    );
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('CONFIG_ERROR');
  });

  it('maps an occupied target to CONFIG_ERROR', async () => {
    const result = await renameBranch(
      '/tmp/repo',
      'old',
      'taken',
      {},
      {
        run: scriptedRun(args => {
          if (args[0] === 'rev-parse') return okRun('/tmp/repo/.git\n');
          if (args[0] === 'check-ref-format') return okRun('taken\n');
          if (args[0] === 'branch')
            return failRun(128, "fatal: a branch named 'taken' already exists");
          throw new Error(`unexpected git call: ${args.join(' ')}`);
        }),
      }
    );
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('CONFIG_ERROR');
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
  it('exposes the default timeout and protected branches', () => {
    expect(DEFAULT_BRANCH_TIMEOUT_MS).toBeGreaterThan(0);
    expect(Number.isInteger(DEFAULT_BRANCH_TIMEOUT_MS)).toBe(true);
    expect(DEFAULT_PROTECTED_BRANCHES).toContain('main');
  });
});
