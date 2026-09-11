// P-036 tests: picomatch-backed gitignore semantics — last-match-wins
// ordering, trailing-slash dirs, bare-name self-match, plus the raw
// picomatch surface the shim declares (array form, ignore option).
// P-012's `util.test.ts` suite covers the base matcher contract and
// must keep passing unchanged.
import { describe, it, expect } from 'vitest';
import picomatch from 'picomatch';
import { buildIgnoreMatcher, shouldIgnore } from '../ignore.js';

describe('P-036 ordering: last match wins (git semantics)', () => {
  it('later negation re-includes (exclude then include)', () => {
    expect(shouldIgnore(['*.log', '!keep.log'], 'keep.log')).toBe(false);
    expect(shouldIgnore(['*.log', '!keep.log'], 'other.log')).toBe(true);
  });

  it('later positive pattern re-excludes (include then exclude)', () => {
    expect(shouldIgnore(['!keep.log', '*.log'], 'keep.log')).toBe(true);
  });

  it('three-pattern chain resolves to the final match', () => {
    const patterns = ['*.log', '!keep.log', 'keep.log'];
    expect(shouldIgnore(patterns, 'keep.log')).toBe(true);
    expect(shouldIgnore(patterns, 'other.log')).toBe(true);
  });

  it('negation of a never-excluded path is a no-op', () => {
    expect(shouldIgnore(['!keep.log'], 'keep.log')).toBe(false);
    expect(shouldIgnore(['!keep.log'], 'other.ts')).toBe(false);
  });
});

describe('P-036 expansion: trailing-slash dirs', () => {
  it('dist/ matches contents at any depth', () => {
    const isIgnored = buildIgnoreMatcher(['dist/']);
    expect(isIgnored('dist/a.js')).toBe(true);
    expect(isIgnored('sub/dist/a.js')).toBe(true);
    expect(isIgnored('src/index.ts')).toBe(false);
  });
});

describe('P-036 expansion: bare names match entry + subtree', () => {
  it('node_modules matches contents and nested copies', () => {
    const isIgnored = buildIgnoreMatcher(['node_modules']);
    expect(isIgnored('a/node_modules/b/index.js')).toBe(true);
    expect(isIgnored('node_modules/.package-lock.json')).toBe(true);
    expect(isIgnored('src/index.ts')).toBe(false);
  });

  it('bare name matches a file with exactly that name', () => {
    const isIgnored = buildIgnoreMatcher(['LICENSED']);
    expect(isIgnored('LICENSED')).toBe(true);
    expect(isIgnored('sub/LICENSED')).toBe(true);
    expect(isIgnored('LICENSED.txt')).toBe(false);
  });
});

describe('P-036 realistic .gitignore fixture', () => {
  const GITIGNORE = [
    '# dependencies',
    'node_modules',
    '',
    '# build output',
    'dist/',
    '*.log',
    '!keep.log',
    '.env',
  ];

  it('flags the realistic set, keeps the exceptions', () => {
    const isIgnored = buildIgnoreMatcher(GITIGNORE);
    expect(isIgnored('node_modules/react/index.js')).toBe(true);
    expect(isIgnored('packages/a/node_modules/x/y.js')).toBe(true);
    expect(isIgnored('dist/bundle.js')).toBe(true);
    expect(isIgnored('debug.log')).toBe(true);
    expect(isIgnored('sub/debug.log')).toBe(true);
    expect(isIgnored('keep.log')).toBe(false);
    expect(isIgnored('sub/keep.log')).toBe(false);
    expect(isIgnored('.env')).toBe(true);
    expect(isIgnored('src/index.ts')).toBe(false);
    expect(isIgnored('README.md')).toBe(false);
  });
});

describe('P-083 expansion: anchored patterns (leading slash + dir trees)', () => {
  it('leading-slash patterns match from the root', () => {
    const isIgnored = buildIgnoreMatcher(['/rooted.txt']);
    expect(isIgnored('rooted.txt')).toBe(true);
    expect(isIgnored('sub/rooted.txt')).toBe(false);
  });

  it('anchored dirs match the entry plus the tree under it', () => {
    const isIgnored = buildIgnoreMatcher(['/repo-a/build']);
    expect(isIgnored('repo-a/build')).toBe(true);
    expect(isIgnored('repo-a/build/out.js')).toBe(true);
    expect(isIgnored('other/build/out.js')).toBe(false);
  });

  it('anchored trailing-slash dirs match contents', () => {
    const isIgnored = buildIgnoreMatcher(['/repo-a/src/gen/']);
    expect(isIgnored('repo-a/src/gen/x.js')).toBe(true);
    expect(isIgnored('repo-a/src/other.js')).toBe(false);
  });

  it('unanchored slash patterns stay root-scoped', () => {
    const isIgnored = buildIgnoreMatcher(['sub/anchored/']);
    expect(isIgnored('sub/anchored/x.js')).toBe(true);
    expect(isIgnored('elsewhere/sub/anchored/x.js')).toBe(false);
  });
});

describe('P-036 raw picomatch surface (shim verification)', () => {
  it('array form typechecks and matches as union', () => {
    const match = picomatch(['*.log', '*.tmp'], { dot: true });
    expect(match('a.log')).toBe(true);
    expect(match('b.tmp')).toBe(true);
    expect(match('c.ts')).toBe(false);
  });

  it('array form does not negate (union-only; ordering lives in the wrapper)', () => {
    const match = picomatch(['*.log', '!keep.log'], { dot: true });
    expect(match('keep.log')).toBe(true);
    expect(match('other.log')).toBe(true);
  });

  it('ignore option excludes on top of the main match', () => {
    const match = picomatch(['*.log'], { dot: true, ignore: ['keep.log'] });
    expect(match('keep.log')).toBe(false);
    expect(match('other.log')).toBe(true);
  });
});
