import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { ok, err } from 'neverthrow';
import type { StitchError } from '../result/index.js';
import type { CommitSummary, MergeSummary } from 'simple-git';
import {
  mergeRepos,
  MERGE_AUTHOR_NAME,
  type FilterRepoLike,
  type MergeGit,
  type MergeOptions,
  type MergeRuntime,
} from './merge.js';
import type { CloneOptions } from './clone.js';
import { generateFixtures, type FixtureSpec } from '../../../../scripts/generate-fixtures.js';

const execFileAsync = promisify(execFile);

async function probeFilterRepoBinary(): Promise<boolean> {
  try {
    await execFileAsync('git-filter-repo', ['--version']);
    return true;
  } catch {
    return false;
  }
}

// Collection-time gate (P-070 precedent): the full clone -> filter-repo ->
// tag-rename path needs the binary. The fake-extract suite below always
// runs; absence never passes vacuously.
const HAS_FILTER_REPO = await probeFilterRepoBinary();
if (!HAS_FILTER_REPO) {
  console.warn('[P-072] git-filter-repo not on PATH — live merge tests skipped.');
}

function toFileUrl(dir: string): string {
  return `file:///${dir.replace(/\\/g, '/')}`;
}

async function existsPath(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function readText(path: string): Promise<string> {
  return readFile(path, 'utf8');
}

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', [...args], { cwd });
  return stdout.trim();
}

// A and B share the tag name v1.0.0 on purpose: without prefix namespacing
// the tag fetch in the assembler would collide. Trees are disjoint.
const MERGE_A: FixtureSpec = {
  name: 'merge-a',
  commits: [
    {
      message: 'a one',
      tag: 'v1.0.0',
      files: [{ path: 'src/a.ts', content: { text: 'export const a = 1;\n' } }],
    },
    {
      message: 'a two',
      files: [{ path: 'src/a2.ts', content: { text: 'export const a2 = 2;\n' } }],
    },
  ],
};

const MERGE_B: FixtureSpec = {
  name: 'merge-b',
  commits: [
    {
      message: 'b one',
      tag: 'v1.0.0',
      files: [{ path: 'lib/b.ts', content: { text: 'export const b = 1;\n' } }],
    },
  ],
};

// Same relative path, different bytes: every merge of these two conflicts.
const CLASH_A: FixtureSpec = {
  name: 'clash-a',
  commits: [
    {
      message: 'a shared',
      files: [{ path: 'shared.txt', content: { text: 'from A\n' } }],
    },
  ],
};

const CLASH_B: FixtureSpec = {
  name: 'clash-b',
  commits: [
    {
      message: 'b shared',
      files: [{ path: 'shared.txt', content: { text: 'from B\n' } }],
    },
  ],
};

const SPECS = [MERGE_A, MERGE_B, CLASH_A, CLASH_B] as const;

let fixtureRoot = '';
const fixtureUrls: Record<string, string> = {};

beforeAll(async () => {
  fixtureRoot = await mkdtemp(join(tmpdir(), 'stitch-merge-src-'));
  const generated = await generateFixtures([...SPECS], { root: fixtureRoot });
  if (generated.isErr()) throw new Error('fixture generation failed');
  for (const [index, spec] of SPECS.entries()) {
    const dir = generated.value[index];
    if (dir === undefined) throw new Error(`fixture ${spec.name} generated no dir`);
    fixtureUrls[spec.name] = toFileUrl(dir);
  }
}, 60000);

afterAll(async () => {
  if (fixtureRoot !== '') {
    await rm(fixtureRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
});

async function freshTarget(): Promise<{ root: string; target: string }> {
  const root = await mkdtemp(join(tmpdir(), 'stitch-merge-'));
  return { root, target: join(root, 'child') };
}

async function cleanup(root: string): Promise<void> {
  await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
}

/**
 * Stand-in for the filter-repo step: records its inputs (so the test can
 * assert the orchestration wired P-070 correctly) and leaves the tree alone.
 * Everything else — clone, tag listing, assembly — stays real git.
 */
function identityExtractRuntime(seen: { opts: Parameters<FilterRepoLike>[0] }[]): MergeRuntime {
  const extract: FilterRepoLike = async opts => {
    seen.push({ opts });
    return ok(opts.repoPath);
  };
  return { extract };
}

function clashSources(): MergeOptions {
  const a = fixtureUrls['clash-a'];
  const b = fixtureUrls['clash-b'];
  if (a === undefined || b === undefined) throw new Error('fixtures missing');
  return {
    sources: [
      { name: 'a', url: a, prefix: 'repo-a', paths: ['shared.txt'] },
      { name: 'b', url: b, prefix: 'repo-b', paths: ['shared.txt'] },
    ],
  };
}

function disjointSources(): MergeOptions {
  const a = fixtureUrls['merge-a'];
  const b = fixtureUrls['merge-b'];
  if (a === undefined || b === undefined) throw new Error('fixtures missing');
  return {
    sources: [
      { name: 'a', url: a, prefix: 'repo-a', paths: ['src'] },
      { name: 'b', url: b, prefix: 'repo-b', paths: ['lib'] },
    ],
  };
}

describe('mergeRepos validation (no I/O)', () => {
  it('rejects empty sources without spawning', async () => {
    const seen: { opts: Parameters<FilterRepoLike>[0] }[] = [];
    const result = await mergeRepos({ sources: [] }, identityExtractRuntime(seen));
    expect(result.isErr()).toBe(true);
    if (!result.isErr()) return;
    expect(result.error.code).toBe('CONFIG_ERROR');
    expect(seen).toHaveLength(0);
  });

  it('rejects bad sources without spawning', async () => {
    const a = fixtureUrls['merge-a'];
    if (a === undefined) throw new Error('fixtures missing');
    const good = { name: 'a', url: a, prefix: 'repo-a', paths: ['src'] };
    const cases: { name: string; sources: MergeOptions['sources'] }[] = [
      { name: 'single source', sources: [good] },
      {
        name: 'blank name',
        sources: [
          { ...good, name: '  ' },
          { ...good, name: 'b' },
        ],
      },
      {
        name: 'unsafe name',
        sources: [
          { ...good, name: 'a/b' },
          { ...good, name: 'b' },
        ],
      },
      {
        name: 'blank url',
        sources: [
          { ...good, url: '' },
          { ...good, name: 'b' },
        ],
      },
      {
        name: 'blank prefix',
        sources: [
          { ...good, prefix: '' },
          { ...good, name: 'b' },
        ],
      },
      {
        name: 'traversal prefix',
        sources: [
          { ...good, prefix: '../x' },
          { ...good, name: 'b' },
        ],
      },
      {
        name: 'absolute prefix',
        sources: [
          { ...good, prefix: '/abs' },
          { ...good, name: 'b' },
        ],
      },
      {
        name: 'no paths',
        sources: [
          { ...good, paths: [] },
          { ...good, name: 'b' },
        ],
      },
      {
        name: 'blank path',
        sources: [
          { ...good, paths: ['  '] },
          { ...good, name: 'b' },
        ],
      },
      {
        name: 'duplicate names',
        sources: [good, { ...good, prefix: 'repo-b' }],
      },
      {
        name: 'blank path',
        sources: [
          { ...good, paths: ['  '] },
          { ...good, name: 'b' },
        ],
      },
      {
        name: 'backslash path',
        sources: [
          { ...good, paths: ['src\\auth'] },
          { ...good, name: 'b' },
        ],
      },
      {
        name: 'drive prefix',
        sources: [
          { ...good, prefix: 'C:/x' },
          { ...good, name: 'b' },
        ],
      },
      {
        name: 'backslash prefix',
        sources: [
          { ...good, prefix: 'repo\\a' },
          { ...good, name: 'b' },
        ],
      },
      {
        name: 'blank ref',
        sources: [
          { ...good, ref: ' ' },
          { ...good, name: 'b' },
        ],
      },
    ];
    for (const { name, sources } of cases) {
      const seen: { opts: Parameters<FilterRepoLike>[0] }[] = [];
      const result = await mergeRepos({ sources }, identityExtractRuntime(seen));
      expect(result.isErr(), name).toBe(true);
      if (!result.isErr()) continue;
      expect(result.error.code, name).toBe('CONFIG_ERROR');
      expect(seen, name).toHaveLength(0);
    }
  });

  it('rejects duplicate prefixes with the field named', async () => {
    const base = disjointSources().sources;
    const first = base[0];
    const second = base[1];
    if (first === undefined || second === undefined) throw new Error('fixtures missing');
    const seen: { opts: Parameters<FilterRepoLike>[0] }[] = [];
    const result = await mergeRepos(
      { sources: [first, { ...second, prefix: first.prefix }] },
      identityExtractRuntime(seen)
    );
    expect(result.isErr()).toBe(true);
    if (!result.isErr()) return;
    expect(result.error.code).toBe('CONFIG_ERROR');
    if (result.error.code === 'CONFIG_ERROR') {
      expect(result.error.field).toBe('sources[1].prefix');
    }
    expect(seen).toHaveLength(0);
  });

  it('rejects an existing targetDir before cloning', async () => {
    const { root } = await freshTarget();
    try {
      const seen: { opts: Parameters<FilterRepoLike>[0] }[] = [];
      // root itself exists: using it as the target must fail pre-I/O.
      const opts: MergeOptions = { ...disjointSources(), targetDir: root };
      const result = await mergeRepos(opts, identityExtractRuntime(seen));
      expect(result.isErr()).toBe(true);
      if (!result.isErr()) return;
      expect(result.error.code).toBe('CONFIG_ERROR');
      if (result.error.code === 'CONFIG_ERROR') {
        expect(result.error.field).toBe('targetDir');
      }
      expect(seen).toHaveLength(0);
    } finally {
      await cleanup(root);
    }
  });

  it('rejects a blank targetDir without spawning', async () => {
    const seen: { opts: Parameters<FilterRepoLike>[0] }[] = [];
    const result = await mergeRepos(
      { ...disjointSources(), targetDir: '  ' },
      identityExtractRuntime(seen)
    );
    expect(result.isErr()).toBe(true);
    if (!result.isErr()) return;
    expect(result.error.code).toBe('CONFIG_ERROR');
    expect(seen).toHaveLength(0);
  });

  it('rejects bad authors without spawning', async () => {
    const base = disjointSources();
    const cases: { name: string; author: MergeOptions['author'] }[] = [
      { name: 'blank name', author: { name: ' ', email: 'a@x.y' } },
      { name: 'blank email', author: { name: 'a', email: '' } },
      { name: 'blank date', author: { name: 'a', email: 'a@x.y', date: ' ' } },
    ];
    for (const { name, author } of cases) {
      const seen: { opts: Parameters<FilterRepoLike>[0] }[] = [];
      const result = await mergeRepos(
        { ...base, ...(author !== undefined ? { author } : {}) },
        identityExtractRuntime(seen)
      );
      expect(result.isErr(), name).toBe(true);
      if (!result.isErr()) continue;
      expect(result.error.code, name).toBe('CONFIG_ERROR');
      expect(seen, name).toHaveLength(0);
    }
  });

  it('maps an unusable target path to INTERNAL', async () => {
    // A target nested under a regular file can never be created: stat
    // either refuses (non-ENOENT) or mkdir fails afterwards. Both
    // platforms land on INTERNAL; only the code is asserted.
    const { root } = await freshTarget();
    try {
      const file = join(root, 'file');
      await writeFile(file, 'x\n', 'utf8');
      const seen: { opts: Parameters<FilterRepoLike>[0] }[] = [];
      const result = await mergeRepos(
        { ...disjointSources(), targetDir: join(file, 'child') },
        identityExtractRuntime(seen)
      );
      expect(result.isErr()).toBe(true);
      if (!result.isErr()) return;
      expect(result.error.code).toBe('INTERNAL');
      expect(seen).toHaveLength(0);
    } finally {
      await cleanup(root);
    }
  });
});

describe('mergeRepos assembly (P-072 real git, stubbed extract)', () => {
  it('conflict flags', async () => {
    const { root, target } = await freshTarget();
    try {
      const seen: { opts: Parameters<FilterRepoLike>[0] }[] = [];
      const result = await mergeRepos(
        { ...clashSources(), targetDir: target },
        identityExtractRuntime(seen)
      );
      expect(result.isErr()).toBe(true);
      if (!result.isErr()) return;
      expect(result.error.code).toBe('GIT_ERROR');
      if (result.error.code === 'GIT_ERROR') {
        expect(result.error.message).toContain('conflict');
        expect(result.error.message).toContain('shared.txt');
      }
      // The extract step ran for the first source before the merge failed.
      expect(seen.length).toBeGreaterThan(0);
    } finally {
      await cleanup(root);
    }
  }, 60000);

  it('rollback', async () => {
    const { root, target } = await freshTarget();
    try {
      const seen: { opts: Parameters<FilterRepoLike>[0] }[] = [];
      const failed = await mergeRepos(
        { ...clashSources(), targetDir: target },
        identityExtractRuntime(seen)
      );
      expect(failed.isErr()).toBe(true);
      if (!failed.isErr()) return;
      // No partial child escapes: the target is gone, so the same path is
      // immediately reusable for a clean merge.
      expect(await existsPath(target)).toBe(false);
      const retry = await mergeRepos(
        { ...disjointSources(), targetDir: target },
        identityExtractRuntime([])
      );
      expect(retry.isOk()).toBe(true);
      if (!retry.isOk()) return;
      expect(await existsPath(join(target, 'src', 'a.ts'))).toBe(true);
    } finally {
      await cleanup(root);
    }
  }, 120000);

  it('deterministic', async () => {
    const { root, target } = await freshTarget();
    const second = join(root, 'child-2');
    try {
      const first = await mergeRepos(
        { ...disjointSources(), targetDir: target },
        identityExtractRuntime([])
      );
      expect(first.isOk()).toBe(true);
      if (!first.isOk()) return;
      const rerun = await mergeRepos(
        { ...disjointSources(), targetDir: second },
        identityExtractRuntime([])
      );
      expect(rerun.isOk()).toBe(true);
      if (!rerun.isOk()) return;
      expect(rerun.value.treeSha).toBe(first.value.treeSha);
      expect(rerun.value.commitShas).toEqual(first.value.commitShas);
      expect([...rerun.value.tagMap]).toEqual([...first.value.tagMap]);
      // Empty root + 2 merge commits + merged source histories (2 + 1),
      // all full SHAs. `git log` follows merge parents by design.
      expect(first.value.commitShas).toHaveLength(6);
      for (const sha of first.value.commitShas) {
        expect(sha).toMatch(/^[0-9a-f]{40}$/);
      }
      expect(first.value.treeSha).toMatch(/^[0-9a-f]{40}$/);
      expect(await readText(join(target, 'src', 'a.ts'))).toBe('export const a = 1;\n');
      expect(await readText(join(target, 'lib', 'b.ts'))).toBe('export const b = 1;\n');
    } finally {
      await cleanup(root);
    }
  }, 120000);

  it('records resolved conflicts and completes', async () => {
    const { root, target } = await freshTarget();
    try {
      const seen: { opts: Parameters<FilterRepoLike>[0] }[] = [];
      const result = await mergeRepos(
        {
          ...clashSources(),
          targetDir: target,
          resolveConflicts: async ({ childPath, conflicts }) => {
            expect(conflicts).toEqual(['shared.txt']);
            await writeFile(join(childPath, 'shared.txt'), 'resolved\n', 'utf8');
            return ok({ resolved: true });
          },
        },
        identityExtractRuntime(seen)
      );
      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;
      expect(result.value.conflictList).toEqual(['shared.txt']);
      expect(await readText(join(target, 'shared.txt'))).toBe('resolved\n');
      expect(await git(target, ['status', '--porcelain'])).toBe('');
    } finally {
      await cleanup(root);
    }
  }, 60000);

  it('propagates extract failure and rolls back', async () => {
    const { root, target } = await freshTarget();
    try {
      const failing: MergeRuntime = {
        extract: async () => err({ code: 'GIT_ERROR', message: 'boom', gitOutput: 'boom' }),
      };
      const result = await mergeRepos({ ...disjointSources(), targetDir: target }, failing);
      expect(result.isErr()).toBe(true);
      if (!result.isErr()) return;
      expect(result.error.code).toBe('GIT_ERROR');
      expect(await existsPath(target)).toBe(false);
    } finally {
      await cleanup(root);
    }
  }, 60000);

  it('propagates resolver failure', async () => {
    const { root, target } = await freshTarget();
    try {
      const result = await mergeRepos(
        {
          ...clashSources(),
          targetDir: target,
          resolveConflicts: async () => err({ code: 'USER_CANCELLED', reason: 'nope' }),
        },
        identityExtractRuntime([])
      );
      expect(result.isErr()).toBe(true);
      if (!result.isErr()) return;
      expect(result.error.code).toBe('USER_CANCELLED');
      expect(await existsPath(target)).toBe(false);
    } finally {
      await cleanup(root);
    }
  }, 60000);

  it('treats a declined resolution as a conflict', async () => {
    const { root, target } = await freshTarget();
    try {
      const result = await mergeRepos(
        {
          ...clashSources(),
          targetDir: target,
          resolveConflicts: async () => ok({ resolved: false }),
        },
        identityExtractRuntime([])
      );
      expect(result.isErr()).toBe(true);
      if (!result.isErr()) return;
      expect(result.error.code).toBe('GIT_ERROR');
      if (result.error.code === 'GIT_ERROR') {
        expect(result.error.message).toContain('shared.txt');
      }
      expect(await existsPath(target)).toBe(false);
    } finally {
      await cleanup(root);
    }
  }, 60000);

  it('uses a default target inside the workdir', async () => {
    const seen: { opts: Parameters<FilterRepoLike>[0] }[] = [];
    const result = await mergeRepos({ ...disjointSources() }, identityExtractRuntime(seen));
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;
    try {
      expect(await existsPath(result.value.childPath)).toBe(true);
      expect(await readText(join(result.value.childPath, 'src', 'a.ts'))).toBe(
        'export const a = 1;\n'
      );
      // The orchestration called extract once per source, in order, with
      // the slash-style tag prefix (P-071 convention, R2 composition).
      expect(seen.map(call => call.opts.targetSubdir)).toEqual(['repo-a', 'repo-b']);
      expect(seen.map(call => call.opts.tagPrefix)).toEqual(['repo-a/', 'repo-b/']);
    } finally {
      await rm(dirname(result.value.childPath), {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 50,
      });
    }
  }, 60000);

  it('stamps the fixed author identity', async () => {
    const { root, target } = await freshTarget();
    try {
      const result = await mergeRepos(
        { ...disjointSources(), targetDir: target },
        identityExtractRuntime([])
      );
      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;
      const authors = await git(target, ['log', '--format=%an <%ae>']);
      for (const line of authors.split('\n')) {
        expect(line).toContain(MERGE_AUTHOR_NAME);
      }
    } finally {
      await cleanup(root);
    }
  }, 60000);

  it('plumbs a custom author identity', async () => {
    const { root, target } = await freshTarget();
    try {
      const result = await mergeRepos(
        {
          ...disjointSources(),
          targetDir: target,
          author: { name: 'custom', email: 'c@x.y', date: '2020-05-05T00:00:00+00:00' },
        },
        identityExtractRuntime([])
      );
      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;
      const authors = await git(target, ['log', '--format=%an <%ae>']);
      const lines = authors.split('\n');
      // Newest-first: the 2 merges plus the empty root carry the override;
      // merged source histories keep their fixture identity.
      expect(lines.slice(0, 3)).toEqual(['custom <c@x.y>', 'custom <c@x.y>', 'custom <c@x.y>']);
      expect(lines.slice(3)).toEqual([
        'stitch-fixtures <fixtures@repo-stitcher.local>',
        'stitch-fixtures <fixtures@repo-stitcher.local>',
        'stitch-fixtures <fixtures@repo-stitcher.local>',
      ]);
    } finally {
      await cleanup(root);
    }
  }, 60000);
});

describe.runIf(HAS_FILTER_REPO)('mergeRepos live (P-072 real filter-repo)', () => {
  it('merges A+B', async () => {
    const { root, target } = await freshTarget();
    try {
      const result = await mergeRepos({ ...disjointSources(), targetDir: target });
      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;
      expect(result.value.childPath).toBe(target);
      expect(result.value.treeSha).toMatch(/^[0-9a-f]{40}$/);
      // Empty root + 2 merge commits + surviving source histories
      // (A keeps its 2 src commits, B its 1 lib commit).
      expect(result.value.commitShas).toHaveLength(6);
      expect(result.value.conflictList).toEqual([]);
      expect(await existsPath(join(target, 'repo-a', 'src', 'a.ts'))).toBe(true);
      expect(await existsPath(join(target, 'repo-b', 'lib', 'b.ts'))).toBe(true);
    } finally {
      await cleanup(root);
    }
  }, 120000);

  it('namespaces', async () => {
    const { root, target } = await freshTarget();
    try {
      const result = await mergeRepos({ ...disjointSources(), targetDir: target });
      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;
      // Prefixed trees only: nothing leaks at the root.
      expect(await readText(join(target, 'repo-a', 'src', 'a.ts'))).toBe('export const a = 1;\n');
      expect(await readText(join(target, 'repo-b', 'lib', 'b.ts'))).toBe('export const b = 1;\n');
      expect(await existsPath(join(target, 'src'))).toBe(false);
      expect(await existsPath(join(target, 'lib'))).toBe(false);
      // Both sources tagged v1.0.0; both survive, namespaced, as real tags.
      const tags = await git(target, ['tag', '--list']);
      expect(tags.split('\n').sort()).toEqual(['repo-a/v1.0.0', 'repo-b/v1.0.0']);
      expect([...result.value.tagMap]).toEqual([
        ['repo-a/v1.0.0', 'v1.0.0'],
        ['repo-b/v1.0.0', 'v1.0.0'],
      ]);
      // The namespaced tags point at history containing their files.
      const tagged = await git(target, ['ls-tree', '-r', '--name-only', 'repo-a/v1.0.0']);
      expect(tagged).toContain('repo-a/src/a.ts');
    } finally {
      await cleanup(root);
    }
  }, 120000);
});

type FailMethod =
  | 'init'
  | 'addConfig'
  | 'commit'
  | 'addRemote'
  | 'revparse'
  | 'fetch'
  | 'merge'
  | 'status'
  | 'add'
  | 'log';

interface GitScript {
  fail?: { method: FailMethod; message: string };
  /** Second failure slot for the resolve path (merge must fail first). */
  failResolve?: { method: 'add' | 'commit' | 'status'; message: string };
  failTagFetch?: string;
  failTreeLookup?: string;
  failInspect?: string;
  dirtyAfterResolve?: boolean;
  conflicted?: string[];
}

const SCRIPT_TIP = '0'.repeat(40);

/** Complete success literals (verified by tsc): fakes stay cast-free. */
function scriptedGit(script: GitScript, calls: string[]): MergeGit {
  const maybeThrow = (method: FailMethod): void => {
    calls.push(method);
    if (script.fail?.method === method) throw new Error(script.fail.message);
  };
  let statusCalls = 0;
  return {
    init: async () => {
      maybeThrow('init');
      return { bare: false, existing: false, path: '', gitDir: '' };
    },
    addConfig: async key => {
      maybeThrow('addConfig');
      return key;
    },
    revparse: async ref => {
      calls.push(`revparse:${ref}`);
      if (script.failTreeLookup !== undefined && ref === 'HEAD^{tree}') {
        throw new Error(script.failTreeLookup);
      }
      maybeThrow('revparse');
      return SCRIPT_TIP;
    },
    addRemote: async name => {
      maybeThrow('addRemote');
      return name;
    },
    fetch: async (remote, ref) => {
      calls.push(`fetch:${ref}`);
      if (script.failTagFetch !== undefined && ref.startsWith('+refs/')) {
        throw new Error(script.failTagFetch);
      }
      maybeThrow('fetch');
      return { raw: '', remote, branches: [], tags: [], updated: [], deleted: [] };
    },
    merge: async () => {
      maybeThrow('merge');
      const summary: MergeSummary = {
        files: [],
        insertions: {},
        deletions: {},
        summary: { changes: 0, insertions: 0, deletions: 0 },
        created: [],
        deleted: [],
        remoteMessages: { all: [] },
        conflicts: [],
        merges: [],
        result: 'success',
        failed: false,
      };
      return summary;
    },
    status: async () => {
      calls.push('status');
      statusCalls += 1;
      if (script.fail?.method === 'status') throw new Error(script.fail.message);
      if (statusCalls === 1) {
        if (script.failInspect !== undefined) throw new Error(script.failInspect);
        return { conflicted: script.conflicted ?? [], clean: true };
      }
      if (script.failResolve?.method === 'status') throw new Error(script.failResolve.message);
      return { conflicted: [], clean: script.dirtyAfterResolve !== true };
    },
    add: async () => {
      if (script.failResolve?.method === 'add') throw new Error(script.failResolve.message);
      maybeThrow('add');
      return '';
    },
    commit: async (_message, allowEmpty) => {
      // The empty root is the only allowEmpty commit by construction, so a
      // resolve-commit failure never fires on init.
      if (script.failResolve?.method === 'commit' && !allowEmpty) {
        throw new Error(script.failResolve.message);
      }
      maybeThrow('commit');
      const summary: CommitSummary = {
        author: null,
        branch: 'main',
        commit: SCRIPT_TIP,
        root: false,
        summary: { changes: 0, insertions: 0, deletions: 0 },
      };
      return summary;
    },
    log: async () => {
      maybeThrow('log');
      return { commits: [SCRIPT_TIP] };
    },
    env: (name, value) => {
      calls.push(`env:${name}=${value}`);
    },
  };
}

interface ScriptPorts {
  cloneError?: string;
  extractError?: string;
  listError?: string;
  tags?: string[];
}

function scriptedRuntime(
  script: GitScript,
  calls: string[],
  ports: ScriptPorts = {}
): MergeRuntime {
  return {
    clone: async (opts: CloneOptions) => {
      calls.push('clone');
      if (ports.cloneError !== undefined) {
        return err({ code: 'GIT_ERROR', message: ports.cloneError, gitOutput: ports.cloneError });
      }
      return ok(opts.targetDir);
    },
    extract: async opts => {
      calls.push('extract');
      if (ports.extractError !== undefined) {
        return err({
          code: 'GIT_ERROR',
          message: ports.extractError,
          gitOutput: ports.extractError,
        });
      }
      return ok(opts.repoPath);
    },
    listTags: async () => {
      calls.push('listTags');
      if (ports.listError !== undefined) {
        return err({ code: 'GIT_ERROR', message: ports.listError, gitOutput: ports.listError });
      }
      return ok(ports.tags ?? []);
    },
    createGit: () => scriptedGit(script, calls),
  };
}

function scriptedSources(): MergeOptions {
  return {
    sources: [
      { name: 'a', url: 'file:///fake-a', prefix: 'repo-a', paths: ['src'] },
      { name: 'b', url: 'file:///fake-b', prefix: 'repo-b', paths: ['lib'] },
    ],
  };
}

describe('mergeRepos failure mapping (P-072 scripted git)', () => {
  async function runScripted(
    script: GitScript,
    ports: ScriptPorts = {},
    opts: MergeOptions = scriptedSources()
  ): Promise<{ calls: string[]; error: StitchError | null }> {
    const calls: string[] = [];
    const result = await mergeRepos(opts, scriptedRuntime(script, calls, ports));
    if (result.isOk()) {
      await rm(dirname(result.value.childPath), {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 50,
      });
      return { calls, error: null };
    }
    return { calls, error: result.error };
  }

  it.each([
    { method: 'init' as const, fragment: 'merge init' },
    { method: 'addConfig' as const, fragment: 'merge config' },
    { method: 'commit' as const, fragment: 'merge root commit' },
    { method: 'addRemote' as const, fragment: 'merge remote add' },
    { method: 'revparse' as const, fragment: 'merge read tip' },
    { method: 'fetch' as const, fragment: 'merge fetch' },
  ])('maps $method failure', async ({ method, fragment }) => {
    const { error } = await runScripted({ fail: { method, message: `${method} blew up` } });
    expect(error).not.toBeNull();
    if (error === null) return;
    expect(error.code).toBe('GIT_ERROR');
    if (error.code === 'GIT_ERROR') {
      expect(error.message).toContain(fragment);
      expect(error.message).toContain('blew up');
    }
  });

  it('maps tag fetch failure', async () => {
    const { error } = await runScripted(
      { failTagFetch: 'tag ref gone' },
      { tags: ['repo-a/v1.0.0'] }
    );
    expect(error).not.toBeNull();
    if (error === null) return;
    expect(error.code).toBe('GIT_ERROR');
    if (error.code === 'GIT_ERROR') {
      expect(error.message).toContain('merge tag fetch');
    }
  });

  it('maps tree lookup and log failures', async () => {
    const tree = await runScripted({ failTreeLookup: 'no tree' });
    expect(tree.error?.code).toBe('GIT_ERROR');
    if (tree.error?.code === 'GIT_ERROR') {
      expect(tree.error.message).toContain('merge tree lookup');
    }
    const logged = await runScripted({ fail: { method: 'log', message: 'no log' } });
    expect(logged.error?.code).toBe('GIT_ERROR');
    if (logged.error?.code === 'GIT_ERROR') {
      expect(logged.error.message).toContain('merge log');
    }
  });

  it('reports a merge failure without conflicts', async () => {
    const { error } = await runScripted({ fail: { method: 'merge', message: 'weird' } });
    expect(error?.code).toBe('GIT_ERROR');
    if (error?.code === 'GIT_ERROR') {
      expect(error.message).toContain('failed without conflicts');
      expect(error.message).toContain('weird');
    }
  });

  it('maps status inspection failure', async () => {
    // The merge rejects, then even the conflict inspection fails: the
    // inspection error (not the merge error) is what surfaces.
    const { error } = await runScripted({
      fail: { method: 'merge', message: 'boom' },
      failInspect: 'no status',
    });
    expect(error?.code).toBe('GIT_ERROR');
    if (error?.code === 'GIT_ERROR') {
      expect(error.message).toContain('merge inspect');
    }
  });

  it('maps resolve stage, commit, and verify failures', async () => {
    const resolving = {
      fail: { method: 'merge' as const, message: 'conflict' },
      conflicted: ['f.txt'],
    };
    const withResolver = (script: GitScript) =>
      runScripted(
        script,
        {},
        {
          ...scriptedSources(),
          resolveConflicts: async () => ok({ resolved: true }),
        }
      );
    const stage = await withResolver({
      ...resolving,
      failResolve: { method: 'add', message: 'no stage' },
    });
    expect(stage.error?.code).toBe('GIT_ERROR');
    if (stage.error?.code === 'GIT_ERROR') {
      expect(stage.error.message).toContain('merge stage resolved');
    }
    const committed = await withResolver({
      ...resolving,
      failResolve: { method: 'commit', message: 'no commit' },
    });
    expect(committed.error?.code).toBe('GIT_ERROR');
    if (committed.error?.code === 'GIT_ERROR') {
      expect(committed.error.message).toContain('merge commit resolved');
    }
    const verified = await withResolver({
      ...resolving,
      failResolve: { method: 'status', message: 'no verify' },
    });
    expect(verified.error?.code).toBe('GIT_ERROR');
    if (verified.error?.code === 'GIT_ERROR') {
      expect(verified.error.message).toContain('merge verify resolved');
    }
    const dirty = await withResolver({ ...resolving, dirtyAfterResolve: true });
    expect(dirty.error?.code).toBe('GIT_ERROR');
    if (dirty.error?.code === 'GIT_ERROR') {
      expect(dirty.error.message).toContain('left uncommitted changes');
    }
  });

  it('maps a throwing resolver to INTERNAL', async () => {
    const { error } = await runScripted(
      { fail: { method: 'merge', message: 'conflict' }, conflicted: ['f.txt'] },
      {},
      {
        ...scriptedSources(),
        resolveConflicts: async () => {
          throw new Error('resolver kaboom');
        },
      }
    );
    expect(error?.code).toBe('INTERNAL');
    if (error?.code === 'INTERNAL') {
      expect(error.message).toContain('resolver threw');
    }
  });

  it('passes clone and tag-listing failures through', async () => {
    const cloned = await runScripted({}, { cloneError: 'no clone' });
    expect(cloned.error?.code).toBe('GIT_ERROR');
    if (cloned.error?.code === 'GIT_ERROR') {
      expect(cloned.error.message).toBe('no clone');
    }
    const listed = await runScripted({}, { listError: 'no tags' });
    expect(listed.error?.code).toBe('GIT_ERROR');
    if (listed.error?.code === 'GIT_ERROR') {
      expect(listed.error.message).toBe('no tags');
    }
  });

  it('pins deterministic identity on the git client', async () => {
    const { calls, error } = await runScripted({});
    expect(error).toBeNull();
    expect(calls).toContain('env:GIT_AUTHOR_NAME=repo-stitcher');
    expect(calls).toContain('env:GIT_AUTHOR_EMAIL=repo-stitcher@localhost');
    expect(calls).toContain('env:GIT_AUTHOR_DATE=2026-01-01T00:00:00+00:00');
    expect(calls).toContain('env:GIT_COMMITTER_NAME=repo-stitcher');
    expect(calls).toContain('env:GIT_COMMITTER_EMAIL=repo-stitcher@localhost');
    expect(calls).toContain('env:GIT_COMMITTER_DATE=2026-01-01T00:00:00+00:00');
    // Tagless sources skip the tag refspec: only tip fetches run.
    expect(calls.filter(call => call.startsWith('fetch:'))).toEqual([
      `fetch:${SCRIPT_TIP}`,
      `fetch:${SCRIPT_TIP}`,
    ]);
  });
});
