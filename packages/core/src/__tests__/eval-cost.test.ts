// P-330 — the cost/token tracking mirror: the pricing, the audited totals,
// the cost per successful merge and the budget alert. The python ids
// (packages/core/test_cost.py) drive the same module through a bun harness;
// this file keeps the contract enforced in the bun CI.

import { describe, expect, it } from 'vitest';
import type { AiCallAudit } from '../ai/audit.js';
import { MODELS } from '../ai/models.js';
import {
  budgetAlert,
  costFor,
  costPerSuccessfulMerge,
  priceFor,
  summarizeCalls,
} from '../eval/cost.js';

const MODEL = (() => {
  const model = MODELS[0];
  if (model === undefined) throw new Error('cost tracking tests require a registered model');
  return model;
})();

function audit(
  id: string,
  inputTokens: number,
  outputTokens: number,
  costUsd: number
): AiCallAudit {
  return {
    id,
    ts: '2026-10-21T00:00:00.000Z',
    provider: MODEL.provider,
    model: MODEL.id,
    promptVersion: 'v1',
    task: 'merge',
    inputTokens,
    outputTokens,
    costUsd,
    latencyMs: 100,
    finishReason: 'stop',
    toolNames: [],
  };
}

describe('cost tracking (P-330)', () => {
  it('prices a model from the registry', () => {
    expect(priceFor(MODEL.id)).toEqual(MODEL.cost);
    expect(priceFor('not-a-model')).toBeUndefined();
  });

  it('costs a usage against the registry price', () => {
    const priced = costFor({ inputTokens: 1_000_000, outputTokens: 1_000_000 }, MODEL.id);
    expect(priced).toBeCloseTo(MODEL.cost.input + MODEL.cost.output, 9);
    // a model that is not in the registry prices at zero
    expect(costFor({ inputTokens: 1_000, outputTokens: 500 }, 'not-a-model')).toBe(0);
  });

  it('sums the audited calls', () => {
    const usage = summarizeCalls([
      audit('call-1', 1_000, 500, 0.01),
      audit('call-2', 2_000, 1_000, 0.02),
    ]);
    expect(usage.calls).toBe(2);
    expect(usage.inputTokens).toBe(3_000);
    expect(usage.outputTokens).toBe(1_500);
    expect(usage.tokensTotal).toBe(4_500);
    expect(usage.costUsd).toBeCloseTo(0.03, 9);
    expect(usage.models).toEqual([MODEL.id]);
    expect(usage.providers).toEqual([MODEL.provider]);
  });

  it('reports the cost of one successful merge', () => {
    expect(costPerSuccessfulMerge(0.03, 1)).toBeCloseTo(0.03, 9);
    expect(costPerSuccessfulMerge(0.03, 0)).toBeNull();
  });

  it('raises a budget alert only over the threshold', () => {
    const off = budgetAlert(0.03, 0);
    expect(off.exceeded).toBe(false);
    expect(off.message).toContain('off');
    const within = budgetAlert(0.03, 1);
    expect(within.exceeded).toBe(false);
    const over = budgetAlert(0.03, 0.001);
    expect(over.exceeded).toBe(true);
    expect(over.message).toContain('EXCEEDS');
  });
});
