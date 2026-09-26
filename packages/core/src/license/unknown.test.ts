import { describe, it, expect, beforeEach } from 'vitest';
import type { DeclaredLicense } from './scan.js';
import {
  detectUnknown,
  recordLicenseDecision,
  getPendingUnknown,
  clearLicenseDecisionsForTests,
} from './unknown.js';

function makeDeclared(pkg: string, licenses: string, raw?: string, path?: string): DeclaredLicense {
  const d: DeclaredLicense = {
    package: pkg,
    version: '1.0.0',
    licenses,
  };
  if (raw !== undefined) (d as { rawLicenses?: string }).rawLicenses = raw;
  else (d as { rawLicenses?: string }).rawLicenses = licenses;
  if (path !== undefined) d.path = path;
  return d;
}

beforeEach(() => {
  clearLicenseDecisionsForTests();
});

describe('P-123 unknown: flags unknown license strings', () => {
  it('flags unknown license strings', () => {
    const declared: DeclaredLicense[] = [
      makeDeclared('a', 'UNKNOWN', 'UNKNOWN'),
      makeDeclared('b', '', ''),
      makeDeclared('c', 'SEE LICENSE IN LICENSE.txt', 'SEE LICENSE IN LICENSE.txt'),
      makeDeclared('d', 'Custom: My License', 'Custom: My License'),
      makeDeclared('e', 'NotARealLicense', 'NotARealLicense'),
      makeDeclared('f', 'MIT', 'MIT'),
    ];
    const unknowns = detectUnknown(declared);
    const pkgs = unknowns.map(u => u.package);
    expect(pkgs).toContain('a');
    expect(pkgs).toContain('b');
    expect(pkgs).toContain('c');
    expect(pkgs).toContain('d');
    expect(pkgs).toContain('e');
    expect(pkgs).not.toContain('f');
    // All flagged should be pending by default
    for (const u of unknowns) {
      expect(u.decision).toBe('pending');
    }
    expect(unknowns.length).toBe(5);
  });
});

describe('P-123 unknown: does not flag valid SPDX', () => {
  it('does not flag valid SPDX', () => {
    const declared: DeclaredLicense[] = [
      makeDeclared('a', 'MIT', 'MIT'),
      makeDeclared('b', 'Apache-2.0', 'Apache-2.0'),
      makeDeclared('c', 'GPL-3.0-only', 'GPL-3.0-only'),
      makeDeclared('d', 'MIT OR Apache-2.0', 'MIT OR Apache-2.0'),
      makeDeclared(
        'e',
        'GPL-3.0-only WITH Classpath-exception-2.0',
        'GPL-3.0-only WITH Classpath-exception-2.0'
      ),
    ];
    const unknowns = detectUnknown(declared);
    expect(unknowns).toEqual([]);
  });
});

describe('P-123 unknown: records allow/deny decision', () => {
  it('records allow/deny decision', () => {
    const declared: DeclaredLicense[] = [
      makeDeclared('foo', 'UNKNOWN', 'UNKNOWN'),
      makeDeclared('bar', 'SEE LICENSE IN LICENSE', 'SEE LICENSE IN LICENSE'),
    ];
    let unknowns = detectUnknown(declared);
    expect(unknowns).toHaveLength(2);
    expect(getPendingUnknown()).toHaveLength(2);

    recordLicenseDecision('foo', 'allow');
    expect(getPendingUnknown().map(u => u.package)).toEqual(['bar']);
    expect(getPendingUnknown()).toHaveLength(1);

    unknowns = detectUnknown(declared);
    const foo = unknowns.find(u => u.package === 'foo');
    expect(foo?.decision).toBe('allow');
    const bar = unknowns.find(u => u.package === 'bar');
    expect(bar?.decision).toBe('pending');

    recordLicenseDecision('bar', 'deny');
    expect(getPendingUnknown()).toHaveLength(0);
    unknowns = detectUnknown(declared);
    expect(unknowns.find(u => u.package === 'bar')?.decision).toBe('deny');
  });
});

describe('P-123 unknown: dedupe and path', () => {
  it('dedupes by package@version and preserves path', () => {
    const declared: DeclaredLicense[] = [
      makeDeclared('dup', 'UNKNOWN', 'UNKNOWN', '/a/path'),
      makeDeclared('dup', 'UNKNOWN', 'UNKNOWN', '/a/path'),
    ];
    const unknowns = detectUnknown(declared);
    expect(unknowns).toHaveLength(1);
    expect(unknowns[0]?.path).toBe('/a/path');
  });
});
