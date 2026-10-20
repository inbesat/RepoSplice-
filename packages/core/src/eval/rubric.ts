// P-325 — the human rubric for merge quality beyond build-pass.
//
// Build-pass (P-324) says the merged tree compiles; the rubric says whether
// the merge is any GOOD: are the two sides actually wired together, did the
// agent make gratuitous edits, and does the result still look like the
// codebase it came from. Each dimension is scored 1-5 by a human rater and
// the notes field carries the qualitative reason.
//
// The object is LOOSE (unknown keys pass through) so a later rubric
// expansion (P-326/P-327) can add fields without invalidating older
// worksheets.
//
// LEAF MODULE: zod only, no core imports — the contract must never drag the
// db/ai layers along.

import { z } from 'zod';

/** The scored dimensions, in the order they are reported. */
export const RUBRIC_DIMENSIONS = [
  'wiring_correctness',
  'unnecessary_changes',
  'respects_patterns',
] as const;

/** One scored dimension. */
export type RubricDimension = (typeof RUBRIC_DIMENSIONS)[number];

/** A 1-5 score (0 and 6 are rejected). */
const SCORE = z.number().int().min(1).max(5);

/**
 * One rater's verdict on one corpus pair. `pair_id` ties the verdict to a
 * corpus entry; `rater` identifies who scored it.
 */
export const semanticRubricSchema = z.looseObject({
  pair_id: z.string().min(1),
  rater: z.string().min(1),
  wiring_correctness: SCORE,
  unnecessary_changes: SCORE,
  respects_patterns: SCORE,
  notes: z.string(),
});

/** One rater's verdict, typed. */
export type SemanticRubric = z.infer<typeof semanticRubricSchema>;

/** Two raters' verdicts on the SAME pair — one observation of the trial. */
export interface RubricPair {
  readonly a: SemanticRubric;
  readonly b: SemanticRubric;
}

/**
 * The aggregate 1-5 score of a rubric (the mean of the three dimensions,
 * one decimal). This is the value that binds to an eval result's
 * `rubric_score`.
 */
export function meanScore(rubric: SemanticRubric): number {
  const total = RUBRIC_DIMENSIONS.reduce((sum, dimension) => sum + rubric[dimension], 0);
  return Math.round((total / RUBRIC_DIMENSIONS.length) * 10) / 10;
}

/** The per-dimension scores of one rubric, flattened for the kappa. */
function dimensionScores(rubric: SemanticRubric): number[] {
  return RUBRIC_DIMENSIONS.map(dimension => rubric[dimension]);
}

/**
 * Cohen's kappa over the PAIRED per-dimension scores of both raters.
 *
 * The trial scores 3 pairs x 3 dimensions = 9 paired observations per
 * rater. Pooling the dimensions is what makes the statistic usable at that
 * sample size: the total-score variant over 3 pairs quantizes to steps of
 * ~0.19 and a single disagreement caps it below the 0.6 threshold.
 *
 * `po` is the share of paired observations with the same score; `pe` is the
 * share expected by chance from the two raters' marginal distributions.
 * The degenerate case (both raters used a single score for every
 * observation, so `pe === 1`) returns 1 when they agreed everywhere and 0
 * otherwise — never a division by zero.
 */
export function cohensKappa(pairs: readonly RubricPair[]): number {
  const observed: number[] = [];
  const first: number[] = [];
  const second: number[] = [];
  for (const pair of pairs) {
    const a = dimensionScores(pair.a);
    const b = dimensionScores(pair.b);
    for (let index = 0; index < a.length; index += 1) {
      const left = a[index] as number;
      const right = b[index] as number;
      observed.push(left === right ? 1 : 0);
      first.push(left);
      second.push(right);
    }
  }
  if (observed.length === 0) return 0;
  const agreements = observed.reduce((sum, value) => sum + value, 0);
  const po = agreements / observed.length;
  const marginal = (scores: readonly number[]): Map<number, number> => {
    const counts = new Map<number, number>();
    for (const score of scores) counts.set(score, (counts.get(score) ?? 0) + 1);
    return counts;
  };
  const firstCounts = marginal(first);
  const secondCounts = marginal(second);
  let pe = 0;
  for (const [score, count] of firstCounts) {
    const other = secondCounts.get(score) ?? 0;
    pe += (count / first.length) * (other / second.length);
  }
  if (pe === 1) return agreements === observed.length ? 1 : 0;
  return (po - pe) / (1 - pe);
}

/** Stable identity of the emitted rubric JSON Schema document. */
export const RUBRIC_SCHEMA_ID = 'https://github.com/inbesat/RepoSplice-/eval/rubric/schema.json';

/**
 * The JSON Schema for the rubric contract, generated from zod (zod 4 ships
 * `toJSONSchema` natively — no extra dependency).
 */
export function semanticRubricJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(semanticRubricSchema, {
    target: 'draft-2020-12',
    unrepresentable: 'any',
  }) as Record<string, unknown>;
}
