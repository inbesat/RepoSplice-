// P-331 — the taxonomy harness: a bun SCRIPT that classifies a FIXED set of
// pairs with the REAL taxonomy module and prints one `TAXONOMY {json}` line.
// The CI is bun-only, so the python test drives THIS script (the P-323/P-324
// pattern). The fixed set covers every category: a passing pair, one failure
// per category, and one pair the classifier cannot place.

import { buildTaxonomy, type TaxonomyInput } from '../../eval/taxonomy.js';

const RATING = (score: number): Record<string, unknown> => ({
  pair_id: 'x',
  rater: 'rater-a',
  wiring_correctness: score,
  unnecessary_changes: score,
  respects_patterns: score,
  notes: 'harness',
});

const INPUTS: readonly TaxonomyInput[] = [
  {
    pair_id: 'fixture-pass',
    status: 'succeeded',
    build_pass: true,
    error_code: null,
    ratings: [RATING(5)],
    build_logs: ['build ok'],
    test_logs: ['tests ok'],
  },
  {
    pair_id: 'fixture-import',
    status: 'failed',
    build_pass: false,
    error_code: 'IMPORT_RESOLUTION',
    ratings: [],
    build_logs: ['cannot resolve ./utils'],
    test_logs: [],
  },
  {
    pair_id: 'fixture-import-2',
    status: 'failed',
    build_pass: false,
    error_code: 'UNRESOLVED_IMPORT',
    ratings: [],
    build_logs: ['unresolved import'],
    test_logs: [],
  },
  {
    pair_id: 'fixture-semver',
    status: 'failed',
    build_pass: false,
    error_code: 'DEPENDENCY_CONFLICT',
    ratings: [],
    build_logs: [],
    test_logs: [],
  },
  {
    pair_id: 'fixture-license',
    status: 'failed',
    build_pass: false,
    error_code: 'LICENSE_VIOLATION',
    ratings: [],
    build_logs: [],
    test_logs: [],
  },
  {
    pair_id: 'fixture-timeout',
    status: 'failed',
    build_pass: false,
    error_code: 'SANDBOX_TIMEOUT',
    ratings: [],
    build_logs: [],
    test_logs: [],
  },
  {
    pair_id: 'fixture-loop',
    status: 'failed',
    build_pass: false,
    error_code: null,
    ratings: [],
    build_logs: ['reached max iterations (20)'],
    test_logs: [],
  },
  {
    pair_id: 'fixture-semantic',
    status: 'succeeded',
    build_pass: true,
    error_code: null,
    ratings: [RATING(2)],
    build_logs: ['build ok'],
    test_logs: ['tests ok'],
  },
  {
    pair_id: 'fixture-unknown',
    status: 'failed',
    build_pass: false,
    error_code: 'SOMETHING_NEW',
    ratings: [],
    build_logs: [],
    test_logs: [],
  },
];

// A second run where every failure is a version clash: the decision rule must
// defer Epic 17.
const DEFERRED_INPUTS: readonly TaxonomyInput[] = [
  {
    pair_id: 'deferred-1',
    status: 'failed',
    build_pass: false,
    error_code: 'DEPENDENCY_CONFLICT',
    ratings: [],
    build_logs: [],
    test_logs: [],
  },
  {
    pair_id: 'deferred-2',
    status: 'failed',
    build_pass: false,
    error_code: 'VERSION_CONFLICT',
    ratings: [],
    build_logs: [],
    test_logs: [],
  },
];

const report = buildTaxonomy(INPUTS, { now: () => '2026-10-21T00:00:00.000Z' });
const deferred = buildTaxonomy(DEFERRED_INPUTS, {
  now: () => '2026-10-21T00:00:00.000Z',
});

process.stdout.write(
  `TAXONOMY ${JSON.stringify({
    report,
    deferred,
    pair_ids: INPUTS.map(input => input.pair_id),
  })}\n`
);
