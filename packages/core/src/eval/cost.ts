// P-330 — what a run COST, not just what it produced.
//
// The numbers come from the P-145 audit rows (a provider call already
// carries its token counts and its cost), so this module never re-prices a
// call it did not make: `summarizeCalls` sums what was audited. The pricing
// table is the core model registry (USD per 1M tokens) and `costFor` is the
// estimator for a usage that has no audited row yet. A model that is not in
// the registry prices at 0 — the TOKENS are still counted, so a run never
// hides its volume behind a missing price.
//
// The budget check reuses the config's convention (P-164): 0 means OFF.

import type { AiCallAudit } from '../ai/audit.js';
import { MODELS } from '../ai/models.js';

/** Input + output tokens of one call (or of a whole run). */
export interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

/** USD per 1M input / 1M output tokens. */
export interface ModelPrice {
  readonly input: number;
  readonly output: number;
}

/** What a set of audited calls added up to. */
export interface CostBreakdown {
  readonly calls: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly tokensTotal: number;
  readonly costUsd: number;
  readonly models: readonly string[];
  readonly providers: readonly string[];
}

/** The registry price for a model id, or undefined when it is unknown. */
export function priceFor(model: string): ModelPrice | undefined {
  return MODELS.find(spec => spec.id === model)?.cost;
}

/**
 * The cost of a usage for a model, in USD. An unknown model costs 0 (the
 * tokens are still counted) — the assumption is documented in
 * eval/cost/README.md.
 */
export function costFor(usage: TokenUsage, model: string | undefined): number {
  const price = model === undefined ? undefined : priceFor(model);
  if (price === undefined) return 0;
  const cost =
    (usage.inputTokens / 1_000_000) * price.input + (usage.outputTokens / 1_000_000) * price.output;
  return roundUsd(cost);
}

/** The totals over the audited calls. */
export function summarizeCalls(calls: readonly AiCallAudit[]): CostBreakdown {
  const models = new Set<string>();
  const providers = new Set<string>();
  let inputTokens = 0;
  let outputTokens = 0;
  let costUsd = 0;
  for (const call of calls) {
    inputTokens += call.inputTokens;
    outputTokens += call.outputTokens;
    costUsd += call.costUsd;
    models.add(call.model);
    providers.add(call.provider);
  }
  return {
    calls: calls.length,
    inputTokens,
    outputTokens,
    tokensTotal: inputTokens + outputTokens,
    costUsd: roundUsd(costUsd),
    models: [...models],
    providers: [...providers],
  };
}

/** The cost of ONE successful merge (null when nothing succeeded). */
export function costPerSuccessfulMerge(costUsd: number, successes: number): number | null {
  if (successes <= 0) return null;
  return roundUsd(costUsd / successes);
}

/** Whether a run crossed its budget, and the sentence that says so. */
export interface BudgetAlert {
  readonly exceeded: boolean;
  readonly message: string;
}

/**
 * The budget check: 0 means OFF (the config's `maxCostUsd: 0` convention).
 * A run over its budget is reported, never hidden.
 */
export function budgetAlert(costUsd: number, budgetUsd: number): BudgetAlert {
  if (budgetUsd <= 0) {
    return { exceeded: false, message: 'no cost budget set (0 = off)' };
  }
  if (costUsd <= budgetUsd) {
    return {
      exceeded: false,
      message: `the run cost $${costUsd.toFixed(4)} is within the $${budgetUsd.toFixed(2)} budget`,
    };
  }
  return {
    exceeded: true,
    message: `the run cost $${costUsd.toFixed(4)} EXCEEDS the $${budgetUsd.toFixed(2)} budget`,
  };
}

/** USD rounded to micro-dollars (the report prints four decimals). */
function roundUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
