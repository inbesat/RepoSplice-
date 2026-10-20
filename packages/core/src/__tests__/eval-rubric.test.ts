// P-325 — the rubric contract, asserted with the REAL zod schema.
//
// The python side (packages/core/test_rubric.py) drives the same contract
// through the bun harness; this is the copy the CI can run.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  RUBRIC_DIMENSIONS,
  cohensKappa,
  meanScore,
  semanticRubricJsonSchema,
  semanticRubricSchema,
  type RubricPair,
  type SemanticRubric,
} from '../eval/rubric.js';

const REPO_ROOT = join(import.meta.dirname, '..', '..', '..', '..');
const SCHEMA_PATH = join(REPO_ROOT, 'eval', 'rubric', 'schema.json');
const WORKSHEET_PATH = join(REPO_ROOT, 'eval', 'rubric', 'trial-worksheet.json');

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));

const VALID: SemanticRubric = {
  pair_id: 'js-axios-ky',
  rater: 'rater-a',
  wiring_correctness: 4,
  unnecessary_changes: 4,
  respects_patterns: 4,
  notes: 'wiring holds on both sides',
};

describe('semantic rubric (P-325)', () => {
  it('accepts a scored rubric', () => {
    const parsed = semanticRubricSchema.safeParse(VALID);
    expect(parsed.success).toBe(true);
  });

  it('rejects a score outside 1-5', () => {
    expect(semanticRubricSchema.safeParse({ ...VALID, wiring_correctness: 0 }).success).toBe(false);
    expect(semanticRubricSchema.safeParse({ ...VALID, respects_patterns: 6 }).success).toBe(false);
    expect(semanticRubricSchema.safeParse({ ...VALID, unnecessary_changes: 2.5 }).success).toBe(
      false
    );
  });

  it('requires every scored dimension', () => {
    const incomplete: Record<string, unknown> = { ...VALID };
    delete incomplete['notes'];
    expect(semanticRubricSchema.safeParse(incomplete).success).toBe(false);
  });

  it('keeps the three scored dimensions', () => {
    expect([...RUBRIC_DIMENSIONS]).toEqual([
      'wiring_correctness',
      'unnecessary_changes',
      'respects_patterns',
    ]);
  });

  it('binds the mean score to the 1-5 scale', () => {
    expect(meanScore(VALID)).toBe(4);
    // (5, 4, 4) = 13 / 3 = 4.333… -> 4.3 on the one-decimal scale.
    expect(meanScore({ ...VALID, wiring_correctness: 5 })).toBe(4.3);
  });

  it('scores the trial worksheet above the reliability threshold', () => {
    const worksheet = readJson(WORKSHEET_PATH) as {
      trials: { a: unknown; b: unknown }[];
    };
    const pairs: RubricPair[] = worksheet.trials.map(trial => ({
      a: semanticRubricSchema.parse(trial.a),
      b: semanticRubricSchema.parse(trial.b),
    }));
    expect(pairs.length).toBe(3);
    expect(cohensKappa(pairs)).toBeGreaterThanOrEqual(0.6);
  });

  it('matches the emitted rubric schema', () => {
    expect(readJson(SCHEMA_PATH)).toEqual(semanticRubricJsonSchema());
  });
});
