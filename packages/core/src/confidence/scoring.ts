// P-349 — the composite scoring model.
//
// P-346 shipped the schema and a PROVISIONAL weight set; this module finalizes
// the weighting, names the rationale for every weight, and exposes the two
// functions the phase asks for: `computeComposite()` and `explain()`.
//
// There is exactly ONE default set in the tree — confidence/schema.ts's
// `DEFAULT_CONFIDENCE_WEIGHTS`, re-exported here as DEFAULT_COMPOSITE_WEIGHTS —
// because two competing "defaults" would make the score depend on which door
// you came in. The composite itself is always computed by the P-346 module
// (`compositeScore`), never re-derived here, so the explanation and the number
// can never disagree.

import { err, ok, type Result } from 'neverthrow';
import type { StitchError } from '../result/index.js';
import {
  compositeScore,
  compositeToRubricScore,
  DEFAULT_CONFIDENCE_WEIGHTS,
  type ConfidenceComponent,
  type ConfidenceComponentScores,
  type ConfidenceWeights,
} from './schema.js';

/** The finalized default weights (P-349): the single source is ./schema.js. */
export const DEFAULT_COMPOSITE_WEIGHTS: ConfidenceWeights = DEFAULT_CONFIDENCE_WEIGHTS;

/** The tolerance the weights must sum to 1 within. */
export const COMPOSITE_WEIGHT_SUM_TOLERANCE = 1e-6;

/**
 * Why each weight is what it is (P-349 step 3).
 *
 * This is the machine-readable half of the ADR-158 rationale: the same
 * sentences appear in DECISIONS.md and in `explain()`'s output, so a reader
 * never has to choose between the doc and the code.
 */
export const COMPOSITE_WEIGHT_RATIONALE: Readonly<Record<ConfidenceComponent, string>> = {
  sandbox_pass: 'the outcome proxy: a proposal that does not build is not a proposal',
  self_confidence: "the agent's own second read of its diff",
  resolver_confidence: 'the technical correctness of the imports the change rests on',
  license_risk: 'the compliance exposure, scored as its complement (less risk scores higher)',
  test_coverage: 'the regression safety the change carries with it',
};

/** The order the five factors are explained in (largest weight first). */
export const COMPOSITE_FACTOR_ORDER: readonly ConfidenceComponent[] = [
  'sandbox_pass',
  'self_confidence',
  'resolver_confidence',
  'license_risk',
  'test_coverage',
];

/**
 * Validate a weight set: every weight a finite non-negative number and the sum
 * within COMPOSITE_WEIGHT_SUM_TOLERANCE of 1.
 *
 * An unusable set is a CONFIG_ERROR (field 'confidence.weights') rather than a
 * silently different score: a number nobody can reproduce is worse than an
 * error.
 */
export function normalizeCompositeWeights(
  weights?: ConfidenceWeights
): Result<ConfidenceWeights, StitchError> {
  const candidate = weights ?? DEFAULT_COMPOSITE_WEIGHTS;
  const entries = COMPOSITE_FACTOR_ORDER.map((component): [ConfidenceComponent, number] => [
    component,
    candidate[component],
  ]);
  for (const [component, value] of entries) {
    if (!Number.isFinite(value) || value < 0) {
      return err({
        code: 'CONFIG_ERROR',
        field: 'confidence.weights',
        message: `the ${component} weight must be a finite non-negative number, got ${String(value)}`,
      });
    }
  }
  const sum = entries.reduce((total, [, value]) => total + value, 0);
  if (Math.abs(sum - 1) > COMPOSITE_WEIGHT_SUM_TOLERANCE) {
    return err({
      code: 'CONFIG_ERROR',
      field: 'confidence.weights',
      message: `the weights must sum to 1, got ${sum.toFixed(6)}`,
    });
  }
  return ok(candidate);
}

/**
 * The composite score, 0-100.
 *
 * The weights are validated first, then the P-346 module computes the number
 * (the license complement and the sandbox 0/1 -> x100 normalisation live there).
 */
export function computeComposite(
  components: ConfidenceComponentScores,
  weights?: ConfidenceWeights
): Result<number, StitchError> {
  const normalized = normalizeCompositeWeights(weights);
  if (normalized.isErr()) return err(normalized.error);
  return compositeScore(components, normalized.value);
}

/** The normalised 0-100 value a factor contributes before its weight. */
function factorValue(
  component: ConfidenceComponent,
  components: ConfidenceComponentScores
): number {
  if (component === 'sandbox_pass') return components.sandbox_pass === 1 ? 100 : 0;
  if (component === 'license_risk') return 100 - components.license_risk;
  return components[component];
}

/**
 * A human-readable breakdown of the composite (P-349 step 4).
 *
 * The spec names `explain(score)`; a bare number cannot be decomposed, so the
 * function takes the INPUTS of the score and prints every factor, its
 * normalised value, its weight, its contribution, the weighted sum, the
 * rounded composite and the P-325 rubric band. The total always comes from
 * `computeComposite`, so the printed number and the reported one agree.
 */
export function explain(
  components: ConfidenceComponentScores,
  weights?: ConfidenceWeights
): Result<string, StitchError> {
  const normalized = normalizeCompositeWeights(weights);
  if (normalized.isErr()) return err(normalized.error);
  const total = computeComposite(components, normalized.value);
  if (total.isErr()) return err(total.error);

  const lines: string[] = [];
  let weightedSum = 0;
  for (const component of COMPOSITE_FACTOR_ORDER) {
    const weight = normalized.value[component];
    const value = factorValue(component, components);
    const contribution = value * weight;
    weightedSum += contribution;
    const raw =
      component === 'sandbox_pass'
        ? String(components.sandbox_pass)
        : String(components[component]);
    lines.push(
      `${component}: ${raw} -> ${value.toFixed(1)} x ${(weight * 100).toFixed(0)}% = ${contribution.toFixed(2)} (${COMPOSITE_WEIGHT_RATIONALE[component]})`
    );
  }
  lines.push(`weighted sum = ${weightedSum.toFixed(2)} -> composite ${String(total.value)}/100`);
  lines.push(
    `rubric band ${String(compositeToRubricScore(total.value))}/5 (P-325: wiring, unnecessary changes, patterns)`
  );
  return ok(lines.join('\n'));
}
