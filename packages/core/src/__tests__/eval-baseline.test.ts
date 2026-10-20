// P-327 — the baseline metrics: the numbers the roadmap gates on.
// The compute is pure (inputs in, metrics out); the CLI owns the IO.

import { describe, expect, it } from 'vitest';
import { categoryFor, computeBaseline } from '../eval/baseline.js';

/** A valid SemanticRubric (all three dimensions scored the same). */
const rubric = (score: number): unknown => ({
  pair_id: 'p1',
  rater: 'rater-a',
  wiring_correctness: score,
  unnecessary_changes: score,
  respects_patterns: score,
  notes: 'a note',
});

describe('eval baseline (P-327)', () => {
  it('computes the build-pass rate', () => {
    const metrics = computeBaseline(
      [
        { pair_id: 'a', status: 'succeeded', build_pass: true, error_code: null, ratings: [] },
        {
          pair_id: 'b',
          status: 'failed',
          build_pass: false,
          error_code: 'DOCKER_BUILD_FAILED',
          ratings: [],
        },
      ],
      { now: () => '2026-10-21T00:00:00.000Z' }
    );
    expect(metrics.pairs).toBe(2);
    expect(metrics.build_pass_count).toBe(1);
    expect(metrics.build_pass_rate).toBe(0.5);
    expect(metrics.generated_at).toBe('2026-10-21T00:00:00.000Z');
  });

  it('averages the rubric per pair', () => {
    const metrics = computeBaseline(
      [
        {
          pair_id: 'a',
          status: 'succeeded',
          build_pass: true,
          error_code: null,
          ratings: [rubric(4), rubric(5)],
        },
      ],
      { now: () => 'x' }
    );
    expect(metrics.rated).toBe(1);
    expect(metrics.rubric_avg).toBe(4.5);
    expect(metrics.per_pair[0]?.rubric_avg).toBe(4.5);
    expect(metrics.per_pair[0]?.ratings).toBe(2);
  });

  it('resolves a pair that builds and averages four or more', () => {
    const metrics = computeBaseline(
      [
        {
          pair_id: 'a',
          status: 'succeeded',
          build_pass: true,
          error_code: null,
          ratings: [rubric(4)],
        },
        {
          pair_id: 'b',
          status: 'succeeded',
          build_pass: true,
          error_code: null,
          ratings: [rubric(3)],
        },
      ],
      { now: () => 'x' }
    );
    expect(metrics.resolved_count).toBe(1);
    expect(metrics.resolve_rate).toBe(0.5);
  });

  it('counts the failure categories', () => {
    const metrics = computeBaseline(
      [
        {
          pair_id: 'a',
          status: 'failed',
          build_pass: false,
          error_code: 'DEPENDENCY_CONFLICT',
          ratings: [],
        },
        {
          pair_id: 'b',
          status: 'failed',
          build_pass: false,
          error_code: 'DEPENDENCY_CONFLICT',
          ratings: [],
        },
        {
          pair_id: 'c',
          status: 'failed',
          build_pass: false,
          error_code: 'DOCKER_BUILD_FAILED',
          ratings: [],
        },
      ],
      { now: () => 'x' }
    );
    expect(metrics.categories.resolution).toBe(2);
    expect(metrics.categories.build).toBe(1);
    expect(metrics.categories.other).toBe(0);
  });

  it('decides go when the resolution failures are in the top two', () => {
    const metrics = computeBaseline(
      [
        {
          pair_id: 'a',
          status: 'failed',
          build_pass: false,
          error_code: 'DEPENDENCY_CONFLICT',
          ratings: [rubric(2)],
        },
        {
          pair_id: 'b',
          status: 'failed',
          build_pass: false,
          error_code: 'DOCKER_BUILD_FAILED',
          ratings: [rubric(2)],
        },
      ],
      { now: () => 'x' }
    );
    expect(metrics.decision).toBe('go');
    expect(metrics.reasons.join(' ')).toContain('cross-language epic is warranted');
  });

  it('decides no-go when the resolution failures are not', () => {
    const metrics = computeBaseline(
      [
        {
          pair_id: 'a',
          status: 'failed',
          build_pass: false,
          error_code: 'DOCKER_BUILD_FAILED',
          ratings: [rubric(2)],
        },
        {
          pair_id: 'b',
          status: 'failed',
          build_pass: false,
          error_code: 'SANDBOX_TIMEOUT',
          ratings: [rubric(2)],
        },
      ],
      { now: () => 'x' }
    );
    expect(metrics.decision).toBe('no-go');
    expect(metrics.reasons.join(' ')).toContain('not warranted');
  });

  it('stays pending when no pair carries a rating', () => {
    const metrics = computeBaseline(
      [
        {
          pair_id: 'a',
          status: 'failed',
          build_pass: false,
          error_code: 'DEPENDENCY_CONFLICT',
          ratings: [],
        },
      ],
      { now: () => 'x' }
    );
    expect(metrics.decision).toBe('pending');
    expect(metrics.rated).toBe(0);
    expect(metrics.rubric_avg).toBeNull();
  });

  it('ignores an invalid rating', () => {
    const metrics = computeBaseline(
      [
        {
          pair_id: 'a',
          status: 'succeeded',
          build_pass: true,
          error_code: null,
          ratings: [{ bogus: true }, rubric(4)],
        },
      ],
      { now: () => 'x' }
    );
    expect(metrics.rated).toBe(1);
    expect(metrics.per_pair[0]?.ratings).toBe(1);
  });

  it('maps an error code to a category', () => {
    expect(categoryFor('DEPENDENCY_CONFLICT')).toBe('resolution');
    expect(categoryFor('DOCKER_BUILD_FAILED')).toBe('build');
    expect(categoryFor('SANDBOX_TIMEOUT')).toBe('timeout');
    expect(categoryFor('LICENSE_VIOLATION')).toBe('license');
    expect(categoryFor('WHATEVER')).toBe('other');
    expect(categoryFor(null)).toBeNull();
  });
});
