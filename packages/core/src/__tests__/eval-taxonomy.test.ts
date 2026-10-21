// P-331 — the taxonomy mirror: every pair is classified, the frequencies are
// counted over the failures, and the Epic 17 decision rule is applied.

import { describe, expect, it } from 'vitest';
import {
  buildTaxonomy,
  classifyResult,
  decide,
  TAXONOMY_CATEGORIES,
  type TaxonomyInput,
} from '../eval/taxonomy.js';

const RATING = (score: number): Record<string, unknown> => ({
  pair_id: 'x',
  rater: 'rater-a',
  wiring_correctness: score,
  unnecessary_changes: score,
  respects_patterns: score,
  notes: 'mirror',
});

const input = (overrides: Partial<TaxonomyInput>): TaxonomyInput => ({
  pair_id: 'p',
  status: 'failed',
  build_pass: false,
  error_code: null,
  ratings: [],
  ...overrides,
});

describe('failure taxonomy (P-331)', () => {
  it('lists the six categories from the plan', () => {
    expect(TAXONOMY_CATEGORIES).toEqual([
      'import-resolution',
      'semver-conflict',
      'license-block',
      'loop-cap-exceeded',
      'sandbox-timeout',
      'semantic-wrong-but-builds',
    ]);
  });

  it('classifies a passing pair as none', () => {
    const result = classifyResult(
      input({ pair_id: 'ok', status: 'succeeded', build_pass: true, ratings: [RATING(5)] })
    );
    expect(result.primary).toBe('none');
    expect(result.confidence).toBe(1);
  });

  it('reads the category off the error code', () => {
    expect(classifyResult(input({ error_code: 'IMPORT_RESOLUTION' })).primary).toBe(
      'import-resolution'
    );
    expect(classifyResult(input({ error_code: 'DEPENDENCY_CONFLICT' })).primary).toBe(
      'semver-conflict'
    );
    expect(classifyResult(input({ error_code: 'LICENSE_VIOLATION' })).primary).toBe(
      'license-block'
    );
    expect(classifyResult(input({ error_code: 'SANDBOX_TIMEOUT' })).primary).toBe(
      'sandbox-timeout'
    );
  });

  it('falls back to the logs and then to the rubric', () => {
    expect(classifyResult(input({ build_logs: ['reached max iterations (20)'] })).primary).toBe(
      'loop-cap-exceeded'
    );
    expect(
      classifyResult(input({ status: 'succeeded', build_pass: true, ratings: [RATING(2)] })).primary
    ).toBe('semantic-wrong-but-builds');
    expect(classifyResult(input({ error_code: 'SOMETHING_NEW' })).primary).toBe('unknown');
  });

  it('counts the frequencies over the failures only', () => {
    const report = buildTaxonomy([
      input({ pair_id: 'ok', status: 'succeeded', build_pass: true, ratings: [RATING(5)] }),
      input({ pair_id: 'a', error_code: 'IMPORT_RESOLUTION' }),
      input({ pair_id: 'b', error_code: 'IMPORT_RESOLUTION' }),
      input({ pair_id: 'c', error_code: 'DEPENDENCY_CONFLICT' }),
    ]);
    expect(report.total_pairs).toBe(4);
    expect(report.total_failures).toBe(3);
    expect(report.frequencies['import-resolution']).toBe(2);
    // the passing pair is filed as 'none' - the bucket counts the successes
    expect(report.frequencies['none']).toBe(1);
  });

  it('warrants Epic 17 on the share or the top two', () => {
    const warranted = decide(
      {
        'import-resolution': 2,
        'semver-conflict': 1,
        'license-block': 0,
        'loop-cap-exceeded': 0,
        'sandbox-timeout': 0,
        'semantic-wrong-but-builds': 0,
        unknown: 0,
        none: 0,
      },
      3
    );
    expect(warranted.decision).toBe('epic17-warranted');
    const deferred = decide(
      {
        'import-resolution': 0,
        'semver-conflict': 2,
        'license-block': 1,
        'loop-cap-exceeded': 0,
        'sandbox-timeout': 0,
        'semantic-wrong-but-builds': 0,
        unknown: 0,
        none: 0,
      },
      3
    );
    expect(deferred.decision).toBe('epic17-deferred');
    expect(
      decide(
        {
          'import-resolution': 0,
          'semver-conflict': 0,
          'license-block': 0,
          'loop-cap-exceeded': 0,
          'sandbox-timeout': 0,
          'semantic-wrong-but-builds': 0,
          unknown: 0,
          none: 0,
        },
        0
      ).decision
    ).toBe('pending');
  });
});
