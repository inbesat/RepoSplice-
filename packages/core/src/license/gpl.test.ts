import { describe, it, expect } from 'vitest';
import { checkGpl, GPL_REMEDIATIONS } from './gpl.js';
import { checkCompatibility } from './compat.js';
import type { DeclaredLicense } from './scan.js';
import type { LicensePolicy } from './types.js';

function makeDeclared(pkg: string, license: string): DeclaredLicense {
  return { package: pkg, version: '1.0.0', licenses: license };
}

describe('P-121 gpl: warns on GPL dep in JS repo', () => {
  it('warns on GPL-3.0 in JS', () => {
    const warnings = checkGpl([makeDeclared('foo', 'GPL-3.0-only')], true);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]?.severity).toBe('warning');
    expect(warnings[0]?.package).toBe('foo');
  });

  it('warns on AGPL in JS', () => {
    const warnings = checkGpl([makeDeclared('bar', 'AGPL-3.0-only')], true);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]?.license).toContain('AGPL');
  });
});

describe('P-121 gpl: does not warn on LGPL', () => {
  it('LGPL is weak, not GPL warning', () => {
    const warnings = checkGpl([makeDeclared('baz', 'LGPL-3.0-only')], true);
    expect(warnings).toEqual([]);
    const mpl = checkGpl([makeDeclared('qux', 'MPL-2.0')], true);
    expect(mpl).toEqual([]);
  });
});

describe('P-121 gpl: provides remediation suggestion', () => {
  it('suggestion non-empty', () => {
    const warnings = checkGpl([makeDeclared('foo', 'GPL-3.0-only')], true);
    expect(warnings[0]?.suggestion.length).toBeGreaterThan(0);
    expect(warnings[0]?.suggestion).toMatch(/Replace|Vendor|Include|permission/i);
  });

  it('GPL_REMEDIATIONS has expected keys', () => {
    expect(GPL_REMEDIATIONS.replace).toBeDefined();
    expect(GPL_REMEDIATIONS.vendor).toBeDefined();
    expect(GPL_REMEDIATIONS.notice).toBeDefined();
    expect(GPL_REMEDIATIONS.permission).toBeDefined();
  });
});

describe('P-121 gpl: handles non-JS link heuristics', () => {
  it('non-JS with wasm/native is warning, else info', () => {
    const wasmWarnings = checkGpl([makeDeclared('my-wasm-pkg', 'GPL-3.0-only')], false);
    expect(wasmWarnings[0]?.severity).toBe('warning');
    const plainWarnings = checkGpl([makeDeclared('plain-pkg', 'GPL-3.0-only')], false);
    expect(plainWarnings[0]?.severity).toBe('info');
  });

  it('handles unknown gracefully', () => {
    const warnings = checkGpl([makeDeclared('unk', 'UNKNOWN')], true);
    expect(warnings).toEqual([]);
    const empty = checkGpl([makeDeclared('empty', '')], true);
    expect(empty).toEqual([]);
  });
});

describe('P-121 gpl: integrates with checkCompatibility', () => {
  it('gpl warnings alongside matrix', () => {
    const policy: LicensePolicy = {
      allow: ['permissive'],
      denyUnknown: false,
      requireAttribution: true,
      targetLicense: 'MIT',
    };
    const licenses = ['MIT', 'GPL-3.0-only'];
    const compat = checkCompatibility(licenses, policy);
    expect(['review', 'deny']).toContain(compat.decision);
    const gplWarnings = checkGpl(
      licenses.map(l => makeDeclared('pkg-' + l, l)),
      true
    );
    expect(gplWarnings.length).toBeGreaterThan(0);
    // Ensure not double-counting as hard deny when already warned — gpl warnings are separate
    expect(compat.reasons.length).toBeGreaterThan(0);
  });
});
