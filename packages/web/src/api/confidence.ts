// P-352 — Web: the confidence wire contract.
//
// The core pipeline (the P-346 schema, the P-347 self-critique, the P-348 tool and the P-349
// weights) produces the composite score, its five factors and its flags. The web reads that
// shape and — like every other module in api/ — declares it LOCALLY: the web tsconfig rootDir
// cannot import the core barrel (the P-218 evidence recorded in deps.ts), and the client only
// ever sees the serialized shape anyway.

/** The five factors the composite is folded from. */
export interface ConfidenceComponents {
  readonly sandbox_pass?: number;
  readonly self_confidence?: number;
  readonly resolver_confidence?: number;
  readonly license_risk?: number;
  readonly test_coverage?: number;
}

/** One file's confidence as the UI renders it. */
export interface ConfidenceView {
  readonly score: number;
  readonly flags?: readonly string[];
  readonly components?: ConfidenceComponents;
  readonly rationale?: string;
}

/**
 * Read a confidence value the server sent, defensively.
 *
 * The wire may name the score `score` or core's `composite_score`; anything unusable yields
 * `undefined` (the UI renders the honest 'N/A' state) rather than a silent zero.
 */
export function parseConfidence(value: unknown): ConfidenceView | undefined {
  if (value === null || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  const score = record['score'] ?? record['composite_score'];
  if (typeof score !== 'number' || !Number.isFinite(score)) return undefined;
  const components = record['components'];
  return {
    score,
    ...(Array.isArray(record['flags'])
      ? { flags: record['flags'].filter((flag): flag is string => typeof flag === 'string') }
      : {}),
    ...(components !== null && typeof components === 'object'
      ? { components: components as ConfidenceComponents }
      : {}),
    ...(typeof record['rationale'] === 'string' ? { rationale: record['rationale'] } : {}),
  };
}
