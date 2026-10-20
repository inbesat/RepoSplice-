// P-327 — the baseline metrics and the GO/NO-GO decision.
//
// The numbers the roadmap gates on: the build-pass rate, the human-rubric
// average and the resolve rate (a pair that builds AND whose rubric average
// is at least 4). The decision rule follows the spec: when the
// import-resolution failures are one of the top-2 failure categories the
// cross-language work (Epic 17) is warranted; otherwise it is not.
//
// The metrics are computed from the harness result files, so the same code
// scores a dry run and the real 20-pair run. A pair that carries no rating
// is NOT scored: the rubric average stays null and the decision stays
// 'pending' rather than pretending a number nobody gave.

import { meanScore, semanticRubricSchema } from './rubric.js';

/** The GO/NO-GO verdict for the cross-language epic. */
export type BaselineDecision = 'go' | 'no-go' | 'pending';

/** The preliminary failure taxonomy (P-331 formalizes it). */
export type FailureCategory = 'resolution' | 'build' | 'test' | 'license' | 'timeout' | 'other';

/** One corpus pair as the metrics see it. */
export interface BaselineInput {
  readonly pair_id: string;
  readonly status: string;
  readonly build_pass: boolean | null;
  readonly error_code: string | null;
  /** The raw rubric objects (validated here; an invalid one is ignored). */
  readonly ratings: readonly unknown[];
}

/** One pair inside the computed metrics. */
export interface BaselinePair {
  readonly pair_id: string;
  readonly status: string;
  readonly build_pass: boolean | null;
  readonly rubric_avg: number | null;
  readonly ratings: number;
  readonly resolved: boolean;
  readonly error_code: string | null;
  readonly category: FailureCategory | null;
}

/** The computed baseline. */
export interface BaselineMetrics {
  readonly version: 1;
  readonly generated_at: string;
  readonly pairs: number;
  readonly rated: number;
  readonly build_pass_count: number;
  readonly build_pass_rate: number;
  readonly rubric_avg: number | null;
  readonly resolved_count: number;
  readonly resolve_rate: number;
  readonly decision: BaselineDecision;
  readonly reasons: readonly string[];
  readonly categories: Readonly<Record<FailureCategory, number>>;
  readonly per_pair: readonly BaselinePair[];
}

/** The rubric average a pair needs to count as resolved. */
export const RESOLVE_RUBRIC_THRESHOLD = 4;

/** The error codes that mean "the merge could not be wired up". */
const RESOLUTION_CODES: readonly string[] = [
  'DEPENDENCY_CONFLICT',
  'IMPORT_RESOLUTION',
  'RESOLUTION_ERROR',
  'UNRESOLVED_IMPORT',
];

/** The error codes that mean "the sandbox could not build the merged tree". */
const BUILD_CODES: readonly string[] = [
  'DOCKER_BUILD_FAILED',
  'BUILD_ERROR',
  'DOCKER_ERROR',
  'DEP_INSTALL_FAILED',
];

/** The error codes that mean "the build worked, the tests did not". */
const TEST_CODES: readonly string[] = ['SANDBOX_FAILED', 'TEST_ERROR'];

/** The error codes that mean "the license policy stopped it". */
const LICENSE_CODES: readonly string[] = [
  'LICENSE_VIOLATION',
  'COMPLIANCE_VIOLATION',
  'UNKNOWN_LICENSE',
];

/** The error codes that mean "it ran out of time". */
const TIMEOUT_CODES: readonly string[] = ['SANDBOX_TIMEOUT', 'TIMEOUT'];

/** Map one error code onto the preliminary taxonomy. */
export function categoryFor(errorCode: string | null): FailureCategory | null {
  if (errorCode === null) return null;
  if (RESOLUTION_CODES.includes(errorCode)) return 'resolution';
  if (BUILD_CODES.includes(errorCode)) return 'build';
  if (TEST_CODES.includes(errorCode)) return 'test';
  if (LICENSE_CODES.includes(errorCode)) return 'license';
  if (TIMEOUT_CODES.includes(errorCode)) return 'timeout';
  return 'other';
}

/** The rubric average of one pair (the mean over the raters' means). */
function rubricAverage(ratings: readonly unknown[]): { avg: number | null; count: number } {
  const scores: number[] = [];
  for (const rating of ratings) {
    const parsed = semanticRubricSchema.safeParse(rating);
    if (!parsed.success) continue;
    scores.push(meanScore(parsed.data));
  }
  if (scores.length === 0) return { avg: null, count: 0 };
  const total = scores.reduce((sum, score) => sum + score, 0);
  return { avg: Math.round((total / scores.length) * 10) / 10, count: scores.length };
}

function rate(part: number, whole: number): number {
  if (whole === 0) return 0;
  return Math.round((part / whole) * 10000) / 10000;
}

/**
 * Compute the baseline from the per-pair results.
 *
 * The decision: the cross-language epic is warranted when the
 * import-resolution failures are one of the two biggest failure categories
 * AND at least one pair carries a rating. With no ratings at all the
 * decision stays 'pending' — the numbers nobody scored cannot decide it.
 */
export function computeBaseline(
  inputs: readonly BaselineInput[],
  options?: { readonly now?: () => string }
): BaselineMetrics {
  const now = options?.now ?? (() => new Date().toISOString());
  const categories: Record<FailureCategory, number> = {
    resolution: 0,
    build: 0,
    test: 0,
    license: 0,
    timeout: 0,
    other: 0,
  };
  const perPair: BaselinePair[] = [];
  let buildPassCount = 0;
  let resolvedCount = 0;
  let rated = 0;
  const rubricTotals: number[] = [];

  for (const input of inputs) {
    const { avg, count } = rubricAverage(input.ratings);
    if (avg !== null) {
      rated += 1;
      rubricTotals.push(avg);
    }
    if (input.build_pass === true) buildPassCount += 1;
    const resolved = input.build_pass === true && avg !== null && avg >= RESOLVE_RUBRIC_THRESHOLD;
    if (resolved) resolvedCount += 1;
    const failed = input.build_pass !== true;
    const category = failed ? (categoryFor(input.error_code) ?? 'other') : null;
    if (category !== null) categories[category] += 1;
    perPair.push({
      pair_id: input.pair_id,
      status: input.status,
      build_pass: input.build_pass,
      rubric_avg: avg,
      ratings: count,
      resolved,
      error_code: input.error_code,
      category,
    });
  }

  const pairs = inputs.length;
  const rubricAvg =
    rubricTotals.length === 0
      ? null
      : Math.round(
          (rubricTotals.reduce((sum, value) => sum + value, 0) / rubricTotals.length) * 10
        ) / 10;

  const ranked = (Object.entries(categories) as [FailureCategory, number][])
    .filter(([, count]) => count > 0)
    .sort((left, right) =>
      right[1] === left[1] ? left[0].localeCompare(right[0]) : right[1] - left[1]
    );
  const reasons: string[] = [];
  let decision: BaselineDecision = 'pending';
  if (rated === 0) {
    reasons.push('no pair carries a human rating - the decision stays pending');
  } else {
    const topTwo = ranked.slice(0, 2).map(([category]) => category);
    decision = topTwo.includes('resolution') ? 'go' : 'no-go';
    reasons.push(
      `failure categories: ${ranked.length === 0 ? 'none' : ranked.map(([category, count]) => `${category}=${count}`).join(', ')}`
    );
    reasons.push(
      decision === 'go'
        ? 'import-resolution failures are in the top two categories - the cross-language epic is warranted'
        : 'import-resolution failures are not in the top two categories - the cross-language epic is not warranted'
    );
  }

  return {
    version: 1,
    generated_at: now(),
    pairs,
    rated,
    build_pass_count: buildPassCount,
    build_pass_rate: rate(buildPassCount, pairs),
    rubric_avg: rubricAvg,
    resolved_count: resolvedCount,
    resolve_rate: rate(resolvedCount, pairs),
    decision,
    reasons,
    categories,
    per_pair: perPair,
  };
}
