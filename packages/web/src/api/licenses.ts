// License API — client contract. The serve endpoints (GET /api/licenses/report,
// POST /api/licenses/decide) do NOT exist yet (P-193 server has only
// provenance/jobs/settings); P-128/P-127 define the core side. Wire types mirror
// core license/types.ts STRUCTURALLY but are local on purpose — this package's
// tsconfig rootDir cannot import the @repo-stitcher/core barrel (TS6059).
import { describeFailure } from './repos.js';

export type LicenseCategory =
  'permissive' | 'weak-copyleft' | 'strong-copyleft' | 'network-copyleft' | 'unknown';

export type LicenseVerdict = 'allow' | 'deny' | 'review';

export interface LicenseReportRow {
  package: string;
  version: string;
  declared: string;
  normalized: string;
  category: LicenseCategory;
  decision: 'allow' | 'review' | 'deny';
  reason?: string;
}

export interface GplWarning {
  package: string;
  version: string;
  license: string;
  category: LicenseCategory;
  severity: 'warning' | 'info';
  suggestion: string;
}

export interface DualDecision {
  expression: string;
  recommended: string;
  alternatives: string[];
  allCompliant: boolean;
  reasons: string[];
}

export interface UnknownLicense {
  package: string;
  version: string;
  rawLicense: string;
  path?: string;
  decision: 'pending' | 'allow' | 'deny';
}

export interface LicenseReportData {
  reportVersion: 1;
  generatedAt: string;
  verdict: LicenseVerdict;
  blocking: boolean;
  rows: LicenseReportRow[];
  summary: {
    total: number;
    allow: number;
    review: number;
    deny: number;
    unknown: number;
    gplWarnings: number;
  };
  dualLicenses: DualDecision[];
  gplWarnings: GplWarning[];
  unknown: UnknownLicense[];
}

export async function fetchLicenseReport(): Promise<LicenseReportData> {
  const response = await fetch('/api/licenses/report');
  if (!response.ok) throw new Error(await describeFailure(response));
  return (await response.json()) as LicenseReportData;
}

export type UnknownVerdict = 'allow' | 'deny';

/** POST an allow/deny decision for a pending unknown license (P-127 overrides). */
export async function decideUnknown(licenseId: string, verdict: UnknownVerdict): Promise<void> {
  const response = await fetch('/api/licenses/decide', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ licenseId, verdict }),
  });
  if (!response.ok) throw new Error(await describeFailure(response));
}
