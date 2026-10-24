// P-355 — the recalibration loop's contract.
//
// The measured baseline (P-354) already clears the bar, so the interesting
// cases here are the two the loop exists for: a weak baseline that a candidate
// fixes, and a weak baseline that no candidate fixes.

import { describe, expect, it } from 'vitest';
import type { CalibrationSample } from './calibration.js';
import {
  defaultRecalibrationBaseline,
  measureCorrelation,
  RECALIBRATION_MAX_ITERATIONS,
  runRecalibration,
} from './recalibration.js';
import { DEFAULT_COMPOSITE_WEIGHTS } from './scoring.js';

const PROMPT_VERSION = 'abc123def456';

/** A set whose self scores track the human rubric. */
function aligned(): CalibrationSample[] {
  return [10, 30, 50, 70, 90].map((self, index) => ({
    id: `case-${index + 1}`,
    selfConfidence: self,
    humanRubric: 1 + index,
  }));
}

/** A set whose self scores are INVERTED against the human rubric. */
function inverted(): CalibrationSample[] {
  return [10, 30, 50, 70, 90].map((self, index) => ({
    id: `case-${index + 1}`,
    selfConfidence: self,
    humanRubric: 5 - index,
  }));
}

describe('runRecalibration (P-355)', () => {
  it('measures a correlation with and without a re-mapping', () => {
    expect(measureCorrelation(aligned()).spearman).toBe(1);
    expect(measureCorrelation(inverted()).spearman).toBe(-1);
    expect(measureCorrelation(inverted(), value => 100 - value).spearman).toBe(1);
  });

  it('refuses fewer than two usable samples', () => {
    const result = runRecalibration([{ id: 'only', selfConfidence: 50, humanRubric: 3 }], {
      baseline: defaultRecalibrationBaseline(PROMPT_VERSION),
    });
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.code).toBe('CONFIG_ERROR');
      if (result.error.code === 'CONFIG_ERROR') {
        expect(result.error.field).toBe('confidence.recalibration');
        expect(result.error.message).toContain('at least two');
      }
    }
  });

  it('validates a baseline that already clears the threshold', () => {
    const result = runRecalibration(aligned(), {
      baseline: defaultRecalibrationBaseline(PROMPT_VERSION),
    });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const report = result.value;
      expect(report.decision).toBe('validated');
      expect(report.attempts).toHaveLength(0);
      expect(report.baseline.meets).toBe(true);
      expect(report.frozen.promptVersion).toBe(PROMPT_VERSION);
      expect(report.frozen.spearman).toBe(1);
      expect(report.reason).toContain('No recalibration is needed');
    }
  });

  it('recalibrates a weak baseline with a candidate that clears the bar', () => {
    const result = runRecalibration(inverted(), {
      baseline: defaultRecalibrationBaseline(PROMPT_VERSION),
      variants: [{ label: 'flip', transform: value => 100 - value }],
    });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const report = result.value;
      expect(report.decision).toBe('recalibrated');
      expect(report.baseline.spearman).toBe(-1);
      expect(report.attempts).toHaveLength(1);
      expect(report.attempts[0]?.improved).toBe(true);
      expect(report.attempts[0]?.meets).toBe(true);
      expect(report.frozen.spearman).toBe(1);
      expect(report.frozen.spearman).toBeGreaterThan(report.baseline.spearman ?? -1);
      expect(report.reason).toContain('Recalibrated on attempt 1');
    }
  });

  it('documents a limitation when no candidate clears the bar', () => {
    const result = runRecalibration(inverted(), {
      baseline: defaultRecalibrationBaseline(PROMPT_VERSION),
      variants: [
        { label: 'noop', transform: value => value },
        { label: 'noop-2', transform: value => value },
      ],
    });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const report = result.value;
      expect(report.decision).toBe('limited');
      expect(report.attempts).toHaveLength(2);
      expect(report.attempts.every(attempt => attempt.meets === false)).toBe(true);
      expect(report.frozen.spearman).toBe(-1);
      expect(report.reason).toContain('P-350');
    }
  });

  it('caps the attempts at maxIterations', () => {
    const variants = [1, 2, 3, 4, 5, 6, 7].map(index => ({
      label: `noop-${index}`,
      transform: (value: number) => value,
    }));
    const result = runRecalibration(inverted(), {
      baseline: defaultRecalibrationBaseline(PROMPT_VERSION),
      variants,
    });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.attempts).toHaveLength(RECALIBRATION_MAX_ITERATIONS);
      expect(result.value.decision).toBe('limited');
    }
  });

  it('propagates an unusable weight set', () => {
    const result = runRecalibration(inverted(), {
      baseline: defaultRecalibrationBaseline(PROMPT_VERSION),
      variants: [
        {
          label: 'bad-weights',
          weights: { ...DEFAULT_COMPOSITE_WEIGHTS, sandbox_pass: 5 },
        },
      ],
    });
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.code).toBe('CONFIG_ERROR');
      if (result.error.code === 'CONFIG_ERROR') {
        expect(result.error.field).toBe('confidence.weights');
      }
    }
  });

  it('is deterministic with an injected clock', () => {
    const now = (): Date => new Date('2026-10-24T00:00:00.000Z');
    const first = runRecalibration(aligned(), {
      baseline: defaultRecalibrationBaseline(PROMPT_VERSION),
      now,
    });
    const second = runRecalibration(aligned(), {
      baseline: defaultRecalibrationBaseline(PROMPT_VERSION),
      now,
    });
    expect(first.isOk() && second.isOk()).toBe(true);
    if (first.isOk() && second.isOk()) {
      expect(first.value.generatedAt).toBe('2026-10-24T00:00:00.000Z');
      expect(first.value).toEqual(second.value);
    }
  });

  it('freezes the finalized weights by default', () => {
    const baseline = defaultRecalibrationBaseline(PROMPT_VERSION);
    expect(baseline.weights).toEqual(DEFAULT_COMPOSITE_WEIGHTS);
    expect(baseline.promptVersion).toBe(PROMPT_VERSION);
  });
});
