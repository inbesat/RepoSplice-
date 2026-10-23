// P-346 — the SemanticConfidence schema.
//
// A composite confidence score (0-100) for a proposed component or merge
// decision, built from five independent factors so a caller can see WHY a
// number came out the way it did:
//
//   sandbox_pass         0 or 1  — the sandbox build/test run succeeded (P-176)
//   self_confidence      0-100   — the agent's own second-pass rating (P-347)
//   resolver_confidence  0-100   — the import-resolution confidence (P-342)
//   license_risk         0-100   — RISK, not safety (P-127): 0 = clean
//   test_coverage         0-100   — the coverage of the touched code
//
// The module never throws: the schema is used through `safeParse`, and the two
// computations return a neverthrow `Result`. The errors reuse the existing
// StitchError codes only (CONFIG_ERROR with a `field`).

import { err, ok, type Result } from 'neverthrow';
import { z } from 'zod';
import type { StitchError } from '../result/index.js';

/** The five factors a composite score is built from, in reporting order. */
export const CONFIDENCE_COMPONENTS = [
  'sandbox_pass',
  'self_confidence',
  'resolver_confidence',
  'license_risk',
  'test_coverage',
] as const;

export type ConfidenceComponent = (typeof CONFIDENCE_COMPONENTS)[number];

/** The per-factor raw inputs. */
export interface ConfidenceComponentScores {
  /** 0 (the sandbox run failed) or 1 (it passed). Normalised to 0/100 in the sum. */
  readonly sandbox_pass: 0 | 1;
  /** The agent's own rating, 0-100. */
  readonly self_confidence: number;
  /** The import-resolution confidence, 0-100 (P-342). */
  readonly resolver_confidence: number;
  /** The license RISK, 0-100 (P-127): 0 = clean, 100 = certain violation. */
  readonly license_risk: number;
  /** The coverage of the touched code, 0-100. */
  readonly test_coverage: number;
}

/** The weight of each factor. The weights must be non-negative and sum to 1. */
export type ConfidenceWeights = Readonly<Record<ConfidenceComponent, number>>;

/**
 * The default weights, FINALIZED by P-349 (documented in ADR-158; P-346 had
 * shipped them as a provisional set and P-349 is the phase that finalizes the
 * model, so the two swapped factors below are the final values).
 *
 * The sandbox build carries the most weight (a component that does not build
 * is not a component), then the agent's own self rating, then the resolver's
 * confidence, then the license risk and the test coverage. The per-weight
 * rationale lives in COMPOSITE_WEIGHT_RATIONALE in ./scoring.js, and this
 * constant stays the ONE default: ./scoring.js re-exports it rather than
 * declaring a second set.
 */
export const DEFAULT_CONFIDENCE_WEIGHTS: ConfidenceWeights = {
  sandbox_pass: 0.3,
  self_confidence: 0.25,
  resolver_confidence: 0.2,
  license_risk: 0.15,
  test_coverage: 0.1,
};

/** A raw key-value input kept alongside the score, so the number is auditable. */
export type ContributingFactor = number | string | boolean;

export const confidenceComponentScoresSchema = z.object({
  sandbox_pass: z.union([z.literal(0), z.literal(1)]),
  self_confidence: z.number().min(0).max(100),
  resolver_confidence: z.number().min(0).max(100),
  license_risk: z.number().min(0).max(100),
  test_coverage: z.number().min(0).max(100),
});

export const semanticConfidenceSchema = z.object({
  composite_score: z.number().int().min(0).max(100),
  components: confidenceComponentScoresSchema,
  rationale: z.string().min(1),
  flags: z.array(z.string()),
  contributing_factors: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])),
});

export type SemanticConfidence = z.infer<typeof semanticConfidenceSchema>;

/** The inputs `buildSemanticConfidence` accepts. */
export interface SemanticConfidenceInput {
  readonly components: ConfidenceComponentScores;
  /** Overrides the default weights (P-346 step 3). */
  readonly weights?: ConfidenceWeights;
  /** Raw inputs kept for the audit trail (P-346 step 1). */
  readonly contributing_factors?: Readonly<Record<string, ContributingFactor>>;
}

/**
 * The P-325 rubric compatibility map.
 *
 * The human rubric (packages/core/src/eval/rubric.ts) scores three 1-5
 * dimensions; this composite is built from five 0-100 factors. The mapping is
 * documented rather than implied, so a consumer can compare the two:
 *
 *   wiring_correctness  <- resolver_confidence + self_confidence
 *   unnecessary_changes <- self_confidence
 *   respects_patterns   <- self_confidence
 */
export const RUBRIC_COMPATIBILITY: Readonly<Record<string, readonly ConfidenceComponent[]>> = {
  wiring_correctness: ['resolver_confidence', 'self_confidence'],
  unnecessary_changes: ['self_confidence'],
  respects_patterns: ['self_confidence'],
};

/** The sum the weights must reach (floating point tolerance below). */
const WEIGHT_SUM = 1;
const WEIGHT_EPSILON = 1e-6;

/**
 * The contribution of one factor to the composite, on a 0-100 scale.
 *
 * `sandbox_pass` is stored 0/1 and normalised x100; `license_risk` is RISK, so
 * its contribution is its COMPLEMENT — a confidence score must rise as risk
 * falls.
 */
function contributionOf(
  component: ConfidenceComponent,
  components: ConfidenceComponentScores
): number {
  if (component === 'sandbox_pass') return components.sandbox_pass * 100;
  if (component === 'license_risk') return 100 - components.license_risk;
  return components[component];
}

/** Are the weights usable (non-negative and summing to 1)? */
function weightsProblem(weights: ConfidenceWeights): string | undefined {
  for (const component of CONFIDENCE_COMPONENTS) {
    const weight = weights[component];
    if (!Number.isFinite(weight) || weight < 0) {
      return `the weight of ${component} must be a non-negative number (got ${String(weight)})`;
    }
  }
  const sum = CONFIDENCE_COMPONENTS.reduce((total, component) => total + weights[component], 0);
  if (Math.abs(sum - WEIGHT_SUM) > WEIGHT_EPSILON) {
    return `the weights must sum to 1 (they sum to ${sum})`;
  }
  return undefined;
}

/**
 * The weighted composite, rounded and clamped to 0-100 (P-346 steps 3 + 4).
 * An unusable weight set is a CONFIG_ERROR, never a silently wrong number.
 */
export function compositeScore(
  components: ConfidenceComponentScores,
  weights: ConfidenceWeights = DEFAULT_CONFIDENCE_WEIGHTS
): Result<number, StitchError> {
  const problem = weightsProblem(weights);
  if (problem !== undefined) {
    return err({ code: 'CONFIG_ERROR', field: 'confidence.weights', message: problem });
  }
  const parsed = confidenceComponentScoresSchema.safeParse(components);
  if (!parsed.success) {
    return err({
      code: 'CONFIG_ERROR',
      field: 'confidence.components',
      message: `the component scores are invalid: ${parsed.error.issues
        .map(issue => `${issue.path.join('.')} ${issue.message}`)
        .join('; ')}`,
    });
  }
  const weighted = CONFIDENCE_COMPONENTS.reduce(
    (total, component) => total + weights[component] * contributionOf(component, components),
    0
  );
  const rounded = Math.round(weighted);
  const clamped = Math.min(100, Math.max(0, rounded));
  return ok(clamped);
}

/** The warnings a set of components implies. */
export function deriveFlags(components: ConfidenceComponentScores): string[] {
  const flags: string[] = [];
  if (components.sandbox_pass === 0) flags.push('sandbox_failed');
  if (components.license_risk >= 50) flags.push('high_license_risk');
  if (components.test_coverage < 50) flags.push('low_test_coverage');
  if (components.resolver_confidence < 50) flags.push('unresolved_imports');
  if (components.self_confidence < 50) flags.push('low_self_confidence');
  return flags;
}

/** A one-sentence explanation of the score, naming the factors behind it. */
export function deriveRationale(components: ConfidenceComponentScores, composite: number): string {
  const parts = [
    components.sandbox_pass === 1 ? 'the sandbox run passed' : 'the sandbox run failed',
    `resolver confidence ${components.resolver_confidence}/100`,
    `license risk ${components.license_risk}/100`,
    `test coverage ${components.test_coverage}/100`,
    `self confidence ${components.self_confidence}/100`,
  ];
  return `Composite confidence ${composite}/100: ${parts.join(', ')}.`;
}

/**
 * Build a complete, schema-valid `SemanticConfidence` document: the score, the
 * derived flags and rationale, and the raw factors for the audit trail.
 */
export function buildSemanticConfidence(
  input: SemanticConfidenceInput
): Result<SemanticConfidence, StitchError> {
  const score = compositeScore(input.components, input.weights);
  if (score.isErr()) return err(score.error);
  const document = {
    composite_score: score.value,
    components: input.components,
    rationale: deriveRationale(input.components, score.value),
    flags: deriveFlags(input.components),
    contributing_factors: { ...(input.contributing_factors ?? {}) },
  };
  const parsed = semanticConfidenceSchema.safeParse(document);
  if (!parsed.success) {
    return err({
      code: 'CONFIG_ERROR',
      field: 'confidence.document',
      message: `the confidence document is invalid: ${parsed.error.issues
        .map(issue => `${issue.path.join('.')} ${issue.message}`)
        .join('; ')}`,
    });
  }
  return ok(parsed.data);
}

/**
 * Map a 0-100 composite onto the P-325 rubric's 1-5 scale, so the two can be
 * compared side by side (the AC's "compatible with the P-325 rubric").
 */
export function compositeToRubricScore(composite: number): 1 | 2 | 3 | 4 | 5 {
  if (composite >= 80) return 5;
  if (composite >= 60) return 4;
  if (composite >= 40) return 3;
  if (composite >= 20) return 2;
  return 1;
}
