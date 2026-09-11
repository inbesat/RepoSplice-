// Git Core epic consolidation (P-087): multi-origin provenance. Two
// identities committing under two prefixes must attribute per directory
// AND per author, and uncommitted lines must never invent a commit.

import { describe, it, expect } from 'vitest';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  makeTempRepo,
  commitFiles,
  headSha,
  disposeRepo,
  git,
} from '../../../test-utils/gitFixtures.js';
import { buildBlameMap } from '../blameMap.js';

async function commitAs(
  repo: string,
  name: string,
  email: string,
  files: Record<string, string>,
  message: string
): Promise<string> {
  await git(repo, ['config', 'user.name', name]);
  await git(repo, ['config', 'user.email', email]);
  return commitFiles(repo, files, message);
}

describe('multi-origin blame (P-087 epic edge)', () => {
  it('attributes per prefix and per author', async () => {
    const repo = await makeTempRepo('stitch-epic-blame-');
    try {
      await commitAs(repo, 'Alice', 'alice@stitch.dev', { 'a/one.txt': 'a1\na2\n' }, 'alice first');
      await commitAs(repo, 'Bob', 'bob@stitch.dev', { 'b/two.txt': 'b1\n' }, 'bob first');
      await commitAs(
        repo,
        'Alice',
        'alice@stitch.dev',
        { 'a/one.txt': 'a1\na2\na3\n' },
        'alice second'
      );
      const map = await buildBlameMap(repo, [
        { name: 'team-a', prefix: 'a/' },
        { name: 'team-b', prefix: 'b/' },
      ]);
      expect(map.isOk()).toBe(true);
      if (map.isErr()) return;
      expect(map.value.repoPath).toBe(repo);
      const paths = map.value.files.map(file => file.path).sort();
      expect(paths).toEqual(['a/one.txt', 'b/two.txt']);
      const one = map.value.files.find(file => file.path === 'a/one.txt');
      const two = map.value.files.find(file => file.path === 'b/two.txt');
      if (one === undefined || two === undefined) throw new Error('missing files');
      expect(one.origins.length).toBeGreaterThan(0);
      for (const origin of one.origins) {
        expect(origin.author).toBe('Alice');
        expect(origin.sha).not.toBeNull();
      }
      expect(two.origins.map(origin => origin.author)).toEqual(['Bob']);
      // Line ranges tile the file exactly.
      const last = one.origins[one.origins.length - 1];
      if (last === undefined) throw new Error('no origins');
      expect(one.origins[0]?.startLine).toBe(1);
      expect(last.endLine).toBe(3);
    } finally {
      await disposeRepo(repo);
    }
  }, 30_000);

  it('leaves uncommitted lines sha-less', async () => {
    const repo = await makeTempRepo('stitch-epic-blame-');
    try {
      await commitAs(repo, 'Alice', 'alice@stitch.dev', { 'a/one.txt': 'a1\n' }, 'base');
      await writeFile(join(repo, 'a/one.txt'), 'a1\ndirty\n');
      const map = await buildBlameMap(repo, [{ name: 'team-a', prefix: 'a/' }]);
      expect(map.isOk()).toBe(true);
      if (map.isErr()) return;
      const one = map.value.files.find(file => file.path === 'a/one.txt');
      if (one === undefined) throw new Error('missing file');
      const open = one.origins.find(origin => origin.sha === null);
      expect(open).not.toBeUndefined();
      expect(open?.endLine).toBe(2);
    } finally {
      await disposeRepo(repo);
    }
  }, 30_000);

  it('tracks tips across identities', async () => {
    const repo = await makeTempRepo('stitch-epic-blame-');
    try {
      await commitAs(repo, 'Alice', 'alice@stitch.dev', { 'a/one.txt': 'a1\n' }, 'base');
      const tip = await commitAs(repo, 'Bob', 'bob@stitch.dev', { 'b/two.txt': 'b1\n' }, 'second');
      expect(tip).toBe(await headSha(repo));
      const map = await buildBlameMap(
        repo,
        [
          { name: 'team-a', prefix: 'a/', tipSha: tip },
          { name: 'team-b', prefix: 'b/', tipSha: tip },
        ],
        {}
      );
      expect(map.isOk()).toBe(true);
      if (map.isErr()) return;
      expect(map.value.files).toHaveLength(2);
    } finally {
      await disposeRepo(repo);
    }
  }, 30_000);
});
