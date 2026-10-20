// P-328 — the CI regression gate: does this PR make the corpus WORSE than
// the last baseline?
//
// The composite is one number on a 0..100 scale so a threshold means the same
// thing for every component. Only the components that actually carry a
// number are counted: a run nobody rated has no rubric average, and a missing
// component is SKIPPED (never a fake zero that would sink the score).
//
// The subset is deterministic: one pair per ecosystem first, then the
// remaining pairs in corpus order, so a PR gate and a local run pick the
// same pairs.

import type { BaselineMetrics } from './baseline.js';
import type { EvalPair } from './schema.js';

/** How many pairs the PR gate runs by default. */
export const DEFAULT_SUBSET_SIZE = 5;

/** The default drop (in composite POINTS, 0..100) that fails the gate. */
export const DEFAULT_THRESHOLD_POINTS = 5;

/**
 * A deterministic subset: one pair per ecosystem (the first of each in input
 * order), then the remaining pairs in input order until `size`.
 */
export function selectSubset(
  pairs: readonly EvalPair[],
  size: number = DEFAULT_SUBSET_SIZE
): readonly EvalPair[] {
  if (size <= 0) return [];
  const chosen: EvalPair[] = [];
  const taken = new Set<string>();
  const byEcosystem = new Set<string>();
  for (const pair of pairs) {
    if (chosen.length >= size) break;
    if (byEcosystem.has(pair.ecosystem)) continue;
    byEcosystem.add(pair.ecosystem);
    taken.add(pair.pair_id);
    chosen.push(pair);
  }
  for (const pair of pairs) {
    if (chosen.length >= size) break;
    if (taken.has(pair.pair_id)) continue;
    taken.add(pair.pair_id);
    chosen.push(pair);
  }
  return chosen;
}

/**
 * The composite score on a 0..100 scale: the mean of the components that
 * carry a number (the build-pass rate, the rubric average mapped from 1-5,
 * and the resolve rate).
 */
export function compositeScore(metrics: BaselineMetrics): number {
  const components: number[] = [];
  components.push(metrics.build_pass_rate * 100);
  if (metrics.rubric_avg !== null) components.push(metrics.rubric_avg * 20);
  components.push(metrics.resolve_rate * 100);
  if (components.length === 0) return 0;
  const mean = components.reduce((sum, value) => sum + value, 0) / components.length;
  return Math.round(mean * 100) / 100;
}

/** One side of the comparison. */
export interface GateInput {
  readonly composite: number;
  readonly label?: string;
}

/** What the gate decided, and why. */
export interface GateVerdict {
  readonly passed: boolean;
  readonly composite: number;
  readonly baseline_composite: number;
  /** The baseline composite MINUS the current one (a drop). */
  readonly delta: number;
  readonly threshold: number;
  readonly reasons: readonly string[];
}

/**
 * The gate rule: a drop of MORE than the threshold fails. A rise passes, and
 * so does a drop within the threshold.
 */
export function evaluateGate(
  current: GateInput,
  baseline: GateInput,
  threshold: number = DEFAULT_THRESHOLD_POINTS
): GateVerdict {
  const delta = Math.round((baseline.composite - current.composite) * 100) / 100;
  const passed = delta <= threshold;
  const currentLabel = current.label ?? 'the current run';
  const baselineLabel = baseline.label ?? 'the baseline';
  const reasons: string[] = [];
  if (passed) {
    reasons.push(
      `composite ${current.composite} vs ${baselineLabel} ${baseline.composite} - the drop of ${delta} is within the ${threshold}-point threshold`
    );
  } else {
    reasons.push(
      `composite ${current.composite} vs ${baselineLabel} ${baseline.composite} - the drop of ${delta} exceeds the ${threshold}-point threshold`
    );
    reasons.push(`${currentLabel} regressed; fix the merge quality or record an ADR`);
  }
  return {
    passed,
    composite: current.composite,
    baseline_composite: baseline.composite,
    delta,
    threshold,
    reasons,
  };
}

/** The convenience wrapper over two metric sets. */
export function gateFromMetrics(
  current: BaselineMetrics,
  baseline: BaselineMetrics,
  threshold: number = DEFAULT_THRESHOLD_POINTS
): GateVerdict {
  return evaluateGate(
    { composite: compositeScore(current), label: 'the current run' },
    { composite: compositeScore(baseline), label: 'the baseline' },
    threshold
  );
}
