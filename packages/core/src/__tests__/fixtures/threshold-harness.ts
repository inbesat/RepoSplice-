// P-350 — the harness the python test drives.
//
// It exercises the threshold policy over a bare composite and over a real
// SemanticConfidence document, proves the flag > config > default precedence
// and reports the HIL routing shape. One line: `THRESHOLD {json}`

import { defaultConfig, ConfigSchema } from '../../config/schema.js';
import {
  buildSemanticConfidence,
  type ConfidenceComponentScores,
} from '../../confidence/schema.js';
import {
  AUTO_APPROVE_THRESHOLD_RANGE,
  DEFAULT_AUTO_APPROVE_THRESHOLD,
  normalizeAutoApproveThreshold,
  requiresHumanReview,
  resolveThreshold,
  shouldAutoApprove,
  THRESHOLD_RATIONALE,
  thresholdDecision,
} from '../../confidence/threshold.js';

const STRONG: ConfidenceComponentScores = {
  sandbox_pass: 1,
  self_confidence: 82,
  resolver_confidence: 60,
  license_risk: 40,
  test_coverage: 50,
};

function decisionReport(composite: number, threshold?: number): Record<string, unknown> {
  const result = thresholdDecision(composite, threshold);
  if (result.isErr()) return { error: result.error.code };
  return {
    autoApprove: result.value.autoApprove,
    requiresHumanReview: result.value.requiresHumanReview,
    composite: result.value.composite,
    threshold: result.value.threshold,
    reason: result.value.reason,
  };
}

const refusals = [150, -1, Number.NaN].map(input => {
  const result = normalizeAutoApproveThreshold(input);
  if (result.isOk()) return { input: String(input), code: null, field: null };
  const error = result.error;
  return {
    input: String(input),
    code: error.code,
    field: 'field' in error ? error.field : null,
  };
});

const flag = resolveThreshold({ flagValue: 90, configValue: 40 });
const config = resolveThreshold({ configValue: 40 });
const fallback = resolveThreshold({});
const badFlag = resolveThreshold({ flagValue: 150, configValue: 40 });

const built = buildSemanticConfidence({ components: STRONG });
const document = built.isErr()
  ? { ok: false }
  : {
      ok: true,
      composite: built.value.composite_score,
      autoApprove: shouldAutoApprove(built.value).unwrapOr(false),
      requiresHumanReview: requiresHumanReview(built.value).unwrapOr(true),
    };

// The config surface: the schema's own parse fills the new default.
const parsed = ConfigSchema.safeParse(defaultConfig);

const report = {
  mode: 'threshold',
  default: DEFAULT_AUTO_APPROVE_THRESHOLD,
  range: { min: AUTO_APPROVE_THRESHOLD_RANGE.min, max: AUTO_APPROVE_THRESHOLD_RANGE.max },
  rationale: THRESHOLD_RATIONALE,
  above: decisionReport(80),
  atThreshold: decisionReport(DEFAULT_AUTO_APPROVE_THRESHOLD),
  below: decisionReport(74),
  custom: decisionReport(74, 60),
  refusals,
  precedence: {
    flag: flag.isOk() ? flag.value : null,
    config: config.isOk() ? config.value : null,
    fallback: fallback.isOk() ? fallback.value : null,
    badFlagCode: badFlag.isErr() ? badFlag.error.code : null,
    flagBeatsConfig:
      flag.isOk() &&
      flag.value === 90 &&
      config.isOk() &&
      config.value === 40 &&
      fallback.isOk() &&
      fallback.value === 75,
  },
  configDefault: defaultConfig.confidence.auto_approve_threshold,
  configRoundTrip: parsed.success ? parsed.data.confidence.auto_approve_threshold : null,
  document,
};

process.stdout.write(`THRESHOLD ${JSON.stringify(report)}\n`);
