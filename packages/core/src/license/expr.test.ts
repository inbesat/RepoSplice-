// P-024 tests: parseExpr covers single, compound, exception, malformed,
// and collectLicenses helper.
import { describe, it, expect } from 'vitest';
import { parseExpr, collectLicenses } from './expr.js';

describe('P-024 parseExpr: single licenses', () => {
  it('parses a single SPDX identifier', () => {
    const r = parseExpr('MIT');
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      expect(r.value).toEqual({ kind: 'license', license: 'MIT' });
    }
  });

  it('parses a license with the deprecated `+` suffix', () => {
    const r = parseExpr('GPL-3.0-or-later+');
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      expect(r.value).toEqual({
        kind: 'license',
        license: 'GPL-3.0-or-later',
        plus: true,
      });
    }
  });

  it('parses a license WITH an exception', () => {
    const r = parseExpr('GPL-2.0-only WITH Classpath-exception-2.0');
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      expect(r.value).toEqual({
        kind: 'license',
        license: 'GPL-2.0-only',
        exception: 'Classpath-exception-2.0',
      });
    }
  });
});

describe('P-024 parseExpr: compound expressions', () => {
  it('parses a parenthesized OR (the spec smoke test)', () => {
    const r = parseExpr('(MIT OR Apache-2.0)');
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      expect(r.value).toEqual({
        kind: 'compound',
        op: 'or',
        left: { kind: 'license', license: 'MIT' },
        right: { kind: 'license', license: 'Apache-2.0' },
      });
    }
  });

  it('parses a parenthesized AND', () => {
    const r = parseExpr('(MIT AND Apache-2.0)');
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      expect(r.value.kind).toBe('compound');
      if (r.value.kind === 'compound') {
        expect(r.value.op).toBe('and');
      }
    }
  });

  it('parses nested compound (OR of AND)', () => {
    const r = parseExpr('((MIT OR ISC) AND Apache-2.0)');
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      expect(r.value.kind).toBe('compound');
      if (r.value.kind === 'compound') {
        expect(r.value.op).toBe('and');
        expect(r.value.left.kind).toBe('compound');
        if (r.value.left.kind === 'compound') {
          expect(r.value.left.op).toBe('or');
        }
      }
    }
  });
});

describe('P-024 parseExpr: malformed input', () => {
  it('rejects a bogus identifier (the spec smoke test)', () => {
    const r = parseExpr('not-a-license');
    expect(r.isErr()).toBe(true);
    if (r.isErr()) {
      expect(r.error.code).toBe('INTERNAL');
    }
  });

  it('rejects an empty string', () => {
    const r = parseExpr('');
    expect(r.isErr()).toBe(true);
    if (r.isErr()) {
      expect(r.error.code).toBe('INTERNAL');
    }
  });

  it('rejects unbalanced parens', () => {
    const r = parseExpr('(MIT OR Apache-2.0');
    expect(r.isErr()).toBe(true);
  });
});

describe('P-024 collectLicenses', () => {
  it('returns [MIT] for a single license', () => {
    const r = parseExpr('MIT');
    if (r.isErr()) throw r.error;
    expect(collectLicenses(r.value)).toEqual(['MIT']);
  });

  it('returns both for an OR compound', () => {
    const r = parseExpr('(MIT OR Apache-2.0)');
    if (r.isErr()) throw r.error;
    expect(collectLicenses(r.value).sort()).toEqual(['Apache-2.0', 'MIT']);
  });

  it('flattens nested compounds', () => {
    const r = parseExpr('((MIT OR ISC) AND Apache-2.0)');
    if (r.isErr()) throw r.error;
    expect(collectLicenses(r.value).sort()).toEqual(['Apache-2.0', 'ISC', 'MIT']);
  });
});
