// P-328 — the CI gate's contract, mirrored for the bun CI: the deterministic
// subset, the composite score, and the pass/fail verdicts (including the
// spec's "a degraded run must be caught" case).

import { describe, expect, it } from 'vitest';
import type { BaselineMetrics } from '../eval/baseline.js';
import {
  compositeScore,
  DEFAULT_SUBSET_SIZE,
  DEFAULT_THRESHOLD_POINTS,
  evaluateGate,
  gateFromMetrics,
  selectSubset,
} from '../eval/ci_gate.js';
import type { EvalPair } from '../eval/schema.js';

function pair(id: string, ecosystem: EvalPair['ecosystem']): EvalPair {
  return {
    pair_id: id,
    repo_a_url: `https://github.com/example/${id}-a`,
    repo_b_url: `https://github.com/example/${id}-b`,
    repo_a_sha: 'a'.repeat(40),
    repo_b_sha: 'b'.repeat(40),
    extract_paths_a: ['./'],
    extract_paths_b: ['./'],
    ecosystem,
    license_a: 'MIT',
    license_b: 'MIT',
    expected_outcome: 'clean',
  };
}

function metrics(overrides: Partial<BaselineMetrics> = {}): BaselineMetrics {
  return {
    version: 1,
    generated_at: '2026-10-21T00:00:00.000Z',
    pairs: 10,
    rated: 10,
    build_pass_count: 8,
    build_pass_rate: 0.8,
    rubric_avg: 4,
    resolved_count: 6,
    resolve_rate: 0.6,
    decision: 'go',
    reasons: [],
    categories: { resolution: 0, build: 1, test: 0, license: 0, timeout: 0, other: 0 },
    per_pair: [],
    ...overrides,
  };
}

describe('ci gate (P-328)', () => {
  it('selects one pair per ecosystem first', () => {
    const pairs = [
      pair('js-1', 'js'),
      pair('js-2', 'js'),
      pair('py-1', 'python'),
      pair('py-2', 'python'),
      pair('go-1', 'go'),
      pair('go-2', 'go'),
      pair('rs-1', 'rust'),
      pair('rs-2', 'rust'),
    ];
    const subset = selectSubset(pairs);
    expect(subset.length).toBe(DEFAULT_SUBSET_SIZE);
    const ids = subset.map(entry => entry.pair_id);
    expect(ids).toContain('js-1');
    expect(ids).toContain('py-1');
    expect(ids).toContain('go-1');
    expect(ids).toContain('rs-1');
    // the fifth slot is the first remaining pair in corpus order
    expect(ids[4]).toBe('js-2');
    // a pair is never taken twice
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('honours the subset size', () => {
    const pairs = [pair('js-1', 'js'), pair('py-1', 'python'), pair('go-1', 'go')];
    expect(selectSubset(pairs, 2).length).toBe(2);
    expect(selectSubset(pairs, 0).length).toBe(0);
  });

  it('scores only the components that carry a number', () => {
    const withoutRatings = metrics({ rubric_avg: null, rated: 0 });
    // (80 + 60) / 2 — the missing rubric average is skipped, never a zero
    expect(compositeScore(withoutRatings)).toBe(70);
  });

  it('maps the rubric average onto the 0-100 scale', () => {
    // (100 + 4 * 20 + 100) / 3 = 93.33
    expect(compositeScore(metrics({ build_pass_rate: 1, resolve_rate: 1 }))).toBe(93.33);
  });

  it('passes when the score holds', () => {
    const verdict = evaluateGate({ composite: 90 }, { composite: 90 });
    expect(verdict.passed).toBe(true);
    expect(verdict.delta).toBe(0);
  });

  it('passes when the drop stays inside the threshold', () => {
    const verdict = evaluateGate({ composite: 86 }, { composite: 90 });
    expect(verdict.passed).toBe(true);
    expect(verdict.delta).toBe(4);
  });

  it('fails when the drop exceeds the threshold', () => {
    const verdict = evaluateGate({ composite: 84 }, { composite: 90 });
    expect(verdict.passed).toBe(false);
    expect(verdict.delta).toBe(6);
    expect(verdict.threshold).toBe(DEFAULT_THRESHOLD_POINTS);
    expect(verdict.reasons.join(' ')).toContain('exceeds');
  });

  it('catches a degraded run', () => {
    const baseline = metrics();
    const degraded = metrics({ build_pass_rate: 0.2, resolve_rate: 0, rubric_avg: 2 });
    const verdict = gateFromMetrics(degraded, baseline);
    expect(verdict.passed).toBe(false);
    expect(verdict.delta).toBeGreaterThan(DEFAULT_THRESHOLD_POINTS);
  });

  it('wraps two metric sets', () => {
    const verdict = gateFromMetrics(metrics(), metrics());
    expect(verdict.passed).toBe(true);
    expect(verdict.composite).toBe(verdict.baseline_composite);
  });
});
