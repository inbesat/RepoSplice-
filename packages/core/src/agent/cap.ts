// P-164 — the hard spend/iteration guard on the agent loop.
//
// An agent loop that never terminates wastes money and can mutate a working
// tree indefinitely. This module answers one question at the top of every
// iteration: may this iteration start? If not, which budget stopped us, how
// much of it was used, and why.
//
// THREE BUDGETS, THREE DIFFERENT FAILURE MODES, so three distinct codes:
//
//   iterations -> LOOP_LIMIT  (P-140)  the model is not converging
//   tokens     -> TOKEN_LIMIT (P-164)  the conversation outgrew its budget
//   dollars    -> COST_LIMIT  (P-137)  the run cost real money
//
// Tokens and dollars are deliberately NOT collapsed into one code. A cheap model
// can exhaust a token cap with no dollar consequence and an expensive one can
// hit the dollar cap first, so a run stopped for one reason must never be
// reported as the other — the two send an operator to different settings.
//
// THE OFF-BY-ONE IS DELIBERATE. The spec writes "if `iterations > maxIterations`
// -> err" and "consult the guard at the top of each iteration". Read together
// those permit `maxIterations + 1` iterations, because at the top of
// iteration k the counter is k. The loop's existing (and tested) behaviour is
// exactly `maxIterations` iterations, so `check` refuses when
// `iterations >= maxIterations` — "may iteration k begin?" — which preserves
// that behaviour instead of quietly granting one extra provider call.
//
// A BUDGET OF 0 MEANS OFF, NOT "SPEND NOTHING". The `[agent]` config defaults
// `maxTokens` and `maxCostUsd` to 0; read literally as a limit, every default
// run would stop on its first iteration. `budgetOf` is the single place that
// decides what "0" means.
//
// A CONFIGURED DOLLAR BUDGET WITH NO PRICED TRACKER IS AN ERROR, NOT A NO-OP.
// The loop cannot price a turn itself: the `ModelSpec` it builds is a
// placeholder with `cost: { input: 0, output: 0 }` (ai/loop.ts), so real
// pricing only exists in the `CostTracker` the caller injects. Silently not
// enforcing a spend cap is precisely the failure this module exists to prevent,
// so an unenforceable budget is reported rather than ignored.

import { err, ok, type Result } from 'neverthrow';
import type { StitchError } from '../result/index.js';

/** Default when nothing in `[agent]` config says otherwise (P-164 step 3). */
export const DEFAULT_MAX_ITERATIONS = 20;

/** The budgets one agent run is held to. */
export interface LoopCap {
  /** Iterations allowed. Exactly this many are permitted; the next is refused. */
  maxIterations: number;
  /** Token budget. `0` or absent means OFF. */
  maxTokens?: number;
  /** USD budget. `0` or absent means OFF. */
  maxCostUsd?: number;
  /**
   * P-164 step 5: on hitting a budget, ask a human whether to raise it.
   * Default OFF. Even when ON the cap is never widened without that answer.
   */
  autoRaiseBudget?: boolean;
  /**
   * How many times `autoRaiseBudget` may widen the cap in one run. Default 1.
   *
   * Without a limit the feature is a trap: a human who keeps saying yes is
   * answered, the budget doubles, the loop resumes, hits the new ceiling, asks
   * again, and runs indefinitely. That converts the phase's central safety
   * property — spend is bounded — into unbounded spend with extra steps, and an
   * auto-approving client would never stop. One raise is the useful case
   * (the cap was set too low for a job that is nearly done); more than that is
   * someone declining to set a limit.
   */
  maxRaises?: number;
}

/**
 * What the guard needs to know about the run in progress.
 *
 * The spec writes this parameter `ctx: LoopContext` and reads
 * `ctx.costTracker.get totalTokens > maxTokens`. Two corrections, both forced by
 * the real types: `CostTracker.totalTokens` is a `TokenUsage` **object**, not a
 * number, so it cannot be compared with `>`; and the loop's own `ModelSpec` has
 * zero pricing, so cost is only knowable through an injected tracker. Hence two
 * flat numbers rather than a live tracker reference.
 */
export interface LoopContext {
  /** Tokens spent so far this run. Always available - providers report usage. */
  totalTokens: number;
  /** USD spent so far, or `null` when no priced `CostTracker` was injected. */
  totalCostUsd: number | null;
  /** Provider label, for `COST_LIMIT`'s `provider` field. */
  provider?: string;
}

/** Which budget stopped the run. */
export type CapKind = 'iterations' | 'tokens' | 'cost';

/** A budget stop, in the shape the UI and the `ask_user` question both need. */
export interface CapStop {
  kind: CapKind;
  /** The configured ceiling that was hit. */
  limit: number;
  /** What the run had actually reached. */
  used: number;
  /** One sentence naming the budget, the usage, and the remedy. */
  reason: string;
}

/** The slice of `[agent]` config this module reads. */
export interface CapConfigInput {
  maxIterations?: number;
  maxTokens?: number;
  maxCostUsd?: number;
}

/**
 * Pull the cap budgets out of a config bag, narrowing as it goes.
 *
 * `ToolContext.config` is typed `Record<string, unknown>` (P-140), not `Config`,
 * so reading `[agent]` out of it is a narrowing job rather than a lookup. Doing
 * it here — with no casts — means the cap is the one place that knows how to
 * read its own settings, and the rule is unit-tested instead of being spread
 * through the loop as a chain of `typeof` checks.
 *
 * Anything non-numeric, negative, or NaN is treated as absent, which lands on
 * the same "budget off" default rather than on a limit nobody configured.
 */
export function readCapConfig(
  raw: Record<string, unknown> | undefined
): CapConfigInput | undefined {
  if (raw === undefined) return undefined;
  const agent = raw['agent'];
  if (agent === null || typeof agent !== 'object') return undefined;
  const bag = agent as Record<string, unknown>;
  const out: CapConfigInput = {};
  for (const key of ['maxIterations', 'maxTokens', 'maxCostUsd'] as const) {
    const value = bag[key];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Read a budget, treating `0` and absent as OFF.
 *
 * The single place that decides what `0` means, so the config default, the
 * guard, and the tests cannot drift apart.
 */
function budgetOf(value: number | undefined): number | undefined {
  if (value === undefined || value <= 0) return undefined;
  return value;
}

/**
 * Resolve the cap for one run: explicit override, then config, then the
 * caller's own `maxIterations`, then the built-in default.
 *
 * Pure, and ordered so the most specific source wins. `legacyMaxIterations` is
 * `LoopConfig.maxIterations`, which predates this phase and is still the
 * authoritative iteration count when no cap and no config say otherwise —
 * dropping it would silently change the bound every existing caller relies on.
 */
export function resolveCap(
  config?: CapConfigInput,
  override?: LoopCap,
  legacyMaxIterations?: number
): LoopCap {
  if (override !== undefined) return override;
  const fromConfig = config?.maxIterations;
  const maxIterations =
    fromConfig !== undefined && fromConfig > 0
      ? fromConfig
      : legacyMaxIterations !== undefined && legacyMaxIterations > 0
        ? legacyMaxIterations
        : DEFAULT_MAX_ITERATIONS;
  const resolved: LoopCap = { maxIterations };
  const maxTokens = budgetOf(config?.maxTokens);
  if (maxTokens !== undefined) resolved.maxTokens = maxTokens;
  const maxCostUsd = budgetOf(config?.maxCostUsd);
  if (maxCostUsd !== undefined) resolved.maxCostUsd = maxCostUsd;
  return resolved;
}

/**
 * The per-iteration budget check (P-164 step 2).
 *
 * `check(iterations, ctx)` is the spec's signature. `Result<void, StitchError>`
 * is the spec's return type, and a stop is an error because a capped run did not
 * finish its job — there is no partial success to return.
 */
export class LoopCapGuard {
  #cap: LoopCap;
  #lastStop: CapStop | undefined;
  #raises = 0;

  constructor(cap: LoopCap) {
    this.#cap = cap;
  }

  /**
   * The cap currently in force.
   *
   * A getter over a private field rather than a `readonly` property, because a
   * raise has to change it. Keeping the raise counter and the cap on the SAME
   * object is deliberate: a caller that rebuilt the guard from a raised cap
   * would reset the counter and make the bound in {@link canRaise} unreachable.
   */
  get cap(): LoopCap {
    return this.#cap;
  }

  /** The most recent budget stop, for the loop's error message and the HIL ask. */
  get lastStop(): CapStop | undefined {
    return this.#lastStop;
  }

  /** How many times this run has already had its budget widened. */
  get raises(): number {
    return this.#raises;
  }

  /**
   * May the budget be widened right now?
   *
   * Checked by the loop BEFORE it parks a question, so a run that has already
   * spent its raises does not ask a human a question whose only possible answer
   * is "no".
   */
  canRaise(): boolean {
    if (this.#cap.autoRaiseBudget !== true) return false;
    return this.#raises < (this.#cap.maxRaises ?? 1);
  }

  /**
   * May iteration `iterations` begin? `Result<void, StitchError>`.
   *
   * Checked in budget order — iterations, then tokens, then cost — so the reason
   * reported is the first one actually exceeded, which is the one an operator
   * needs to change. Never throws.
   */
  check(iterations: number, ctx: LoopContext): Result<void, StitchError> {
    // 1. Iterations. See the off-by-one note at the top of the file: `>=`, not
    //    the spec's `>`, so exactly `maxIterations` calls are allowed.
    if (iterations >= this.cap.maxIterations) {
      const used = iterations;
      const stop: CapStop = {
        kind: 'iterations',
        limit: this.cap.maxIterations,
        used,
        reason: `The agent used all ${this.cap.maxIterations} iterations without finishing (${describeUsage(ctx)}).`,
      };
      this.#lastStop = stop;
      return err({ code: 'LOOP_LIMIT', message: stop.reason });
    }

    // 2. Tokens. Always enforceable: providers report usage per turn, so the
    //    loop knows the running total whether or not a tracker was injected.
    const maxTokens = budgetOf(this.cap.maxTokens);
    if (maxTokens !== undefined && ctx.totalTokens > maxTokens) {
      const stop: CapStop = {
        kind: 'tokens',
        limit: maxTokens,
        used: ctx.totalTokens,
        reason: `This run used ${ctx.totalTokens} tokens, over its budget of ${maxTokens}.`,
      };
      this.#lastStop = stop;
      return err({
        code: 'TOKEN_LIMIT',
        spentTokens: ctx.totalTokens,
        limitTokens: maxTokens,
        message: stop.reason,
      });
    }

    // 3. Cost. Needs an injected, priced tracker — see the module header.
    const maxCostUsd = budgetOf(this.cap.maxCostUsd);
    if (maxCostUsd !== undefined) {
      if (ctx.totalCostUsd === null) {
        // Refusing is the safe direction: an unenforceable spend cap must not
        // read as an enforced one.
        return err({
          code: 'CONFIG_ERROR',
          field: 'agent.maxCostUsd',
          message:
            'A USD budget is configured but no priced CostTracker was supplied, so the cap cannot be enforced. Pass LoopConfig.cost, or set maxCostUsd to 0 to turn the budget off.',
        });
      }
      if (ctx.totalCostUsd > maxCostUsd) {
        const stop: CapStop = {
          kind: 'cost',
          limit: maxCostUsd,
          used: ctx.totalCostUsd,
          reason: `This run spent $${ctx.totalCostUsd}, over its budget of $${maxCostUsd}.`,
        };
        this.#lastStop = stop;
        return err({
          code: 'COST_LIMIT',
          provider: ctx.provider ?? 'unknown',
          spentUsd: ctx.totalCostUsd,
          limitUsd: maxCostUsd,
          message: stop.reason,
        });
      }
    }

    return ok(undefined);
  }

  /**
   * Widen the cap after a human said yes (P-164 step 5).
   *
   * Doubles the CURRENT value of the budget that was hit — not the value the
   * stop recorded. Doubling the stop's limit would make every raise after the
   * first a no-op that still consumed the allowance, which reads as "the human
   * said yes and nothing happened". The stop is consulted only for *which*
   * budget to widen.
   *
   * Refuses — leaving the cap unchanged — unless `autoRaiseBudget` is on AND the
   * raise allowance is not spent, so "never auto-enable more budget" is a
   * property of this class rather than a convention the loop has to remember.
   * Call {@link canRaise} first; this stays defensive so a direct caller cannot
   * bypass the bound.
   */
  raise(stop: CapStop): LoopCap {
    if (!this.canRaise()) return this.#cap;
    this.#raises += 1;
    const next: LoopCap = { ...this.#cap };
    if (stop.kind === 'iterations') next.maxIterations = this.#cap.maxIterations * 2;
    if (stop.kind === 'tokens') next.maxTokens = (this.#cap.maxTokens ?? stop.limit) * 2;
    if (stop.kind === 'cost') next.maxCostUsd = (this.#cap.maxCostUsd ?? stop.limit) * 2;
    this.#cap = next;
    return this.#cap;
  }
}

/** The usage tail appended to an iteration stop, so the reason carries context. */
function describeUsage(ctx: LoopContext): string {
  const dollars = ctx.totalCostUsd === null ? 'cost untracked' : `$${ctx.totalCostUsd}`;
  return `${ctx.totalTokens} tokens, ${dollars}`;
}
