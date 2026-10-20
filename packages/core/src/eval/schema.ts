// P-320 — the eval corpus metadata contract.
//
// Every corpus entry (a repo pair, the subdirectories to extract, the pinned
// commits, the ecosystem, the licenses and the human-annotated expected
// outcome) is described by `EvalPair`. The corpus runner (P-323), the SHA
// verifier (P-322) and the reporting (P-329) all read this shape.
//
// The object is LOOSE (unknown keys pass through) so a later corpus
// expansion (P-332) can add fields without invalidating older manifests.
//
// LEAF MODULE: zod only, no core imports — the contract must never drag the
// db/ai layers along.

import { z } from 'zod';

/** Ecosystems the corpus covers. */
export const EVAL_ECOSYSTEMS = ['js', 'python', 'go', 'rust'] as const;

/** The outcome a human annotator expects for a pair. */
export const EVAL_OUTCOMES = ['clean', 'conflicts', 'license_block', 'semantic_drift'] as const;

/** A pinned git commit: 40 lowercase hex characters. */
const SHA40 = /^[0-9a-f]{40}$/;

/** An SPDX license identifier (the short form, e.g. `MIT`, `Apache-2.0`). */
const SPDX = /^[A-Za-z0-9][A-Za-z0-9.+-]*$/;

/** One corpus entry. Unknown extra fields are preserved (P-332 expansion). */
export const evalPairSchema = z.looseObject({
  pair_id: z.string().min(1),
  repo_a_url: z.string().min(1),
  repo_b_url: z.string().min(1),
  repo_a_sha: z.string().regex(SHA40, 'repo_a_sha must be 40 lowercase hex characters'),
  repo_b_sha: z.string().regex(SHA40, 'repo_b_sha must be 40 lowercase hex characters'),
  extract_paths_a: z.array(z.string().min(1)),
  extract_paths_b: z.array(z.string().min(1)),
  ecosystem: z.enum(EVAL_ECOSYSTEMS),
  license_a: z.string().regex(SPDX, 'license_a must be an SPDX identifier'),
  license_b: z.string().regex(SPDX, 'license_b must be an SPDX identifier'),
  expected_outcome: z.enum(EVAL_OUTCOMES),
});

/** One corpus entry, typed. */
export type EvalPair = z.infer<typeof evalPairSchema>;

/** Stable identity of the emitted JSON Schema document. */
export const EVAL_PAIR_SCHEMA_ID = 'https://github.com/inbesat/RepoSplice-/eval/corpus/schema.json';

/**
 * The JSON Schema for the corpus contract, generated from zod (zod 4 ships
 * `toJSONSchema` natively — no extra dependency). The shapes used here
 * (object/string/array, enum, pattern, minItems/minLength) are exactly what
 * `eval/scripts/validate_corpus.py` can read with the standard library only.
 */
export function evalPairJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(evalPairSchema, {
    target: 'draft-2020-12',
    unrepresentable: 'any',
  }) as Record<string, unknown>;
}
