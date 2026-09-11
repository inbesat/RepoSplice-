// Git Core epic consolidation (P-087): deep-nested gitignore trees.
// Collection must find ignores at every depth with correct prefixes,
// anchored patterns must rebase under their merge prefix, and required
// files must survive the merged set.
//
// Semantics note (P-083 rule, documented not relitigated): only ANCHORED
// patterns rebase — bare patterns merge root-wide. A nested `*.tmp`
// therefore matches at every depth of the merged file, and a bare
// `!keep.tmp` re-includes at every depth too.

import { describe, it, expect } from 'vitest';
import { makeTempRepo, disposeRepo } from '../../../test-utils/gitFixtures.js';
import { collectGitignores, mergeGitignores } from '../gitignoreMerge.js';
import { buildIgnoreMatcher } from '../../util/ignore.js';

const FIXED_DATE = '2026-01-01T00:00:00.000Z';

describe('deep-nested ignores (P-087 epic edge)', () => {
  it('collects ignores at every depth with correct prefixes', async () => {
    const repo = await makeTempRepo('stitch-epic-ignore-', {
      seed: {
        '.gitignore': '*.log\n',
        'a/b/.gitignore': '/build\n',
        'a/b/c/d/.gitignore': '*.tmp\n!keep.tmp\n',
        'a/b/c/d/deep.txt': 'x\n',
      },
    });
    try {
      const collected = await collectGitignores([{ name: 'repo', dir: repo }]);
      expect(collected.isOk()).toBe(true);
      if (collected.isErr()) return;
      expect(collected.value).toHaveLength(3);
      const prefixes = collected.value.map(entry => entry.prefix ?? '');
      expect(prefixes).toContain('');
      expect(prefixes).toContain('a/b');
      expect(prefixes).toContain('a/b/c/d');
      for (const entry of collected.value) {
        // Nested files are namespaced under their root (repo:sub/dir).
        expect(entry.name.startsWith('repo')).toBe(true);
        expect(entry.path.endsWith('.gitignore')).toBe(true);
      }
    } finally {
      await disposeRepo(repo);
    }
  }, 30_000);

  it('rebases anchored patterns under merge prefixes', async () => {
    const repo = await makeTempRepo('stitch-epic-ignore-', {
      seed: {
        '.gitignore': '*.log\n',
        'a/b/.gitignore': '/build\n',
        'a/b/c/d/.gitignore': '*.tmp\n',
      },
    });
    try {
      const collected = await collectGitignores([{ name: 'repo', dir: repo }]);
      if (collected.isErr()) throw new Error('collect failed');
      const merged = await mergeGitignores(collected.value, { generatedAt: FIXED_DATE });
      expect(merged.isOk()).toBe(true);
      if (merged.isErr()) return;
      // Any-depth globs pass through; the anchored /build rebases with
      // its leading-slash form preserved.
      expect(merged.value.patterns).toContain('*.log');
      expect(merged.value.patterns).toContain('/a/b/build');
      // Per-source dividers keep provenance auditable.
      expect(merged.value.content).toContain('# Source: repo');
    } finally {
      await disposeRepo(repo);
    }
  }, 30_000);

  it('merged bare patterns apply root-wide with global negations', async () => {
    const repo = await makeTempRepo('stitch-epic-ignore-', {
      seed: {
        '.gitignore': '*.log\n',
        'a/b/c/d/.gitignore': '*.tmp\n!keep.tmp\n',
      },
    });
    try {
      const collected = await collectGitignores([{ name: 'repo', dir: repo }]);
      if (collected.isErr()) throw new Error('collect failed');
      const merged = await mergeGitignores(collected.value, { generatedAt: FIXED_DATE });
      if (merged.isErr()) throw new Error('merge failed');
      const matches = buildIgnoreMatcher(merged.value.patterns);
      expect(matches('debug.log')).toBe(true);
      expect(matches('a/b/c/d/x.tmp')).toBe(true);
      // Broadened by the merge (documented above): the nested glob now
      // fires far from its origin dir…
      expect(matches('a/x.tmp')).toBe(true);
      // …while the bare negation re-includes at every depth too.
      expect(matches('a/b/c/d/keep.tmp')).toBe(false);
      expect(matches('a/keep.tmp')).toBe(false);
      expect(matches('a/b/c/d/deep.txt')).toBe(false);
    } finally {
      await disposeRepo(repo);
    }
  }, 30_000);

  it('required files survive, ignored ones refuse', async () => {
    const repo = await makeTempRepo('stitch-epic-ignore-', {
      seed: { '.gitignore': '*.log\n' },
    });
    try {
      const collected = await collectGitignores([{ name: 'repo', dir: repo }]);
      if (collected.isErr()) throw new Error('collect failed');
      const surviving = await mergeGitignores(collected.value, {
        generatedAt: FIXED_DATE,
        requiredFiles: ['keep.txt'],
      });
      expect(surviving.isOk()).toBe(true);
      const refusing = await mergeGitignores(collected.value, {
        generatedAt: FIXED_DATE,
        requiredFiles: ['debug.log'],
      });
      expect(refusing.isErr()).toBe(true);
      if (refusing.isOk()) return;
      expect(refusing.error.code).toBe('CONFIG_ERROR');
      if (refusing.error.code !== 'CONFIG_ERROR') return;
      expect(refusing.error.field).toBe('requiredFiles');
    } finally {
      await disposeRepo(repo);
    }
  }, 30_000);
});
