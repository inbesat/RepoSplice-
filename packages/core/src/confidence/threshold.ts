// P-350 — the confidence threshold policy.
//
// A composite score below the configured threshold forces human review even
// for a tool that is normally in the auto-approval list (SECURITY.md section
// 6.1). The decision is DATA: this module never throws and never re-derives
// the composite — it reads the P-346/P-349 value and compares it.

import { err, ok, type Result } from 'neverthrow';
import type { StitchError } from '../result/index.js';
import type { SemanticConfidence } from './schema.js';

/** The documented default (ADR-159). */
export const DEFAULT_AUTO_APPROVE_THRESHOLD = 75;

/** The accepted range of a threshold. */
export const AUTO_APPROVE_THRESHOLD_RANGE = { min: 0, max: 100 } as const;

/**
 * Why 75 is the default (ADR-159, mirrored in DECISIONS.md).
 *
 * P-349 weights the sandbox outcome (30%) and the resolver/self reads (45%)
 * above the license and coverage signals (25%), so a composite of 75 means the
 * proposal passed its sandbox and rested on mostly high-confidence imports.
 * The value is PROVISIONAL: it is a defensible prior, not a measurement -
 * P-354 calibrates the threshold against the Epic 16 human rubric scores.
 */
export const THRESHOLD_RATIONALE =
  'A composite of 75 is the documented default: P-349 weights the sandbox outcome (30%) and the resolver and self-critique reads (45%) above the license and coverage signals (25%), so 75 means the proposal passed its sandbox and rested on mostly high-confidence imports. The value is PROVISIONAL pending the P-354 calibration against the Epic 16 human rubric scores.';

/** The composite a decision is made about: a document or a bare number. */
export type ConfidenceInput = SemanticConfidence | number;

export interface ThresholdSources {
  /** The per-run override (the CLI `--confidence-threshold` flag). */
  readonly flagValue?: number;
  /** The value from `~/.stitch/config.json`. */
  readonly configValue?: number;
}

export interface ThresholdDecision {
  readonly autoApprove: boolean;
  readonly composite: number;
  readonly threshold: number;
  readonly requiresHumanReview: boolean;
  readonly reason: string;
}

/** Read the composite out of either accepted input shape. */
function compositeOf(confidence: ConfidenceInput): number {
  return typeof confidence === 'number' ? confidence : confidence.composite_score;
}

/**
 * Validate a threshold; absent means the default.
 *
 * An out-of-range or non-finite value is refused rather than clamped: a
 * silently clamped threshold would auto-approve things nobody configured it to.
 */
export function normalizeAutoApproveThreshold(value?: number): Result<number, StitchError> {
  if (value === undefined) return ok(DEFAULT_AUTO_APPROVE_THRESHOLD);
  if (
    !Number.isFinite(value) ||
    value < AUTO_APPROVE_THRESHOLD_RANGE.min ||
    value > AUTO_APPROVE_THRESHOLD_RANGE.max
  ) {
    return err({
      code: 'CONFIG_ERROR',
      field: 'confidence.auto_approve_threshold',
      message:
        `the auto-approve threshold must be a finite number between ` +
        `${AUTO_APPROVE_THRESHOLD_RANGE.min} and ${AUTO_APPROVE_THRESHOLD_RANGE.max}, got ${String(value)}`,
    });
  }
  return ok(value);
}

/**
 * Resolve the effective threshold: the per-run flag beats the config file,
 * which beats the default. Whichever value wins is validated, so a bad flag
 * cannot be masked by a good config value.
 */
export function resolveThreshold(sources: ThresholdSources = {}): Result<number, StitchError> {
  if (sources.flagValue !== undefined) return normalizeAutoApproveThreshold(sources.flagValue);
  return normalizeAutoApproveThreshold(sources.configValue);
}

/** The spec's step 2: a composite at or above the threshold auto-approves. */
export function shouldAutoApprove(
  confidence: ConfidenceInput,
  threshold?: number
): Result<boolean, StitchError> {
  const normalized = normalizeAutoApproveThreshold(threshold);
  if (normalized.isErr()) return err(normalized.error);
  return ok(compositeOf(confidence) >= normalized.value);
}

/** The decision the HIL queue (P-160) reads (the spec's step 3). */
export function thresholdDecision(
  confidence: ConfidenceInput,
  threshold?: number
): Result<ThresholdDecision, StitchError> {
  const normalized = normalizeAutoApproveThreshold(threshold);
  if (normalized.isErr()) return err(normalized.error);
  const limit = normalized.value;
  const composite = compositeOf(confidence);
  const autoApprove = composite >= limit;
  const reason = autoApprove
    ? `composite ${composite}/100 meets the ${limit} auto-approve threshold`
    : `composite ${composite}/100 is below the ${limit} auto-approve threshold by ${limit - composite}`;
  return ok({
    autoApprove,
    composite,
    threshold: limit,
    requiresHumanReview: !autoApprove,
    reason,
  });
}

/** The `requires_human_review` flag alone, for a caller that needs only it. */
export function requiresHumanReview(
  confidence: ConfidenceInput,
  threshold?: number
): Result<boolean, StitchError> {
  const decision = thresholdDecision(confidence, threshold);
  if (decision.isErr()) return err(decision.error);
  return ok(decision.value.requiresHumanReview);
}
