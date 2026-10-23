// P-349 — the scoring-model harness the mandated python tests drive. One line:
// SCORING {json}

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  COMPOSITE_FACTOR_ORDER,
  COMPOSITE_WEIGHT_RATIONALE,
  COMPOSITE_WEIGHT_SUM_TOLERANCE,
  computeComposite,
  DEFAULT_COMPOSITE_WEIGHTS,
  explain,
  normalizeCompositeWeights,
} from '../../confidence/scoring.js';
import type { ConfidenceComponentScores, ConfidenceWeights } from '../../confidence/schema.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..', '..', '..');

const STRONG: ConfidenceComponentScores = {
  sandbox_pass: 1,
  self_confidence: 80,
  resolver_confidence: 90,
  license_risk: 10,
  test_coverage: 70,
};

const CUSTOM: ConfidenceWeights = {
  sandbox_pass: 0.5,
  self_confidence: 0.5,
  resolver_confidence: 0,
  license_risk: 0,
  test_coverage: 0,
};

const SHORT: ConfidenceWeights = {
  sandbox_pass: 0.3,
  self_confidence: 0.3,
  resolver_confidence: 0.3,
  license_risk: 0,
  test_coverage: 0,
};

function value(result: { isOk(): boolean; value?: number }): number | null {
  return result.isOk() ? (result.value ?? null) : null;
}

const defaults = DEFAULT_COMPOSITE_WEIGHTS;
const sum = Object.values(defaults).reduce((a, b) => a + b, 0);
const strong = computeComposite(STRONG);
const custom = computeComposite({ ...STRONG, sandbox_pass: 1, self_confidence: 33.2 }, CUSTOM);
const shortResult = normalizeCompositeWeights(SHORT);
const negativeResult = normalizeCompositeWeights({ ...defaults, license_risk: -1 });
const explained = explain(STRONG);
const explainedAgain = explain(STRONG);
const best = computeComposite({
  sandbox_pass: 1,
  self_confidence: 100,
  resolver_confidence: 100,
  license_risk: 0,
  test_coverage: 100,
});
const worst = computeComposite({
  sandbox_pass: 0,
  self_confidence: 0,
  resolver_confidence: 0,
  license_risk: 100,
  test_coverage: 0,
});

const explainText = explained.isOk() ? explained.value : '';

const report = {
  mode: 'scoring-model',
  root: REPO_ROOT,
  defaults,
  sum,
  tolerance: COMPOSITE_WEIGHT_SUM_TOLERANCE,
  order: COMPOSITE_FACTOR_ORDER,
  rationale: COMPOSITE_WEIGHT_RATIONALE,
  rationaleComplete: COMPOSITE_FACTOR_ORDER.every(
    factor => (COMPOSITE_WEIGHT_RATIONALE[factor] ?? '').trim().length > 0
  ),
  strong: value(strong),
  custom: value(custom),
  refusal: shortResult.isErr()
    ? {
        code: shortResult.error.code,
        field: 'field' in shortResult.error ? shortResult.error.field : null,
        message: 'message' in shortResult.error ? shortResult.error.message : '',
      }
    : null,
  negativeRefusal: negativeResult.isErr()
    ? {
        code: negativeResult.error.code,
        field: 'field' in negativeResult.error ? negativeResult.error.field : null,
        message: 'message' in negativeResult.error ? negativeResult.error.message : '',
      }
    : null,
  explain: explainText,
  explainLines: explainText === '' ? 0 : explainText.split('\n').length,
  deterministic:
    explained.isOk() && explainedAgain.isOk() && explained.value === explainedAgain.value,
  bounds: { worst: value(worst), best: value(best) },
};

process.stdout.write(`SCORING ${JSON.stringify(report)}\n`);
