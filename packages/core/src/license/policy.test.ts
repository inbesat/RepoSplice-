import { describe, it, expect, beforeEach } from 'vitest';
import { evaluatePolicy, finalGate } from './policy.js';
import { checkCompatibility } from './compat.js';
import { checkGpl } from './gpl.js';
import { detectUnknown, clearLicenseDecisionsForTests } from './unknown.js';

beforeEach(() => {
  clearLicenseDecisionsForTests();
});
import type { DeclaredLicense, LicensePolicy, DualDecision } from './types.js';

function makeDeclared(pkg: string, licenses: string): DeclaredLicense {
  return { package: pkg, version: '1.0.0', licenses };
}

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

function makeDualDecision(expr: string, rec: string): DualDecision {
  return {
    expression: expr,
    recommended: rec,
    alternatives: [],
    allCompliant: false,
    reasons: ['not compliant'],
  };
}

describe('P-127 policy: allows when clear', () => {
  it('allows when clear', () => {
    const declared = [makeDeclared('a', 'MIT'), makeDeclared('b', 'Apache-2.0')];
    const matrix = checkCompatibility(['MIT', 'Apache-2.0'], permissivePolicy);
    const gpl = checkGpl(declared, true);
    const unknown = detectUnknown(declared);
    const dual: DualDecision[] = [];
    const deep = null;

    const fields = { declared, unknown, gplWarnings: gpl, matrix, dual, deep };
    const report = evaluatePolicy(fields, permissivePolicy, new Map());

    expect(report.verdict).toBe('allow');
    expect(report.blocking).toBe(false);
    expect(finalGate(report)).toBe(true);
    expect(report.reasons.some(r => r.includes('all clear'))).toBe(true);
  });
});

describe('P-127 policy: reviews on pending unknown', () => {
  it('reviews on pending unknown', () => {
    const declared = [makeDeclared('a', 'MIT'), makeDeclared('b', 'UNKNOWN')];
    const matrix = checkCompatibility(['MIT', 'UNKNOWN'], permissivePolicy);
    const gpl = checkGpl(declared, true);
    const unknown = detectUnknown(declared);
    const dual: DualDecision[] = [];
    const deep = null;

    const fields = { declared, unknown, gplWarnings: gpl, matrix, dual, deep };
    const report = evaluatePolicy(fields, permissivePolicy, new Map());

    expect(report.verdict).toBe('review');
    expect(report.blocking).toBe(true);
    expect(report.reasons.some(r => r.includes('unknown-pending'))).toBe(true);
    expect(finalGate(report)).toBe(false);
  });
});

describe('P-127 policy: denies on deny override', () => {
  it('denies on deny override', () => {
    const declared = [makeDeclared('a', 'MIT'), makeDeclared('b', 'UNKNOWN')];
    const matrix = checkCompatibility(['MIT', 'UNKNOWN'], permissivePolicy);
    const gpl = checkGpl(declared, true);
    const unknown = detectUnknown(declared);
    const dual: DualDecision[] = [];
    const deep = null;

    const overrides = new Map<string, 'allow' | 'deny'>();
    overrides.set('b@1.0.0', 'deny');

    const fields = { declared, unknown, gplWarnings: gpl, matrix, dual, deep };
    const report = evaluatePolicy(fields, permissivePolicy, overrides);

    expect(report.verdict).toBe('deny');
    expect(report.blocking).toBe(true);
    expect(report.reasons.some(r => r.includes('unknown-denied'))).toBe(true);
    expect(finalGate(report)).toBe(false);
  });
});

describe('P-127 policy: denies on matrix deny', () => {
  it('denies on matrix deny', () => {
    const declared = [makeDeclared('a', 'MIT'), makeDeclared('b', 'GPL-3.0-only')];
    const matrix = checkCompatibility(['MIT', 'GPL-3.0-only'], permissivePolicy);
    const gpl = checkGpl(declared, true);
    const unknown = detectUnknown(declared);
    const dual: DualDecision[] = [];
    const deep = null;

    const fields = { declared, unknown, gplWarnings: gpl, matrix, dual, deep };
    const report = evaluatePolicy(fields, permissivePolicy, new Map());

    expect(report.verdict).toBe('deny');
    expect(report.blocking).toBe(true);
    expect(report.reasons.some(r => r.includes('matrix-deny'))).toBe(true);
    expect(finalGate(report)).toBe(false);
  });

  it('denies on matrix deny even with allow override for unknown', () => {
    const declared = [makeDeclared('a', 'UNKNOWN'), makeDeclared('b', 'GPL-3.0-only')];
    const matrix = checkCompatibility(['UNKNOWN', 'GPL-3.0-only'], permissivePolicy);
    const gpl = checkGpl(declared, true);
    const unknown = detectUnknown(declared);
    const dual: DualDecision[] = [];
    const deep = null;

    const overrides = new Map<string, 'allow' | 'deny'>();
    overrides.set('a@1.0.0', 'allow');

    const fields = { declared, unknown, gplWarnings: gpl, matrix, dual, deep };
    const report = evaluatePolicy(fields, permissivePolicy, overrides);

    // Matrix deny takes precedence
    expect(report.verdict).toBe('deny');
    expect(report.blocking).toBe(true);
  });
});

describe('P-127 policy: reviews on GPL warning', () => {
  it('reviews on gpl warning', () => {
    const declared = [makeDeclared('a', 'GPL-3.0-only')];
    const matrix = checkCompatibility(['GPL-3.0-only'], permissiveWeakPolicy);
    const gpl = checkGpl(declared, true);
    const unknown = detectUnknown(declared);
    const dual: DualDecision[] = [];
    const deep = null;

    const fields = { declared, unknown, gplWarnings: gpl, matrix, dual, deep };
    const report = evaluatePolicy(fields, permissiveWeakPolicy, new Map());

    expect(report.verdict).toBe('review');
    expect(report.blocking).toBe(true);
    expect(report.reasons.some(r => r.includes('gpl-warning'))).toBe(true);
    expect(finalGate(report)).toBe(false);
  });
});

describe('P-127 policy: reasons aggregate every gate', () => {
  it('reasons aggregate every gate', () => {
    const declared = [
      makeDeclared('a', 'MIT'),
      makeDeclared('b', 'UNKNOWN'),
      makeDeclared('c', 'GPL-3.0-only'),
    ];
    const matrix = checkCompatibility(['MIT', 'UNKNOWN', 'GPL-3.0-only'], permissivePolicy);
    const gpl = checkGpl(declared, true);
    const unknown = detectUnknown(declared);
    const dual: DualDecision[] = [];
    const deep = null;

    const fields = { declared, unknown, gplWarnings: gpl, matrix, dual, deep };
    const report = evaluatePolicy(fields, permissivePolicy, new Map());

    // Should have reasons from unknown, matrix, and GPL
    const reasonStr = report.reasons.join(' | ');
    expect(reasonStr).toContain('unknown-pending');
    expect(reasonStr).toContain('matrix-deny');
    expect(reasonStr).toContain('gpl-warning');
    expect(report.reasons.length).toBeGreaterThanOrEqual(3);
  });
});

describe('P-127 policy: finalGate reflects verdict', () => {
  it('finalGate true for allow', () => {
    const report = {
      verdict: 'allow' as const,
      blocking: false,
      reasons: [],
      declared: [],
      unknown: [],
      gplWarnings: [],
      matrix: { decision: 'allow' as const, reasons: [], failingCategories: [] },
      dual: [],
      deep: null,
    };
    expect(finalGate(report)).toBe(true);
  });

  it('finalGate false for review', () => {
    const report = {
      verdict: 'review' as const,
      blocking: true,
      reasons: [],
      declared: [],
      unknown: [],
      gplWarnings: [],
      matrix: { decision: 'allow' as const, reasons: [], failingCategories: [] },
      dual: [],
      deep: null,
    };
    expect(finalGate(report)).toBe(false);
  });

  it('finalGate false for deny', () => {
    const report = {
      verdict: 'deny' as const,
      blocking: true,
      reasons: [],
      declared: [],
      unknown: [],
      gplWarnings: [],
      matrix: { decision: 'deny' as const, reasons: [], failingCategories: [] },
      dual: [],
      deep: null,
    };
    expect(finalGate(report)).toBe(false);
  });

  it('finalGate reflects verdict', () => {
    const allowReport = {
      verdict: 'allow' as const,
      blocking: false,
      reasons: [] as string[],
      declared: [],
      unknown: [],
      gplWarnings: [],
      matrix: { decision: 'allow' as const, reasons: [] as string[], failingCategories: [] as [] },
      dual: [],
      deep: null,
    };
    const reviewReport = { ...allowReport, verdict: 'review' as const, blocking: true };
    const denyReport = { ...allowReport, verdict: 'deny' as const, blocking: true };
    expect(finalGate(allowReport)).toBe(true);
    expect(finalGate(reviewReport)).toBe(false);
    expect(finalGate(denyReport)).toBe(false);
  });
});

describe('P-127 policy: allow override resolves unknown', () => {
  it('allow override resolves unknown', () => {
    const declared = [makeDeclared('a', 'MIT'), makeDeclared('b', 'UNKNOWN')];
    const matrix = checkCompatibility(['MIT', 'UNKNOWN'], permissivePolicy);
    const gpl = checkGpl(declared, true);
    const unknown = detectUnknown(declared);
    const dual: DualDecision[] = [];
    const deep = null;

    const overrides = new Map<string, 'allow' | 'deny'>();
    overrides.set('b@1.0.0', 'allow');

    const fields = { declared, unknown, gplWarnings: gpl, matrix, dual, deep };
    const report = evaluatePolicy(fields, permissivePolicy, overrides);

    // With allow override, unknown is resolved, but matrix still denies if GPL present
    // Wait, matrix would still be review/deny due to UNKNOWN in checkCompatibility
    // Let's check: with denyUnknown:false, UNKNOWN is review, not deny
    // But with override, the unknown is "resolved" in our logic
    // The matrix still sees UNKNOWN though...
    // For this test, just verify the override logic
    expect(report.reasons.some(r => r.includes('unknown-resolved'))).toBe(true);
  });
});

describe('P-127 policy: non-JS repo GPL handling', () => {
  it('GPL warning present but JS/TS defaults to warning', () => {
    const declared = [makeDeclared('c-wasm', 'GPL-3.0-only')];
    const matrix = checkCompatibility(['GPL-3.0-only'], permissiveWeakPolicy);
    const gpl = checkGpl(declared, true); // true = JS/TS
    const unknown = detectUnknown(declared);
    const dual: DualDecision[] = [];
    const deep = null;

    const fields = { declared, unknown, gplWarnings: gpl, matrix, dual, deep };
    const report = evaluatePolicy(fields, permissiveWeakPolicy, new Map());

    expect(report.gplWarnings.length).toBeGreaterThan(0);
    expect(report.verdict).toBe('review');
  });
});

describe('P-127 policy: dual non-compliance', () => {
  it('dual non-compliance affects verdict', () => {
    const declared = [makeDeclared('a', 'MIT OR GPL-3.0-only')];
    const matrix = checkCompatibility(['MIT'], permissivePolicy); // expanded
    const gpl = checkGpl(declared, true);
    const unknown = detectUnknown(declared);
    const dual = [makeDualDecision('MIT OR GPL-3.0-only', 'MIT')];
    const deep = null;

    const fields = { declared, unknown, gplWarnings: gpl, matrix, dual, deep };
    const report = evaluatePolicy(fields, permissivePolicy, new Map());

    // dual.allCompliant is false, so should add reasons
    // but recommended is MIT which is compliant
    expect(report.reasons.some(r => r.startsWith('dual-'))).toBe(true);
  });
});
