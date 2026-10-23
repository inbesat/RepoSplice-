// P-346 — the SemanticConfidence schema, its weighting formula and its bounds.

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONFIDENCE_WEIGHTS,
  RUBRIC_COMPATIBILITY,
  buildSemanticConfidence,
  compositeScore,
  compositeToRubricScore,
  confidenceComponentScoresSchema,
  deriveFlags,
  semanticConfidenceSchema,
  type ConfidenceComponentScores,
} from './schema.js';

const STRONG: ConfidenceComponentScores = {
  sandbox_pass: 1,
  self_confidence: 80,
  resolver_confidence: 90,
  license_risk: 10,
  test_coverage: 70,
};

describe('SemanticConfidence schema (P-346)', () => {
  it('validates a complete document', () => {
    const parsed = semanticConfidenceSchema.safeParse({
      composite_score: 89,
      components: STRONG,
      rationale: 'Composite confidence 89/100: the sandbox run passed.',
      flags: [],
      contributing_factors: { pr: 12, ecosystem: 'node', merged: true },
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects an out-of-range component score', () => {
    expect(
      confidenceComponentScoresSchema.safeParse({ ...STRONG, self_confidence: 101 }).success
    ).toBe(false);
    expect(
      confidenceComponentScoresSchema.safeParse({ ...STRONG, resolver_confidence: -1 }).success
    ).toBe(false);
  });

  it('rejects a sandbox_pass that is neither 0 nor 1', () => {
    const rejected = confidenceComponentScoresSchema.safeParse({
      ...STRONG,
      sandbox_pass: 2,
    });
    expect(rejected.success).toBe(false);
  });

  it('computes the weighted composite', () => {
    const score = compositeScore(STRONG);
    expect(score.isOk()).toBe(true);
    if (score.isOk()) {
      // .30*100 + .20*80 + .25*90 + .15*(100-10) + .10*70 = 89
      expect(score.value).toBe(89);
    }
  });

  it('rounds the weighted sum', () => {
    const score = compositeScore(
      {
        sandbox_pass: 1,
        self_confidence: 33.2,
        resolver_confidence: 0,
        license_risk: 0,
        test_coverage: 0,
      },
      {
        sandbox_pass: 0.5,
        self_confidence: 0.5,
        resolver_confidence: 0,
        license_risk: 0,
        test_coverage: 0,
      }
    );
    expect(score.isOk()).toBe(true);
    // 50 + 16.6 = 66.6 -> 67
    if (score.isOk()) expect(score.value).toBe(67);
  });

  it('keeps the composite within the 0-100 bounds', () => {
    const worst: ConfidenceComponentScores = {
      sandbox_pass: 0,
      self_confidence: 0,
      resolver_confidence: 0,
      license_risk: 100,
      test_coverage: 0,
    };
    const best: ConfidenceComponentScores = {
      sandbox_pass: 1,
      self_confidence: 100,
      resolver_confidence: 100,
      license_risk: 0,
      test_coverage: 100,
    };
    const low = compositeScore(worst);
    const high = compositeScore(best);
    expect(low.isOk() && low.value).toBe(0);
    expect(high.isOk() && high.value).toBe(100);
    // A sweep over the component corners never leaves the bounds.
    for (const sandbox of [0, 1] as const) {
      for (const value of [0, 25, 50, 75, 100]) {
        const score = compositeScore({
          sandbox_pass: sandbox,
          self_confidence: value,
          resolver_confidence: 100 - value,
          license_risk: value,
          test_coverage: 100 - value,
        });
        expect(score.isOk()).toBe(true);
        if (score.isOk()) {
          expect(score.value).toBeGreaterThanOrEqual(0);
          expect(score.value).toBeLessThanOrEqual(100);
        }
      }
    }
  });

  it('refuses a weight set that does not sum to one', () => {
    const score = compositeScore(STRONG, {
      sandbox_pass: 0.5,
      self_confidence: 0.5,
      resolver_confidence: 0.5,
      license_risk: 0,
      test_coverage: 0,
    });
    expect(score.isErr()).toBe(true);
    if (score.isErr()) {
      expect(score.error.code).toBe('CONFIG_ERROR');
      if ('field' in score.error) expect(score.error.field).toBe('confidence.weights');
    }
  });

  it('refuses a negative weight', () => {
    const score = compositeScore(STRONG, {
      ...DEFAULT_CONFIDENCE_WEIGHTS,
      sandbox_pass: -0.3,
      test_coverage: 0.4,
    });
    expect(score.isErr()).toBe(true);
  });

  it('derives the flags from the components', () => {
    expect(deriveFlags(STRONG)).toEqual([]);
    expect(
      deriveFlags({
        sandbox_pass: 0,
        self_confidence: 10,
        resolver_confidence: 10,
        license_risk: 90,
        test_coverage: 10,
      })
    ).toEqual([
      'sandbox_failed',
      'high_license_risk',
      'low_test_coverage',
      'unresolved_imports',
      'low_self_confidence',
    ]);
  });

  it('builds a schema-valid document with a rationale and the factors', () => {
    const built = buildSemanticConfidence({
      components: STRONG,
      contributing_factors: { merge_id: 'm-1', files: 4 },
    });
    expect(built.isOk()).toBe(true);
    if (built.isOk()) {
      expect(built.value.composite_score).toBe(89);
      expect(built.value.flags).toEqual([]);
      expect(built.value.rationale).toContain('89/100');
      expect(built.value.contributing_factors).toEqual({ merge_id: 'm-1', files: 4 });
      expect(semanticConfidenceSchema.safeParse(built.value).success).toBe(true);
    }
  });

  it('maps the composite onto the P-325 rubric scale', () => {
    expect(compositeToRubricScore(100)).toBe(5);
    expect(compositeToRubricScore(80)).toBe(5);
    expect(compositeToRubricScore(79)).toBe(4);
    expect(compositeToRubricScore(60)).toBe(4);
    expect(compositeToRubricScore(59)).toBe(3);
    expect(compositeToRubricScore(40)).toBe(3);
    expect(compositeToRubricScore(39)).toBe(2);
    expect(compositeToRubricScore(20)).toBe(2);
    expect(compositeToRubricScore(19)).toBe(1);
    expect(compositeToRubricScore(0)).toBe(1);
    // The compatibility map names the P-325 dimensions.
    expect(Object.keys(RUBRIC_COMPATIBILITY).sort()).toEqual([
      'respects_patterns',
      'unnecessary_changes',
      'wiring_correctness',
    ]);
  });
});
