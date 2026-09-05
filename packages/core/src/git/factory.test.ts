// P-016 fixture test: confirms the simple-git wrapper (createGit) works
// end-to-end against a throwaway temp repo. P-062 sandbox image will
// provide the real environment for cross-machine tests; this proves the
// factory surface is correct.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGit, checkGitAvailable, isRepo, getStatus, getLog, initRepo } from './factory.js';
import { fromInternalPromise } from '../result/index.js';

let workDir: string;
let cleanup: () => Promise<void>;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'repo-stitcher-git-'));
  cleanup = async () => {
    await rm(workDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  };
});

afterEach(async () => {
  await cleanup();
});

describe('P-016 git factory: binary detection', () => {
  it('checkGitAvailable() returns the system git version', async () => {
    const result = await checkGitAvailable();
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.version).toMatch(/^git version \d+\.\d+/);
    }
  });
});

describe('P-016 git factory: createGit + init', () => {
  it('createGit() returns a SimpleGit instance configured for baseDir', () => {
    const git = createGit({ baseDir: workDir });
    expect(git).toBeDefined();
    expect(typeof git.init).toBe('function');
    expect(typeof git.status).toBe('function');
    expect(typeof git.log).toBe('function');
  });

  it('initRepo() creates a working .git directory', async () => {
    const git = createGit({ baseDir: workDir });
    const result = await initRepo(git);
    expect(result.isOk()).toBe(true);
  });

  it('isRepo() returns true after init, false before', async () => {
    const git = createGit({ baseDir: workDir });
    const before = await isRepo(git);
    expect(before.isOk()).toBe(true);
    if (before.isOk()) expect(before.value).toBe(false);

    const initResult = await initRepo(git);
    expect(initResult.isOk()).toBe(true);

    const after = await isRepo(git);
    expect(after.isOk()).toBe(true);
    if (after.isOk()) expect(after.value).toBe(true);
  });

  it('isRepo() on a non-repo returns ok(false) (not an error)', async () => {
    // /tmp or empty subdir is guaranteed to not be a git repo
    const git = createGit({ baseDir: workDir });
    const r = await isRepo(git);
    expect(r.isOk()).toBe(true);
    if (r.isOk()) expect(r.value).toBe(false);
  });
});

describe('P-016 git factory: full commit + log + status cycle', () => {
  it('init → add → commit → log returns the commit', async () => {
    const git = createGit({ baseDir: workDir });

    // init + identity
    const initResult = await initRepo(git);
    expect(initResult.isOk()).toBe(true);
    await git.addConfig('user.email', 'test@repo-stitcher.local');
    await git.addConfig('user.name', 'P-016 Test');

    // create + stage a file
    const filePath = join(workDir, 'hello.txt');
    await writeFile(filePath, 'hello world', 'utf8');
    await git.add('hello.txt');

    // commit
    const commitResult = await fromInternalPromise(git.commit('initial commit'), 'git.commit');
    expect(commitResult.isOk()).toBe(true);

    // log
    const log = await getLog(git, { maxCount: 1 });
    expect(log.isOk()).toBe(true);
    if (log.isOk()) {
      expect(log.value.total).toBe(1);
      expect(log.value.latest?.message).toBe('initial commit');
    }

    // status
    const status = await getStatus(git);
    expect(status.isOk()).toBe(true);
    if (status.isOk()) {
      expect(status.value.current).toBeDefined();
    }

    // the committed file is on disk
    const read = await readFile(filePath, 'utf8');
    expect(read).toBe('hello world');
  });
});
