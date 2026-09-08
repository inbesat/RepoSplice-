// P-071 tagRename: prefix-namespace repo tags for collision-free merges.
// Unit describes run hermetic (mocked git seam); live describes run real
// local git only (no filter-repo, no network) against P-064 fixtures.
import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { generateFixtures, type FixtureSpec } from '../../../../scripts/generate-fixtures.js';
import { listTags, renameTags, type TagRenameRuntime } from './tagRename.js';

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', [...args], { cwd });
  return stdout.trim();
}

async function freshRoot(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

type GitSeam = (args: readonly string[], cwd: string) => Promise<string>;

function fakeRuntime(
  impl: GitSeam,
  seen?: { calls: { args: readonly string[]; cwd: string }[] }
): TagRenameRuntime {
  return {
    git: async (args, cwd) => {
      seen?.calls.push({ args, cwd });
      return impl(args, cwd);
    },
  };
}

describe('tagRename unit (P-071 mocked seam)', () => {
  it('listTags returns sorted names', async () => {
    const runtime = fakeRuntime(async args => {
      expect([...args]).toEqual(['tag', '--list']);
      return 'v2.0.0\nv10.0.0\nv1.0.0\n';
    });
    const result = await listTags('/repo', runtime);
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;
    // Lexicographic (deterministic P-282); version-sort is P-080's job.
    expect(result.value).toEqual(['v1.0.0', 'v10.0.0', 'v2.0.0']);
  });

  it('listTags maps failure to GIT_ERROR', async () => {
    const runtime = fakeRuntime(async () => {
      throw new Error('fatal: not a git repository');
    });
    const result = await listTags('/repo', runtime);
    expect(result.isErr()).toBe(true);
    if (!result.isErr()) return;
    expect(result.error.code).toBe('GIT_ERROR');
  });

  it('renameTags builds the argv sequence', async () => {
    const seen: { calls: { args: readonly string[]; cwd: string }[] } = { calls: [] };
    const runtime = fakeRuntime(async args => {
      const [cmd, ...rest] = args;
      if (cmd === 'tag' && rest[0] === '--list') return 'v1.0.0\nv2.0.0\n';
      if (cmd === 'check-ref-format') return '';
      if (cmd === 'tag' && rest[0] !== '-d') return '';
      if (cmd === 'tag' && rest[0] === '-d') return '';
      throw new Error(`unexpected call: ${args.join(' ')}`);
    }, seen);
    const result = await renameTags('/repo', { prefix: 'repo-a/' }, runtime);
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;
    expect(result.value.skipped).toEqual([]);
    expect([...result.value.renamed.entries()]).toEqual([
      ['v1.0.0', 'repo-a/v1.0.0'],
      ['v2.0.0', 'repo-a/v2.0.0'],
    ]);
    const argv = seen.calls.map(c => [...c.args]);
    expect(argv).toEqual([
      ['tag', '--list'],
      ['check-ref-format', 'refs/tags/repo-a/v1.0.0'],
      ['check-ref-format', 'refs/tags/repo-a/v2.0.0'],
      ['tag', 'repo-a/v1.0.0', 'v1.0.0'],
      ['tag', '-d', 'v1.0.0'],
      ['tag', 'repo-a/v2.0.0', 'v2.0.0'],
      ['tag', '-d', 'v2.0.0'],
    ]);
    for (const call of seen.calls) expect(call.cwd).toBe('/repo');
  });

  it('renameTags rejects invalid names before mutating', async () => {
    const seen: { calls: { args: readonly string[]; cwd: string }[] } = { calls: [] };
    const runtime = fakeRuntime(async args => {
      if (args[0] === 'tag' && args[1] === '--list') return 'v1.0.0\n';
      if (args[0] === 'check-ref-format')
        throw new Error("fatal: 'refs/tags/bad~x/v1.0.0' is not a valid ref name");
      throw new Error(`unexpected call: ${args.join(' ')}`);
    }, seen);
    const result = await renameTags('/repo', { prefix: 'bad~x/' }, runtime);
    expect(result.isErr()).toBe(true);
    if (!result.isErr()) return;
    expect(result.error.code).toBe('CONFIG_ERROR');
    // Validated everything first: no tag created or deleted.
    expect(seen.calls.map(c => [...c.args])).toEqual([
      ['tag', '--list'],
      ['check-ref-format', 'refs/tags/bad~x/v1.0.0'],
    ]);
  });

  it('renameTags maps delete failure with the replacement named', async () => {
    // Create succeeded but delete failed: duplication (recoverable), never
    // loss — and the error says exactly that.
    const runtime = fakeRuntime(async args => {
      if (args[0] === 'tag' && args[1] === '--list') return 'v1.0.0\n';
      if (args[0] === 'check-ref-format') return '';
      if (args[0] === 'tag' && args[1] !== '-d') return '';
      throw new Error('fatal: locked ref');
    });
    const result = await renameTags('/repo', { prefix: 'repo-a/' }, runtime);
    expect(result.isErr()).toBe(true);
    if (!result.isErr()) return;
    expect(result.error.code).toBe('GIT_ERROR');
    if (result.error.code === 'GIT_ERROR') {
      expect(result.error.message).toContain('repo-a/v1.0.0 exists');
    }
  });

  it('renameTags rejects a blank prefix without spawning', async () => {
    const seen: { calls: { args: readonly string[]; cwd: string }[] } = { calls: [] };
    const runtime = fakeRuntime(async () => '', seen);
    const result = await renameTags('/repo', { prefix: '   ' }, runtime);
    expect(result.isErr()).toBe(true);
    if (!result.isErr()) return;
    expect(result.error.code).toBe('CONFIG_ERROR');
    expect(seen.calls).toHaveLength(0);
  });

  it('renameTags maps create failure without deleting', async () => {
    const seen: { calls: { args: readonly string[]; cwd: string }[] } = { calls: [] };
    const runtime = fakeRuntime(async args => {
      if (args[0] === 'tag' && args[1] === '--list') return 'v1.0.0\n';
      if (args[0] === 'check-ref-format') return '';
      if (args[0] === 'tag' && args[1] !== '-d') throw new Error('fatal: tag failed');
      throw new Error(`unexpected call (old tag must survive): ${args.join(' ')}`);
    }, seen);
    const result = await renameTags('/repo', { prefix: 'repo-a/' }, runtime);
    expect(result.isErr()).toBe(true);
    if (!result.isErr()) return;
    expect(result.error.code).toBe('GIT_ERROR');
    if (result.error.code === 'GIT_ERROR') {
      expect(result.error.message).toContain('v1.0.0');
    }
  });
});

const TAG_SRC: FixtureSpec = {
  name: 'tag-src',
  commits: [
    {
      message: 'one',
      tag: 'v2.0.0',
      files: [{ path: 'a.txt', content: { text: 'one\n' } }],
    },
    {
      message: 'two',
      tag: 'v1.0.0',
      files: [{ path: 'b.txt', content: { text: 'two\n' } }],
    },
    {
      message: 'three',
      files: [{ path: 'c.txt', content: { text: 'three\n' } }],
    },
  ],
};

/** Fresh tagged repo per test: 2 lightweight tags + annotated + v10. */
async function freshTaggedRepo(): Promise<{ root: string; dir: string }> {
  const root = await freshRoot('stitch-tags-');
  const generated = await generateFixtures([TAG_SRC], { root });
  if (generated.isErr()) throw new Error('fixture generation failed');
  const dir = generated.value[0];
  if (dir === undefined) throw new Error('fixture generated no repos');
  await git(dir, ['tag', '-a', 'v3.0.0', '-m', 'release three']);
  await git(dir, ['tag', 'v10.0.0']);
  return { root, dir };
}

describe('tagRename live (P-071 real git)', () => {
  it('lists', async () => {
    const { root, dir } = await freshTaggedRepo();
    try {
      const result = await listTags(dir);
      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;
      expect(result.value).toEqual(['v1.0.0', 'v10.0.0', 'v2.0.0', 'v3.0.0']);
    } finally {
      await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    }
  }, 30000);

  it('renames prefix', async () => {
    const { root, dir } = await freshTaggedRepo();
    try {
      const result = await renameTags(dir, { prefix: 'repo-a/' });
      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;
      expect(result.value.skipped).toEqual([]);
      expect(Object.fromEntries(result.value.renamed)).toEqual({
        'v1.0.0': 'repo-a/v1.0.0',
        'v10.0.0': 'repo-a/v10.0.0',
        'v2.0.0': 'repo-a/v2.0.0',
        'v3.0.0': 'repo-a/v3.0.0',
      });
      expect(await git(dir, ['tag', '--list'])).toBe(
        'repo-a/v1.0.0\nrepo-a/v10.0.0\nrepo-a/v2.0.0\nrepo-a/v3.0.0'
      );
    } finally {
      await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    }
  }, 30000);

  it('collision skip', async () => {
    const { root, dir } = await freshTaggedRepo();
    try {
      // Pre-existing target on a different object. Snapshot semantics: the
      // old tag stays, the blocker itself is still renamed (relocated, not
      // destroyed) — nothing is ever overwritten.
      await git(dir, ['tag', 'repo-a/v1.0.0', 'HEAD~2']);
      const before = await git(dir, ['rev-parse', 'repo-a/v1.0.0']);
      const result = await renameTags(dir, { prefix: 'repo-a/' });
      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;
      expect(result.value.skipped).toEqual(['v1.0.0']);
      expect(result.value.renamed.has('v1.0.0')).toBe(false);
      // Skipped old tag remains under its old name.
      expect(
        await git(dir, ['rev-parse', 'v1.0.0']).then(
          () => 'present',
          () => 'missing'
        )
      ).toBe('present');
      // Blocker object relocated intact, never overwritten.
      expect(await git(dir, ['rev-parse', 'repo-a/repo-a/v1.0.0'])).toBe(before);
      // Non-colliding tags still renamed.
      expect(result.value.renamed.get('v2.0.0')).toBe('repo-a/v2.0.0');
    } finally {
      await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    }
  }, 30000);

  it('annotated kept', async () => {
    const { root, dir } = await freshTaggedRepo();
    try {
      const result = await renameTags(dir, { prefix: 'repo-a/' });
      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;
      // Annotated stays a tag object with its message; light stays a commit.
      expect(await git(dir, ['cat-file', '-t', 'repo-a/v3.0.0'])).toBe('tag');
      expect(await git(dir, ['tag', '-l', '--format=%(subject)', 'repo-a/v3.0.0'])).toBe(
        'release three'
      );
      expect(await git(dir, ['cat-file', '-t', 'repo-a/v1.0.0'])).toBe('commit');
    } finally {
      await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    }
  }, 30000);
});
