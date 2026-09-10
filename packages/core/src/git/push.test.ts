// Push to remote (P-078): full suite. Real git against local bare remotes
// proves the transport (new branch, skip-if-equal, force-with-lease on a
// diverged branch); scripted runners prove guards and failure arms; pure
// unit tests prove remote parsing.
//
// Timeout note (P-075 precedent): real-git tests carry an explicit 30s
// budget — the core project resolves vitest's 5s default (the root 30s
// does not inherit into defineProject). Scripted/pure tests keep the
// strict default as a canary. No network is touched: remotes are local
// bare repos or scripted fakes.

import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { err, ok } from 'neverthrow';
import type { StitchError } from '../result/index.js';
import {
  pushToRemote,
  parseGitHubRemote,
  exitCodeOf,
  DEFAULT_PUSH_TIMEOUT_MS,
  DEFAULT_PROTECTED_BRANCHES,
  type PushRunner,
  type PushRunResult,
  type RemoteRepoCheck,
  type RepoCreator,
} from './push.js';

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', [...args], { cwd });
  return stdout.trim();
}

/** Hermetic source repo (P-072 precedent: local identity + lf). */
async function makeRepo(): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), 'stitch-push-'));
  await git(repo, ['init', '-q', '-b', 'main']);
  await git(repo, ['config', 'user.email', 'test@stitch.dev']);
  await git(repo, ['config', 'user.name', 'stitch-test']);
  await git(repo, ['config', 'core.autocrlf', 'false']);
  await git(repo, ['config', 'core.eol', 'lf']);
  return repo;
}

async function makeBare(base: string, name: string): Promise<string> {
  const bare = join(base, name);
  await git(base, ['init', '-q', '--bare', bare]);
  return bare;
}

async function remoteHead(bare: string, branch: string): Promise<string> {
  return git(bare, ['rev-parse', branch]);
}

// ─── Scripted seams ────────────────────────────────────────────────────

function okRun(stdout: string | Buffer = ''): PushRunResult {
  return {
    exitCode: 0,
    stdout: typeof stdout === 'string' ? Buffer.from(stdout) : stdout,
    stderr: '',
  };
}

function failRun(exitCode: number, stderr: string): PushRunResult {
  return { exitCode, stdout: Buffer.from(''), stderr };
}

const LOCAL_SHA = 'a75739818b8db9fa29f02117112255dfc11ead18';
const REMOTE_SHA = 'd05fb693b3be97ea889a7ba82f859cc01b731d21';
const THIRD_SHA = 'c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2';
const LS_REMOTE_HIT = Buffer.from(`${REMOTE_SHA}\trefs/heads/main\n`);

function happyRun(overrides: Partial<Record<string, PushRunResult>> = {}): PushRunner {
  const table: Record<string, PushRunResult> = {
    'rev-parse': okRun('/tmp/repo/.git\n'),
    'check-ref-format': okRun('main\n'),
    'rev-parse-branch': okRun(`${LOCAL_SHA}\n`),
    'ls-remote': okRun(LS_REMOTE_HIT),
    push: okRun(''),
    ...overrides,
  };
  return async args => {
    // Credentialed calls prepend ['-c', header]: strip the pair so the
    // subcommand keys the table (mirrors the impl's argv assembly).
    const stripped = args[0] === '-c' ? args.slice(2) : args;
    const key =
      stripped[0] === 'rev-parse' && stripped[1] === '--verify'
        ? 'rev-parse-branch'
        : stripped[0] === 'ls-remote'
          ? 'ls-remote'
          : String(stripped[0]);
    const hit = table[key];
    if (hit === undefined) throw new Error(`unexpected git call: ${args.join(' ')}`);
    return hit;
  };
}

function throwingRun(message: string): PushRunner {
  return async () => {
    throw new Error(message);
  };
}

const LOCAL_HIT = Buffer.from(`${LOCAL_SHA}\trefs/heads/main\n`);

/** Local-SHA hit line for any branch (verify matches the pushed ref). */
function localHitFor(branch: string): Buffer {
  return Buffer.from(`${LOCAL_SHA}\trefs/heads/${branch}\n`);
}

/** Stateful ls-remote: pre-push output first, post-push output after. */
function flowingRun(pre: Buffer, post: Buffer, base: PushRunner): PushRunner {
  let lsCalls = 0;
  return async (args, cwd, opts) => {
    if (args[0] === 'ls-remote') {
      lsCalls += 1;
      if (lsCalls > 1) return okRun(post);
      return okRun(pre);
    }
    return base(args, cwd, opts);
  };
}

const repoExistsYes: RemoteRepoCheck = async () => ok(true);
const repoExistsNo: RemoteRepoCheck = async () => ok(false);

describe('pushToRemote (real git, local bare remote)', () => {
  it('pushes branch', async () => {
    const repo = await makeRepo();
    try {
      await writeFile(join(repo, 'a.txt'), 'v1\n');
      await git(repo, ['add', '-A']);
      await git(repo, ['commit', '-qm', 'one']);
      const bare = await makeBare(tmpdir(), `stitch-push-bare-${Date.now()}`);
      try {
        const result = await pushToRemote(repo, bare, 'main');
        expect(result.isOk()).toBe(true);
        if (result.isErr()) return;
        expect(await remoteHead(bare, 'main')).toBe(await git(repo, ['rev-parse', 'HEAD']));
      } finally {
        await rm(bare, { recursive: true, force: true });
      }
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  }, 30_000);

  it('skips an up-to-date branch without pushing', async () => {
    const repo = await makeRepo();
    try {
      await writeFile(join(repo, 'a.txt'), 'v1\n');
      await git(repo, ['add', '-A']);
      await git(repo, ['commit', '-qm', 'one']);
      const bare = await makeBare(tmpdir(), `stitch-push-even-${Date.now()}`);
      try {
        const first = await pushToRemote(repo, bare, 'main');
        expect(first.isOk()).toBe(true);
        const second = await pushToRemote(repo, bare, 'main');
        expect(second.isOk()).toBe(true);
        expect(await remoteHead(bare, 'main')).toBe(await git(repo, ['rev-parse', 'HEAD']));
      } finally {
        await rm(bare, { recursive: true, force: true });
      }
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  }, 30_000);

  it('forces with lease on a diverged branch when authorized', async () => {
    const repo = await makeRepo();
    try {
      await writeFile(join(repo, 'a.txt'), 'v1\n');
      await git(repo, ['add', '-A']);
      await git(repo, ['commit', '-qm', 'one']);
      const bare = await makeBare(tmpdir(), `stitch-push-div-${Date.now()}`);
      const other = await mkdtemp(join(tmpdir(), 'stitch-push-other-'));
      try {
        await git(repo, ['branch', 'feature']);
        const first = await pushToRemote(repo, bare, 'feature');
        expect(first.isOk()).toBe(true);
        // Diverge the remote from a second checkout.
        await git(other, ['clone', '-q', bare, '.']);
        await git(other, ['config', 'user.email', 't@t.t']);
        await git(other, ['config', 'user.name', 't']);
        await git(other, ['fetch', '-q', 'origin', 'feature:feature']);
        await git(other, ['checkout', '-q', 'feature']);
        await writeFile(join(other, 'a.txt'), 'diverged\n');
        await git(other, ['add', '-A']);
        await git(other, ['commit', '-qm', 'diverge']);
        await git(other, ['push', '-q', 'origin', 'HEAD:feature']);
        await git(repo, ['checkout', '-q', 'feature']);
        await writeFile(join(repo, 'a.txt'), 'v2 local\n');
        await git(repo, ['add', '-A']);
        await git(repo, ['commit', '-qm', 'two']);
        // Plain push refuses on divergence.
        const refused = await pushToRemote(repo, bare, 'feature');
        expect(refused.isErr()).toBe(true);
        if (refused.isOk()) return;
        expect(refused.error.code).toBe('GIT_ERROR');
        // Authorized force takes the branch via lease.
        const forced = await pushToRemote(repo, bare, 'feature', {
          force: true,
          allowForce: true,
        });
        expect(forced.isOk()).toBe(true);
        expect(await remoteHead(bare, 'feature')).toBe(await git(repo, ['rev-parse', 'HEAD']));
      } finally {
        await rm(other, { recursive: true, force: true });
        await rm(bare, { recursive: true, force: true });
      }
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  }, 30_000);
});

describe('parseGitHubRemote (pure)', () => {
  it('parses https, ssh, and scp forms', () => {
    expect(parseGitHubRemote('https://github.com/octo/hello.git')).toEqual({
      owner: 'octo',
      repo: 'hello',
    });
    expect(parseGitHubRemote('https://github.com/octo/hello')).toEqual({
      owner: 'octo',
      repo: 'hello',
    });
    expect(parseGitHubRemote('https://user:pass@github.com/octo/hello.git')).toEqual({
      owner: 'octo',
      repo: 'hello',
    });
    expect(parseGitHubRemote('git@github.com:octo/hello.git')).toEqual({
      owner: 'octo',
      repo: 'hello',
    });
    expect(parseGitHubRemote('ssh://git@github.com/octo/hello.git')).toEqual({
      owner: 'octo',
      repo: 'hello',
    });
  });

  it('returns null for non-GitHub and unparseable remotes', () => {
    expect(parseGitHubRemote('/tmp/local.git')).toBeNull();
    expect(parseGitHubRemote('file:///tmp/local.git')).toBeNull();
    expect(parseGitHubRemote('https://gitlab.com/octo/hello.git')).toBeNull();
    expect(parseGitHubRemote('git@gitlab.com:octo/hello.git')).toBeNull();
    expect(parseGitHubRemote('https://github.com/onlyowner')).toBeNull();
    expect(parseGitHubRemote('not a url at all')).toBeNull();
  });
});

describe('pushToRemote guards (scripted)', () => {
  it('creates repo gated', async () => {
    let created: { owner: string; repo: string } | null = null;
    const creator: RepoCreator = async input => {
      created = input;
      return ok({ fullName: `${input.owner}/${input.repo}` });
    };
    const calls: string[][] = [];
    const base = happyRun({ 'ls-remote': okRun('') });
    const flow = flowingRun(Buffer.from(''), LOCAL_HIT, base);
    const runtime: { run: PushRunner } = {
      run: async (args, cwd, opts) => {
        calls.push([...args]);
        return flow(args, cwd, opts);
      },
    };
    const result = await pushToRemote(
      '/tmp/repo',
      'https://github.com/octo/hello.git',
      'main',
      { createIfMissing: true, repoCreator: creator, repoExists: repoExistsNo },
      runtime
    );
    expect(result.isOk()).toBe(true);
    expect(created).toEqual({ owner: 'octo', repo: 'hello' });
    expect(calls.some(args => args[0] === 'push')).toBe(true);
  });

  it('skips creation when the repo exists', async () => {
    const creator: RepoCreator = async () => {
      throw new Error('must not create an existing repo');
    };
    const base = happyRun({ 'ls-remote': okRun('') });
    const result = await pushToRemote(
      '/tmp/repo',
      'https://github.com/octo/hello.git',
      'main',
      { createIfMissing: true, repoCreator: creator, repoExists: repoExistsYes },
      { run: flowingRun(Buffer.from(''), LOCAL_HIT, base) }
    );
    expect(result.isOk()).toBe(true);
  });

  it('refuses a missing repo without createIfMissing', async () => {
    const result = await pushToRemote(
      '/tmp/repo',
      'https://github.com/octo/hello.git',
      'main',
      { repoExists: repoExistsNo },
      { run: happyRun({ 'ls-remote': okRun('') }) }
    );
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('CONFIG_ERROR');
  });

  it('requires a creator when createIfMissing is set', async () => {
    const result = await pushToRemote(
      '/tmp/repo',
      'https://github.com/octo/hello.git',
      'main',
      { createIfMissing: true, repoExists: repoExistsNo },
      { run: happyRun({ 'ls-remote': okRun('') }) }
    );
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('CONFIG_ERROR');
  });

  it('carries creator errors through unchanged', async () => {
    const denied: StitchError = { code: 'AUTH_ERROR', provider: 'github', message: 'rbac deny' };
    const creator: RepoCreator = async () => err(denied);
    const result = await pushToRemote(
      '/tmp/repo',
      'https://github.com/octo/hello.git',
      'main',
      { createIfMissing: true, repoCreator: creator, repoExists: repoExistsNo },
      { run: happyRun({ 'ls-remote': okRun('') }) }
    );
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error).toEqual(denied);
  });

  it('refuses createIfMissing on non-GitHub remotes', async () => {
    const result = await pushToRemote(
      '/tmp/repo',
      '/tmp/local.git',
      'main',
      {
        createIfMissing: true,
      },
      { run: happyRun({ 'ls-remote': okRun('') }) }
    );
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('CONFIG_ERROR');
  });

  it('refuses force without allowForce before spawning', async () => {
    const runtime = { run: throwingRun('must not spawn on force refusal') };
    const result = await pushToRemote(
      '/tmp/repo',
      '/tmp/local.git',
      'feature',
      { force: true },
      runtime
    );
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('CONFIG_ERROR');
    if (result.error.code === 'CONFIG_ERROR') {
      expect(result.error.field).toBe('force');
    }
  });

  it('refuses force protected', async () => {
    const runtime = { run: throwingRun('must not spawn on protected refusal') };
    const result = await pushToRemote(
      '/tmp/repo',
      '/tmp/local.git',
      'main',
      { force: true, allowForce: true },
      runtime
    );
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('CONFIG_ERROR');
    if (result.error.code === 'CONFIG_ERROR') {
      expect(result.error.field).toBe('branch');
    }
  });

  it('skips the push when SHAs match without calling push', async () => {
    const calls: string[][] = [];
    const base = happyRun({ 'ls-remote': okRun('') });
    const flow = flowingRun(LOCAL_HIT, LOCAL_HIT, base);
    const runtime: { run: PushRunner } = {
      run: async (args, cwd, opts) => {
        calls.push([...args]);
        return flow(args, cwd, opts);
      },
    };
    const result = await pushToRemote('/tmp/repo', '/tmp/local.git', 'main', {}, runtime);
    expect(result.isOk()).toBe(true);
    expect(calls.some(args => args[0] === 'push')).toBe(false);
  });

  it('pushes without a lease flag for a brand-new branch', async () => {
    const calls: string[][] = [];
    const base = happyRun({ 'ls-remote': okRun('') });
    const flow = flowingRun(Buffer.from(''), localHitFor('feature'), base);
    const runtime: { run: PushRunner } = {
      run: async (args, cwd, opts) => {
        calls.push([...args]);
        return flow(args, cwd, opts);
      },
    };
    const result = await pushToRemote(
      '/tmp/repo',
      '/tmp/local.git',
      'feature',
      { force: true, allowForce: true },
      runtime
    );
    expect(result.isOk()).toBe(true);
    const pushCall = calls.find(args => args[0] === 'push');
    expect(pushCall).toBeDefined();
    expect(pushCall?.some(arg => arg.startsWith('--force'))).toBe(false);
  });

  it('hints allowForce on divergent refusals', async () => {
    const result = await pushToRemote(
      '/tmp/repo',
      '/tmp/local.git',
      'feature',
      {},
      {
        run: happyRun({
          'ls-remote': okRun(Buffer.from(`${REMOTE_SHA}\trefs/heads/feature\n`)),
          push: failRun(1, '! [rejected] feature -> feature (fetch first)\nerror: failed to push'),
        }),
      }
    );
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GIT_ERROR');
    if (result.error.code === 'GIT_ERROR') {
      expect(result.error.message).toContain('allowForce');
    }
  });

  it('maps verify ls-remote failure to GIT_ERROR', async () => {
    let lsCalls = 0;
    const base = happyRun();
    const runtime: { run: PushRunner } = {
      run: async (args, cwd, opts) => {
        if (args[0] === 'ls-remote') {
          lsCalls += 1;
          if (lsCalls > 1) return failRun(128, 'fatal: boom');
        }
        return base(args, cwd, opts);
      },
    };
    const result = await pushToRemote('/tmp/repo', '/tmp/local.git', 'main', {}, runtime);
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GIT_ERROR');
  });

  it('fails a moved remote after push as INTERNAL', async () => {
    let lsCalls = 0;
    const base = happyRun({
      'ls-remote': okRun(Buffer.from(`${REMOTE_SHA}\trefs/heads/feature\n`)),
    });
    const runtime: { run: PushRunner } = {
      run: async (args, cwd, opts) => {
        if (args[0] === 'ls-remote') {
          lsCalls += 1;
          if (lsCalls > 1) return okRun(Buffer.from(`${THIRD_SHA}\trefs/heads/feature\n`));
        }
        return base(args, cwd, opts);
      },
    };
    // Pre-push ls-remote differs from local (push proceeds), post-push shows
    // a third SHA: someone moved the ref under us.
    const result = await pushToRemote('/tmp/repo', '/tmp/local.git', 'feature', {}, runtime);
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('INTERNAL');
  });
});

describe('pushToRemote validation (no spawn)', () => {
  it('rejects blank repoPath, remoteUrl, branch, and bad timeouts', async () => {
    const run = throwingRun('must not spawn on validation failure');
    const runtime = { run };
    for (const call of [
      () => pushToRemote('', '/tmp/r.git', 'main', {}, runtime),
      () => pushToRemote('/tmp/repo', '   ', 'main', {}, runtime),
      () => pushToRemote('/tmp/repo', '/tmp/r.git', '  ', {}, runtime),
      () => pushToRemote('/tmp/repo', '/tmp/r.git', 'main', { timeoutMs: 0 }, runtime),
    ]) {
      const result = await call();
      expect(result.isErr()).toBe(true);
      if (result.isOk()) continue;
      expect(result.error.code).toBe('CONFIG_ERROR');
    }
  });

  it('rejects a non-repo directory', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'stitch-push-plain-'));
    try {
      const result = await pushToRemote(dir, join(tmpdir(), 'stitch-push-far.git'), 'main');
      expect(result.isErr()).toBe(true);
      if (result.isOk()) return;
      expect(result.error.code).toBe('CONFIG_ERROR');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it('rejects a missing local branch', async () => {
    const result = await pushToRemote(
      '/tmp/repo',
      '/tmp/local.git',
      'nope',
      {},
      {
        run: happyRun({ 'rev-parse-branch': failRun(128, 'fatal: Needed a single revision') }),
      }
    );
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('CONFIG_ERROR');
    if (result.error.code === 'CONFIG_ERROR') {
      expect(result.error.field).toBe('branch');
    }
  });

  it('rejects a malformed branch name', async () => {
    const result = await pushToRemote(
      '/tmp/repo',
      '/tmp/local.git',
      'has space',
      {},
      {
        run: happyRun({
          'check-ref-format': failRun(128, "fatal: 'has space' is not a valid branch name"),
        }),
      }
    );
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('CONFIG_ERROR');
    if (result.error.code === 'CONFIG_ERROR') {
      expect(result.error.field).toBe('branch');
    }
  });
});

describe('pushToRemote failure arms (scripted)', () => {
  it('maps ls-remote failure to GIT_ERROR', async () => {
    const result = await pushToRemote(
      '/tmp/repo',
      '/tmp/local.git',
      'main',
      {},
      {
        run: happyRun({
          'ls-remote': failRun(128, 'fatal: does not appear to be a git repository'),
        }),
      }
    );
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GIT_ERROR');
  });

  it('maps a malformed ls-remote SHA to INTERNAL', async () => {
    const result = await pushToRemote(
      '/tmp/repo',
      '/tmp/local.git',
      'main',
      {},
      {
        run: happyRun({ 'ls-remote': okRun('not-a-sha\trefs/heads/main\n') }),
      }
    );
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('INTERNAL');
  });

  it('maps a malformed ls-remote line to INTERNAL', async () => {
    const result = await pushToRemote(
      '/tmp/repo',
      '/tmp/local.git',
      'main',
      {},
      {
        run: happyRun({ 'ls-remote': okRun('no-tab-here\n') }),
      }
    );
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('INTERNAL');
  });

  it('treats other refs as a missing branch and pushes', async () => {
    const base = happyRun({
      'ls-remote': okRun(Buffer.from(`${REMOTE_SHA}\trefs/heads/other\n`)),
    });
    const flow = flowingRun(Buffer.from(`${REMOTE_SHA}\trefs/heads/other\n`), LOCAL_HIT, base);
    const result = await pushToRemote(
      '/tmp/repo',
      '/tmp/local.git',
      'main',
      {},
      {
        run: flow,
      }
    );
    expect(result.isOk()).toBe(true);
  });

  it('maps local rev-parse failure to GIT_ERROR', async () => {
    const result = await pushToRemote(
      '/tmp/repo',
      '/tmp/local.git',
      'main',
      {},
      {
        run: happyRun({ 'rev-parse-branch': failRun(1, 'fatal: boom') }),
      }
    );
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GIT_ERROR');
  });

  it('maps a malformed local SHA to INTERNAL', async () => {
    const result = await pushToRemote(
      '/tmp/repo',
      '/tmp/local.git',
      'main',
      {},
      {
        run: happyRun({ 'rev-parse-branch': okRun('junk\n') }),
      }
    );
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('INTERNAL');
  });

  it('requires a check when createIfMissing is set without a port', async () => {
    const result = await pushToRemote(
      '/tmp/repo',
      'https://github.com/octo/hello.git',
      'main',
      { createIfMissing: true },
      { run: happyRun({ 'ls-remote': okRun('') }) }
    );
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('CONFIG_ERROR');
  });

  it('fails a throwing existence check as INTERNAL', async () => {
    const check: RemoteRepoCheck = async () => {
      throw new Error('api exploded');
    };
    const result = await pushToRemote(
      '/tmp/repo',
      'https://github.com/octo/hello.git',
      'main',
      { repoExists: check },
      { run: happyRun({ 'ls-remote': okRun('') }) }
    );
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('INTERNAL');
  });

  it('carries existence-check errors through unchanged', async () => {
    const denied: StitchError = { code: 'AUTH_ERROR', provider: 'github', message: 'bad creds' };
    const check: RemoteRepoCheck = async () => err(denied);
    const result = await pushToRemote(
      '/tmp/repo',
      'https://github.com/octo/hello.git',
      'main',
      { repoExists: check },
      { run: happyRun({ 'ls-remote': okRun('') }) }
    );
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error).toEqual(denied);
  });

  it('fails a throwing creator as INTERNAL', async () => {
    const creator: RepoCreator = async () => {
      throw new Error('creator exploded');
    };
    const result = await pushToRemote(
      '/tmp/repo',
      'https://github.com/octo/hello.git',
      'main',
      { createIfMissing: true, repoCreator: creator, repoExists: repoExistsNo },
      { run: happyRun({ 'ls-remote': okRun('') }) }
    );
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('INTERNAL');
  });

  it('maps check-ref-format failure to GIT_ERROR', async () => {
    const result = await pushToRemote(
      '/tmp/repo',
      '/tmp/local.git',
      'main',
      {},
      {
        run: happyRun({ 'check-ref-format': failRun(128, 'fatal: boom') }),
      }
    );
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GIT_ERROR');
  });

  it('carries push spawn errors through unchanged', async () => {
    const base = happyRun();
    const runtime: { run: PushRunner } = {
      run: async (args, cwd, opts) => {
        if (args[0] === 'push') throw new Error('spawn EACCES');
        return base(args, cwd, opts);
      },
    };
    const result = await pushToRemote('/tmp/repo', '/tmp/local.git', 'main', {}, runtime);
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('INTERNAL');
  });

  it('maps push failure to GIT_ERROR', async () => {
    const result = await pushToRemote(
      '/tmp/repo',
      '/tmp/local.git',
      'main',
      {},
      {
        run: happyRun({
          'ls-remote': okRun(Buffer.from(`${REMOTE_SHA}\trefs/heads/main\n`)),
          push: failRun(1, 'error: RPC failed; HTTP 500'),
        }),
      }
    );
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GIT_ERROR');
  });

  it('maps the timeout sentinel to a GIT_ERROR mentioning the timeout', async () => {
    const result = await pushToRemote(
      '/tmp/repo',
      '/tmp/local.git',
      'main',
      { timeoutMs: 50 },
      { run: happyRun({ 'rev-parse': { exitCode: 124, stdout: Buffer.from(''), stderr: '' } }) }
    );
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GIT_ERROR');
    if (result.error.code === 'GIT_ERROR') {
      expect(result.error.message).toContain('timed out');
      expect(result.error.message).toContain('50');
    }
  });

  it('treats a throwing runner as INTERNAL', async () => {
    const result = await pushToRemote(
      '/tmp/repo',
      '/tmp/local.git',
      'main',
      {},
      {
        run: throwingRun('spawn EACCES'),
      }
    );
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('INTERNAL');
  });

  it('no token leak', async () => {
    const password = 'sekrit-password-123';
    const header = `http.extraHeader=Authorization: Basic ${Buffer.from(`u:${password}`, 'utf8').toString('base64')}`;
    const result = await pushToRemote(
      '/tmp/repo',
      'https://u:hunter2@github.com/octo/hello.git',
      'feature',
      { credentials: { username: 'u', password } },
      {
        run: happyRun({
          'ls-remote': okRun(''),
          push: failRun(
            1,
            `error: failed to push to 'https://u:${password}@github.com/octo/hello.git'`
          ),
        }),
      }
    );
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    const text =
      result.error.code === 'GIT_ERROR' ? `${result.error.message} ${result.error.gitOutput}` : '';
    expect(text).not.toContain(password);
    expect(text).not.toContain('hunter2');
    expect(text).not.toContain(header);
    expect(text).toContain('***');
  });
});

describe('module constants', () => {
  it('exposes the default timeout and protected branches', () => {
    expect(DEFAULT_PUSH_TIMEOUT_MS).toBeGreaterThan(0);
    expect(Number.isInteger(DEFAULT_PUSH_TIMEOUT_MS)).toBe(true);
    expect(DEFAULT_PROTECTED_BRANCHES).toContain('main');
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
