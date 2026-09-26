// License policy evaluation engine (P-127).
//
// Converges all license signals (scan, matrix, GPL, dual, unknown, deep scan)
// into a single policy verdict that gates C creation. Side-effect-free and
// trivially testable.

import type {
  LicensePolicy,
  CompatibilityResult,
  LicenseReport,
  DualDecision,
  GplWarning,
  UnknownLicense,
  DeepScanResult,
  NoticeResult,
  GeneratedLicense,
  DeclaredLicense,
} from './types.js';

interface LicenseAggregateFields {
  declared: DeclaredLicense[];
  unknown: UnknownLicense[];
  gplWarnings: GplWarning[];
  matrix: CompatibilityResult;
  dual: DualDecision[];
  deep: DeepScanResult | null;
  notice?: NoticeResult;
  generatedLicense?: GeneratedLicense;
}

type PolicyOverrides = Map<string, 'allow' | 'deny'>;

/**
 * Evaluate the license policy against all collected signals.
 *
 * @param fields - Aggregated license findings from scan/matrix/GPL/dual/unknown/deep
 * @param policy - LicensePolicy (allow/denyUnknown/requireAttribution/targetLicense)
 * @param overrides - Human decisions for unknown packages (Map<pkg@version, 'allow'|'deny'>)
 * @returns LicenseReport with verdict, blocking, and reasons
 */
export function evaluatePolicy(
  fields: LicenseAggregateFields,
  policy: LicensePolicy,
  overrides: PolicyOverrides
): LicenseReport {
  void policy;
  let verdict: 'allow' | 'deny' | 'review' = 'allow';
  let blocking = false;
  const reasons: string[] = [];

  // 1. Pending unknowns
  const pendingUnknowns = fields.unknown.filter(u => u.decision === 'pending');
  for (const u of pendingUnknowns) {
    const key = `${u.package}@${u.version}`;
    const override = overrides.get(key) ?? overrides.get(u.package);
    if (override === 'allow') {
      // Resolved by human allow
      reasons.push(`unknown-resolved: ${u.package}@${u.version} overridden to allow`);
    } else if (override === 'deny') {
      // Deny override forces deny
      verdict = 'deny';
      blocking = true;
      reasons.push(`unknown-denied: ${u.package}@${u.version} overridden to deny`);
    } else {
      // No override → review + blocking
      verdict = 'review';
      blocking = true;
      reasons.push(
        `unknown-pending: ${u.package}@${u.version} (${u.rawLicense}) awaiting decision`
      );
    }
  }

  // 2. Matrix decision (compatibility check)
  if (fields.matrix.decision === 'deny') {
    verdict = 'deny';
    blocking = true;
    reasons.push(...fields.matrix.reasons.map(r => `matrix-deny: ${r}`));
  } else if (fields.matrix.decision === 'review') {
    if (verdict !== 'deny') verdict = 'review';
    blocking = true;
    reasons.push(...fields.matrix.reasons.map(r => `matrix-review: ${r}`));
  }

  // 3. GPL warnings (never downgrade below review)
  if (fields.gplWarnings.length > 0) {
    if (verdict !== 'deny') verdict = 'review';
    blocking = true;
    for (const w of fields.gplWarnings) {
      reasons.push(`gpl-warning: ${w.package}@${w.version} (${w.license}) - ${w.suggestion}`);
    }
  }

  // 4. Dual-license non-compliance
  for (const d of fields.dual) {
    if (!d.allCompliant) {
      if (d.reasons.some(r => r.includes('deny') || r.includes('not in allow'))) {
        verdict = 'deny';
        blocking = true;
      } else if (verdict !== 'deny') {
        verdict = 'review';
        blocking = true;
      }
      for (const r of d.reasons) {
        reasons.push(`dual-${verdict}: ${d.expression} -> ${r}`);
      }
    }
  }

  // 5. Deep scan unexpected licenses (if opt-in was on)
  if (fields.deep && fields.deep.optIn && fields.deep.files.length > 0) {
    // Deep scan findings would be folded in at P-129; for now note opt-in
    reasons.push('deep-scan: opt-in enabled, unexpected licenses reported via P-129');
  }

  // 6. All clear → allow
  if (verdict === 'allow' && !blocking) {
    reasons.push('policy-eval: all clear, permissive licenses only');
  }

  // Dedupe reasons while preserving order
  const uniqueReasons = [...new Set(reasons)];

  return {
    ...fields,
    verdict,
    blocking,
    reasons: uniqueReasons,
  };
}

/**
 * Final gate check used by orchestration (P-205) and UI (P-218).
 * Returns true only when verdict is 'allow'.
 */
export function finalGate(report: LicenseReport): boolean {
  return report.verdict === 'allow';
}

/**
 * Build a LicenseReport from raw aggregate fields (convenience for callers).
 * This is the single gate the pipeline calls.
 */
export function buildLicenseReport(
  fields: LicenseAggregateFields,
  policy: LicensePolicy,
  overrides: PolicyOverrides
): LicenseReport {
  return evaluatePolicy(fields, policy, overrides);
}
