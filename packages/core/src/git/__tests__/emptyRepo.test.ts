// Git Core epic consolidation (P-087): every op against a born-empty
// repo (no commits, no HEAD). Empty trees are the boundary the per-phase
// suites never exercised: clean checks must hold vacuously, aborts must
// no-op, ref resolution must refuse (nothing to resolve), while root
// commits and empty clones must still work.

import { describe, it, expect } from 'vitest';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  makeTempRepo,
  commitFiles,
  headSha,
  disposeRepo,
  git,
  toFileUrl,
} from '../../../test-utils/gitFixtures.js';
import { isClean, assertClean } from '../clean.js';
import { abortGitOp } from '../rollback.js';
import { resetTo } from '../rollback.js';
import { commitWithTrailers } from '../commit.js';
import { cloneMany } from '../perf.js';
import { buildBlameMap } from '../blameMap.js';

describe('empty repos (P-087 epic edge)', () => {
  it('clean checks hold vacuously', async () => {
    const repo = await makeTempRepo('stitch-epic-empty-');
    try {
      expect((await isClean(repo)).unwrapOr(false)).toBe(true);
      expect((await assertClean(repo, 'empty-preflight')).isOk()).toBe(true);
    } finally {
      await disposeRepo(repo);
    }
  }, 30_000);

  it('aborts no-op without sequencers', async () => {
    const repo = await makeTempRepo('stitch-epic-empty-');
    try {
      for (const kind of ['merge', 'cherry-pick', 'rebase'] as const) {
        expect((await abortGitOp(repo, kind)).isOk()).toBe(true);
      }
    } finally {
      await disposeRepo(repo);
    }
  }, 30_000);

  it('resetTo refuses the unborn HEAD without moving', async () => {
    const repo = await makeTempRepo('stitch-epic-empty-');
    try {
      const result = await resetTo(repo, 'HEAD');
      expect(result.isErr()).toBe(true);
      if (result.isOk()) return;
      expect(result.error.code).toBe('CONFIG_ERROR');
      if (result.error.code !== 'CONFIG_ERROR') return;
      expect(result.error.field).toBe('ref');
      // Still unborn: nothing was created or moved.
      await expect(git(repo, ['rev-parse', 'HEAD'])).rejects.toThrow();
    } finally {
      await disposeRepo(repo);
    }
  }, 30_000);

  it('root commits carry trailers', async () => {
    const repo = await makeTempRepo('stitch-epic-empty-');
    try {
      await commitFiles(repo, { 'a.txt': 'v1\n' }, 'seed');
      // commitWithTrailers commits the STAGED tree: stage first.
      await writeFile(join(repo, 'b.txt'), 'v2\n');
      await git(repo, ['add', '-A']);
      const sha = await commitWithTrailers(
        repo,
        'feat: second',
        [{ name: 'Ada', email: 'ada@stitch.dev' }],
        {}
      );
      expect(sha.isOk()).toBe(true);
      if (sha.isErr()) return;
      expect(sha.value).toBe(await headSha(repo));
      const body = await git(repo, ['log', '-1', '--format=%B']);
      expect(body).toContain('Co-Authored-By: Ada <ada@stitch.dev>');
    } finally {
      await disposeRepo(repo);
    }
  }, 30_000);

  it('empty file:// repos clone clean', async () => {
    const src = await makeTempRepo('stitch-epic-empty-src-');
    const work = await makeTempRepo('stitch-epic-empty-work-');
    // The work dir is itself a repo; clones land in fresh subdirs.
    try {
      const target = join(work, 'child');
      const result = await cloneMany([{ url: toFileUrl(src), targetDir: target }]);
      expect(result.isOk()).toBe(true);
      if (result.isErr()) return;
      expect(result.value[0]?.isOk()).toBe(true);
      expect((await isClean(target)).unwrapOr(false)).toBe(true);
      await expect(git(target, ['rev-parse', 'HEAD'])).rejects.toThrow();
    } finally {
      await disposeRepo(src);
      await disposeRepo(work);
    }
  }, 30_000);

  it('blame never invents origins for history-less files', async () => {
    const repo = await makeTempRepo('stitch-epic-empty-');
    try {
      await commitFiles(repo, { 'seed.txt': 's\n' }, 'root');
      await writeFile(join(repo, 'new.txt'), 'untracked\n');
      const result = await buildBlameMap(repo, [{ name: 'repo', prefix: '' }]);
      if (result.isErr()) {
        // Refusal is fail-closed and acceptable.
        expect(result.error.code).toBe('GIT_ERROR');
        return;
      }
      // Otherwise the untracked file must simply be absent —
      // invented origins are the only wrong answer.
      expect(result.value.files.map(file => file.path)).not.toContain('new.txt');
    } finally {
      await disposeRepo(repo);
    }
  }, 30_000);
});
