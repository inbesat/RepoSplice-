// P-165 — GitFacade integration tests.
//
// Real git state, no mocks: each test builds fixture repos with the P-064
// generator and drives the facade against actual checkouts. The child stage
// (repo C) is a real git repo too, so staging, commits and the P-082 binary
// verification all exercise git for real.
//
// The suite covers the six required scenarios from the phase spec, plus the
// source-read surface and the P-140 arity-1 `commit`:
//
//   it('writes and commits')          (spec: 'writes and commits')
//   it('moves files')                 (spec: 'moves files')
//   it('adds provenance trailers')    (spec: 'adds provenance trailers')
//   it('rolls back')                  (spec: 'rolls back')
//   it('rejects traversal')           (spec: 'rejects traversal')
//   it('skips binaries')              (spec: 'skips binaries')

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, readFile, writeFile, cp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { generateFixtures, type FixtureSpec } from '../../../../scripts/generate-fixtures.js';
import {
  GitFacade,
  createGitFacade,
  withinRepoRoot,
  parseOriginTrailer,
  type FacadePaths,
} from './gitFacade.js';

const run = promisify(execFile);

const SPECS: readonly FixtureSpec[] = [
  {
    name: 'facade-a',
    commits: [
      {
        message: 'initial',
        files: [
          { path: 'src/index.ts', content: { text: 'export const a = 1;\n' } },
          { path: 'package.json', content: { text: '{\n  "name": "facade-a"\n}\n' } },
        ],
      },
    ],
  },
  {
    name: 'facade-b',
    commits: [
      {
        message: 'initial',
        files: [{ path: 'README.md', content: { text: '# b\n' } }],
      },
    ],
  },
];

const CWD = process.cwd();

let baseRoot: string; // holds the pristine generated fixtures
let root: string; // per-test copy
let paths: FacadePaths;
let facade: GitFacade;

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

/** Fresh repo copies per test: no stray-file cascade across tests. */
async function refresh(): Promise<void> {
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });
  await cp(join(baseRoot, 'facade-a'), join(root, 'facade-a'), { recursive: true });
  await cp(join(baseRoot, 'facade-b'), join(root, 'facade-b'), { recursive: true });
  paths = {
    repoA: join(root, 'facade-a'),
    repoB: join(root, 'facade-b'),
    repoC: join(root, 'child'),
  };
  await initStage(paths.repoC);
  facade = createGitFacade(paths);
}

beforeAll(async () => {
  baseRoot = await mkdtemp(join(tmpdir(), 'stitch-facade-base-'));
  const built = await generateFixtures(SPECS, { root: baseRoot, clean: false });
  if (!built.isOk()) throw new Error(`fixtures failed: ${built.error.message}`);
  root = await mkdtemp(join(tmpdir(), 'stitch-facade-'));
}, 60_000);

afterAll(async () => {
  await rm(baseRoot, { recursive: true, force: true });
  await rm(root, { recursive: true, force: true });
});

describe('P-165 GitFacade: writes and commits', () => {
  it('writes and commits', async () => {
    await refresh();
    const write = await facade.writeFile(CWD, 'A', 'src/new.ts', 'export const n = 2;\n');
    expect(write.isOk()).toBe(true);

    // Content actually landed in the CHILD STAGE (repo C), not source A.
    const onDisk = await readFile(join(paths.repoC, 'src', 'new.ts'), 'utf8');
    expect(onDisk).toBe('export const n = 2;\n');
    await expect(readFile(join(paths.repoA, 'src', 'new.ts'))).rejects.toMatchObject({
      code: 'ENOENT',
    });

    const commit = await facade.commitStage('feat: add new module', {
      files: ['src/new.ts'],
      origin: { source: 'A', path: 'src/new.ts', op: 'write' },
    });
    expect(commit.isOk()).toBe(true);
    if (commit.isOk()) {
      expect(commit.value.sha).toMatch(/^[0-9a-f]{7,40}$/);
      expect(commit.value.message).toContain('src/new.ts');
    }

    const log = await run('git', ['-C', paths.repoC, 'log', '--oneline']);
    expect(log.stdout).toContain('feat: add new module');
  }, 30_000);

  it('commits through the P-140 arity-1 commit() too', async () => {
    await refresh();
    const write = await facade.writeFile(CWD, 'A', 'docs/note.md', 'note\n');
    expect(write.isOk()).toBe(true);
    await expect(facade.commit('compat commit')).resolves.toBeUndefined();
    const log = await run('git', ['-C', paths.repoC, 'log', '--oneline']);
    expect(log.stdout).toContain('compat commit');
  }, 30_000);
});

describe('P-165 GitFacade: moves files', () => {
  it('moves files', async () => {
    await refresh();
    await facade.writeFile(CWD, 'A', 'tmp/movable.ts', 'contents\n');
    await facade.commitStage('add movable', { files: ['tmp/movable.ts'] });

    const moved = await facade.move(CWD, 'A', 'tmp/movable.ts', 'lib/movable.ts');
    expect(moved.isOk()).toBe(true);

    await expect(readFile(join(paths.repoC, 'tmp', 'movable.ts'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    const content = await readFile(join(paths.repoC, 'lib', 'movable.ts'), 'utf8');
    expect(content).toBe('contents\n');

    // The rename becomes a real history entry for the blame map (P-079).
    const committed = await facade.commitStage('refactor: move movable', {
      files: ['tmp/movable.ts', 'lib/movable.ts'],
    });
    expect(committed.isOk()).toBe(true);
  }, 30_000);

  it('fails FILE_NOT_FOUND when the source does not exist', async () => {
    await refresh();
    const moved = await facade.move(CWD, 'A', 'nope/missing.ts', 'lib/missing.ts');
    expect(moved.isErr()).toBe(true);
    if (moved.isErr()) expect(moved.error.code).toBe('FILE_NOT_FOUND');
  }, 30_000);
});

describe('P-165 GitFacade: adds provenance trailers', () => {
  it('adds provenance trailers', async () => {
    await refresh();
    const write = await facade.writeFile(CWD, 'A', 'provenance.txt', 'origins\n');
    expect(write.isOk()).toBe(true);
    const commit = await facade.commitStage('fix: provenance check', {
      files: ['provenance.txt'],
      coAuthors: [{ name: 'Repo Splicer', email: 'splicer@stitch.dev' }],
      origin: { source: 'B', path: 'README.md', op: 'component' },
    });
    expect(commit.isOk()).toBe(true);

    const msg = await run('git', ['-C', paths.repoC, 'log', '-1', '--format=%B']);
    expect(msg.stdout).toContain('Co-Authored-By: Repo Splicer <splicer@stitch.dev>');
    const trailerLine = msg.stdout.split('\n').find(line => line.startsWith('Stitch-Origin:'));
    expect(trailerLine).toBeDefined();
    // Round-trip through the structured parser (P-181 seam).
    expect(trailerLine !== undefined && parseOriginTrailer(msg.stdout)).toEqual({
      source: 'B',
      path: 'README.md',
      op: 'component',
    });
  }, 30_000);

  it('parseOriginTrailer ignores foreign prefixes and bad JSON', () => {
    expect(parseOriginTrailer('plain message')).toBeUndefined();
    expect(parseOriginTrailer('Stitch-Origin: {not json')).toBeUndefined();
    expect(
      parseOriginTrailer('{"source":"A","path":"x"}\nStitch-Origin: {"nope":1}')
    ).toBeUndefined();
  });
});

describe('P-165 GitFacade: rolls back', () => {
  it('rolls back', async () => {
    await refresh();
    const headBefore = await run('git', ['-C', paths.repoC, 'rev-parse', 'HEAD']);
    const ref = headBefore.stdout.trim();

    // A tool "fails midway": wrote junk, committed it.
    await facade.writeFile(CWD, 'A', 'junk/failed.ts', 'bad\n');
    const committed = await facade.commitStage('bad move', { files: ['junk/failed.ts'] });
    expect(committed.isOk()).toBe(true);
    expect(await readFile(join(paths.repoC, 'junk', 'failed.ts'), 'utf8')).toBe('bad\n');

    const rolled = await facade.rollback(ref);
    expect(rolled.isOk()).toBe(true);
    await expect(readFile(join(paths.repoC, 'junk', 'failed.ts'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    const headAfter = await run('git', ['-C', paths.repoC, 'rev-parse', 'HEAD']);
    expect(headAfter.stdout.trim()).toBe(ref);
  }, 30_000);
});

describe('P-165 GitFacade: rejects traversal', () => {
  it('rejects traversal', async () => {
    await refresh();
    const escapes = ['../outside.txt', '../../etc/passwd', '/abs/path.txt', 'a/../../b.txt'];
    for (const rel of escapes) {
      const check = withinRepoRoot(paths.repoC, rel);
      expect(check.isErr(), `expected rejection for ${rel}`).toBe(true);
      if (check.isErr()) expect(check.error.code).toBe('CONFIG_ERROR');
    }

    const write = await facade.writeFile(CWD, 'A', '../outside.txt', 'mal\n');
    expect(write.isErr()).toBe(true);
    if (write.isErr()) expect(write.error.code).toBe('CONFIG_ERROR');

    const moved = await facade.move(CWD, 'A', '../a.txt', '../b.txt');
    expect(moved.isErr()).toBe(true);

    const del = await facade.deleteFile(CWD, 'A', '../../victim.txt');
    expect(del.isErr()).toBe(true);
  }, 30_000);

  it('rejects empty paths', () => {
    const check = withinRepoRoot(paths.repoC, '   ');
    expect(check.isErr()).toBe(true);
  });
});

describe('P-165 GitFacade: skips binaries', () => {
  it('skips binaries', async () => {
    await refresh();

    // Magic rule: a NUL in the payload is refused before anything is written.
    const nul = await facade.writeFile(CWD, 'A', 'blob.bin', 'ok\u0000bytes');
    expect(nul.isErr()).toBe(true);
    if (nul.isErr()) expect(nul.error.code).toBe('CONFIG_ERROR');
    expect((await facade.readStagedFile('blob.bin')).isErr()).toBe(true);

    // The P-082 skip list proper (git attributes): `*.dat binary` refuses a
    // text write whose extension the skip list marks binary, and nothing lands.
    await facade.writeFile(CWD, 'A', '.gitattributes', '*.dat binary\n');
    await facade.commitStage('chore: attributes', { files: ['.gitattributes'] });

    const attr = await facade.writeFile(CWD, 'A', 'payload.dat', 'plain text\n');
    expect(attr.isErr()).toBe(true);
    if (attr.isErr()) expect(attr.error.code).toBe('CONFIG_ERROR');
    expect((await facade.readStagedFile('payload.dat')).isErr()).toBe(true);
  }, 30_000);
});

describe('P-165 GitFacade: source reads (A / B)', () => {
  it('lists repo-relative sorted paths, no .git internals', async () => {
    await refresh();
    const listing = await facade.listFiles(CWD, 'A');
    expect(listing.isOk()).toBe(true);
    if (listing.isOk()) {
      expect(listing.value).toContain('src/index.ts');
      expect(listing.value).toContain('package.json');
      expect(listing.value.some(p => p.includes('.git/'))).toBe(false);
      const sorted = [...listing.value].sort();
      expect(listing.value).toEqual(sorted);
    }
  }, 30_000);

  it('reads a known file, FILE_NOT_FOUND for missing', async () => {
    await refresh();
    const read = await facade.readFile(CWD, 'A', 'src/index.ts');
    expect(read.isOk()).toBe(true);
    if (read.isOk()) expect(read.value).toContain('export const a');

    const missing = await facade.readFile(CWD, 'A', 'src/ghost.ts');
    expect(missing.isErr()).toBe(true);
    if (missing.isErr()) expect(missing.error.code).toBe('FILE_NOT_FOUND');
  }, 30_000);
});
