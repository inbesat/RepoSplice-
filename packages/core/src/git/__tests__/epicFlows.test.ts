// Git Core epic consolidation (P-087): end-to-end flows across modules.
// write→commit→push reaches a bare remote; a whitespace conflict flows
// through detect→auto-resolve→commit back to clean; a manual
// stash→reset→pop cycle restores exact bytes.

import { describe, it, expect } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  makeTempRepo,
  makeScratchDir,
  commitFiles,
  headSha,
  disposeRepo,
  git,
  toFileUrl,
} from '../../../test-utils/gitFixtures.js';
import { writeToWorktree } from '../worktree.js';
import { commitWithTrailers } from '../commit.js';
import { pushToRemote } from '../push.js';
import { detectConflicts, resolveConflicts } from '../conflict.js';
import { safeStash, safeStashPop } from '../stash.js';
import { resetTo } from '../rollback.js';
import { isClean } from '../clean.js';

async function mergeSide(repo: string, branch: string): Promise<void> {
  try {
    await git(repo, ['merge', branch, '--no-edit']);
  } catch {
    // Exit 1 = conflicts; anything else surfaces in the assertions.
  }
}

describe('epic flows (P-087 consolidation)', () => {
  it('write, commit with trailers, and push to a bare remote', async () => {
    // Scratch layout: source repo + bare remote side by side.
    const dir = await makeScratchDir('stitch-epic-flow-');
    const repo = join(dir, 'work');
    const bare = join(dir, 'remote.git');
    await git(dir, ['init', '-q', '-b', 'main', repo]);
    await git(repo, ['config', 'user.email', 'test@stitch.dev']);
    await git(repo, ['config', 'user.name', 'stitch-test']);
    await git(repo, ['config', 'core.autocrlf', 'false']);
    await git(repo, ['config', 'core.eol', 'lf']);
    await commitFiles(repo, { 'seed.txt': 's\n' }, 'seed');
    await git(dir, ['init', '-q', '--bare', bare]);
    try {
      // P-076 isolates the write in a linked worktree; the commit and
      // push happen there, leaving the main checkout untouched.
      const written = await writeToWorktree(repo, new Map([['app.txt', 'shipped\n']]));
      expect(written.isOk()).toBe(true);
      if (written.isErr()) return;
      const wt = written.value.worktreePath;
      await git(wt, ['add', '-A']);
      const sha = await commitWithTrailers(
        wt,
        'feat: ship',
        [{ name: 'Ada', email: 'ada@stitch.dev' }],
        {}
      );
      expect(sha.isOk()).toBe(true);
      if (sha.isErr()) return;
      await git(wt, ['checkout', '-qb', 'feature']);
      const pushed = await pushToRemote(wt, toFileUrl(bare), 'feature', {});
      expect(pushed.isErr()).toBe(false);
      if (pushed.isErr()) {
        throw new Error(`push failed: ${pushed.error.code}`);
      }
      // Strongest proof: a fresh clone of the bare remote has the bytes.
      const check = join(dir, 'check');
      await git(dir, ['clone', '-q', '-b', 'feature', toFileUrl(bare), check]);
      const content = await readFile(join(check, 'app.txt'), 'utf8');
      expect(content.replace(/\r\n/g, '\n')).toBe('shipped\n');
      const body = await git(check, ['log', '-1', '--format=%B']);
      expect(body).toContain('Co-Authored-By: Ada <ada@stitch.dev>');
      expect(await headSha(check)).toBe(sha.value);
      // The main checkout never saw the feature work: branches live in
      // the shared repo, but its files and HEAD are untouched.
      expect(await git(repo, ['status', '--porcelain'])).toBe('');
      expect(await git(repo, ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe('main');
      await expect(
        readFile(join(repo, 'app.txt'), 'utf8').then(
          () => 'exists',
          () => 'missing'
        )
      ).resolves.toBe('missing');
    } finally {
      await disposeRepo(dir);
    }
  }, 30_000);

  it('whitespace conflicts flow detect, resolve, merge-commit back to clean', async () => {
    const repo = await makeTempRepo('stitch-epic-flow-', {
      seed: { 'ws.txt': 'hello world\nsecond line\n' },
    });
    try {
      await git(repo, ['checkout', '-qb', 'wa']);
      await commitFiles(repo, { 'ws.txt': 'hello   world\nsecond line\n' }, 'a');
      await git(repo, ['checkout', '-q', 'main']);
      await git(repo, ['checkout', '-qb', 'wb']);
      await commitFiles(repo, { 'ws.txt': 'hello world  \nsecond line\n' }, 'b');
      await git(repo, ['checkout', '-q', 'main']);
      await mergeSide(repo, 'wa');
      await mergeSide(repo, 'wb');
      const detected = await detectConflicts(repo, {});
      expect(detected.isOk()).toBe(true);
      if (detected.isErr()) return;
      expect(detected.value.map(conflict => conflict.path)).toEqual(['ws.txt']);
      const report = await resolveConflicts(repo, {});
      expect(report.isOk()).toBe(true);
      if (report.isErr()) return;
      expect(report.value.resolved).toHaveLength(1);
      expect(report.value.unresolved).toEqual([]);
      // The auto tier stages its resolution; completing the in-progress
      // merge is raw git's job (MERGE_HEAD is still present).
      await git(repo, ['add', '-A']);
      await git(repo, ['commit', '--no-edit', '-q']);
      const parents = await git(repo, ['log', '-1', '--format=%P']);
      expect(parents.split(' ')).toHaveLength(2);
      expect((await isClean(repo)).unwrapOr(false)).toBe(true);
    } finally {
      await disposeRepo(repo);
    }
  }, 30_000);

  it('manual stash, reset, pop restores exact content', async () => {
    const repo = await makeTempRepo('stitch-epic-flow-', {
      seed: { 'a.txt': 'v1\n' },
    });
    try {
      const base = await headSha(repo);
      await writeFile(join(repo, 'a.txt'), 'dirty-work\n');
      const stashed = await safeStash(repo, {});
      expect(stashed.isOk() && stashed.value.stashed).toBe(true);
      const reset = await resetTo(repo, base);
      expect(reset.isOk()).toBe(true);
      const popped = await safeStashPop(repo, {});
      expect(popped.isOk() && popped.value.popped).toBe(true);
      expect(await readFile(join(repo, 'a.txt'), 'utf8')).toBe('dirty-work\n');
      // The restored work dirties the tree again — by design.
      expect((await isClean(repo)).unwrapOr(true)).toBe(false);
    } finally {
      await disposeRepo(repo);
    }
  }, 30_000);
});
