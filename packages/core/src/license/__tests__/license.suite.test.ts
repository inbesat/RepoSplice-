import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkCompatibility } from '../compat.js';
import { checkGpl } from '../gpl.js';
import { chooseDualLicense } from '../dual.js';
import { detectUnknown, clearLicenseDecisionsForTests } from '../unknown.js';
import { evaluatePolicy } from '../policy.js';
import { buildLicenseReportData, renderLicenseReportJson } from '../report.js';
import {
  runScanCode,
  setDeepScanConfigForTests,
  clearDeepScanConfigForTests,
  setDeepScanExecForTests,
} from '../deepScan.js';
import { LICENSE_CATEGORIES } from '../categories.js';
import type { DeclaredLicense } from '../scan.js';
import type { DualDecision, LicensePolicy, LicenseReport, LicenseReportData } from '../types.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, 'fixtures');

const permissivePolicy: LicensePolicy = {
  allow: ['permissive'],
  denyUnknown: false,
  requireAttribution: true,
  targetLicense: 'MIT',
};

interface FixturePkg {
  name: string;
  version: string;
  license?: string | string[];
  dependencies?: Record<string, string>;
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf-8')) as unknown;
}

function loadDeclared(fixture: string): DeclaredLicense[] {
  const pkg = readJson(join(fixturesDir, fixture, 'package.json')) as FixturePkg;
  const licMap = readJson(join(fixturesDir, fixture, 'licenses.json')) as Record<string, string>;
  const declared: DeclaredLicense[] = [];
  const rootRaw = Array.isArray(pkg.license)
    ? pkg.license.join(' OR ')
    : (pkg.license ?? 'UNKNOWN');
  declared.push({
    package: pkg.name,
    version: pkg.version,
    licenses: rootRaw,
    rawLicenses: rootRaw,
  });
  const deps = pkg.dependencies ?? {};
  for (const [dep, version] of Object.entries(deps)) {
    const lic = licMap[dep] ?? 'UNKNOWN';
    declared.push({ package: dep, version, licenses: lic, rawLicenses: lic });
  }
  declared.sort((a, b) => {
    if (a.package < b.package) return -1;
    if (a.package > b.package) return 1;
    return 0;
  });
  return declared;
}

function runPipeline(declared: DeclaredLicense[]): {
  report: LicenseReport;
  data: LicenseReportData;
} {
  const matrix = checkCompatibility(
    declared.map(d => d.licenses),
    permissivePolicy
  );
  const gpl = checkGpl(declared, true);
  const unknown = detectUnknown(declared);
  const dual: DualDecision[] = [];
  for (const d of declared) {
    if (/\sOR\s/i.test(d.licenses)) {
      dual.push(chooseDualLicense(d.licenses, permissivePolicy, permissivePolicy.targetLicense));
    }
  }
  const report = evaluatePolicy(
    { declared, unknown, gplWarnings: gpl, matrix, dual, deep: null },
    permissivePolicy,
    new Map()
  );
  const data = buildLicenseReportData(declared, report, { dual, gpl, unknown });
  return { report, data };
}

beforeEach(() => {
  clearLicenseDecisionsForTests();
});

afterEach(() => {
  setDeepScanExecForTests(null);
  clearDeepScanConfigForTests();
});

describe('P-130 suite: mit-repo allows', () => {
  it('mit-repo allows', () => {
    const declared = loadDeclared('mit-repo');
    expect(declared).toHaveLength(2);
    const { report, data } = runPipeline(declared);
    expect(report.verdict).toBe('allow');
    expect(report.blocking).toBe(false);
    expect(data.verdict).toBe('allow');
    expect(data.blocking).toBe(false);
    expect(data.summary).toMatchObject({ total: 2, allow: 2, review: 0, deny: 0 });
    const parsed = JSON.parse(renderLicenseReportJson(data)) as LicenseReportData;
    expect(parsed.verdict).toBe('allow');
    expect(parsed.rows).toHaveLength(2);
  });
});

describe('P-130 suite: mixed-repo reviews on gpl', () => {
  it('mixed-repo reviews on gpl', () => {
    const declared = loadDeclared('mixed-repo');
    expect(declared).toHaveLength(3);
    const { report, data } = runPipeline(declared);
    expect(report.gplWarnings.length).toBeGreaterThan(0);
    expect(report.blocking).toBe(true);
    expect(['review', 'deny']).toContain(report.verdict);
    const gplRow = data.rows.find(r => r.package === 'gpl-lib');
    expect(gplRow?.reason).toContain('gpl-warning');
  });
});

describe('P-130 suite: dual-repo picks MIT', () => {
  it('dual-repo picks MIT', () => {
    const declared = loadDeclared('dual-repo');
    const root = declared.find(d => d.package === 'dual-repo-fixture')!;
    expect(root.licenses).toBe('MIT OR Apache-2.0');
    const dual = chooseDualLicense(root.licenses, permissivePolicy, permissivePolicy.targetLicense);
    expect(dual.allCompliant).toBe(true);
    expect(LICENSE_CATEGORIES[dual.recommended]).toBe('permissive');
    const mitPick = chooseDualLicense(
      'MIT OR GPL-3.0-only',
      permissivePolicy,
      permissivePolicy.targetLicense
    );
    expect(mitPick.recommended).toBe('MIT');
  });
});

describe('P-130 suite: unknown-repo blocks', () => {
  it('unknown-repo blocks', () => {
    const declared = loadDeclared('unknown-repo');
    const { report, data } = runPipeline(declared);
    expect(report.blocking).toBe(true);
    const pending = report.unknown.filter(u => u.decision === 'pending');
    expect(pending).toHaveLength(1);
    expect(pending[0]?.package).toBe('mystery-lib');
    expect(data.summary.unknown).toBe(1);
  });
});

describe('P-130 suite: gpl-repo denies', () => {
  it('gpl-repo denies under permissive-only policy', () => {
    const declared = loadDeclared('gpl-repo');
    const { report, data } = runPipeline(declared);
    expect(report.verdict).toBe('deny');
    expect(report.blocking).toBe(true);
    for (const row of data.rows) {
      expect(row.reason).toContain('gpl-warning');
    }
    expect(data.summary.review + data.summary.deny).toBe(data.summary.total);
  });
});

describe('P-130 suite: deep-scan parses stub output', () => {
  it('deep-scan parses stub output', async () => {
    const stubJson = readFileSync(join(fixturesDir, 'scancode.json'), 'utf-8');
    setDeepScanConfigForTests({ deepScan: true });
    setDeepScanExecForTests(async () => ({ exitCode: 0, stdout: stubJson, stderr: '' }));
    const result = await runScanCode('mixed-repo');
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.scanner).toBe('scancode');
      expect(result.value.optIn).toBe(true);
      expect(result.value.files).toHaveLength(2);
      const gplFile = result.value.files.find(f => f.path === 'src/vendor/gpl-util.js');
      expect(gplFile?.licenses).toContain('GPL-3.0-only');
      const declaredLicenses = ['MIT'];
      const unexpected = result.value.files.filter(f =>
        f.licenses.some(lic => !declaredLicenses.includes(lic))
      );
      expect(unexpected).toHaveLength(1);
      expect(unexpected[0]?.path).toBe('src/vendor/gpl-util.js');
    }
  });
});
