// Token/Cost Estimation (P-137).
//
// Deterministic token counting, cost estimation from ModelSpec.cost,
// and a thread-safe CostTracker for aggregating usage across tool loops.

import type { ChatMessage, TokenUsage, ModelSpec } from './types.js';
import type { ChatProvider } from './provider.js';
/**
 * Heuristic token counter: ~4 chars per token (English average).
 * Adds small per-message overhead for role/structure tokens.
 * Returns deterministic positive integer.
 */
export function countTokens(messages: ChatMessage[]): number {
  let total = 0;
  for (const msg of messages) {
    if (msg.content && msg.content.length > 0) {
      total += Math.ceil(msg.content.length / 4);
    }
    // Per-message overhead: role token + structure
    total += 4;
    // Tool calls add overhead
    if (msg.toolCalls && msg.toolCalls.length > 0) {
      for (const tc of msg.toolCalls) {
        total += Math.ceil(JSON.stringify(tc).length / 4) + 8;
      }
    }
  }
  // Minimal base for system prompt / framing
  return Math.max(1, total);
}

/**
 * Accurate token count via provider's tokenizer when available.
 * Falls back to heuristic if provider.countTokens not implemented.
 */
export async function countTokensAccurate(
  messages: ChatMessage[],
  provider: ChatProvider
): Promise<number> {
  if (typeof provider.countTokens === 'function') {
    try {
      return await provider.countTokens(messages);
    } catch {
      // Fall back to heuristic on any error
    }
  }
  return countTokens(messages);
}

/**
 * Estimate dollar cost from ModelSpec pricing and TokenUsage.
 * @returns { input, output, total } in USD
 */
export function estimateCost(
  model: ModelSpec,
  usage: TokenUsage
): { input: number; output: number; total: number } {
  const inputCost = (usage.input * model.cost.input) / 1_000_000;
  const outputCost = (usage.output * model.cost.output) / 1_000_000;
  return {
    input: Number(inputCost.toFixed(6)),
    output: Number(outputCost.toFixed(6)),
    total: Number((inputCost + outputCost).toFixed(6)),
  };
}

/**
 * Thread-safe cost accumulator for a single pipeline job.
 * Not exported as a module singleton — instantiate per job (P-238).
 */
export class CostTracker {
  #model: ModelSpec;
  #totalUsage: TokenUsage = { input: 0, output: 0, total: 0 };
  #totalCost = 0;
  #calls = 0;

  constructor(model: ModelSpec) {
    this.#model = model;
  }

  /** Add usage from one provider call and update totals. */
  add(usage: TokenUsage): void {
    this.#totalUsage.input += usage.input;
    this.#totalUsage.output += usage.output;
    this.#totalUsage.total += usage.total;
    const cost = estimateCost(this.#model, usage);
    this.#totalCost += cost.total;
    this.#calls++;
  }

  get totalTokens(): TokenUsage {
    return { ...this.#totalUsage };
  }

  get totalCost(): number {
    return Number(this.#totalCost.toFixed(6));
  }

  get calls(): number {
    return this.#calls;
  }

  /** Reset tracker for reuse (e.g., retry loops). */
  reset(): void {
    this.#totalUsage = { input: 0, output: 0, total: 0 };
    this.#totalCost = 0;
    this.#calls = 0;
  }
}

/**
 * Budget configuration for approval gating (P-302).
 */
export interface CostBudget {
  /** Max cost per call before requiring approval (USD). */
  autoApprove: number;
  /** Hard limit — abort if exceeded (USD). */
  limit: number;
}

/**
 * Pre-flight cost estimate for a single call.
 * Heuristic input tokens; worst-case output capped at model.maxOutput.
 */
export function estimateCallCost(
  model: ModelSpec,
  messages: ChatMessage[],
  _tools?: unknown[]
): {
  estimate: { input: number; output: number; total: number };
  worstCase: { input: number; output: number; total: number };
} {
  const inputTokens = countTokens(messages);
  // Estimate: assume output ~20% of input as rough heuristic, but cap at maxOutput
  const estimatedOutput = Math.min(Math.ceil(inputTokens * 0.2), model.maxOutput);
  const estimatedUsage: TokenUsage = {
    input: inputTokens,
    output: estimatedOutput,
    total: inputTokens + estimatedOutput,
  };
  const worstCaseUsage: TokenUsage = {
    input: inputTokens,
    output: model.maxOutput,
    total: inputTokens + model.maxOutput,
  };

  return {
    estimate: estimateCost(model, estimatedUsage),
    worstCase: estimateCost(model, worstCaseUsage),
  };
}

/**
 * Approval gate: should the user approve this estimated cost?
 * Returns true if estimatedCost.total > budget.autoApprove and <= budget.limit.
 * Returns false if within autoApprove; throws if > budget.limit.
 */
export function shouldRequestApproval(
  estimatedCost: { total: number },
  budget: CostBudget
): boolean {
  if (estimatedCost.total > budget.limit) {
    const err = new Error(
      `Estimated cost $${estimatedCost.total.toFixed(4)} exceeds budget limit $${budget.limit.toFixed(4)}`
    );
    (err as Error & { code: string }).code = 'BUDGET_EXCEEDED';
    throw err;
  }
  return estimatedCost.total > budget.autoApprove;
}
