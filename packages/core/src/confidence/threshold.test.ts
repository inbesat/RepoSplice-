// P-350 — the threshold policy's contract.
//
// The composite always comes from the P-346/P-349 modules; this module only
// compares it with the configured threshold and reports the decision.

import { describe, expect, it } from 'vitest';
import { buildSemanticConfidence, type ConfidenceComponentScores } from './schema.js';
import {
  AUTO_APPROVE_THRESHOLD_RANGE,
  DEFAULT_AUTO_APPROVE_THRESHOLD,
  normalizeAutoApproveThreshold,
  requiresHumanReview,
  resolveThreshold,
  shouldAutoApprove,
  THRESHOLD_RATIONALE,
  thresholdDecision,
} from './threshold.js';

const STRONG: ConfidenceComponentScores = {
  sandbox_pass: 1,
  self_confidence: 82,
  resolver_confidence: 60,
  license_risk: 40,
  test_coverage: 50,
};

describe('confidence threshold (P-350)', () => {
  it('defaults to 75 across a 0-100 range', () => {
    expect(DEFAULT_AUTO_APPROVE_THRESHOLD).toBe(75);
    expect(AUTO_APPROVE_THRESHOLD_RANGE).toEqual({ min: 0, max: 100 });
    const normalized = normalizeAutoApproveThreshold();
    expect(normalized.isOk()).toBe(true);
    if (normalized.isOk()) expect(normalized.value).toBe(75);
  });

  it('approves a composite at or above the threshold', () => {
    const approve = shouldAutoApprove(80);
    expect(approve.isOk()).toBe(true);
    if (approve.isOk()) expect(approve.value).toBe(true);
    const decision = thresholdDecision(80);
    expect(decision.isOk()).toBe(true);
    if (decision.isOk()) {
      expect(decision.value.autoApprove).toBe(true);
      expect(decision.value.requiresHumanReview).toBe(false);
      expect(decision.value.reason).toContain('meets the 75');
    }
  });

  it('approves exactly at the boundary', () => {
    const decision = thresholdDecision(DEFAULT_AUTO_APPROVE_THRESHOLD);
    expect(decision.isOk()).toBe(true);
    if (decision.isOk()) {
      expect(decision.value.autoApprove).toBe(true);
      expect(decision.value.requiresHumanReview).toBe(false);
    }
  });

  it('routes a below-threshold composite to human review', () => {
    const decision = thresholdDecision(74);
    expect(decision.isOk()).toBe(true);
    if (decision.isOk()) {
      expect(decision.value.autoApprove).toBe(false);
      expect(decision.value.requiresHumanReview).toBe(true);
      expect(decision.value.reason).toContain('below the 75');
    }
    const flag = requiresHumanReview(74);
    expect(flag.isOk()).toBe(true);
    if (flag.isOk()) expect(flag.value).toBe(true);
  });

  it('honours a custom threshold', () => {
    const approve = shouldAutoApprove(74, 60);
    expect(approve.isOk()).toBe(true);
    if (approve.isOk()) expect(approve.value).toBe(true);
    const decision = thresholdDecision(40, 60);
    expect(decision.isOk()).toBe(true);
    if (decision.isOk()) expect(decision.value.requiresHumanReview).toBe(true);
  });

  it('refuses an unusable threshold instead of clamping it', () => {
    for (const input of [150, -1, Number.NaN]) {
      const result = normalizeAutoApproveThreshold(input);
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.code).toBe('CONFIG_ERROR');
        if (result.error.code === 'CONFIG_ERROR') {
          expect(result.error.field).toBe('confidence.auto_approve_threshold');
        }
      }
    }
  });

  it('lets the per-run flag beat the config file and the default', () => {
    const flag = resolveThreshold({ flagValue: 90, configValue: 40 });
    const config = resolveThreshold({ configValue: 40 });
    const fallback = resolveThreshold({});
    expect(flag.isOk()).toBe(true);
    expect(config.isOk()).toBe(true);
    expect(fallback.isOk()).toBe(true);
    if (flag.isOk()) expect(flag.value).toBe(90);
    if (config.isOk()) expect(config.value).toBe(40);
    if (fallback.isOk()) expect(fallback.value).toBe(75);
    const badFlag = resolveThreshold({ flagValue: 150, configValue: 40 });
    expect(badFlag.isErr()).toBe(true);
  });

  it('accepts a SemanticConfidence document', () => {
    const built = buildSemanticConfidence({ components: STRONG });
    expect(built.isOk()).toBe(true);
    if (built.isErr()) return;
    expect(built.value.composite_score).toBe(77);
    const approve = shouldAutoApprove(built.value);
    expect(approve.isOk()).toBe(true);
    if (approve.isOk()) expect(approve.value).toBe(true);
    const flag = requiresHumanReview(built.value);
    expect(flag.isOk()).toBe(true);
    if (flag.isOk()) expect(flag.value).toBe(false);
  });

  it('documents the default as provisional pending P-354', () => {
    expect(THRESHOLD_RATIONALE).toContain('PROVISIONAL');
    expect(THRESHOLD_RATIONALE).toContain('P-354');
  });

  it('separates 74 from 75 at the boundary', () => {
    const below = thresholdDecision(74);
    const at = thresholdDecision(75);
    expect(below.isOk() && at.isOk()).toBe(true);
    if (below.isOk() && at.isOk()) {
      expect(below.value.autoApprove).toBe(false);
      expect(below.value.requiresHumanReview).toBe(true);
      expect(at.value.autoApprove).toBe(true);
      expect(at.value.requiresHumanReview).toBe(false);
      expect(at.value.composite - below.value.composite).toBe(1);
      expect(below.value.threshold).toBe(75);
      expect(at.value.threshold).toBe(75);
    }
  });
});
