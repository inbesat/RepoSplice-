// P-354 — the calibration maths and the report builder.
//
// The implementation is a pure leaf, so these cases pin the two honesty rules
// it carries: a coefficient that cannot be computed is `undefined` (never a
// fake 0) and the critical flag is `boolean | null`, so "we could not tell" is
// never reported as "not critical".

import { describe, expect, it } from 'vitest';
import {
  buildCalibrationReport,
  CALIBRATION_CORRELATION_THRESHOLD,
  parseCalibrationSet,
  pearson,
  ranks,
  rubricToConfidence,
  spearman,
  type CalibrationSample,
} from './calibration.js';

const FIXED_NOW = new Date('2026-10-24T00:00:00.000Z');

/** A perfectly ascending set: the self score tracks the human rubric. */
const ASCENDING: readonly CalibrationSample[] = [
  { id: 'a', selfConfidence: 10, humanRubric: 1 },
  { id: 'b', selfConfidence: 30, humanRubric: 2 },
  { id: 'c', selfConfidence: 50, humanRubric: 3 },
  { id: 'd', selfConfidence: 70, humanRubric: 4 },
  { id: 'e', selfConfidence: 90, humanRubric: 5 },
];

/** A deliberately inverted set: the self score runs against the rubric. */
const DECORRELATED: readonly CalibrationSample[] = [
  { id: 'a', selfConfidence: 10, humanRubric: 5 },
  { id: 'b', selfConfidence: 30, humanRubric: 4 },
  { id: 'c', selfConfidence: 50, humanRubric: 3 },
  { id: 'd', selfConfidence: 70, humanRubric: 2 },
  { id: 'e', selfConfidence: 90, humanRubric: 1 },
];

describe('calibration (P-354)', () => {
  it('ranks values with the average rank for ties', () => {
    expect(ranks([10, 10, 30])).toEqual([1.5, 1.5, 3]);
    expect(ranks([5])).toEqual([1]);
    expect(ranks([3, 1, 2])).toEqual([3, 1, 2]);
  });

  it('computes pearson for a linear pair and its inverse', () => {
    expect(pearson([1, 2, 3], [2, 4, 6])).toBe(1);
    expect(pearson([1, 2, 3], [6, 4, 2])).toBe(-1);
  });

  it('refuses a coefficient it cannot compute rather than reporting zero', () => {
    expect(pearson([1, 2, 3], [1, 2])).toBeUndefined();
    expect(pearson([1], [1])).toBeUndefined();
    expect(pearson([5, 5, 5], [1, 2, 3])).toBeUndefined();
    expect(spearman([1], [1])).toBeUndefined();
    expect(spearman([5, 5, 5], [1, 2, 3])).toBeUndefined();
  });

  it('is 1 for a monotonic pair even when pearson is not', () => {
    expect(spearman([1, 2, 3], [1, 4, 9])).toBe(1);
    expect(pearson([1, 2, 3], [1, 4, 9])).toBeLessThan(1);
  });

  it('maps the human rubric onto 0-100', () => {
    expect(rubricToConfidence(1)).toBe(0);
    expect(rubricToConfidence(3)).toBe(50);
    expect(rubricToConfidence(5)).toBe(100);
    expect(rubricToConfidence(7)).toBe(100);
    expect(rubricToConfidence(-1)).toBe(0);
  });

  it('reads the recorded reference set and skips an unusable case', () => {
    const recorded = {
      cases: [
        {
          id: 'case-01',
          proposal: 'a',
          self: { self_confidence: 40 },
          human: {
            wiring_correctness: 2,
            unnecessary_changes: 2,
            respects_patterns: 2,
          },
        },
        {
          id: 'case-02',
          proposal: 'b',
          self: { self_confidence: 80 },
          human: {
            wiring_correctness: 5,
            unnecessary_changes: 4,
            respects_patterns: 5,
          },
        },
        { id: 'case-03', proposal: 'c', human: { wiring_correctness: 3 } },
      ],
    };
    const samples = parseCalibrationSet(recorded);
    expect(samples).toHaveLength(2);
    expect(samples[0]).toEqual({ id: 'case-01', selfConfidence: 40, humanRubric: 2 });
    expect(samples[1]?.humanRubric).toBeCloseTo(4.6667, 3);
    expect(parseCalibrationSet({ cases: 'nope' })).toEqual([]);
    expect(parseCalibrationSet(null)).toEqual([]);
  });

  it('carries an ecosystem label when the set has one', () => {
    const samples = parseCalibrationSet({
      cases: [
        {
          id: 'x',
          ecosystem: 'python',
          self: { self_confidence: 50 },
          human: { wiring_correctness: 3 },
        },
      ],
    });
    expect(samples[0]?.ecosystem).toBe('python');
  });

  it('builds a report whose coefficient clears the threshold', () => {
    const built = buildCalibrationReport(ASCENDING, { now: () => FIXED_NOW });
    expect(built.isOk()).toBe(true);
    if (built.isErr()) return;
    const report = built.value;
    expect(report.version).toBe(1);
    expect(report.kind).toBe('calibration-report');
    expect(report.generatedAt).toBe(FIXED_NOW.toISOString());
    expect(report.samples).toBe(5);
    expect(report.threshold).toBe(CALIBRATION_CORRELATION_THRESHOLD);
    expect(report.primary).toBe('spearman');
    expect(report.spearman).toBe(1);
    expect(report.critical).toBe(false);
    expect(report.requiresRecalibration).toBe(false);
    expect(report.scatter).toHaveLength(5);
    expect(report.scatter[0]?.humanConfidence).toBe(0);
    expect(report.perEcosystem).toHaveLength(1);
    expect(report.perEcosystem[0]?.ecosystem).toBe('unassigned');
    expect(report.provenance).toContain('recorded reference set');
  });

  it('refuses fewer than two usable samples', () => {
    const built = buildCalibrationReport([ASCENDING[0]!]);
    expect(built.isErr()).toBe(true);
    if (built.isErr()) {
      expect(built.error.code).toBe('CONFIG_ERROR');
      if (built.error.code === 'CONFIG_ERROR') {
        expect(built.error.field).toBe('confidence.calibration');
        expect(built.error.message).toContain('at least two');
      }
    }
  });

  it('flags a decorrelated set as critical', () => {
    const built = buildCalibrationReport(DECORRELATED, { now: () => FIXED_NOW });
    expect(built.isOk()).toBe(true);
    if (built.isErr()) return;
    expect(built.value.spearman).toBe(-1);
    expect(built.value.critical).toBe(true);
    expect(built.value.requiresRecalibration).toBe(true);
    expect(built.value.spearman).toBeLessThan(CALIBRATION_CORRELATION_THRESHOLD);
  });

  it('labels the live corpus when it is asked to', () => {
    const built = buildCalibrationReport(ASCENDING, {
      set: 'live-corpus',
      now: () => FIXED_NOW,
    });
    expect(built.isOk()).toBe(true);
    if (built.isErr()) return;
    expect(built.value.set).toBe('live-corpus');
    expect(built.value.provenance).toBe('Measured over the live corpus.');
  });
});
