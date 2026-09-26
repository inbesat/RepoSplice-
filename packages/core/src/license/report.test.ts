import { describe, it, expect, beforeEach } from 'vitest';
import { checkCompatibility } from './compat.js';
import { checkGpl } from './gpl.js';
import { detectUnknown, clearLicenseDecisionsForTests } from './unknown.js';
import {
  aggregateLicenseReport,
  buildLicenseReportData,
  renderLicenseReportJson,
} from './report.js';
import type {
  LicensePolicy,
  LicenseReport,
  DualDecision,
  GplWarning,
  DeclaredLicense,
} from './types.js';

function makeDeclared(pkg: string, licenses: string): DeclaredLicense {
  return { package: pkg, version: '1.0.0', licenses };
}

const permissivePolicy: LicensePolicy = {
  allow: ['permissive'],
  denyUnknown: false,
  requireAttribution: true,
  targetLicense: 'MIT',
};

function makeGplWarning(pkg: string, license: string): GplWarning {
  return {
    package: pkg,
    version: '1.0.0',
    license,
    category: 'strong-copyleft',
    severity: 'warning',
    suggestion: 'Replace package with permissive alternative',
  };
}

function makeDualDecision(expr: string, rec: string): DualDecision {
  return {
    expression: expr,
    recommended: rec,
    alternatives: [],
    allCompliant: false,
    reasons: ['not compliant'],
  };
}

function makeLicenseReport(
  verdict: 'allow' | 'deny' | 'review',
  blocking: boolean,
  reasons: string[] = []
): LicenseReport {
  return {
    declared: [],
    unknown: [],
    gplWarnings: [],
    matrix: { decision: 'allow', reasons: [], failingCategories: [] },
    dual: [],
    deep: null,
    verdict,
    blocking,
    reasons,
  };
}

beforeEach(() => {
  clearLicenseDecisionsForTests();
});

describe('P-128 report: builds rows from declared set', () => {
  it('builds rows from declared set', () => {
    const declared = [makeDeclared('foo', 'MIT'), makeDeclared('bar', 'Apache-2.0')];
    const gpl = checkGpl(declared, true);
    const unknown = detectUnknown(declared);
    const dual: DualDecision[] = [];
    const policyEval = makeLicenseReport('allow', false, ['all clear']);
    const captures = { dual, gpl, unknown };

    const data = buildLicenseReportData(declared, policyEval, captures);

    expect(data.rows).toHaveLength(2);
    expect(data.rows[0]?.package).toBe('foo');
    expect(data.rows[0]?.version).toBe('1.0.0');
    expect(data.rows[0]?.declared).toBe('MIT');
    expect(data.rows[0]?.normalized).toBe('MIT');
    expect(data.rows[0]?.category).toBe('permissive');
    expect(data.rows[0]?.decision).toBe('allow');
    expect(data.rows[1]?.package).toBe('bar');
    expect(data.rows[1]?.normalized).toBe('Apache-2.0');
  });
});

describe('P-128 report: annotates dual/gpl/unknown rows', () => {
  it('annotates dual-license rows with reason', () => {
    const declared = [makeDeclared('foo', 'MIT OR GPL-3.0-only')];
    const gpl = checkGpl(declared, true);
    const unknown = detectUnknown(declared);
    const dual = [makeDualDecision('MIT OR GPL-3.0-only', 'MIT')];
    const policyEval = makeLicenseReport('review', true, ['dual-review: MIT OR GPL-3.0-only']);
    const captures = { dual, gpl, unknown };

    const data = buildLicenseReportData(declared, policyEval, captures);

    expect(data.rows).toHaveLength(1);
    expect(data.rows[0]?.reason).toBeDefined();
    expect(data.rows[0]?.reason).toContain('dual-');
  });

  it('annotates GPL-warning rows with reason', () => {
    const declared = [makeDeclared('foo', 'GPL-3.0-only')];
    const gpl = checkGpl(declared, true);
    const unknown = detectUnknown(declared);
    const dual: DualDecision[] = [];
    const policyEval = makeLicenseReport('review', true, [
      'gpl-warning: foo@1.0.0 (GPL-3.0-only) - Replace package',
    ]);
    const captures = { dual, gpl, unknown };

    const data = buildLicenseReportData(declared, policyEval, captures);

    expect(data.rows).toHaveLength(1);
    expect(data.rows[0]?.reason).toContain('gpl-warning');
  });

  it('annotates unknown rows with reason', () => {
    const declared = [makeDeclared('foo', 'UNKNOWN')];
    const gpl = checkGpl(declared, true);
    const unknown = detectUnknown(declared);
    const dual: DualDecision[] = [];
    const policyEval = makeLicenseReport('review', true, [
      'unknown-pending: foo@1.0.0 (UNKNOWN) awaiting decision',
    ]);
    const captures = { dual, gpl, unknown };

    const data = buildLicenseReportData(declared, policyEval, captures);

    expect(data.rows).toHaveLength(1);
    expect(data.rows[0]?.reason).toContain('unknown-pending');
  });
});

describe('P-128 report: computes summary counts', () => {
  it('computes summary counts', () => {
    const declared = [
      makeDeclared('a', 'MIT'),
      makeDeclared('b', 'Apache-2.0'),
      makeDeclared('c', 'UNKNOWN'),
      makeDeclared('d', 'GPL-3.0-only'),
    ];
    const gpl = checkGpl(declared, true);
    const unknown = detectUnknown(declared);
    const dual: DualDecision[] = [];
    // 2 allow, 1 unknown (review), 1 gpl (review) = total 4
    const policyEval = makeLicenseReport('review', true, ['unknown-pending', 'gpl-warning']);
    const captures = { dual, gpl, unknown };

    const data = buildLicenseReportData(declared, policyEval, captures);

    expect(data.summary.total).toBe(4);
    expect(data.summary.allow).toBe(2);
    expect(data.summary.review).toBe(2);
    expect(data.summary.deny).toBe(0);
    expect(data.summary.unknown).toBe(1);
    expect(data.summary.gplWarnings).toBe(1);
  });
});

describe('P-128 report: renders deterministic JSON', () => {
  it('renders deterministic JSON', () => {
    const declared = [makeDeclared('foo', 'MIT')];
    const gpl = checkGpl(declared, true);
    const unknown = detectUnknown(declared);
    const dual: DualDecision[] = [];
    const policyEval = makeLicenseReport('allow', false);
    const captures = { dual, gpl, unknown };

    const data = buildLicenseReportData(declared, policyEval, captures);
    const json1 = renderLicenseReportJson(data);
    const json2 = renderLicenseReportJson(data);

    // P-128 step 3: deterministic key order + `JSON.stringify(data, null, 2)`.
    expect(json1).toBe(json2);
    expect(json1.startsWith('{\n  "reportVersion": 1')).toBe(true);

    // Fixed key order in the emitted document.
    const versionIdx = json1.indexOf('"reportVersion"');
    const generatedIdx = json1.indexOf('"generatedAt"');
    const verdictIdx = json1.indexOf('"verdict"');
    const blockingIdx = json1.indexOf('"blocking"');
    expect(versionIdx).toBeLessThan(generatedIdx);
    expect(generatedIdx).toBeLessThan(verdictIdx);
    expect(verdictIdx).toBeLessThan(blockingIdx);

    // Two-space indentation, so the persisted report stays human-readable.
    expect(json1).toContain('\n  "rows": [');
    expect(json1).toContain('\n      "package": "foo"');

    const parsed = JSON.parse(json1) as {
      reportVersion: number;
      verdict: string;
      blocking: boolean;
    };
    expect(parsed.reportVersion).toBe(1);
    expect(parsed.verdict).toBe('allow');
    expect(parsed.blocking).toBe(false);
  });

  it('round-trips through JSON.parse', () => {
    const declared = [makeDeclared('foo', 'MIT'), makeDeclared('bar', 'Apache-2.0')];
    const gpl = checkGpl(declared, true);
    const unknown = detectUnknown(declared);
    const dual: DualDecision[] = [];
    const policyEval = makeLicenseReport('allow', false);
    const captures = { dual, gpl, unknown };

    const data = buildLicenseReportData(declared, policyEval, captures);
    const json = renderLicenseReportJson(data);
    const parsed = JSON.parse(json);

    expect(parsed.reportVersion).toBe(1);
    expect(parsed.verdict).toBe('allow');
    expect(parsed.blocking).toBe(false);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.summary.total).toBe(2);
    expect(parsed.dualLicenses).toEqual([]);
    expect(parsed.gplWarnings).toEqual([]);
    expect(parsed.unknown).toEqual([]);
  });
});

describe('P-123 report: blocking reflects pending unknown', () => {
  it('blocking reflects pending unknown', () => {
    const declared = [makeDeclared('foo', 'UNKNOWN')];
    const matrix = checkCompatibility(['UNKNOWN'], permissivePolicy);
    const report = aggregateLicenseReport(declared, permissivePolicy, matrix);
    expect(report.blocking).toBe(true);
    expect(report.unknown.length).toBeGreaterThan(0);
    const clear = aggregateLicenseReport(
      [makeDeclared('bar', 'MIT')],
      permissivePolicy,
      checkCompatibility(['MIT'], permissivePolicy)
    );
    expect(clear.blocking).toBe(false);
  });
});

describe('P-123 report: aggregates full license report', () => {
  it('aggregates full license report', () => {
    const declared = [makeDeclared('foo', 'MIT'), makeDeclared('bar', 'UNKNOWN')];
    const matrix = checkCompatibility(
      declared.map(d => d.licenses),
      permissivePolicy
    );
    const report = aggregateLicenseReport(declared, permissivePolicy, matrix);
    expect(report.declared).toBeDefined();
    expect(report.unknown.length).toBeGreaterThan(0);
    expect(report.gplWarnings).toBeDefined();
    expect(report.matrix).toBeDefined();
    expect(report.blocking).toBe(true);
  });
});

describe('P-128 report: annotates dual/gpl/unknown rows', () => {
  it('annotates dual/gpl/unknown rows', () => {
    const dualDeclared = [makeDeclared('d1', 'MIT OR GPL-3.0-only')];
    const dualPolicyEval = makeLicenseReport('review', true, ['dual-review']);
    const dualData = buildLicenseReportData(dualDeclared, dualPolicyEval, {
      dual: [makeDualDecision('MIT OR GPL-3.0-only', 'MIT')],
      gpl: [],
      unknown: [],
    });
    expect(dualData.rows[0]?.reason).toContain('dual-');
    const gplDeclared = [makeDeclared('g1', 'GPL-3.0-only')];
    const gplData = buildLicenseReportData(gplDeclared, makeLicenseReport('review', true), {
      dual: [],
      gpl: [makeGplWarning('g1', 'GPL-3.0-only')],
      unknown: [],
    });
    expect(gplData.rows[0]?.reason).toContain('gpl-warning');
    const unkDeclared = [makeDeclared('u1', 'UNKNOWN')];
    const unkData = buildLicenseReportData(unkDeclared, makeLicenseReport('review', true), {
      dual: [],
      gpl: [],
      unknown: detectUnknown(unkDeclared),
    });
    expect(unkData.rows[0]?.reason).toContain('unknown-pending');
  });
});
