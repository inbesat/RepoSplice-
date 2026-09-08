import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { checkFilterRepoStatus } from './filterRepo.js';
import {
  extractPathsViaFilterRepo,
  DEFAULT_FILTER_REPO_TIMEOUT_MS,
  type FilterRepoOutput,
  type FilterRepoRuntime,
} from './filterRepo.js';
import { cloneRepo } from './clone.js';
import { generateFixtures, type FixtureSpec } from '../../../../scripts/generate-fixtures.js';

// Real `--version` output captured from git-filter-repo 2.47.0 (upstream
// reports its own revision hash, not semver — see filterRepo.ts).
const REAL_VERSION_OUTPUT = 'a40bce548d2c\n';

describe('filter-repo presence (P-066)', () => {
  it('present ok', async () => {
    const status = await checkFilterRepoStatus(async () => REAL_VERSION_OUTPUT);
    expect(status.isOk()).toBe(true);
    if (!status.isOk()) return;
    expect(status.value.available).toBe(true);
    expect(status.value.version).toBe('a40bce548d2c');
    expect(status.value.fix).toBeUndefined();
  });

  it('missing hints fix', async () => {
    const status = await checkFilterRepoStatus(async () => {
      throw new Error('spawn git-filter-repo ENOENT');
    });
    expect(status.isOk()).toBe(true);
    if (!status.isOk()) return;
    expect(status.value.available).toBe(false);
    expect(status.value.version).toBeNull();
    expect(status.value.fix).toContain('pip install git-filter-repo');
  });

  it('version check', async () => {
    // Empty output: binary runs but reports nothing usable.
    const empty = await checkFilterRepoStatus(async () => '\n');
    expect(empty.isOk()).toBe(true);
    if (!empty.isOk()) return;
    expect(empty.value.available).toBe(true);
    expect(empty.value.version).toBeNull();

    // Whatever upstream prints is carried through verbatim (opaque).
    const other = await checkFilterRepoStatus(async () => 'v2.47.0-3-gdeadbee\n');
    expect(other.isOk()).toBe(true);
    if (!other.isOk()) return;
    expect(other.value.version).toBe('v2.47.0-3-gdeadbee');
  });
});

const execFileAsync = promisify(execFile);

interface RecordedRun {
  args: readonly string[];
  cwd: string;
  timeoutMs: number;
}

function fakeRuntime(impl?: {
  runImpl?: (args: readonly string[], cwd: string) => Promise<FilterRepoOutput>;
  gitImpl?: (args: readonly string[], cwd: string) => Promise<string>;
  seen?: RecordedRun[];
}): FilterRepoRuntime {
  return {
    filterRepo: async (args, cwd, opts) => {
      impl?.seen?.push({ args, cwd, timeoutMs: opts.timeoutMs });
      if (impl?.runImpl !== undefined) return impl.runImpl(args, cwd);
      return { stdout: '', stderr: '' };
    },
    git: async (args, cwd) => {
      if (impl?.gitImpl !== undefined) return impl.gitImpl(args, cwd);
      if (args[0] === 'rev-list') return '2';
      throw new Error(`unexpected git call: ${args.join(' ')}`);
    },
  };
}

const EXTRACT_OPTS = {
  repoPath: 'C:/work/child',
  paths: ['src/auth'],
  targetSubdir: 'repo-a',
};

describe('extractPathsViaFilterRepo unit (P-070 mocked runner)', () => {
  it('builds extraction args', async () => {
    const seen: RecordedRun[] = [];
    const result = await extractPathsViaFilterRepo(EXTRACT_OPTS, fakeRuntime({ seen }));
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;
    expect(result.value).toBe(EXTRACT_OPTS.repoPath);
    expect(seen).toHaveLength(1);
    const run = seen[0];
    expect(run).toBeDefined();
    if (run === undefined) return;
    // Deterministic order: force, paths, subdir, tag rename (default prefix).
    expect([...run.args]).toEqual([
      '--force',
      '--path',
      'src/auth',
      '--to-subdirectory-filter',
      'repo-a',
      '--tag-rename',
      ':repo-a-',
    ]);
    expect(run.cwd).toBe(EXTRACT_OPTS.repoPath);
    expect(run.timeoutMs).toBe(DEFAULT_FILTER_REPO_TIMEOUT_MS);
  });

  it('honors explicit tagPrefix, timeoutMs, and multiple paths', async () => {
    const seen: RecordedRun[] = [];
    const result = await extractPathsViaFilterRepo(
      {
        repoPath: 'C:/work/child',
        paths: ['src/auth', 'docs'],
        targetSubdir: 'repo-a',
        tagPrefix: 'custom/',
        timeoutMs: 5000,
        jobId: 'job-9',
      },
      fakeRuntime({ seen })
    );
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;
    const run = seen[0];
    expect(run).toBeDefined();
    if (run === undefined) return;
    expect([...run.args]).toEqual([
      '--force',
      '--path',
      'src/auth',
      '--path',
      'docs',
      '--to-subdirectory-filter',
      'repo-a',
      '--tag-rename',
      ':custom/',
    ]);
    expect(run.timeoutMs).toBe(5000);
  });

  it('strips trailing slashes from the subdir', async () => {
    const seen: RecordedRun[] = [];
    const result = await extractPathsViaFilterRepo(
      { repoPath: 'C:/work/child', paths: ['src/auth'], targetSubdir: 'repo-a/' },
      fakeRuntime({ seen })
    );
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;
    expect([...(seen[0]?.args ?? [])]).toContain('repo-a');
    expect([...(seen[0]?.args ?? [])]).toContain(':repo-a-');
  });

  it('maps runner failure to GIT_ERROR', async () => {
    const result = await extractPathsViaFilterRepo(
      EXTRACT_OPTS,
      fakeRuntime({
        runImpl: async () => {
          throw new Error('Command failed: git-filter-repo --force\nexit code 128');
        },
      })
    );
    expect(result.isErr()).toBe(true);
    if (!result.isErr()) return;
    expect(result.error.code).toBe('GIT_ERROR');
    if (result.error.code === 'GIT_ERROR') {
      expect(result.error.message).toContain('filter-repo failed');
      expect(result.error.gitOutput).toContain('128');
    }
  });

  it('hints install when the binary is missing', async () => {
    const missing = Object.assign(new Error('spawn git-filter-repo ENOENT'), { code: 'ENOENT' });
    const result = await extractPathsViaFilterRepo(
      EXTRACT_OPTS,
      fakeRuntime({
        runImpl: async () => {
          throw missing;
        },
      })
    );
    expect(result.isErr()).toBe(true);
    if (!result.isErr()) return;
    expect(result.error.code).toBe('GIT_ERROR');
    if (result.error.code === 'GIT_ERROR') {
      expect(result.error.message).toContain('pip install git-filter-repo');
    }
  });

  it('fails when extraction empties history', async () => {
    // Upstream exits 0 on unmatched --path and leaves an empty repo; the
    // post-condition check turns that into a typed error.
    const result = await extractPathsViaFilterRepo(
      { repoPath: 'C:/work/child', paths: ['nope/nothing'], targetSubdir: 'repo-a' },
      fakeRuntime({
        gitImpl: async () => {
          throw new Error("fatal: your current branch 'main' does not have any commits yet");
        },
      })
    );
    expect(result.isErr()).toBe(true);
    if (!result.isErr()) return;
    expect(result.error.code).toBe('GIT_ERROR');
    if (result.error.code === 'GIT_ERROR') {
      expect(result.error.message).toContain('no commits');
    }
  });

  it('fails when rev-list reports zero commits', async () => {
    // A zero count without a throw (empty-but-valid HEAD edge) is the same
    // user-visible state as an unborn HEAD: matched nothing.
    const result = await extractPathsViaFilterRepo(
      { repoPath: 'C:/work/child', paths: ['src/auth'], targetSubdir: 'repo-a' },
      fakeRuntime({ gitImpl: async () => '0' })
    );
    expect(result.isErr()).toBe(true);
    if (!result.isErr()) return;
    expect(result.error.code).toBe('GIT_ERROR');
    if (result.error.code === 'GIT_ERROR') {
      expect(result.error.message).toContain('no commits');
    }
  });

  it('rejects bad input without spawning', async () => {
    const cases: { name: string; opts: Parameters<typeof extractPathsViaFilterRepo>[0] }[] = [
      { name: 'blank repo', opts: { repoPath: '  ', paths: ['a'], targetSubdir: 'r' } },
      { name: 'no paths', opts: { repoPath: 'r', paths: [], targetSubdir: 'r' } },
      { name: 'blank path', opts: { repoPath: 'r', paths: ['  '], targetSubdir: 'r' } },
      { name: 'absolute path', opts: { repoPath: 'r', paths: ['/etc'], targetSubdir: 'r' } },
      { name: 'traversal path', opts: { repoPath: 'r', paths: ['../evil'], targetSubdir: 'r' } },
      {
        name: 'backslash path',
        opts: { repoPath: 'r', paths: ['src\\auth'], targetSubdir: 'r' },
      },
      { name: 'blank subdir', opts: { repoPath: 'r', paths: ['a'], targetSubdir: ' ' } },
      { name: 'subdir traversal', opts: { repoPath: 'r', paths: ['a'], targetSubdir: '../x' } },
      { name: 'slashes-only subdir', opts: { repoPath: 'r', paths: ['a'], targetSubdir: '///' } },
      {
        name: 'blank tag',
        opts: { repoPath: 'r', paths: ['a'], targetSubdir: 'r', tagPrefix: '' },
      },
      {
        name: 'zero timeout',
        opts: { repoPath: 'r', paths: ['a'], targetSubdir: 'r', timeoutMs: 0 },
      },
    ];
    for (const { name, opts } of cases) {
      const seen: RecordedRun[] = [];
      const result = await extractPathsViaFilterRepo(opts, fakeRuntime({ seen }));
      expect(result.isErr(), name).toBe(true);
      if (!result.isErr()) continue;
      expect(result.error.code, name).toBe('CONFIG_ERROR');
      expect(seen, name).toHaveLength(0);
    }
  });
});

async function probeFilterRepoBinary(): Promise<boolean> {
  try {
    await execFileAsync('git-filter-repo', ['--version']);
    return true;
  } catch {
    return false;
  }
}

// Collection-time gate: live tests only run where the binary exists (CI
// runners lack it; a dev box needs the Python Scripts dir on PATH). The
// mocked suite above always runs; absence never passes vacuously.
const HAS_FILTER_REPO = await probeFilterRepoBinary();
if (!HAS_FILTER_REPO) {
  console.warn('[P-070] git-filter-repo not on PATH — live extraction tests skipped.');
}

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', [...args], { cwd });
  return stdout.trim();
}

function toFileUrl(dir: string): string {
  return `file:///${dir.replace(/\\/g, '/')}`;
}

async function exists(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch {
    return false;
  }
}

const EXTRACT_SRC: FixtureSpec = {
  name: 'extract-src',
  commits: [
    {
      message: 'auth scaffold',
      tag: 'v1.0.0',
      files: [{ path: 'src/auth/index.ts', content: { text: 'export const a = 1;\n' } }],
    },
    {
      message: 'utils side',
      files: [{ path: 'src/utils/help.ts', content: { text: 'export const h = 1;\n' } }],
    },
    {
      message: 'docs note',
      files: [{ path: 'docs/readme.md', content: { text: '# docs\n' } }],
    },
    {
      message: 'auth fix',
      files: [
        {
          path: 'src/auth/index.ts',
          content: { text: 'export const a = 1;\nexport const a2 = 2;\n' },
        },
      ],
    },
  ],
};

describe.runIf(HAS_FILTER_REPO)('extractPathsViaFilterRepo live (P-070 real binary)', () => {
  let sourceUrl = '';

  beforeAll(async () => {
    const sourceRoot = await mkdtemp(join(tmpdir(), 'stitch-extract-src-'));
    const generated = await generateFixtures([EXTRACT_SRC], { root: sourceRoot });
    if (generated.isErr()) throw new Error('fixture generation failed');
    const first = generated.value[0];
    if (first === undefined) throw new Error('fixture generated no repos');
    sourceUrl = toFileUrl(first);
  }, 60000);

  afterAll(async () => {
    // Source roots live under tmpdir with the stitch-extract-src- prefix;
    // per-test targets clean themselves. Nothing to do here.
  });

  async function freshClone(): Promise<{ root: string; target: string }> {
    const root = await mkdtemp(join(tmpdir(), 'stitch-extract-'));
    const target = join(root, 'child');
    const cloned = await cloneRepo({ url: sourceUrl, targetDir: target, shallow: false });
    if (cloned.isErr()) throw new Error(`setup clone failed: ${cloned.error.code}`);
    return { root, target };
  }

  it('extracts one dir and rewrites history', async () => {
    const { root, target } = await freshClone();
    try {
      const before = await git(target, [
        'log',
        '--format=%an %ad',
        '--date=short',
        '--',
        'src/auth/index.ts',
      ]);
      const result = await extractPathsViaFilterRepo({
        repoPath: target,
        paths: ['src/auth'],
        targetSubdir: 'repo-a',
      });
      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;
      expect(result.value).toBe(target);
      // Only the extracted tree remains, under the prefix.
      expect(await exists(join(target, 'repo-a', 'src', 'auth', 'index.ts'))).toBe(true);
      expect(await exists(join(target, 'src', 'utils', 'help.ts'))).toBe(false);
      expect(await exists(join(target, 'docs', 'readme.md'))).toBe(false);
      // Only commits touching the kept path survive.
      expect(await git(target, ['log', '--format=%s'])).toBe('auth fix\nauth scaffold');
      // Tags ride along renamed.
      expect(await git(target, ['tag', '--list'])).toBe('repo-a-v1.0.0');
      // Blame keeps original authors and dates.
      const after = await git(target, [
        'log',
        '--format=%an %ad',
        '--date=short',
        '--',
        'repo-a/src/auth/index.ts',
      ]);
      expect(after).toBe(before);
    } finally {
      await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    }
  }, 60000);

  it('renames tags with a custom prefix', async () => {
    const { root, target } = await freshClone();
    try {
      const result = await extractPathsViaFilterRepo({
        repoPath: target,
        paths: ['src/auth'],
        targetSubdir: 'repo-a',
        tagPrefix: 'custom/',
      });
      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;
      expect(await git(target, ['tag', '--list'])).toBe('custom/v1.0.0');
    } finally {
      await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    }
  }, 60000);

  it('extracts multiple paths', async () => {
    const { root, target } = await freshClone();
    try {
      const result = await extractPathsViaFilterRepo({
        repoPath: target,
        paths: ['src/auth', 'docs'],
        targetSubdir: 'repo-a',
      });
      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;
      expect(await exists(join(target, 'repo-a', 'src', 'auth', 'index.ts'))).toBe(true);
      expect(await exists(join(target, 'repo-a', 'docs', 'readme.md'))).toBe(true);
      expect(await exists(join(target, 'src', 'utils', 'help.ts'))).toBe(false);
      expect(await git(target, ['log', '--format=%s'])).toBe('auth fix\ndocs note\nauth scaffold');
    } finally {
      await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    }
  }, 60000);

  it('fails on unmatched paths', async () => {
    const { root, target } = await freshClone();
    try {
      const result = await extractPathsViaFilterRepo({
        repoPath: target,
        paths: ['nope/nothing'],
        targetSubdir: 'repo-a',
      });
      expect(result.isErr()).toBe(true);
      if (!result.isErr()) return;
      expect(result.error.code).toBe('GIT_ERROR');
      if (result.error.code === 'GIT_ERROR') {
        expect(result.error.message).toContain('no commits');
      }
    } finally {
      await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    }
  }, 60000);
});
