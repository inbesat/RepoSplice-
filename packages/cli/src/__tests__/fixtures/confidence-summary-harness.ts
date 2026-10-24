// P-353 - the harness the three mandated python ids drive.
//
// It exercises the CLI confidence summary end to end: the formatter bands and
// cells, the `--no-color` paint, the `stitch merge` summary and the
// `stitch status` report. The JSON it prints is deliberately ASCII: the python
// side must not depend on the host locale to decode it.

import { mergeSummary } from '../../commands/merge.js';
import { renderStatusReport } from '../../commands/status.js';
import {
  CONFIDENCE_THRESHOLDS,
  confidenceFlags,
  confidenceLevel,
  confidencePercent,
  formatConfidenceSummary,
  parseConfidenceSummary,
  type ConfidencePaint,
  type ConfidenceSummary,
} from '../../ui/confidence-summary.js';

/** The plain paint: `--no-color` passes exactly this to every renderer. */
const plain: ConfidencePaint = (_level, text) => text;

/** A paint that wraps its text, so the band mapping is observable in the JSON. */
const wrap: ConfidencePaint = (level, text) => `[${level}]${text}[/]`;

const STRONG: ConfidenceSummary = {
  score: 87,
  flags: ['low_resolver'],
  components: {
    sandbox_pass: 1,
    self_confidence: 92,
    resolver_confidence: 78,
    license_risk: 95,
    test_coverage: 88,
  },
  rationale: 'the change is well covered',
};

const WEAK: ConfidenceSummary = {
  score: 16,
  flags: ['sandbox_failed', 'high_license_risk'],
  components: {
    sandbox_pass: 0,
    self_confidence: 30,
    resolver_confidence: 20,
    license_risk: 80,
    test_coverage: 10,
  },
};

/** The minimal shape `renderStatusReport` actually reads. */
const baseReport: Parameters<typeof renderStatusReport>[0] = {
  config: {
    path: '',
    present: false,
    store: '',
    storePresent: false,
    stateDb: '',
    stateDbPresent: false,
    providers: [],
    model: null,
    projectDir: '',
  },
  sources: [],
  hil: null,
  jobs: null,
  sandbox: { docker: 'available', ghFallback: false },
  checksums: { state: 'no-manifest' },
};

const outcome: Parameters<typeof mergeSummary>[0] = {
  outDir: '/tmp/stitch-child',
  outcome: 'completed',
  dryRun: true,
};

const withConfidence: Parameters<typeof mergeSummary>[1] = {
  outcome: 'completed',
  records: [{ stage: 'confidence', status: 'ok', meta: { confidence: STRONG } }],
};

const withoutConfidence: Parameters<typeof mergeSummary>[1] = {
  outcome: 'completed',
  records: [],
};

const coreName = parseConfidenceSummary({
  composite_score: WEAK.score,
  flags: WEAK.flags,
  components: { self_confidence: 30 },
});

const report = {
  mode: 'cli-confidence',
  thresholds: CONFIDENCE_THRESHOLDS,
  default: formatConfidenceSummary(STRONG, { paint: plain }),
  weak: formatConfidenceSummary(WEAK, { paint: plain }),
  verbose: formatConfidenceSummary(STRONG, { paint: plain, verbose: true }),
  none: formatConfidenceSummary(undefined),
  levels: {
    ok: confidenceLevel(87),
    warn: confidenceLevel(70),
    err: confidenceLevel(20),
    none: confidenceLevel(undefined),
    nan: confidenceLevel(Number.NaN),
  },
  percents: {
    scored: confidencePercent(87),
    missing: confidencePercent(undefined),
  },
  flags: {
    filtered: confidenceFlags(['ok', ' ', 7, 'other']),
    empty: confidenceFlags(undefined),
  },
  colors: {
    on: formatConfidenceSummary(STRONG, { paint: wrap }),
    off: formatConfidenceSummary(STRONG, { paint: plain }),
  },
  coreName: coreName?.score ?? null,
  stable:
    JSON.stringify(formatConfidenceSummary(STRONG, { paint: plain })) ===
    JSON.stringify(formatConfidenceSummary(STRONG, { paint: plain })),
  merge: {
    lines: mergeSummary(outcome, withConfidence),
    plain: mergeSummary(outcome, withConfidence, { paint: plain }),
    verbose: mergeSummary(outcome, withConfidence, { paint: plain, verbose: true }),
    withoutConfidence: mergeSummary(outcome, withoutConfidence),
  },
  status: {
    withConfidence: renderStatusReport({ ...baseReport, confidence: STRONG }, plain),
    withoutConfidence: renderStatusReport(baseReport, plain),
  },
};

process.stdout.write(`CONFIDENCE ${JSON.stringify(report)}\n`);
