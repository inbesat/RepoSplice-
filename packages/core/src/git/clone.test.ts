// P-069 cloneRepo: unit (mocked git seam, arg verification) + integration
// (real git binary against local file:// fixture sources — deterministic,
// no network, CI-safe). Live public-clone verification is manual per phase.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { StatusResult } from 'simple-git';
import { generateFixtures, type FixtureSpec } from '../../../../scripts/generate-fixtures.js';
import {
  cloneRepo,
  redactUrlCredentials,
  DEFAULT_CLONE_TIMEOUT_MS,
  type CloneGit,
  type CloneOptions,
  type CloneRuntime,
} from './clone.js';
import type { GitFactoryOptions } from './factory.js';

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', [...args], { cwd });
  return stdout.trim();
}

async function freshRoot(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

async function exists(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch {
    return false;
  }
}

function toFileUrl(dir: string): string {
  return `file:///${dir.replace(/\\/g, '/')}`;
}

/** Complete StatusResult literal: no casts, fully typed fake. */
function cleanStatus(current: string | null): StatusResult {
  return {
    not_added: [],
    conflicted: [],
    created: [],
    deleted: [],
    modified: [],
    renamed: [],
    staged: [],
    files: [],
    ahead: 0,
    behind: 0,
    current,
    tracking: null,
    detached: false,
    isClean: () => true,
  };
}

interface CloneCall {
  repo: string;
  target: string;
  options: string[] | undefined;
}

function fakeGit(impl?: {
  cloneImpl?: (repo: string, target: string, options?: string[]) => Promise<string>;
  statusImpl?: () => Promise<StatusResult>;
}): { git: CloneGit; calls: CloneCall[] } {
  const calls: CloneCall[] = [];
  const git: CloneGit = {
    clone: async (repo, target, options) => {
      calls.push({ repo, target, options });
      if (impl?.cloneImpl !== undefined) return impl.cloneImpl(repo, target, options);
      return 'cloned';
    },
    status: async () => {
      if (impl?.statusImpl !== undefined) return impl.statusImpl();
      return cleanStatus('main');
    },
  };
  return { git, calls };
}

function fakeRuntime(
  git: CloneGit,
  seen?: { options?: GitFactoryOptions; calls: number }
): CloneRuntime {
  return {
    createGit: options => {
      if (seen !== undefined) {
        seen.options = options;
        seen.calls += 1;
      }
      return git;
    },
  };
}

/** Unit target dir: real temp path (ensureDir runs for real), cleaned after. */
async function withTarget<T>(fn: (target: string) => Promise<T>): Promise<T> {
  const root = await freshRoot('stitch-clone-unit-');
  try {
    return await fn(join(root, 'target'));
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
}

const UNIT_URL = 'https://example.com/org/repo.git';

describe('cloneRepo unit (P-069 mocked seam)', () => {
  it('builds shallow args by default', async () => {
    await withTarget(async target => {
      const { git, calls } = fakeGit();
      const seen: { options?: GitFactoryOptions; calls: number } = { calls: 0 };
      const result = await cloneRepo({ url: UNIT_URL, targetDir: target }, fakeRuntime(git, seen));
      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;
      expect(result.value).toBe(target);
      expect(calls).toEqual([{ repo: UNIT_URL, target, options: ['--depth', '1'] }]);
      expect(seen.calls).toBe(1);
      expect(seen.options?.baseDir).toBe(target);
      expect(seen.options?.timeoutMs).toBe(DEFAULT_CLONE_TIMEOUT_MS);
    });
  });

  it('builds full clone args when shallow is false', async () => {
    await withTarget(async target => {
      const { git, calls } = fakeGit();
      const result = await cloneRepo(
        { url: UNIT_URL, targetDir: target, shallow: false },
        fakeRuntime(git)
      );
      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;
      expect(calls).toEqual([{ repo: UNIT_URL, target, options: [] }]);
    });
  });

  it('honors custom depth and branch', async () => {
    await withTarget(async target => {
      const { git, calls } = fakeGit();
      const result = await cloneRepo(
        { url: UNIT_URL, targetDir: target, depth: 5, branch: 'feature' },
        fakeRuntime(git)
      );
      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;
      // Deterministic order: depth, branch, then auth.
      expect(calls).toEqual([
        { repo: UNIT_URL, target, options: ['--depth', '5', '--branch', 'feature'] },
      ]);
    });
  });

  it('passes timeoutMs to the factory', async () => {
    await withTarget(async target => {
      const { git } = fakeGit();
      const seen: { options?: GitFactoryOptions; calls: number } = { calls: 0 };
      const result = await cloneRepo(
        { url: UNIT_URL, targetDir: target, timeoutMs: 5000, jobId: 'job-1' },
        fakeRuntime(git, seen)
      );
      expect(result.isOk()).toBe(true);
      expect(seen.options?.timeoutMs).toBe(5000);
    });
  });

  it('sends credentials via header, never the URL', async () => {
    await withTarget(async target => {
      const { git, calls } = fakeGit();
      const result = await cloneRepo(
        {
          url: UNIT_URL,
          targetDir: target,
          credentials: { username: 'octo', password: 's3cret-pat' },
        },
        fakeRuntime(git)
      );
      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;
      const expected = `http.extraHeader=Authorization: Basic ${Buffer.from('octo:s3cret-pat', 'utf8').toString('base64')}`;
      expect(calls).toEqual([
        { repo: UNIT_URL, target, options: ['--depth', '1', '-c', expected] },
      ]);
      // The password appears nowhere in the cloned URL.
      expect(calls[0]?.repo).toBe(UNIT_URL);
      expect(calls[0]?.repo).not.toContain('s3cret');
    });
  });

  it('scrubs secrets from failures', async () => {
    await withTarget(async target => {
      const password = 's3cret-pat';
      const header = `http.extraHeader=Authorization: Basic ${Buffer.from(`octo:${password}`, 'utf8').toString('base64')}`;
      const { git } = fakeGit({
        cloneImpl: async () => {
          throw new Error(`fatal: Authentication failed for '${UNIT_URL}': ${header}`);
        },
      });
      const result = await cloneRepo(
        {
          url: UNIT_URL,
          targetDir: target,
          credentials: { username: 'octo', password },
        },
        fakeRuntime(git)
      );
      expect(result.isErr()).toBe(true);
      if (!result.isErr()) return;
      expect(result.error.code).toBe('GIT_ERROR');
      if (result.error.code !== 'GIT_ERROR') return;
      const rendered = `${result.error.message} ${result.error.gitOutput ?? ''}`;
      expect(rendered).not.toContain(password);
      expect(rendered).not.toContain(Buffer.from(`octo:${password}`, 'utf8').toString('base64'));
      expect(rendered).toContain('Clone failed');
    });
  });

  it('maps client-init failure to GIT_ERROR', async () => {
    await withTarget(async target => {
      const runtime: CloneRuntime = {
        createGit: () => {
          throw new Error('Cannot use simple-git on a directory that does not exist');
        },
      };
      const result = await cloneRepo({ url: UNIT_URL, targetDir: target }, runtime);
      expect(result.isErr()).toBe(true);
      if (!result.isErr()) return;
      expect(result.error.code).toBe('GIT_ERROR');
      if (result.error.code === 'GIT_ERROR') {
        expect(result.error.message).toContain('Clone failed');
      }
    });
  });

  it('maps clone failure to GIT_ERROR', async () => {
    await withTarget(async target => {
      const { git } = fakeGit({
        cloneImpl: async () => {
          throw new Error("fatal: repository 'https://example.com/nope.git/' not found");
        },
      });
      const result = await cloneRepo({ url: UNIT_URL, targetDir: target }, fakeRuntime(git));
      expect(result.isErr()).toBe(true);
      if (!result.isErr()) return;
      expect(result.error.code).toBe('GIT_ERROR');
      if (result.error.code === 'GIT_ERROR') {
        expect(result.error.message).toContain('Clone failed');
        expect(result.error.gitOutput).toContain('not found');
      }
    });
  });

  it('maps timeout-shaped failure to GIT_ERROR', async () => {
    await withTarget(async target => {
      const { git } = fakeGit({
        cloneImpl: async () => {
          throw new Error('GitPluginError: block timeout reached');
        },
      });
      const result = await cloneRepo(
        { url: UNIT_URL, targetDir: target, timeoutMs: 1000 },
        fakeRuntime(git)
      );
      expect(result.isErr()).toBe(true);
      if (!result.isErr()) return;
      expect(result.error.code).toBe('GIT_ERROR');
      if (result.error.code === 'GIT_ERROR') {
        expect(result.error.message).toContain('Clone failed');
      }
    });
  });

  it('maps verify failure to GIT_ERROR', async () => {
    await withTarget(async target => {
      const { git } = fakeGit({
        statusImpl: async () => {
          throw new Error('not a git repository');
        },
      });
      const result = await cloneRepo({ url: UNIT_URL, targetDir: target }, fakeRuntime(git));
      expect(result.isErr()).toBe(true);
      if (!result.isErr()) return;
      expect(result.error.code).toBe('GIT_ERROR');
      if (result.error.code === 'GIT_ERROR') {
        expect(result.error.message).toContain('verification failed');
      }
    });
  });

  it('rejects bad input without spawning', async () => {
    const cases: { name: string; opts: CloneOptions }[] = [
      { name: 'empty url', opts: { url: '', targetDir: 't' } },
      { name: 'blank url', opts: { url: '   ', targetDir: 't' } },
      { name: 'empty target', opts: { url: UNIT_URL, targetDir: '' } },
      { name: 'zero depth', opts: { url: UNIT_URL, targetDir: 't', depth: 0 } },
      { name: 'fractional depth', opts: { url: UNIT_URL, targetDir: 't', depth: 1.5 } },
      {
        name: 'depth without shallow',
        opts: { url: UNIT_URL, targetDir: 't', shallow: false, depth: 2 },
      },
      { name: 'empty branch', opts: { url: UNIT_URL, targetDir: 't', branch: '' } },
      { name: 'blank branch', opts: { url: UNIT_URL, targetDir: 't', branch: '   ' } },
      { name: 'zero timeout', opts: { url: UNIT_URL, targetDir: 't', timeoutMs: 0 } },
      {
        name: 'empty username',
        opts: { url: UNIT_URL, targetDir: 't', credentials: { username: '', password: 'x' } },
      },
      {
        name: 'empty password',
        opts: { url: UNIT_URL, targetDir: 't', credentials: { username: 'u', password: '' } },
      },
    ];
    for (const { name, opts } of cases) {
      const { git } = fakeGit();
      const seen: { options?: GitFactoryOptions; calls: number } = { calls: 0 };
      const result = await cloneRepo(opts, fakeRuntime(git, seen));
      expect(result.isErr(), name).toBe(true);
      if (!result.isErr()) continue;
      expect(result.error.code, name).toBe('CONFIG_ERROR');
      // No factory construction, no spawn, no filesystem touch.
      expect(seen.calls, name).toBe(0);
    }
  });

  it('redacts embedded credentials for logs', () => {
    expect(redactUrlCredentials('https://octo:s3cret@github.com/o/r.git')).toBe(
      'https://***@github.com/o/r.git'
    );
    expect(redactUrlCredentials('https://github.com/o/r.git')).toBe('https://github.com/o/r.git');
    expect(redactUrlCredentials('file:///C:/repos/src')).toBe('file:///C:/repos/src');
    expect(redactUrlCredentials('git@github.com:o/r.git')).toBe('git@github.com:o/r.git');
  });
});

const CLONE_SRC: FixtureSpec = {
  name: 'clone-src',
  commits: [
    {
      message: 'first',
      files: [{ path: 'a.txt', content: { text: 'one\n' } }],
    },
    {
      message: 'second',
      files: [{ path: 'b.txt', content: { text: 'two\n' } }],
    },
  ],
};

describe('cloneRepo integration (P-069 real git, file:// sources)', () => {
  let sourceRoot = '';
  let sourceDir = '';
  let sourceUrl = '';

  beforeAll(async () => {
    sourceRoot = await freshRoot('stitch-clone-src-');
    const generated = await generateFixtures([CLONE_SRC], { root: sourceRoot });
    if (generated.isErr()) throw new Error('fixture generation failed');
    const first = generated.value[0];
    if (first === undefined) throw new Error('fixture generated no repos');
    sourceDir = first;
    // A second branch to clone selectively.
    await git(sourceDir, ['checkout', '-b', 'feature']);
    await writeFile(join(sourceDir, 'c.txt'), 'three\n');
    await git(sourceDir, ['add', 'c.txt']);
    await git(sourceDir, [
      '-c',
      'user.email=t@t',
      '-c',
      'user.name=t',
      'commit',
      '-m',
      'feature work',
    ]);
    await git(sourceDir, ['checkout', 'main']);
    sourceUrl = toFileUrl(sourceDir);
  }, 30000);

  afterAll(async () => {
    await rm(sourceRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  });

  it('clones shallow with a single commit', async () => {
    const root = await freshRoot('stitch-clone-shallow-');
    try {
      const target = join(root, 'target');
      const result = await cloneRepo({ url: sourceUrl, targetDir: target });
      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;
      expect(result.value).toBe(target);
      expect(await git(target, ['rev-list', '--count', 'HEAD'])).toBe('1');
      expect(await git(target, ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe('main');
      expect(await exists(join(target, '.git', 'shallow'))).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    }
  }, 20000);

  it('clones full history when shallow is false', async () => {
    const root = await freshRoot('stitch-clone-full-');
    try {
      const target = join(root, 'target');
      const result = await cloneRepo({ url: sourceUrl, targetDir: target, shallow: false });
      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;
      expect(await git(target, ['rev-list', '--count', 'HEAD'])).toBe('2');
      expect(await git(target, ['log', '--format=%s'])).toContain('second');
      expect(await exists(join(target, '.git', 'shallow'))).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    }
  }, 20000);

  it('checks out a branch', async () => {
    const root = await freshRoot('stitch-clone-branch-');
    try {
      const target = join(root, 'target');
      const result = await cloneRepo({ url: sourceUrl, targetDir: target, branch: 'feature' });
      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;
      expect(await git(target, ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe('feature');
      // Trim: Windows checkouts may use CRLF regardless of the committed LF.
      expect((await readFile(join(target, 'c.txt'), 'utf8')).trim()).toBe('three');
    } finally {
      await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    }
  }, 20000);

  it('clones into an existing empty directory', async () => {
    const root = await freshRoot('stitch-clone-empty-');
    try {
      const target = join(root, 'target');
      await mkdir(target, { recursive: true });
      const result = await cloneRepo({ url: sourceUrl, targetDir: target });
      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;
      expect(await git(target, ['rev-parse', '--is-inside-work-tree'])).toBe('true');
    } finally {
      await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    }
  }, 20000);

  it('fails fast on a missing source', async () => {
    const root = await freshRoot('stitch-clone-missing-');
    try {
      const result = await cloneRepo({
        url: toFileUrl(join(root, 'does-not-exist')),
        targetDir: join(root, 'target'),
      });
      expect(result.isErr()).toBe(true);
      if (!result.isErr()) return;
      expect(result.error.code).toBe('GIT_ERROR');
      if (result.error.code === 'GIT_ERROR') {
        expect(result.error.message).toContain('Clone failed');
      }
    } finally {
      await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    }
  }, 20000);

  it('refuses a non-empty target', async () => {
    const root = await freshRoot('stitch-clone-nonempty-');
    try {
      const target = join(root, 'target');
      await mkdir(target, { recursive: true });
      await writeFile(join(target, 'occupied.txt'), 'mine\n');
      const result = await cloneRepo({ url: sourceUrl, targetDir: target });
      expect(result.isErr()).toBe(true);
      if (!result.isErr()) return;
      expect(result.error.code).toBe('GIT_ERROR');
      if (result.error.code === 'GIT_ERROR') {
        expect(result.error.message).toContain('Clone failed');
      }
    } finally {
      await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    }
  }, 20000);
});
