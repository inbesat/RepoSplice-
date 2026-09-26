import { describe, it, expect } from 'vitest';
import { checkCompatibility } from './compat.js';
import { parseOrExpression, chooseDualLicense } from './dual.js';
import type { LicensePolicy } from './types.js';

const permissivePolicy: LicensePolicy = {
  allow: ['permissive'],
  denyUnknown: false,
  requireAttribution: true,
  targetLicense: 'MIT',
};

const permissiveWeakPolicy: LicensePolicy = {
  allow: ['permissive', 'weak-copyleft'],
  denyUnknown: false,
  requireAttribution: true,
  targetLicense: 'MIT',
};

describe('P-122 dual: parses OR branches', () => {
  it('parses OR branches', () => {
    expect(parseOrExpression('MIT OR Apache-2.0')).toEqual(['MIT', 'Apache-2.0']);
  });
});

describe('P-122 dual: chooses most permissive compliant', () => {
  it('chooses most permissive compliant', () => {
    const result = chooseDualLicense('MIT OR GPL-3.0-only', permissivePolicy, 'MIT');
    expect(result.recommended).toBe('MIT');
    expect(result.alternatives).toEqual(['GPL-3.0-only']);
    // allCompliant false because GPL branch not compliant under permissive-only policy
    expect(result.allCompliant).toBe(false);
  });
});

describe('P-122 dual: reports no-compliant case', () => {
  it('reports no-compliant case', () => {
    const result = chooseDualLicense('GPL-3.0-only OR AGPL-3.0-only', permissivePolicy, 'MIT');
    expect(result.allCompliant).toBe(false);
    expect(result.reasons.join(' ')).toMatch(/no permissive/);
  });
});

describe('P-122 dual: handles nested parens', () => {
  it('handles nested parens', () => {
    expect(parseOrExpression('(MIT OR Apache-2.0) OR BSD-3-Clause')).toEqual([
      'MIT',
      'Apache-2.0',
      'BSD-3-Clause',
    ]);
    expect(parseOrExpression('(MIT OR Apache-2.0)')).toEqual(['MIT', 'Apache-2.0']);
    const result = chooseDualLicense(
      '(MIT OR Apache-2.0) OR BSD-3-Clause',
      permissivePolicy,
      'MIT'
    );
    expect(result.recommended).toBeDefined();
    expect(result.alternatives.length).toBeGreaterThan(0);
  });
});

describe('P-122 dual: treats WITH exception as relaxed', () => {
  it('treats WITH exception as relaxed', () => {
    const withoutWith = chooseDualLicense('GPL-3.0-only', permissivePolicy, 'MIT');
    expect(withoutWith.allCompliant).toBe(false);
    const withException = chooseDualLicense(
      'GPL-3.0-only WITH Classpath-exception-2.0',
      permissiveWeakPolicy,
      'MIT'
    );
    expect(withException.reasons.join(' ')).toMatch(/WITH/);
  });
});

describe('P-122 dual: integrates into checkCompatibility', () => {
  it('integrates into checkCompatibility', () => {
    const dual = chooseDualLicense('MIT OR GPL-3.0-only', permissivePolicy, 'MIT');
    expect(dual.recommended).toBe('MIT');
    const result = checkCompatibility(['MIT OR GPL-3.0-only'], permissivePolicy);
    expect(result.decision).toBe('allow');
    expect(result.reasons).toEqual([]);
    const denied = checkCompatibility(['GPL-3.0-only OR AGPL-3.0-only'], permissivePolicy);
    expect(denied.decision).toBe('deny');
  });
});
