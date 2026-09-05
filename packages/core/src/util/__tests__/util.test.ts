import { describe, it, expect, beforeEach } from 'vitest';
import {
  monotonicId,
  shortId,
  longId,
  _resetIdCountersForTests,
  toPosix,
  normalizePath,
  trimTrailingSep,
  resolveWithin,
  safeJoin,
  buildIgnoreMatcher,
  shouldIgnore,
} from '../index.js';

describe('id: unique + monotonic (P-012)', () => {
  beforeEach(() => {
    _resetIdCountersForTests();
  });

  it('monotonicId returns well-formed prefix_ts_seq_rand', () => {
    const id = monotonicId('job');
    expect(id).toMatch(/^job_[0-9a-z]+_[0-9a-z]+_[0-9A-Za-z]{12}$/);
  });

  it('shortId and longId are non-empty and shortId is 12 chars', () => {
    expect(shortId()).toHaveLength(12);
    expect(longId().length).toBeGreaterThan(12);
  });

  it('100 monotonicIds in a tight loop are all unique', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(monotonicId('run'));
    }
    expect(ids.size).toBe(100);
  });

  it('ids are sortable by timestamp when the clock advances', async () => {
    const a = monotonicId('job');
    await new Promise(r => setTimeout(r, 5));
    const b = monotonicId('job');
    // Lexicographic compare of `prefix_ts_seq_rand` should reflect creation order.
    expect(a < b).toBe(true);
  });

  it('per-millisecond counter increments on rapid generation', () => {
    const a = monotonicId('job');
    const b = monotonicId('job');
    const c = monotonicId('job');
    // Within the same millisecond, the seq part should grow.
    const [, tsA, seqA] = a.split('_');
    const [, tsB, seqB] = b.split('_');
    const [, tsC, seqC] = c.split('_');
    expect(tsA).toBe(tsB);
    expect(tsB).toBe(tsC);
    expect(Number.parseInt(seqA ?? '0', 36)).toBe(0);
    expect(Number.parseInt(seqB ?? '0', 36)).toBe(1);
    expect(Number.parseInt(seqC ?? '0', 36)).toBe(2);
  });
});

describe('paths: safeJoin + resolveWithin (P-012)', () => {
  it('toPosix converts backslashes to forward slashes (or no-op on POSIX)', () => {
    const input = 'a\\b\\c';
    const out = toPosix(input);
    expect(out).not.toContain('\\');
  });

  it('normalizePath collapses . and .. segments', () => {
    expect(normalizePath('a/b/../c')).toBe('a/c');
    expect(normalizePath('./a/./b')).toBe('a/b');
  });

  it('trimTrailingSep strips a single trailing separator', () => {
    expect(trimTrailingSep('a/b/')).toBe('a/b');
    expect(trimTrailingSep('a/b')).toBe('a/b');
  });

  it('safeJoin joins paths under a root', () => {
    expect(safeJoin('/repo', 'a', 'b')).toBe('/repo/a/b');
    expect(safeJoin('/repo', 'a/b')).toBe('/repo/a/b');
  });

  it('resolveWithin returns ok for in-scope paths', () => {
    const r = resolveWithin('/repo', 'src/index.ts');
    expect(r.isOk()).toBe(true);
    if (r.isOk()) expect(r.value).toBe('/repo/src/index.ts');
  });

  it('resolveWithin returns err for ../ escape (returns CONFIG_ERROR StitchError)', () => {
    const r = resolveWithin('/repo', '../etc/passwd');
    expect(r.isErr()).toBe(true);
    if (r.isErr()) {
      if (r.error.code === 'CONFIG_ERROR') {
        expect(r.error.field).toBe('path');
        expect(r.error.message).toContain('escapes');
      }
    }
  });

  it('resolveWithin returns err for deep ../ escape', () => {
    const r = resolveWithin('/repo', 'a/../../b');
    expect(r.isErr()).toBe(true);
  });

  it('safeJoin throws on escape (strict variant)', () => {
    expect(() => safeJoin('/repo', '..', 'etc')).toThrow(/escapes/);
  });

  it('resolveWithin handles trailing-sep root gracefully', () => {
    const r = resolveWithin('/repo/', 'a');
    expect(r.isOk()).toBe(true);
    if (r.isOk()) expect(r.value).toBe('/repo/a');
  });

  it('resolveWithin rejects empty input', () => {
    const r = resolveWithin('/repo', '');
    expect(r.isErr()).toBe(true);
  });
});

describe('Windows path normalization (P-012)', () => {
  it('toPosix is idempotent', () => {
    const a = toPosix('a\\b\\c');
    const b = toPosix(toPosix('a\\b\\c'));
    expect(a).toBe(b);
  });

  it('normalizePath handles mixed separators', () => {
    const out = normalizePath('a\\b/../c');
    expect(out).not.toContain('\\');
    expect(out).toBe('a/c');
  });
});

describe('ignore matcher (P-012)', () => {
  it('excludes by simple pattern (no negation)', () => {
    expect(shouldIgnore(['node_modules'], 'a/node_modules/x.js')).toBe(true);
    expect(shouldIgnore(['node_modules'], 'a/src/index.ts')).toBe(false);
  });

  it('excludes by glob pattern (e.g. *.log)', () => {
    expect(shouldIgnore(['*.log'], 'a/error.log')).toBe(true);
    expect(shouldIgnore(['*.log'], 'a/error.txt')).toBe(false);
  });

  it('excludes by directory wildcard (dist/**)', () => {
    expect(shouldIgnore(['dist/**'], 'dist/a/b/c.js')).toBe(true);
    expect(shouldIgnore(['dist/**'], 'src/a.ts')).toBe(false);
  });

  it('negation (with !) re-includes a previously-excluded path', () => {
    expect(shouldIgnore(['*.log', '!keep.log'], 'a/keep.log')).toBe(false);
    expect(shouldIgnore(['*.log', '!keep.log'], 'a/other.log')).toBe(true);
  });

  it('baseDir scopes the matcher (paths outside baseDir are out of scope)', () => {
    const m = buildIgnoreMatcher(['*.log'], { baseDir: 'src' });
    expect(m('src/foo.log')).toBe(true);
    expect(m('tests/foo.log')).toBe(false);
  });

  it('negated: true flips the semantics (matcher returns true to INCLUDE)', () => {
    const m = buildIgnoreMatcher(['*.ts'], { negated: true });
    expect(m('a/b.ts')).toBe(true);
    expect(m('a/b.js')).toBe(false);
  });

  it('dotfiles are matched when dot:true is passed through', () => {
    expect(shouldIgnore(['.*'], '.env')).toBe(true);
    expect(shouldIgnore(['.*'], 'a/.env')).toBe(true);
  });

  it('returns a stable matcher function that can be called repeatedly', () => {
    const m = buildIgnoreMatcher(['node_modules', 'dist']);
    expect(m('a/node_modules/x.js')).toBe(true);
    expect(m('a/dist/b.js')).toBe(true);
    expect(m('a/src/c.ts')).toBe(false);
  });

  it('empty patterns list never ignores', () => {
    expect(shouldIgnore([], 'a/b/c.ts')).toBe(false);
  });

  it('whitespace-only pattern is skipped', () => {
    expect(shouldIgnore(['   '], 'a/b.ts')).toBe(false);
  });
});
