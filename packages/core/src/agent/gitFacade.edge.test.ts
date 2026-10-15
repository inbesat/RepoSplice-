// P-165 — GitFacade edge / error coverage suite.
//
// `gitFacade.test.ts` covers the six phase-spec scenarios against real git
// state. This file complements it by driving the paths those happy-path
// scenarios never reach: the source-read surface (A and B), the pre-P-165
// `diff`/`status`/`add` methods, traversal and not-found refusals, every
// `catch` arm (write / rename / unlink failures and the subprocess-failure
// branches), the `expandIntended` directory-intent expansion, the
// `mergeSources`/`stageStatus`/`abort` delegations, and the error returns of
// `commit` / `commitStage` / `rollback`.
//
// Same discipline as the sibling suite: real fixtures, real git, no mocks.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, mkdir, cp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { generateFixtures, type FixtureSpec } from '../../../../scripts/generate-fixtures.js';
import {
  createGitFacade,
  parseOriginTrailer,
  type GitFacade,
  type FacadePaths,
} from './gitFacade.js';

const run = promisify(execFile);

const SPECS: readonly FixtureSpec[] = [
  {
    name: 'edge-a',
    commits: [
      {
        message: 'initial',
        files: [
          { path: 'src/index.ts', content: { text: 'export const a = 1;\n' } },
          { path: 'package.json', content: { text: '{\n  "name": "edge-a"\n}\n' } },
        ],
      },
    ],
  },
  {
    name: 'edge-b',
    commits: [
      {
        message: 'initial',
        files: [{ path: 'README.md', content: { text: '# b\n' } }],
      },
    ],
  },
];

const CWD = process.cwd();

let baseRoot: string;
let root: string;
let paths: FacadePaths;

/** Initialise repo C as a real git repo with one commit. */
async function initStage(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await run('git', ['-C', dir, 'init', '-b', 'main', '-q']);
  await run('git', ['-C', dir, 'config', 'user.email', 'stitch@test.dev']);
  await run('git', ['-C', dir, 'config', 'user.name', 'Stitch Test']);
  await writeFile(join(dir, '.gitkeep'), '', 'utf8');
  await run('git', ['-C', dir, 'add', '.gitkeep']);
  await run('git', ['-C', dir, 'commit', '-q', '-m', 'init', '--no-gpg-sign']);
}

/** Fresh copies of both fixtures + a fresh stage. */
async function refresh(): Promise<GitFacade> {
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });
  await cp(join(baseRoot, 'edge-a'), join(root, 'edge-a'), { recursive: true });
  await cp(join(baseRoot, 'edge-b'), join(root, 'edge-b'), { recursive: true });
  paths = {
    repoA: join(root, 'edge-a'),
    repoB: join(root, 'edge-b'),
    repoC: join(root, 'child'),
  };
  await initStage(paths.repoC);
  return createGitFacade(paths);
}

beforeAll(async () => {
  baseRoot = await mkdtemp(join(tmpdir(), 'stitch-edge-base-'));
  const built = await generateFixtures(SPECS, { root: baseRoot, clean: false });
  if (!built.isOk()) throw new Error(`fixtures failed: ${built.error.message}`);
  root = await mkdtemp(join(tmpdir(), 'stitch-edge-'));
}, 60_000);

afterAll(async () => {
  await rm(baseRoot, { recursive: true, force: true });
  await rm(root, { recursive: true, force: true });
});

describe('parseOriginTrailer: op validation and whitespace', () => {
  it('accepts every known op and round-trips source/path', () => {
    const ops = ['write', 'move', 'delete', 'component'] as const;
    for (const op of ops) {
      expect(
        parseOriginTrailer(`Stitch-Origin: {"source":"B","path":"p/${op}","op":"${op}"}`)
      ).toEqual({ source: 'B', path: `p/${op}`, op });
    }
  });

  it('ignores a well-formed trailer whose op is unknown', () => {
    expect(
      parseOriginTrailer('Stitch-Origin: {"source":"A","path":"x","op":"rename"}')
    ).toBeUndefined();
  });

  it('tolerates surrounding whitespace and picks the first valid trailer', () => {
    const msg = [
      'subject',
      '',
      'Co-Authored-By: x <x@y.z>',
      '   Stitch-Origin:    {"source":"A","path":"x","op":"move"}   ',
    ].join('\n');
    expect(parseOriginTrailer(msg)).toEqual({ source: 'A', path: 'x', op: 'move' });
  });
});

describe('GitFacade: pre-P-165 read-only surface (now real)', () => {
  it('reports a clean stage and never throws', async () => {
    const facade = await refresh();
    await expect(facade.diff()).resolves.toBe('');
    await expect(facade.status()).resolves.toBe('');
    await expect(facade.add([])).resolves.toBeUndefined();
    // A traversal path in `add` is skipped, not staged.
    await expect(facade.add(['../escape.txt'])).resolves.toBeUndefined();
  });
});

describe('GitFacade: source reads cover A and B', () => {
  it('reads and lists both source repos, plus the path helpers', async () => {
    const facade = await refresh();

    // Writes go to the STAGE; sources are read-only. Populate B on disk.
    await writeFile(join(paths.repoB, 'extra.md'), 'b extra\n', 'utf8');

    const readA = await facade.readFile(CWD, 'A', 'src/index.ts');
    expect(readA.isOk() && readA.value).toContain('export const a');

    const readB = await facade.readFile(CWD, 'B', 'extra.md');
    expect(readB.isOk() && readB.value).toBe('b extra\n');

    const listB = await facade.listFiles(CWD, 'B');
    expect(listB.isOk() && listB.value).toContain('extra.md');
    expect(listB.isOk() && listB.value).toContain('README.md');

    expect(facade.repoPath('A')).toBe(paths.repoA);
    expect(facade.repoPath('B')).toBe(paths.repoB);
    expect(facade.stageRoot()).toBe(paths.repoC);
  }, 30_000);
});

describe('GitFacade: readStagedFile refusals', () => {
  it('rejects traversal, and reports INTERNAL for non-ENOENT read failures', async () => {
    const facade = await refresh();

    const escaped = await facade.readStagedFile('../secret.txt');
    expect(escaped.isErr()).toBe(true);
    if (escaped.isErr()) expect(escaped.error.code).toBe('CONFIG_ERROR');

    await facade.writeFile(CWD, 'A', 'dirwith/child.ts', 'x\n');
    const onDir = await facade.readStagedFile('dirwith');
    expect(onDir.isErr()).toBe(true);
    if (onDir.isErr()) expect(onDir.error.code).toBe('INTERNAL');

    const missing = await facade.readStagedFile('ghost.ts');
    expect(missing.isErr()).toBe(true);
    if (missing.isErr()) expect(missing.error.code).toBe('FILE_NOT_FOUND');
  }, 30_000);
});

describe('GitFacade: writeFile failure', () => {
  it('reports INTERNAL when the write target cannot be created', async () => {
    const facade = await refresh();
    // `blocker` is a FILE, so mkdir'ing it as a directory must fail.
    const blocker = await facade.writeFile(CWD, 'A', 'blocker', 'plain\n');
    expect(blocker.isOk()).toBe(true);

    const nested = await facade.writeFile(CWD, 'A', 'blocker/child.ts', 'x\n');
    expect(nested.isErr()).toBe(true);
    if (nested.isErr()) expect(nested.error.code).toBe('INTERNAL');
  }, 30_000);
});

describe('GitFacade: move refusals and failures', () => {
  it('rejects a traversing destination without touching the source', async () => {
    const facade = await refresh();
    await facade.writeFile(CWD, 'A', 'm1.ts', 'x\n');

    const escaped = await facade.move(CWD, 'A', 'm1.ts', '../outside.ts');
    expect(escaped.isErr()).toBe(true);
    if (escaped.isErr()) expect(escaped.error.code).toBe('CONFIG_ERROR');

    const still = await facade.readStagedFile('m1.ts');
    expect(still.isOk()).toBe(true);
  }, 30_000);

  it('reports INTERNAL when the rename cannot complete', async () => {
    const facade = await refresh();
    await facade.writeFile(CWD, 'A', 'm2.ts', 'x\n');
    await facade.writeFile(CWD, 'A', 'mblocker', 'file\n');

    const bad = await facade.move(CWD, 'A', 'm2.ts', 'mblocker/child.ts');
    expect(bad.isErr()).toBe(true);
    if (bad.isErr()) expect(bad.error.code).toBe('INTERNAL');
  }, 30_000);
});

describe('GitFacade: deleteFile', () => {
  it('deletes an existing file', async () => {
    const facade = await refresh();
    await facade.writeFile(CWD, 'A', 'gone.ts', 'x\n');

    const deleted = await facade.deleteFile(CWD, 'A', 'gone.ts');
    expect(deleted.isOk()).toBe(true);

    const after = await facade.readStagedFile('gone.ts');
    expect(after.isErr()).toBe(true);
  }, 30_000);

  it('reports FILE_NOT_FOUND for a missing path', async () => {
    const facade = await refresh();
    const missing = await facade.deleteFile(CWD, 'A', 'never-existed.ts');
    expect(missing.isErr()).toBe(true);
    if (missing.isErr()) expect(missing.error.code).toBe('FILE_NOT_FOUND');
  }, 30_000);

  it('reports INTERNAL when the unlink itself fails', async () => {
    const facade = await refresh();
    // A non-empty directory cannot be unlinked as a file.
    await facade.writeFile(CWD, 'A', 'dir3/child.ts', 'x\n');

    const onDir = await facade.deleteFile(CWD, 'A', 'dir3');
    expect(onDir.isErr()).toBe(true);
    if (onDir.isErr()) expect(onDir.error.code).toBe('INTERNAL');
  }, 30_000);
});

describe('GitFacade: expandIntended directory intent', () => {
  it('expands a directory to every changed file inside it', async () => {
    const facade = await refresh();
    await facade.writeFile(CWD, 'A', 'packet/one.ts', '1\n');
    await facade.writeFile(CWD, 'A', 'packet/two.ts', '2\n');

    const commit = await facade.commitStage('feat: packet', { files: ['packet'] });
    expect(commit.isOk()).toBe(true);

    const log = await run('git', ['-C', paths.repoC, 'log', '-1', '--name-only', '--format=']);
    expect(log.stdout).toContain('packet/one.ts');
    expect(log.stdout).toContain('packet/two.ts');
  }, 30_000);

  it('leaves an unmatched entry to git, which refuses it', async () => {
    const facade = await refresh();
    const commit = await facade.commitStage('chore: ghost', { files: ['ghost/never.ts'] });
    expect(commit.isErr()).toBe(true);
    if (commit.isErr()) expect(commit.error.code).toBe('GIT_ERROR');
  }, 30_000);
});

describe('GitFacade: stageStatus and abort delegations', () => {
  it('stageStatus is true when clean, false when dirty', async () => {
    const facade = await refresh();
    const clean = await facade.stageStatus();
    expect(clean.isOk() && clean.value).toBe(true);

    // Bypass the facade: a raw untracked file makes the stage dirty.
    await writeFile(join(paths.repoC, 'dirty.txt'), 'x\n', 'utf8');
    const dirty = await facade.stageStatus();
    expect(dirty.isOk()).toBe(true);
    if (dirty.isOk()) expect(dirty.value).toBe(false);
  }, 30_000);

  it('mergeSources delegates to mergeRepos (invalid opts fail)', async () => {
    const facade = await refresh();
    const merged = await facade.mergeSources({ sources: [] });
    expect(merged.isErr()).toBe(true);
  });

  it('abort surfaces a failure on a non-repo stage', async () => {
    await refresh();
    const notRepo = join(root, 'not-a-repo');
    await mkdir(notRepo, { recursive: true });
    const facade = createGitFacade({
      repoA: paths.repoA,
      repoB: paths.repoB,
      repoC: notRepo,
    });
    const aborted = await facade.abort('merge');
    expect(aborted.isErr()).toBe(true);
  }, 30_000);
});

describe('GitFacade: commit (P-140 arity-1) error paths', () => {
  it('throws when the stage is not a git repository', async () => {
    await refresh();
    const notRepo = join(root, 'not-a-repo-2');
    await mkdir(notRepo, { recursive: true });
    const broken = createGitFacade({
      repoA: paths.repoA,
      repoB: paths.repoB,
      repoC: notRepo,
    });

    await expect(broken.commit('nope')).rejects.toThrow(/git add -A failed/);
  }, 30_000);

  it('throws when there is nothing to commit', async () => {
    const facade = await refresh(); // pristine stage
    await expect(facade.commit('empty')).rejects.toThrow(/nothing to commit/i);
  }, 30_000);
});

describe('GitFacade: commitStage error paths', () => {
  it('returns GIT_ERROR when git status cannot be read', async () => {
    await refresh();
    const notRepo = join(root, 'not-a-repo-3');
    await mkdir(notRepo, { recursive: true });
    const facade = createGitFacade({
      repoA: paths.repoA,
      repoB: paths.repoB,
      repoC: notRepo,
    });

    const result = await facade.commitStage('x', { files: ['a.ts'] });
    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.code).toBe('GIT_ERROR');
  }, 30_000);

  it('returns an error when nothing is staged', async () => {
    const facade = await refresh();
    const result = await facade.commitStage('x', {});
    expect(result.isErr()).toBe(true);
  }, 30_000);

  it('honours an explicit timeoutMs on the happy path', async () => {
    const facade = await refresh();
    await facade.writeFile(CWD, 'A', 'timed.ts', 'x\n');

    const result = await facade.commitStage('feat: timed', {
      files: ['timed.ts'],
      timeoutMs: 30_000,
    });
    expect(result.isOk()).toBe(true);
  }, 30_000);
});

describe('GitFacade: rollback failure', () => {
  it('surfaces a resetTo failure and forwards the timeout', async () => {
    const facade = await refresh();
    const result = await facade.rollback('no-such-ref-xyz', 30_000);
    expect(result.isErr()).toBe(true);
  }, 30_000);
});
