import { describe, it, expect } from 'vitest';
import { normalizeToSPDX, isValidSPDX, normalizeExpression, parseLicenses } from './spdx.js';

describe('P-119 spdx: normalizes common aliases', () => {
  it('normalizes MIT and case variations', () => {
    expect(normalizeToSPDX('MIT')).toBe('MIT');
    expect(normalizeToSPDX('mit')).toBe('MIT');
    expect(normalizeToSPDX('the mit license')).toBe('MIT');
    expect(normalizeToSPDX('Apache 2')).toBe('Apache-2.0');
  });
});

describe('P-119 spdx: parses AND/OR expressions', () => {
  it('collapses whitespace in OR', () => {
    expect(normalizeExpression('MIT  OR   Apache-2.0')).toBe('MIT OR Apache-2.0');
    expect(normalizeExpression('MIT   AND   Apache-2.0')).toBe('MIT AND Apache-2.0');
  });
});

describe('P-119 spdx: validates WITH exception', () => {
  it('validates MIT OR Apache-2.0', () => {
    expect(isValidSPDX('MIT OR Apache-2.0')).toBe(true);
    expect(isValidSPDX('(MIT OR Apache-2.0)')).toBe(true);
  });

  it('validates WITH exception', () => {
    expect(isValidSPDX('GPL-2.0-only WITH Classpath-exception-2.0')).toBe(true);
    expect(isValidSPDX('GPL-3.0 WITH Classpath-exception-2.0')).toBe(true);
  });
});

describe('P-119 spdx: returns false for invalid expr', () => {
  it('invalid license', () => {
    expect(isValidSPDX('NotARealLicense')).toBe(false);
    expect(isValidSPDX('')).toBe(false);
    expect(isValidSPDX('MIT OR')).toBe(false);
  });
});

describe('P-119 spdx: parseLicenses extracts operands', () => {
  it('extracts from OR', () => {
    expect(parseLicenses('(MIT OR Apache-2.0)')).toEqual(['MIT', 'Apache-2.0']);
    expect(parseLicenses('MIT OR Apache-2.0')).toEqual(['MIT', 'Apache-2.0']);
  });

  it('extracts from WITH', () => {
    expect(parseLicenses('GPL-3.0 WITH Classpath-exception-2.0')).toEqual(['GPL-3.0']);
    expect(parseLicenses('GPL-2.0-only WITH Classpath-exception-2.0')).toEqual(['GPL-2.0-only']);
  });
});

describe('P-119 spdx: keeps unknown raw unchanged', () => {
  it('unrecognized returns raw', () => {
    const raw = 'CustomLicense-1.0';
    expect(normalizeToSPDX(raw)).toBe(raw);
    expect(normalizeExpression(raw)).toBe(raw);
  });
});
