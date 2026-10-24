// P-354 — the calibration check: does the agent's self-reported confidence agree
// with the human rubric?
//
// The spec asks for the Pearson AND Spearman correlation between the self-confidence
// scores the agent produced (P-347/P-348) and the human rubric averages (P-326) over
// the Epic 16 corpus (P-327). Two honesty rules drive the shape of this module:
//
//   * A coefficient that cannot be computed is NOT zero. A constant series, or fewer
//     than two samples, has no correlation at all, so the report carries `null` there
//     and says so, rather than inventing a number that would look like a finding.
//   * A missing measurement is never a zero. When the coefficient is unknown the
//     `critical` flag is `null` too, so "we could not tell" can never be reported as
//     "not critical".
//
// The maths is a pure leaf: no filesystem, no logger, no other core service. The rank
// implementation is the one the P-347 harness proved (average ranks, so tied scores do
// not distort the coefficient); it lives here now so the product owns it.

import { err, ok, type Result } from 'neverthrow';
import type { StitchError } from '../result/index.js';

/** A correlation this weak (or weaker) is a critical finding and triggers P-355. */
export const CALIBRATION_CORRELATION_THRESHOLD = 0.5;

/** The field every calibration error carries. */
export const CALIBRATION_ERROR_FIELD = 'confidence.calibration';

/** Which correlation the report treats as the primary signal. */
export type CalibrationPrimary = 'spearman';

/** How many samples a bucket needs before its coefficient is worth reading. */
export interface CalibrationSample {
  /** The proposal (or case) the score belongs to. */
  readonly id: string;
  /** The agent's self-reported confidence, 0-100. */
  readonly selfConfidence: number;
  /** The human rubric mean, 1-5 (the P-325 dimensions). */
  readonly humanRubric: number;
  /** The ecosystem the proposal belongs to, when it is known. */
  readonly ecosystem?: string;
}

/** One point of the scatter data. */
export interface CalibrationScatterPoint {
  readonly id: string;
  readonly selfConfidence: number;
  /** The human rubric mean exactly as recorded (1-5). */
  readonly humanRubric: number;
  /** The same score on the 0-100 scale, so it can sit beside the self score. */
  readonly humanConfidence: number;
}

/** The per-ecosystem slice of the check. */
export interface CalibrationEcosystemStats {
  readonly ecosystem: string;
  readonly samples: number;
  /** null when the bucket has too few samples or no variance. */
  readonly pearson: number | null;
  readonly spearman: number | null;
}

export interface CalibrationReport {
  readonly version: 1;
  readonly kind: 'calibration-report';
  readonly generatedAt: string;
  /** Where the samples came from (an artifact path, or 'inline'). */
  readonly source: string;
  /** 'recorded-reference-set' while the live corpus run is still deferred. */
  readonly set: string;
  readonly samples: number;
  readonly threshold: number;
  readonly primary: CalibrationPrimary;
  readonly pearson: number | null;
  readonly spearman: number | null;
  /** null when the coefficient could not be computed. */
  readonly critical: boolean | null;
  /** The P-355 trigger: true only when a computed coefficient is below the bar. */
  readonly requiresRecalibration: boolean;
  readonly scatter: readonly CalibrationScatterPoint[];
  readonly perEcosystem: readonly CalibrationEcosystemStats[];
  /** The honest statement of what was and was not measured. */
  readonly provenance: string;
}

export interface CalibrationReportOptions {
  /** The artifact the samples came from. */
  readonly source?: string;
  /** The label for the set (the default names the recorded reference set). */
  readonly set?: string;
  /** An injectable clock, so the report stays reproducible in tests. */
  readonly now?: () => Date;
  /** Overrides the threshold (the default is CALIBRATION_CORRELATION_THRESHOLD). */
  readonly threshold?: number;
}

/**
 * Average ranks, so ties do not distort the coefficient.
 * `[10, 10, 30]` ranks as `[1.5, 1.5, 3]`, not `[1, 2, 3]`.
 */
export function ranks(values: readonly number[]): number[] {
  const order = values
    .map((value, index) => ({ value, index }))
    .sort((left, right) => left.value - right.value);
  const ranked = new Array<number>(values.length).fill(0);
  let position = 0;
  while (position < order.length) {
    let end = position;
    while (end + 1 < order.length && order[end + 1]?.value === order[position]?.value) {
      end += 1;
    }
    // Ranks are 1-based; a tie group shares the mean of the positions it spans.
    const average = (position + end) / 2 + 1;
    for (let cursor = position; cursor <= end; cursor += 1) {
      const entry = order[cursor];
      if (entry !== undefined) ranked[entry.index] = average;
    }
    position = end + 1;
  }
  return ranked;
}

/**
 * Pearson's product-moment coefficient.
 *
 * Returns undefined when it is not defined: a length mismatch, fewer than two
 * samples, or a zero-variance series (the denominator would be 0/0).
 */
export function pearson(first: readonly number[], second: readonly number[]): number | undefined {
  if (first.length !== second.length || first.length < 2) return undefined;
  const count = first.length;
  const meanFirst = first.reduce((total, value) => total + value, 0) / count;
  const meanSecond = second.reduce((total, value) => total + value, 0) / count;
  let covariance = 0;
  let varianceFirst = 0;
  let varianceSecond = 0;
  for (let index = 0; index < count; index += 1) {
    const left = (first[index] ?? 0) - meanFirst;
    const right = (second[index] ?? 0) - meanSecond;
    covariance += left * right;
    varianceFirst += left * left;
    varianceSecond += right * right;
  }
  const denominator = Math.sqrt(varianceFirst * varianceSecond);
  if (!Number.isFinite(denominator) || denominator === 0) return undefined;
  return covariance / denominator;
}

/** Spearman's rank correlation: Pearson on the (tie-averaged) ranks. */
export function spearman(first: readonly number[], second: readonly number[]): number | undefined {
  if (first.length !== second.length || first.length < 2) return undefined;
  return pearson(ranks(first), ranks(second));
}

/** The 1-5 human rubric mean mapped onto the 0-100 scale (a linear transform). */
export function rubricToConfidence(humanRubric: number): number {
  const clamped = Math.min(5, Math.max(1, humanRubric));
  return Math.round(((clamped - 1) / 4) * 100);
}

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function meanOf(values: readonly number[]): number | undefined {
  const usable = values.filter(value => Number.isFinite(value));
  if (usable.length === 0) return undefined;
  return usable.reduce((total, value) => total + value, 0) / usable.length;
}

/**
 * Read a recorded calibration set defensively.
 *
 * The P-347 artifact stores `self.self_confidence` (0-100) and the three human
 * dimensions (1-5); a sample is kept only when both sides are usable, so a malformed
 * or partially-filled artifact shrinks the set instead of poisoning the coefficient.
 */
export function parseCalibrationSet(value: unknown): CalibrationSample[] {
  if (value === null || typeof value !== 'object') return [];
  const cases = (value as { cases?: unknown }).cases;
  if (!Array.isArray(cases)) return [];
  const samples: CalibrationSample[] = [];
  for (const entry of cases) {
    if (entry === null || typeof entry !== 'object') continue;
    const record = entry as {
      id?: unknown;
      ecosystem?: unknown;
      self?: { self_confidence?: unknown } | null;
      human?: {
        wiring_correctness?: unknown;
        unnecessary_changes?: unknown;
        respects_patterns?: unknown;
      } | null;
    };
    const id = typeof record.id === 'string' ? record.id : undefined;
    const selfConfidence = finite(record.self?.self_confidence);
    const human = record.human ?? {};
    const humanRubric = meanOf(
      [human.wiring_correctness, human.unnecessary_changes, human.respects_patterns]
        .map(dimension => finite(dimension))
        .filter((dimension): dimension is number => dimension !== undefined)
    );
    if (id === undefined || selfConfidence === undefined || humanRubric === undefined) continue;
    samples.push({
      id,
      selfConfidence,
      humanRubric,
      ...(typeof record.ecosystem === 'string' ? { ecosystem: record.ecosystem } : {}),
    });
  }
  return samples;
}

/** The per-ecosystem buckets (a single 'unassigned' bucket when no labels exist). */
function ecosystemBreakdown(
  samples: readonly CalibrationSample[]
): readonly CalibrationEcosystemStats[] {
  const buckets = new Map<string, CalibrationSample[]>();
  for (const sample of samples) {
    const key = sample.ecosystem ?? 'unassigned';
    const bucket = buckets.get(key) ?? [];
    bucket.push(sample);
    buckets.set(key, bucket);
  }
  return [...buckets.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([ecosystem, bucket]) => ({
      ecosystem,
      samples: bucket.length,
      pearson:
        pearson(
          bucket.map(sample => sample.selfConfidence),
          bucket.map(sample => sample.humanRubric)
        ) ?? null,
      spearman:
        spearman(
          bucket.map(sample => sample.selfConfidence),
          bucket.map(sample => sample.humanRubric)
        ) ?? null,
    }));
}

/**
 * Compute the calibration report for a set of samples.
 *
 * A set with fewer than two usable samples is a CONFIG_ERROR: there is no coefficient
 * to report, and an empty report would read as "no problem found".
 */
export function buildCalibrationReport(
  samples: readonly CalibrationSample[],
  options: CalibrationReportOptions = {}
): Result<CalibrationReport, StitchError> {
  const usable = samples.filter(
    sample => Number.isFinite(sample.selfConfidence) && Number.isFinite(sample.humanRubric)
  );
  if (usable.length < 2) {
    return err({
      code: 'CONFIG_ERROR',
      field: CALIBRATION_ERROR_FIELD,
      message: `a correlation needs at least two usable samples, got ${usable.length}`,
    });
  }
  const threshold = options.threshold ?? CALIBRATION_CORRELATION_THRESHOLD;
  const selfScores = usable.map(sample => sample.selfConfidence);
  const humanScores = usable.map(sample => sample.humanRubric);
  const pearsonValue = pearson(selfScores, humanScores) ?? null;
  const spearmanValue = spearman(selfScores, humanScores) ?? null;
  const critical = spearmanValue === null ? null : spearmanValue < threshold;
  return ok({
    version: 1,
    kind: 'calibration-report',
    generatedAt: (options.now ?? (() => new Date()))().toISOString(),
    source: options.source ?? 'inline',
    set: options.set ?? 'recorded-reference-set',
    samples: usable.length,
    threshold,
    primary: 'spearman',
    pearson: pearsonValue,
    spearman: spearmanValue,
    critical,
    requiresRecalibration: critical === true,
    scatter: usable.map(sample => ({
      id: sample.id,
      selfConfidence: sample.selfConfidence,
      humanRubric: sample.humanRubric,
      humanConfidence: rubricToConfidence(sample.humanRubric),
    })),
    perEcosystem: ecosystemBreakdown(usable),
    provenance:
      options.set === 'live-corpus'
        ? 'Measured over the live corpus.'
        : 'Measured over the recorded reference set, because the live Epic 16 run needs ' +
          'Docker plus an AI provider key and the human rubric ratings need raters. ' +
          'This is calibration evidence for the METHOD, not a claim that the live corpus was inspected.',
  });
}
