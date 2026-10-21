// P-331 — the failure taxonomy: what actually broke, per pair.
//
// The baseline (P-327) counted a failure; this names it. The categories are
// the plan's six: an import that cannot be resolved, a version clash, a
// license the policy refuses, an agent that ran out of iterations, a sandbox
// that timed out, and a merge that builds but is wrong. The two extra
// buckets are honest bookkeeping: 'unknown' (we could not tell) and 'none'
// (the pair passed — a failure report that counts a success as a category
// would lie).
//
// The decision rule is the point of the whole taxonomy: when the import
// failures are a top-2 category, the cross-language epic (Epic 17) earns
// its budget; otherwise it waits.

import type { BaselineInput } from './baseline.js';

/** The six categories the plan names, in the plan's order. */
export const TAXONOMY_CATEGORIES = [
  'import-resolution',
  'semver-conflict',
  'license-block',
  'loop-cap-exceeded',
  'sandbox-timeout',
  'semantic-wrong-but-builds',
] as const;

/** One of the six planned categories, or the two bookkeeping buckets. */
export type TaxonomyCategory = (typeof TAXONOMY_CATEGORIES)[number] | 'unknown' | 'none';

/** A category a failing pair can carry. */
export type FailureCategoryName = Exclude<TaxonomyCategory, 'none'>;

/** The import share that makes the cross-language epic worth funding. */
export const IMPORT_RESOLUTION_SHARE_THRESHOLD = 0.2;

/** One classified pair. */
export interface TaxonomyEntry {
  readonly pair_id: string;
  readonly primary_category: TaxonomyCategory;
  readonly secondary_category: TaxonomyCategory | null;
  /** 0..1 — how sure the classifier is (a code match is sure, a guess is not). */
  readonly confidence: number;
  readonly notes: string;
}

/** The whole classification. */
export interface TaxonomyReport {
  readonly version: 1;
  readonly generated_at: string;
  readonly entries: readonly TaxonomyEntry[];
  /** The count per category (the passing pairs are counted under 'none'). */
  readonly frequencies: Readonly<Record<TaxonomyCategory, number>>;
  readonly total_pairs: number;
  readonly total_failures: number;
  /** The share of the failures that are import-resolution (0 when none failed). */
  readonly import_resolution_share: number;
  readonly decision: 'epic17-warranted' | 'epic17-deferred' | 'pending';
  readonly reasons: readonly string[];
}

/** The error codes that name a category outright. */
const CATEGORY_BY_CODE: Readonly<Record<string, FailureCategoryName>> = {
  IMPORT_RESOLUTION: 'import-resolution',
  RESOLUTION_ERROR: 'import-resolution',
  UNRESOLVED_IMPORT: 'import-resolution',
  DEPENDENCY_CONFLICT: 'semver-conflict',
  VERSION_CONFLICT: 'semver-conflict',
  LICENSE_VIOLATION: 'license-block',
  COMPLIANCE_VIOLATION: 'license-block',
  UNKNOWN_LICENSE: 'license-block',
  SANDBOX_TIMEOUT: 'sandbox-timeout',
  TIMEOUT: 'sandbox-timeout',
};

/** The log text that means the agent ran out of iterations. */
const LOOP_LOG_PATTERNS: readonly RegExp[] = [
  /max\s*iterations/i,
  /iteration\s*limit/i,
  /maxIterations/i,
  /tool\s*loop/i,
];

/** The rubric average at or below which a build that passes is still wrong. */
export const SEMANTIC_WRONG_SCORE = 3;

/**
 * A pair to classify: the baseline's input plus the logs the classifier
 * reads for the agent's own limits.
 */
export interface TaxonomyInput extends BaselineInput {
  readonly build_logs?: readonly string[];
  readonly test_logs?: readonly string[];
}

/** A classification with its reasoning. */
export interface Classification {
  readonly primary: TaxonomyCategory;
  readonly secondary: TaxonomyCategory | null;
  readonly confidence: number;
  readonly notes: string;
}

/** The average rubric score of a pair, or null when nobody scored it. */
function rubricAverage(ratings: readonly unknown[]): number | null {
  const scores: number[] = [];
  for (const rating of ratings) {
    if (rating === null || typeof rating !== 'object') continue;
    const record = rating as Record<string, unknown>;
    const values = [
      record['wiring_correctness'],
      record['unnecessary_changes'],
      record['respects_patterns'],
    ];
    const numbers = values.filter((value): value is number => typeof value === 'number');
    if (numbers.length === 0) continue;
    const total = numbers.reduce((sum, value) => sum + value, 0);
    scores.push(total / numbers.length);
  }
  if (scores.length === 0) return null;
  return scores.reduce((sum, value) => sum + value, 0) / scores.length;
}

/**
 * Classify one pair. The order is deliberate: an error code names the
 * cause outright, the logs catch the agent's own limits, and the rater's
 * rubric catches the merge that compiles but is wrong. Nothing is guessed
 * before those three are exhausted.
 */
export function classifyResult(input: TaxonomyInput): Classification {
  if (input.status === 'succeeded' && input.build_pass === true) {
    // A build that passes is not automatically a GOOD merge: a rater who
    // scored the pair low still names it, so the rubric is read before the
    // pair is filed as a plain success.
    const average = rubricAverage(input.ratings);
    if (average !== null && average <= SEMANTIC_WRONG_SCORE) {
      return {
        primary: 'semantic-wrong-but-builds',
        secondary: null,
        confidence: 0.4,
        notes: `the build passed but the rubric average is ${average.toFixed(1)}`,
      };
    }
    return {
      primary: 'none',
      secondary: null,
      confidence: 1,
      notes: 'the pair built and passed',
    };
  }

  const code = input.error_code;
  if (code !== null) {
    const named = CATEGORY_BY_CODE[code];
    if (named !== undefined) {
      return {
        primary: named,
        secondary: null,
        confidence: 0.9,
        notes: `the run failed with ${code}`,
      };
    }
  }

  const logs = [...(input.build_logs ?? []), ...(input.test_logs ?? [])].join('\n');
  for (const pattern of LOOP_LOG_PATTERNS) {
    if (pattern.test(logs)) {
      return {
        primary: 'loop-cap-exceeded',
        secondary: null,
        confidence: 0.6,
        notes: 'the logs show the agent hitting its iteration limit',
      };
    }
  }

  const average = rubricAverage(input.ratings);
  if (input.build_pass === true && average !== null && average <= SEMANTIC_WRONG_SCORE) {
    return {
      primary: 'semantic-wrong-but-builds',
      secondary: null,
      confidence: 0.4,
      notes: `the build passed but the rubric average is ${average.toFixed(1)}`,
    };
  }

  return {
    primary: 'unknown',
    secondary: null,
    confidence: 0.2,
    notes:
      code === null
        ? 'the pair failed without an error code'
        : `the failure code ${code} is not in the taxonomy`,
  };
}

/** The failure categories ranked by count (the ties break alphabetically). */
function ranked(frequencies: Readonly<Record<TaxonomyCategory, number>>): FailureCategoryName[] {
  return TAXONOMY_CATEGORIES.filter(category => (frequencies[category] ?? 0) > 0).sort(
    (left, right) => {
      const difference = frequencies[right] - frequencies[left];
      return difference !== 0 ? difference : left.localeCompare(right);
    }
  );
}

/**
 * The decision rule the plan states: the cross-language epic is warranted
 * when the import failures are a top-2 category OR at least a fifth of the
 * failures. With no failures there is nothing to decide on.
 */
export function decide(
  frequencies: Readonly<Record<TaxonomyCategory, number>>,
  totalFailures: number
): {
  readonly decision: TaxonomyReport['decision'];
  readonly reasons: readonly string[];
  readonly importResolutionShare: number;
} {
  if (totalFailures === 0) {
    return {
      decision: 'pending',
      reasons: ['no pair failed - the taxonomy has nothing to decide on'],
      importResolutionShare: 0,
    };
  }
  const share = (frequencies['import-resolution'] ?? 0) / totalFailures;
  const order = ranked(frequencies);
  const topTwo = order.slice(0, 2);
  const isTopTwo = topTwo.includes('import-resolution');
  const meetsShare = share >= IMPORT_RESOLUTION_SHARE_THRESHOLD;
  const reasons = [
    `import-resolution failures: ${frequencies['import-resolution'] ?? 0} of ${totalFailures} (${(share * 100).toFixed(1)}%)`,
    `the top categories are ${order.length === 0 ? 'none' : order.join(', ')}`,
  ];
  if (isTopTwo || meetsShare) {
    reasons.push('the cross-language epic (Epic 17) is warranted');
    return { decision: 'epic17-warranted', reasons, importResolutionShare: share };
  }
  reasons.push('the cross-language epic (Epic 17) is deferred');
  return { decision: 'epic17-deferred', reasons, importResolutionShare: share };
}

/**
 * Classify every pair. The passing pairs are classified too (as 'none') —
 * a report that only lists the failures cannot show that the other pairs
 * were looked at.
 */
export function buildTaxonomy(
  inputs: readonly TaxonomyInput[],
  options?: { now?: () => string }
): TaxonomyReport {
  const frequencies = {
    'import-resolution': 0,
    'semver-conflict': 0,
    'license-block': 0,
    'loop-cap-exceeded': 0,
    'sandbox-timeout': 0,
    'semantic-wrong-but-builds': 0,
    unknown: 0,
    none: 0,
  } satisfies Record<TaxonomyCategory, number>;
  const entries: TaxonomyEntry[] = [];
  for (const input of inputs) {
    const classification = classifyResult(input);
    frequencies[classification.primary] += 1;
    entries.push({
      pair_id: input.pair_id,
      primary_category: classification.primary,
      secondary_category: classification.secondary,
      confidence: classification.confidence,
      notes: classification.notes,
    });
  }
  // The denominator is the pairs that carry a FAILURE category: a pair that
  // built but was rated wrong is a failure even though the build passed.
  const totalFailures = entries.filter(entry => entry.primary_category !== 'none').length;
  const verdict = decide(frequencies, totalFailures);
  return {
    version: 1,
    generated_at: (options?.now ?? (() => new Date().toISOString()))(),
    entries,
    frequencies,
    total_pairs: inputs.length,
    total_failures: totalFailures,
    import_resolution_share: verdict.importResolutionShare,
    decision: verdict.decision,
    reasons: verdict.reasons,
  };
}
