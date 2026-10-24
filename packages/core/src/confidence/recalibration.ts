// P-355 — the prompt/weight recalibration loop.
//
// P-354 measures how well the agent's self-reported confidence tracks the human
// rubric. When that correlation is weak the loop here iterates candidate
// variants (a prompt revision, a re-weighted composite, or a monotone re-mapping
// of the self scores), re-measures each one, and freezes the first variant that
// clears the threshold — or documents the best-so-far as a limitation when none
// does, which is what leaves the P-350 human-review threshold carrying the load.
//
// When the baseline already clears the bar (P-354 measured Spearman 0.9848 over
// the recorded set) the honest answer is that NO recalibration is needed: the
// loop runs zero attempts and freezes the baseline it measured.
//
// A pure leaf: neverthrow + the StitchError type + the P-349 scoring types + the
// P-354 calibration maths. It changes no prompt and no weight by itself.

import { err, ok, type Result } from 'neverthrow';
import type { StitchError } from '../result/index.js';
import {
  CALIBRATION_CORRELATION_THRESHOLD,
  pearson,
  spearman,
  type CalibrationSample,
} from './calibration.js';
import { DEFAULT_COMPOSITE_WEIGHTS, normalizeCompositeWeights } from './scoring.js';
import type { ConfidenceWeights } from './schema.js';

/** The spec's cap: after this many attempts a weak correlation is a limitation. */
export const RECALIBRATION_MAX_ITERATIONS = 5;

/** The recalibration error field (reuses the calibration code). */
export const RECALIBRATION_ERROR_FIELD = 'confidence.recalibration';

/** How the loop ended. */
export type RecalibrationDecision = 'validated' | 'recalibrated' | 'limited';

/** A candidate the loop may try when the baseline is weak. */
export interface RecalibrationVariant {
  /** A short label for the log. */
  readonly label: string;
  /** The candidate prompt version, when the axis is the prompt. */
  readonly promptVersion?: string;
  /** The candidate composite weights, when the axis is the weighting. */
  readonly weights?: ConfidenceWeights;
  /** A monotone re-mapping applied to each sample's self confidence. */
  readonly transform?: (value: number) => number;
}

/** The version pair the loop starts from and may freeze. */
export interface RecalibrationBaseline {
  /** The self-critique prompt's content hash (promptVersion('self-critique')). */
  readonly promptVersion: string;
  /** The composite weights in force. */
  readonly weights: ConfidenceWeights;
}

/** One measured attempt. */
export interface RecalibrationAttempt {
  readonly iteration: number;
  readonly label: string;
  readonly promptVersion: string;
  readonly weights: ConfidenceWeights;
  readonly pearson: number | null;
  readonly spearman: number | null;
  readonly meets: boolean;
  readonly improved: boolean;
}

/** The version pair the loop froze, with the measurement that justifies it. */
export interface RecalibrationFrozen {
  readonly promptVersion: string;
  readonly weights: ConfidenceWeights;
  readonly pearson: number | null;
  readonly spearman: number | null;
}

/** The measured view of the starting point. */
export interface RecalibrationBaselineMeasurement {
  readonly promptVersion: string;
  readonly weights: ConfidenceWeights;
  readonly pearson: number | null;
  readonly spearman: number | null;
  readonly meets: boolean;
}

export interface RecalibrationReport {
  readonly version: 1;
  readonly kind: 'recalibration-report';
  readonly generatedAt: string;
  readonly threshold: number;
  readonly samples: number;
  readonly maxIterations: number;
  readonly decision: RecalibrationDecision;
  readonly baseline: RecalibrationBaselineMeasurement;
  readonly attempts: readonly RecalibrationAttempt[];
  readonly frozen: RecalibrationFrozen;
  readonly reason: string;
}

export interface RecalibrationOptions {
  readonly baseline: RecalibrationBaseline;
  /** The candidates to try, in order, when the baseline is weak. */
  readonly variants?: readonly RecalibrationVariant[];
  readonly threshold?: number;
  readonly maxIterations?: number;
  readonly now?: () => Date;
}

/** The correlation of a sample set, optionally through a re-mapping. */
export interface SampleMeasurement {
  readonly pearson: number | null;
  readonly spearman: number | null;
}

function finite(value: number): boolean {
  return Number.isFinite(value);
}

/** Measure one sample set, mapping the self scores through `transform`. */
export function measureCorrelation(
  samples: readonly CalibrationSample[],
  transform?: (value: number) => number
): SampleMeasurement {
  const self: number[] = [];
  const human: number[] = [];
  for (const sample of samples) {
    if (!finite(sample.selfConfidence) || !finite(sample.humanRubric)) continue;
    self.push(transform === undefined ? sample.selfConfidence : transform(sample.selfConfidence));
    human.push(sample.humanRubric);
  }
  return {
    pearson: pearson(self, human) ?? null,
    spearman: spearman(self, human) ?? null,
  };
}

/**
 * Run the recalibration loop: measure, try the candidates, freeze the answer.
 *
 * The decision is 'validated' when the baseline already clears the threshold
 * (zero attempts), 'recalibrated' when a candidate clears it, and 'limited'
 * when none does after `maxIterations` — the last case names the P-350
 * human-review fallback in its reason instead of pretending to a fix.
 */
export function runRecalibration(
  samples: readonly CalibrationSample[],
  options: RecalibrationOptions
): Result<RecalibrationReport, StitchError> {
  const usable = samples.filter(
    sample => finite(sample.selfConfidence) && finite(sample.humanRubric)
  );
  if (usable.length < 2) {
    return err({
      code: 'CONFIG_ERROR',
      field: RECALIBRATION_ERROR_FIELD,
      message: `recalibration needs at least two usable samples, got ${usable.length}`,
    });
  }

  const threshold = options.threshold ?? CALIBRATION_CORRELATION_THRESHOLD;
  const maxIterations = options.maxIterations ?? RECALIBRATION_MAX_ITERATIONS;
  const generatedAt = (options.now ?? (() => new Date()))().toISOString();
  const start = options.baseline;

  const measured = measureCorrelation(usable);
  const baselineMeets = measured.spearman !== null && measured.spearman >= threshold;
  const baseline: RecalibrationBaselineMeasurement = {
    promptVersion: start.promptVersion,
    weights: start.weights,
    pearson: measured.pearson,
    spearman: measured.spearman,
    meets: baselineMeets,
  };

  const base = {
    version: 1 as const,
    kind: 'recalibration-report' as const,
    generatedAt,
    threshold,
    samples: usable.length,
    maxIterations,
  };

  if (baselineMeets) {
    return ok({
      ...base,
      decision: 'validated',
      baseline,
      attempts: [],
      frozen: {
        promptVersion: start.promptVersion,
        weights: start.weights,
        pearson: measured.pearson,
        spearman: measured.spearman,
      },
      reason:
        `No recalibration is needed: the baseline correlates at ` +
        `${measured.spearman === null ? 'null' : measured.spearman.toFixed(4)}, at or above the ` +
        `${threshold} threshold, so the current prompt version and weights are frozen as validated.`,
    });
  }

  const attempts: RecalibrationAttempt[] = [];
  let best: RecalibrationFrozen = {
    promptVersion: start.promptVersion,
    weights: start.weights,
    pearson: measured.pearson,
    spearman: measured.spearman,
  };
  let bestSpearman = measured.spearman;

  const variants = options.variants ?? [];
  for (let index = 0; index < Math.min(variants.length, maxIterations); index += 1) {
    const variant = variants[index];
    if (variant === undefined) break;
    const candidateWeights = variant.weights ?? start.weights;
    const normalized = normalizeCompositeWeights(candidateWeights);
    if (normalized.isErr()) {
      return err(normalized.error);
    }
    const candidate = measureCorrelation(usable, variant.transform);
    const meets = candidate.spearman !== null && candidate.spearman >= threshold;
    attempts.push({
      iteration: index + 1,
      label: variant.label,
      promptVersion: variant.promptVersion ?? start.promptVersion,
      weights: normalized.value,
      pearson: candidate.pearson,
      spearman: candidate.spearman,
      meets,
      improved:
        candidate.spearman !== null && (bestSpearman === null || candidate.spearman > bestSpearman),
    });
    if (
      candidate.spearman !== null &&
      (bestSpearman === null || candidate.spearman > bestSpearman)
    ) {
      bestSpearman = candidate.spearman;
      best = {
        promptVersion: variant.promptVersion ?? start.promptVersion,
        weights: normalized.value,
        pearson: candidate.pearson,
        spearman: candidate.spearman,
      };
    }
    if (meets) {
      return ok({
        ...base,
        decision: 'recalibrated',
        baseline,
        attempts,
        frozen: best,
        reason:
          `Recalibrated on attempt ${attempts.length} ('${variant.label}'): the correlation rose ` +
          `from ${measured.spearman === null ? 'null' : measured.spearman.toFixed(4)} to ` +
          `${candidate.spearman === null ? 'null' : candidate.spearman.toFixed(4)}, clearing the ` +
          `${threshold} threshold. This version pair is frozen.`,
      });
    }
  }

  return ok({
    ...base,
    decision: 'limited',
    baseline,
    attempts,
    frozen: best,
    reason:
      `No candidate cleared the ${threshold} threshold in ${attempts.length} of ` +
      `${maxIterations} allowed attempts; the best measured correlation is ` +
      `${bestSpearman === null ? 'null' : bestSpearman.toFixed(4)}. This is documented as a known ` +
      `limitation and the P-350 human-review threshold carries the load instead of an auto-approval.`,
  });
}

/** The default baseline: the self-critique prompt plus the finalized weights. */
export function defaultRecalibrationBaseline(promptVersion: string): RecalibrationBaseline {
  return { promptVersion, weights: DEFAULT_COMPOSITE_WEIGHTS };
}
