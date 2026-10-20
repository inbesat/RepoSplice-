// P-323 — the eval harness wire types.
//
// The pair schema is NOT redefined here: the P-320 contract (ADR-128) stays
// the single source of truth and is re-exported for the runner and the CLI.
//
// The result fields are the ones the spec lists: pair_id, build_pass,
// rubric_score, resolve_rate, tokens, cost, duration. The scoring fields
// (build_pass, rubric_score, resolve_rate) stay NULL until the scoring phase
// (P-324) and the rubric (P-325) can fill them — null means "not scored",
// never "scored as zero".

import { z } from 'zod';
import { evalPairSchema } from './schema.js';

export { evalPairSchema };
export type { EvalPair } from './schema.js';

/** How a single pair finished. */
export const EVAL_STATUSES = ['succeeded', 'failed'] as const;

/** The per-pair result the runner writes to `<output-dir>/<pair_id>.json`. */
export const evalResultSchema = z.looseObject({
  pair_id: z.string().min(1),
  status: z.enum(EVAL_STATUSES),
  build_pass: z.boolean().nullable(),
  rubric_score: z.number().min(1).max(5).nullable(),
  resolve_rate: z.number().min(0).max(1).nullable(),
  tokens: z.number().int().nonnegative(),
  cost: z.number().nonnegative(),
  duration: z.number().nonnegative(),
  error_code: z.string().nullable(),
  error_message: z.string().nullable(),
});
export type EvalResult = z.infer<typeof evalResultSchema>;

/** The runner configuration (the CLI flags map onto these fields). */
export const evalConfigSchema = z.looseObject({
  corpus: z.string().min(1),
  output_dir: z.string().min(1),
  parallel: z.number().int().min(1).max(16),
  timeout_ms: z.number().int().positive(),
});
export type EvalConfig = z.infer<typeof evalConfigSchema>;

/** The run summary the runner writes to `<output-dir>/summary.json`. */
export const evalRunSummarySchema = z.looseObject({
  pairs: z.number().int().nonnegative(),
  succeeded: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  parallel: z.number().int().min(1),
  max_concurrency: z.number().int().nonnegative(),
  results: z.array(evalResultSchema),
});
export type EvalRunSummary = z.infer<typeof evalRunSummarySchema>;

/** The JSON Schema for one result — emitted as eval/corpus/result-schema.json. */
export function evalResultJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(evalResultSchema, {
    target: 'draft-2020-12',
    unrepresentable: 'any',
  }) as Record<string, unknown>;
}
