// License report aggregation (P-123, P-127, P-128).
//
// Aggregates scanned licenses, unknown queue, GPL warnings, and matrix
// verdict into a LicenseReport that surfaces blocking status for C creation.
// Delegates to policy engine (P-127) for single source of truth.
// Provides serializable LicenseReportData for CLI/web/provenance (P-128).

import { normalizeExpression } from './spdx.js';
import { checkGpl } from './gpl.js';
import type { GplWarning } from './gpl.js';
import type { DeclaredLicense } from './scan.js';
import type {
  CompatibilityResult,
  LicensePolicy,
  LicenseReport,
  DualDecision,
  DeepScanResult,
  NoticeResult,
  GeneratedLicense,
  LicenseReportData,
  LicenseReportRow,
} from './types.js';
import { detectUnknown } from './unknown.js';
import type { UnknownLicense } from './unknown.js';
import { evaluatePolicy, buildLicenseReport as buildPolicyReport } from './policy.js';
import { chooseDualLicense } from './dual.js';
import { LICENSE_CATEGORIES } from './categories.js';

// Re-export from policy for backward compatibility
export { evaluatePolicy, finalGate } from './policy.js';

/**
 * Aggregate license findings into a single report.
 * This is the P-123 API, now delegating to P-127 policy engine.
 *
 * @param declared - declared licenses from scanDeclared (P-118)
 * @param policy - license policy
 * @param matrix - compatibility verdict from checkCompatibility (P-120)
 * @param gplOrDual - either precomputed GplWarning[] or dualResult (ignored). If array, used as gplWarnings; otherwise computed via checkGpl with isJsTs=true.
 * @returns LicenseReport with verdict, blocking, and reasons
 */
export function aggregateLicenseReport(
  declared: DeclaredLicense[],
  policy: LicensePolicy,
  matrix: CompatibilityResult,
  gplOrDual?: GplWarning[] | unknown
): LicenseReport {
  const unknown = detectUnknown(declared);

  let gplWarnings: GplWarning[];
  if (Array.isArray(gplOrDual)) {
    gplWarnings = gplOrDual as GplWarning[];
  } else {
    gplWarnings = checkGpl(declared, true);
  }

  // Build dual decisions for any OR expressions in declared
  const dual: DualDecision[] = [];
  for (const d of declared) {
    if (/\sOR\s/i.test(d.licenses)) {
      const dualResult = chooseDualLicense(d.licenses, policy, policy.targetLicense);
      dual.push(dualResult);
    }
  }

  const fields = {
    declared,
    unknown,
    gplWarnings,
    matrix,
    dual,
    deep: null as DeepScanResult | null,
  };

  // Use policy engine for single source of truth
  return buildPolicyReport(fields, policy, new Map());
}

/**
 * Overload that allows explicit isJsTs control for GPL warnings.
 * Used by CLI when ecosystem is known to be non-JS.
 */
export function aggregateLicenseReportWithGplOpts(
  declared: DeclaredLicense[],
  policy: LicensePolicy,
  matrix: CompatibilityResult,
  gplOpts: { gplWarnings?: GplWarning[]; isJsTs?: boolean }
): LicenseReport {
  const unknown = detectUnknown(declared);

  let gplWarnings: GplWarning[];
  if (gplOpts.gplWarnings !== undefined) {
    gplWarnings = gplOpts.gplWarnings;
  } else {
    const isJsTs = gplOpts.isJsTs ?? true;
    gplWarnings = checkGpl(declared, isJsTs);
  }

  const dual: DualDecision[] = [];
  for (const d of declared) {
    if (/\sOR\s/i.test(d.licenses)) {
      const dualResult = chooseDualLicense(d.licenses, policy, policy.targetLicense);
      dual.push(dualResult);
    }
  }

  const fields = {
    declared,
    unknown,
    gplWarnings,
    matrix,
    dual,
    deep: null as DeepScanResult | null,
  };

  return buildPolicyReport(fields, policy, new Map());
}

/**
 * Build serializable LicenseReportData for CLI/web/provenance (P-128).
 * Maps each declared license to a LicenseReportRow with normalized SPDX,
 * category, and the decision from policy evaluation.
 */
export function buildLicenseReportData(
  declared: DeclaredLicense[],
  policyEval: LicenseReport,
  captures: { dual: DualDecision[]; gpl: GplWarning[]; unknown: UnknownLicense[] }
): LicenseReportData {
  const rows: LicenseReportRow[] = [];

  // Build a map of package@version -> decision from policyEval.reasons
  // The policyEval.reasons contains prefixed reasons like "unknown-pending:", "matrix-deny:", etc.
  // We'll derive the per-package decision from the policy verdict and reasons.

  // For simplicity, we use the policyEval.verdict as the default decision for all packages,
  // then override based on specific reasons.
  // A more precise implementation would track per-package decisions in the policy engine.

  // Per-package decisions are derived from the captures (P-128 step 2). The
  // repo-level `verdict`/`blocking` fields stay the gate callers enforce; a row
  // with no negative signal is 'allow' rather than inheriting the repo verdict,
  // so a single unknown/GPL package does not mark every clean row as review.
  const getPackageDecision = (
    pkg: string,
    version: string,
    lic: string
  ): { decision: 'allow' | 'review' | 'deny'; reason?: string } => {
    // Dual-license first: an OR expression is classified by its chosen branch,
    // not by the GPL signal in one of its branches.
    const dualEntry = captures.dual.find(d => d.expression.includes(lic) || d.recommended === lic);
    if (dualEntry) {
      if (!dualEntry.allCompliant) {
        return {
          decision: policyEval.verdict === 'deny' ? 'deny' : 'review',
          reason: `dual-${policyEval.verdict}: ${dualEntry.expression} -> recommended ${dualEntry.recommended}`,
        };
      }
    }

    // Check if this package has a GPL warning
    const gplWarning = captures.gpl.find(w => w.package === pkg && w.version === version);
    if (gplWarning) {
      return { decision: 'review', reason: `gpl-warning: ${gplWarning.suggestion}` };
    }

    // Check if this package is in unknown list
    const unknownEntry = captures.unknown.find(u => u.package === pkg && u.version === version);
    if (unknownEntry) {
      if (unknownEntry.decision === 'deny')
        return { decision: 'deny', reason: 'unknown-denied: human override' };
      if (unknownEntry.decision === 'allow')
        return { decision: 'allow', reason: 'unknown-resolved: human allow' };
      return {
        decision: 'review',
        reason: `unknown-pending: ${unknownEntry.rawLicense} awaiting decision`,
      };
    }

    return { decision: 'allow' };
  };

  for (const d of declared) {
    const normLic = normalizeExpression(d.licenses);
    const cat = LICENSE_CATEGORIES[normLic] ?? 'unknown';
    const { decision, reason } = getPackageDecision(d.package, d.version, d.licenses);

    rows.push({
      package: d.package,
      version: d.version,
      declared: d.licenses,
      normalized: normLic,
      category: cat,
      decision,
      ...(reason !== undefined ? { reason } : {}),
    });
  }

  // Compute summary counts from rows
  let allow = 0,
    review = 0,
    deny = 0;
  for (const row of rows) {
    if (row.decision === 'allow') allow++;
    else if (row.decision === 'review') review++;
    else if (row.decision === 'deny') deny++;
  }
  const unknownCount = captures.unknown.filter(u => u.decision === 'pending').length;

  return {
    reportVersion: 1,
    generatedAt: new Date().toISOString(),
    verdict: policyEval.verdict,
    blocking: policyEval.blocking,
    rows,
    summary: {
      total: rows.length,
      allow,
      review,
      deny,
      unknown: unknownCount,
      gplWarnings: captures.gpl.length,
    },
    dualLicenses: captures.dual,
    gplWarnings: captures.gpl,
    unknown: captures.unknown,
  };
}

/**
 * Render LicenseReportData to deterministic JSON.
 * Builds object literal in fixed key order for deterministic output.
 */
export function renderLicenseReportJson(data: LicenseReportData): string {
  return JSON.stringify(data, null, 2);
}

/**
 * Full pipeline: scan → evaluate → build report data (P-128).
 * This is the main entry point for CLI (P-196) and web (P-220).
 * Returns LicenseReport for backward compatibility with P-123/P-127.
 */
export function buildLicenseReport(
  declared: DeclaredLicense[],
  policy: LicensePolicy,
  matrix: CompatibilityResult,
  gplOrDual?: GplWarning[] | unknown,
  deepScan?: DeepScanResult | null,
  notice?: NoticeResult,
  generatedLicense?: GeneratedLicense,
  overrides?: Map<string, 'allow' | 'deny'>
): LicenseReport {
  const unknown = detectUnknown(declared);

  let gplWarnings: GplWarning[];
  if (Array.isArray(gplOrDual)) {
    gplWarnings = gplOrDual as GplWarning[];
  } else {
    gplWarnings = checkGpl(declared, true);
  }

  const dual: DualDecision[] = [];
  for (const d of declared) {
    if (/\sOR\s/i.test(d.licenses)) {
      const dualResult = chooseDualLicense(d.licenses, policy, policy.targetLicense);
      dual.push(dualResult);
    }
  }

  const fields = {
    declared,
    unknown,
    gplWarnings,
    matrix,
    dual,
    deep: deepScan ?? null,
    ...(notice !== undefined ? { notice } : {}),
    ...(generatedLicense !== undefined ? { generatedLicense } : {}),
  };

  return evaluatePolicy(fields, policy, overrides ?? new Map());
}
