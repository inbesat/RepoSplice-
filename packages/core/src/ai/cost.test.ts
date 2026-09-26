import { describe, it, expect } from 'vitest';
import {
  countTokens,
  estimateCost,
  CostTracker,
  estimateCallCost,
  shouldRequestApproval,
} from './cost.js';
import type { ModelSpec, ChatMessage, TokenUsage } from './types.js';

const mockModel: ModelSpec = {
  id: 'test/model',
  provider: 'test',
  contextWindow: 100000,
  supportsTools: true,
  toolCalling: 'allowed',
  maxOutput: 4096,
  cost: { input: 3.0, output: 15.0 },
  recommendedFor: ['test'],
};

describe('P-137 cost: token counting', () => {
  it('counts tokens heuristically', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'Hello world!' },
    ];
    const tokens = countTokens(messages);
    expect(typeof tokens).toBe('number');
    expect(tokens).toBeGreaterThan(0);
    expect(Number.isInteger(tokens)).toBe(true);
    // Deterministic
    expect(countTokens(messages)).toBe(tokens);
  });

  it('counts tokens with tool calls', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'Test', toolCalls: [{ id: '1', name: 'fn', arguments: { a: 1 } }] },
    ];
    const tokens = countTokens(messages);
    expect(tokens).toBeGreaterThan(0);
  });
});

describe('P-137 cost: estimateCost', () => {
  it('estimates cost from model spec', () => {
    const usage: TokenUsage = { input: 1_000_000, output: 1_000_000, total: 2_000_000 };
    const cost = estimateCost(mockModel, usage);
    // 1M * 3 / 1M = $3 input, 1M * 15 / 1M = $15 output, total $18
    expect(cost.input).toBe(3.0);
    expect(cost.output).toBe(15.0);
    expect(cost.total).toBe(18.0);
  });

  it('handles fractional costs', () => {
    const usage: TokenUsage = { input: 500_000, output: 500_000, total: 1_000_000 };
    const cost = estimateCost(mockModel, usage);
    expect(cost.input).toBe(1.5);
    expect(cost.output).toBe(7.5);
    expect(cost.total).toBe(9.0);
  });
});

describe('P-137 cost: CostTracker', () => {
  it('accumulates in cost tracker', () => {
    const tracker = new CostTracker(mockModel);
    tracker.add({ input: 1000, output: 500, total: 1500 });
    tracker.add({ input: 2000, output: 1000, total: 3000 });

    expect(tracker.calls).toBe(2);
    expect(tracker.totalTokens.input).toBe(3000);
    expect(tracker.totalTokens.output).toBe(1500);
    expect(tracker.totalTokens.total).toBe(4500);

    // Cost: (3000 * 3 + 1500 * 15) / 1M = (9000 + 22500) / 1M = 0.0315
    expect(tracker.totalCost).toBeCloseTo(0.0315, 4);
  });

  it('reset clears tracker', () => {
    const tracker = new CostTracker(mockModel);
    tracker.add({ input: 1000, output: 500, total: 1500 });
    tracker.reset();
    expect(tracker.calls).toBe(0);
    expect(tracker.totalTokens.input).toBe(0);
    expect(tracker.totalCost).toBe(0);
  });
});

describe('P-137 cost: estimateCallCost', () => {
  it('caps worst case at maxOutput', () => {
    const messages: ChatMessage[] = [{ role: 'user', content: 'a'.repeat(1000) }];
    const result = estimateCallCost(mockModel, messages);

    expect(result.estimate.input).toBeGreaterThan(0);
    expect(result.estimate.output).toBeGreaterThan(0);
    expect(result.worstCase.output).toBeLessThanOrEqual(mockModel.maxOutput);
    // worstCase output should equal maxOutput
    expect(result.worstCase.output).toBe(
      estimateCost(mockModel, {
        input: result.worstCase.input,
        output: mockModel.maxOutput,
        total: result.worstCase.input + mockModel.maxOutput,
      }).output
    );
  });
});

describe('P-137 cost: budget approval gate', () => {
  it('budget approval gate', () => {
    const budget = { autoApprove: 0.01, limit: 1.0 };

    // Under autoApprove - no approval needed
    expect(shouldRequestApproval({ total: 0.005 }, budget)).toBe(false);

    // Between autoApprove and limit - approval needed
    expect(shouldRequestApproval({ total: 0.05 }, budget)).toBe(true);

    // Over limit - throws BUDGET_EXCEEDED
    expect(() => shouldRequestApproval({ total: 2.0 }, budget)).toThrow();
    try {
      shouldRequestApproval({ total: 2.0 }, budget);
    } catch (e) {
      const err = e as Error & { code: string };
      expect(err.code).toBe('BUDGET_EXCEEDED');
    }
  });
});
