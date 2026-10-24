// P-356 — the harness the confidence-docs tests drive: it exercises the scoring
// and threshold edge cases over the real P-346/P-349/P-350 modules and prints one
// machine-readable line.
//
// A bun script may throw; the core APIs it calls never do.

import {
  buildSemanticConfidence,
  type ConfidenceComponentScores,
} from '../../confidence/schema.js';
import { computeComposite, DEFAULT_COMPOSITE_WEIGHTS, explain } from '../../confidence/scoring.js';
import { DEFAULT_AUTO_APPROVE_THRESHOLD, thresholdDecision } from '../../confidence/threshold.js';

const ZEROS: ConfidenceComponentScores = {
  sandbox_pass: 0,
  self_confidence: 0,
  resolver_confidence: 0,
  license_risk: 0,
  test_coverage: 0,
};

const HIGHS: ConfidenceComponentScores = {
  sandbox_pass: 1,
  self_confidence: 100,
  resolver_confidence: 100,
  license_risk: 100,
  test_coverage: 100,
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

const STRONG: ConfidenceComponentScores = {
  sandbox_pass: 1,
  self_confidence: 82,
  resolver_confidence: 60,
  license_risk: 40,
  test_coverage: 50,
};

interface CaseReport {
  readonly composite: number | null;
  readonly error: string | null;
  readonly field: string | null;
}

interface DecisionReport {
  readonly autoApprove: boolean;
  readonly requiresHumanReview: boolean;
  readonly threshold: number;
  readonly composite: number;
  readonly reason: string;
}

function score(components: ConfidenceComponentScores): CaseReport {
  const result = computeComposite(components);
  if (result.isErr()) {
    const error = result.error;
    return {
      composite: null,
      error: error.code,
      field: error.code === 'CONFIG_ERROR' ? error.field : null,
    };
  }
  return { composite: result.value, error: null, field: null };
}

function decision(composite: number): DecisionReport {
  const result = thresholdDecision(composite);
  if (result.isErr()) {
    throw new Error(`the threshold decision refused ${composite}: ${result.error.code}`);
  }
  return {
    autoApprove: result.value.autoApprove,
    requiresHumanReview: result.value.requiresHumanReview,
    threshold: result.value.threshold,
    composite: result.value.composite,
    reason: result.value.reason,
  };
}

// A component set that is missing a factor is refused, never scored.
const missing = score({
  sandbox_pass: 1,
  self_confidence: 80,
  resolver_confidence: 90,
  license_risk: 10,
} as unknown as ConfidenceComponentScores);

const explained = explain(STRONG);
const explainText = explained.isOk() ? explained.value : '';
const document = buildSemanticConfidence({ components: STRONG });

const report = {
  mode: 'confidence-docs',
  weights: DEFAULT_COMPOSITE_WEIGHTS,
  weightsSum: Object.values(DEFAULT_COMPOSITE_WEIGHTS).reduce((total, value) => total + value, 0),
  edgeCases: {
    allZeros: score(ZEROS),
    allHundreds: score(HIGHS),
    worst: score(WORST),
    best: score(BEST),
    strong: score(STRONG),
    missingComponent: missing,
  },
  threshold: {
    default: DEFAULT_AUTO_APPROVE_THRESHOLD,
    at: decision(75),
    below: decision(74),
    margin: 1,
  },
  explain: {
    lines: explainText.split('\n').length,
    hasRubricBand: explainText.includes('rubric band'),
    mentionsComposite: explainText.includes('composite 77/100'),
  },
  document: { composite: document.isOk() ? document.value.composite_score : null },
};

process.stdout.write(`CONFIDENCE_DOCS ${JSON.stringify(report)}\n`);
