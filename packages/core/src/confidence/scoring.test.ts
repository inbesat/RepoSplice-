// P-349 — the composite scoring model: the finalized weights, the deterministic
// formula and the human-readable breakdown.

import { describe, expect, it } from 'vitest';
import {
  COMPOSITE_FACTOR_ORDER,
  COMPOSITE_WEIGHT_RATIONALE,
  COMPOSITE_WEIGHT_SUM_TOLERANCE,
  computeComposite,
  DEFAULT_COMPOSITE_WEIGHTS,
  explain,
  normalizeCompositeWeights,
} from './scoring.js';
import type { ConfidenceComponentScores, ConfidenceWeights } from './schema.js';

/** The same fixture the P-346 mirror uses, so the two cannot drift. */
const STRONG: ConfidenceComponentScores = {
  sandbox_pass: 1,
  self_confidence: 80,
  resolver_confidence: 90,
  license_risk: 10,
  test_coverage: 70,
};

const WORST: ConfidenceComponentScores = {
  sandbox_pass: 0,
  self_confidence: 0,
  resolver_confidence: 0,
  license_risk: 100,
  test_coverage: 0,
};

const BEST: ConfidenceComponentScores = {
  sandbox_pass: 1,
  self_confidence: 100,
  resolver_confidence: 100,
  license_risk: 0,
  test_coverage: 100,
};

describe('composite scoring model (P-349)', () => {
  it('ships the documented default weights', () => {
    expect(DEFAULT_COMPOSITE_WEIGHTS).toEqual({
      sandbox_pass: 0.3,
      self_confidence: 0.25,
      resolver_confidence: 0.2,
      license_risk: 0.15,
      test_coverage: 0.1,
    });
    const sum = Object.values(DEFAULT_COMPOSITE_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(Math.abs(sum - 1)).toBeLessThanOrEqual(COMPOSITE_WEIGHT_SUM_TOLERANCE);
  });

  it('documents a rationale for every factor', () => {
    expect(Object.keys(COMPOSITE_WEIGHT_RATIONALE).sort()).toEqual(
      [...COMPOSITE_FACTOR_ORDER].sort()
    );
    for (const line of Object.values(COMPOSITE_WEIGHT_RATIONALE)) {
      expect(line.trim().length).toBeGreaterThan(0);
    }
  });

  it('computes the documented weighting with the defaults', () => {
    // .30*100 + .25*80 + .20*90 + .15*(100-10) + .10*70 = 88.5 -> 89
    const result = computeComposite(STRONG);
    expect(result.isOk()).toBe(true);
    expect(result.isOk() ? result.value : -1).toBe(89);
  });

  it('honours a custom weight set', () => {
    const weights: ConfidenceWeights = {
      sandbox_pass: 0.5,
      self_confidence: 0.5,
      resolver_confidence: 0,
      license_risk: 0,
      test_coverage: 0,
    };
    const result = computeComposite({ ...WORST, sandbox_pass: 1, self_confidence: 33.2 }, weights);
    expect(result.isOk()).toBe(true);
    expect(result.isOk() ? result.value : -1).toBe(67);
  });

  it('refuses a weight set that cannot be trusted', () => {
    const short: ConfidenceWeights = {
      sandbox_pass: 0.3,
      self_confidence: 0.3,
      resolver_confidence: 0.3,
      license_risk: 0,
      test_coverage: 0,
    };
    const shortResult = normalizeCompositeWeights(short);
    expect(shortResult.isErr()).toBe(true);
    if (shortResult.isErr()) {
      expect(shortResult.error.code).toBe('CONFIG_ERROR');
      if (shortResult.error.code === 'CONFIG_ERROR') {
        expect(shortResult.error.field).toBe('confidence.weights');
      }
    }
    const negative = normalizeCompositeWeights({ ...DEFAULT_COMPOSITE_WEIGHTS, license_risk: -1 });
    expect(negative.isErr()).toBe(true);
    if (negative.isErr() && negative.error.code === 'CONFIG_ERROR') {
      expect(negative.error.field).toBe('confidence.weights');
      expect(negative.error.message).toContain('license_risk');
    }
  });

  it('explains the composite line by line', () => {
    const result = explain(STRONG);
    expect(result.isOk()).toBe(true);
    const text = result.isOk() ? result.value : '';
    for (const factor of COMPOSITE_FACTOR_ORDER) {
      expect(text).toContain(factor);
    }
    expect(text).toContain('composite 89/100');
    expect(text).toContain('sandbox_pass');
    // every line names its weight and its contribution
    expect(text).toMatch(/sandbox_pass: 1 -> 100\.0 x 30% = 30\.00/);
    expect(text).toMatch(/license_risk: 10 -> 90\.0 x 15%/);
    expect(text).toContain('rubric band');
  });

  it('is deterministic', () => {
    const first = computeComposite(STRONG);
    const second = computeComposite(STRONG);
    expect(first.isOk() && second.isOk() && first.value === second.value).toBe(true);
    const firstText = explain(STRONG);
    const secondText = explain(STRONG);
    expect(firstText.isOk() && secondText.isOk() && firstText.value === secondText.value).toBe(
      true
    );
  });

  it('keeps the score inside 0-100', () => {
    const worst = computeComposite(WORST);
    const best = computeComposite(BEST);
    expect(worst.isOk() ? worst.value : -1).toBe(0);
    expect(best.isOk() ? best.value : -1).toBe(100);
  });

  it('scores the all-zero input at the license complement', () => {
    // Every factor at zero still leaves the license COMPLEMENT: no recorded risk
    // is the safest possible input, so the composite is not zero.
    const zeros: ConfidenceComponentScores = {
      sandbox_pass: 0,
      self_confidence: 0,
      resolver_confidence: 0,
      license_risk: 0,
      test_coverage: 0,
    };
    const result = computeComposite(zeros);
    expect(result.isOk()).toBe(true);
    // .30*0 + .25*0 + .20*0 + .15*100 + .10*0 = 15
    expect(result.isOk() ? result.value : -1).toBe(15);
  });

  it('scores the all-hundred input below 100 because license_risk is risk', () => {
    const high: ConfidenceComponentScores = {
      sandbox_pass: 1,
      self_confidence: 100,
      resolver_confidence: 100,
      license_risk: 100,
      test_coverage: 100,
    };
    const result = computeComposite(high);
    expect(result.isOk()).toBe(true);
    // .30*100 + .25*100 + .20*100 + .15*(100-100) + .10*100 = 85
    expect(result.isOk() ? result.value : -1).toBe(85);
  });

  it('refuses a component set that is missing a factor', () => {
    const missing = {
      sandbox_pass: 1,
      self_confidence: 80,
      resolver_confidence: 90,
      license_risk: 10,
    } as unknown as ConfidenceComponentScores;
    const result = computeComposite(missing);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.code).toBe('CONFIG_ERROR');
      if (result.error.code === 'CONFIG_ERROR') {
        expect(result.error.field).toBe('confidence.components');
      }
    }
  });

  it('moves the whole score when one factor carries the weight', () => {
    const sandboxOnly: ConfidenceWeights = {
      sandbox_pass: 1,
      self_confidence: 0,
      resolver_confidence: 0,
      license_risk: 0,
      test_coverage: 0,
    };
    const pass = computeComposite({ ...WORST, sandbox_pass: 1 }, sandboxOnly);
    const fail = computeComposite(WORST, sandboxOnly);
    expect(pass.isOk() ? pass.value : -1).toBe(100);
    expect(fail.isOk() ? fail.value : -1).toBe(0);
  });

  it('formats the explain output in the documented order', () => {
    const result = explain(STRONG);
    expect(result.isOk()).toBe(true);
    const text = result.isOk() ? result.value : '';
    const lines = text.split('\n');
    // one line per factor, then the weighted sum, then the rubric band
    expect(lines).toHaveLength(COMPOSITE_FACTOR_ORDER.length + 2);
    const positions = COMPOSITE_FACTOR_ORDER.map(factor => text.indexOf(factor));
    for (const position of positions) expect(position).toBeGreaterThanOrEqual(0);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(lines[lines.length - 1]).toContain('rubric band');
  });
});
