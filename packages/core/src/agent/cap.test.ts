// P-164 tests: the loop cap.
//
// The cap is a safety mechanism, so the tests are organised around the ways it
// could fail to protect:
//
//   - it must actually stop the loop (not just report, while the loop runs on)
//   - it must not fire early, and must not fire late
//   - "0 means off" must hold, or the default config would kill every run
//   - a budget that CANNOT be enforced must say so rather than pass silently
//   - raising a budget requires a human, always, and never happens by default
//
// The loop tests drive the real `runToolLoop` rather than the guard alone,
// because the whole point of moving the cap out of the `for` condition was that
// the guard is the authority. A guard tested only in isolation would pass even
// if the loop had kept its own bound and never consulted it.

import { describe, it, expect, afterEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { ok, type Result } from 'neverthrow';
import {
  LoopCapGuard,
  resolveCap,
  readCapConfig,
  DEFAULT_MAX_ITERATIONS,
  type CapStop,
  type LoopContext,
} from './cap.js';
import { HilQueue } from './hil.js';
import { defaultAutonomyPolicy } from './policy.js';
import { ReasoningStream } from './reasoning.js';
import { AgentStateMachine } from './state.js';
import { runToolLoop } from '../ai/loop.js';
import { MockProvider } from '../ai/mock.js';
import { CostTracker } from '../ai/cost.js';
import { defaultConfig } from '../config/schema.js';
import type { ModelSpec } from '../ai/models.js';
import type {
  DbLike,
  LoopCapLike,
  SQLiteRow,
  SQLiteValue,
  StatementLike,
  StitchError,
  ToolDefinition,
} from '../index.js';

/** A priced model, so cost caps have something real to measure. */
const PRICED_MODEL: ModelSpec = {
  id: 'priced/model',
  provider: 'mock',
  contextWindow: 128000,
  supportsTools: true,
  toolCalling: 'allowed',
  maxOutput: 4096,
  // Per-million prices, as `ai/cost.ts` expects: it divides by 1e6.
  cost: { input: 3, output: 15 },
  recommendedFor: [],
};

/** A context where both budgets are comfortably unexceeded. */
function ctx(over: Partial<LoopContext> = {}): LoopContext {
  return { totalTokens: 0, totalCostUsd: 0, ...over };
}

/** A tool that always succeeds, so the loop keeps asking for iterations. */
const noop: ToolDefinition = {
  name: 'noop',
  description: 'does nothing and succeeds',
  schema: { x: z.string().optional() },
  autonomy: 'auto',
  execute: async (): Promise<Result<unknown, StitchError>> => ok('done'),
};

/** A provider that always asks for another tool call, so the loop never ends. */
function loopingProvider(usage = { input: 10, output: 5, total: 15 }): MockProvider {
  return new MockProvider({
    script: [
      { kind: 'tool_call', toolCall: { id: 'c1', name: 'noop', arguments: {} } },
      { kind: 'finish', finishReason: 'tool_calls', usage },
    ],
  });
}

/** Run the loop with a cap and report what came back. */
async function run(
  provider: MockProvider,
  cap: LoopCapLike,
  extra: {
    cost?: CostTracker;
    hilQueue?: HilQueue;
    reasoning?: ReasoningStream;
    stateMachine?: AgentStateMachine;
    legacyMaxIterations?: number;
  } = {}
): Promise<{ error?: StitchError; provider: MockProvider }> {
  const result = await runToolLoop(provider, [noop], [{ role: 'user', content: 'go' }], {
    // Deliberately generous: the cap under test, not this, must stop the run.
    maxIterations: extra.legacyMaxIterations ?? 500,
    policy: defaultAutonomyPolicy(),
    cap,
    ...(extra.cost !== undefined ? { cost: extra.cost } : {}),
    ...(extra.hilQueue !== undefined ? { hilQueue: extra.hilQueue } : {}),
    ...(extra.reasoning !== undefined ? { reasoning: extra.reasoning } : {}),
    ...(extra.stateMachine !== undefined ? { stateMachine: extra.stateMachine } : {}),
  });
  return {
    ...(result.isErr() ? { error: result._unsafeUnwrapErr() } : {}),
    provider,
  };
}

describe('P-164 loop cap', () => {
  it('caps iterations', async () => {
    const guard = new LoopCapGuard({ maxIterations: 3 });

    // Iterations 0..2 are allowed; the guard refuses the one that would be
    // the fourth. `>=`, not the spec's `>`, which together with "consult at the
    // top of each iteration" would have permitted a fourth call.
    for (const n of [0, 1, 2]) {
      expect(guard.check(n, ctx()).isOk(), `iteration ${n}`).toBe(true);
    }
    const refused = guard.check(3, ctx());
    expect(refused.isErr()).toBe(true);
    if (refused.isErr()) expect(refused.error.code).toBe('LOOP_LIMIT');
    expect(guard.lastStop?.kind).toBe('iterations');
    expect(guard.lastStop?.limit).toBe(3);
    expect(guard.lastStop?.used).toBe(3);

    // A real, resolved cap must satisfy the loop's structural seam — the eighth
    // ADR-030 seam. `ai/loop.ts` depends on `LoopCapLike`, not on this class, so
    // a `LoopCap` has to be usable as one with no nominal link between them.
    const resolved: LoopCapLike = resolveCap({ maxIterations: 3 });
    expect(resolved.maxIterations).toBe(3);
    const viaSeam = await run(loopingProvider(), resolved);
    expect(viaSeam.error?.code).toBe('LOOP_LIMIT');
    expect(viaSeam.provider.calls).toBe(3);

    // Through the real loop: exactly `maxIterations` provider calls, not four,
    // not two. This is the assertion that the guard is the authority rather than
    // a second opinion the loop's own `for` bound pre-empted.
    const provider = loopingProvider();
    const { error } = await run(provider, { maxIterations: 3 });
    expect(error?.code).toBe('LOOP_LIMIT');
    expect(provider.calls).toBe(3);

    // The reason carries the limit AND the usage, so a user can see why it
    // stopped without opening a log.
    const message = error === undefined ? '' : 'message' in error ? String(error.message) : '';
    expect(message).toContain('3 iterations');
    expect(message).toContain('45 tokens');
  });

  it('caps tokens', async () => {
    const guard = new LoopCapGuard({ maxIterations: 100, maxTokens: 100 });

    // At the limit is still fine; over it is not. A cap that fired AT the
    // budget would stop a run that had not yet exceeded it.
    expect(guard.check(0, ctx({ totalTokens: 100 })).isOk()).toBe(true);
    const over = guard.check(0, ctx({ totalTokens: 101 }));
    expect(over.isErr()).toBe(true);
    if (over.isErr()) {
      expect(over.error.code).toBe('TOKEN_LIMIT');
      // TOKEN_LIMIT (new in this phase) carries its own numbers, so a stopped
      // run is distinguishable from one that hit the dollar cap.
      if (over.error.code === 'TOKEN_LIMIT') {
        expect(over.error.spentTokens).toBe(101);
        expect(over.error.limitTokens).toBe(100);
        expect(over.error.message).toContain('101');
      }
    }
    expect(guard.lastStop?.kind).toBe('tokens');

    // Through the real loop. 15 tokens per turn, so a 25-token cap stops after
    // two turns (30 > 25) — the token budget, not the iteration cap.
    const provider = loopingProvider();
    const { error } = await run(provider, { maxIterations: 100, maxTokens: 25 });
    expect(error?.code).toBe('TOKEN_LIMIT');
    expect(provider.calls).toBe(2);
    expect(guard.lastStop).toBeDefined();
  });

  it('caps cost', async () => {
    const cost = new CostTracker(PRICED_MODEL);
    // 1M input tokens at $3/M = $3.00. A $1 cap is exceeded on the first turn.
    cost.add({ input: 1_000_000, output: 0, total: 1_000_000 });
    expect(cost.totalCost).toBeCloseTo(3, 6);

    const guard = new LoopCapGuard({ maxIterations: 100, maxCostUsd: 1 });
    const over = guard.check(0, {
      totalTokens: 0,
      totalCostUsd: cost.totalCost,
      provider: 'mock',
    });
    expect(over.isErr()).toBe(true);
    if (over.isErr()) {
      expect(over.error.code).toBe('COST_LIMIT');
      if (over.error.code === 'COST_LIMIT') {
        expect(over.error.provider).toBe('mock');
        expect(over.error.spentUsd).toBeCloseTo(3, 6);
        expect(over.error.limitUsd).toBe(1);
        // P-164: COST_LIMIT gained an optional `message` so a cap stop can
        // carry its reason the way LOOP_LIMIT and TOKEN_LIMIT do.
        expect(over.error.message).toContain('$3');
      }
    }
    expect(guard.lastStop?.kind).toBe('cost');

    // Under budget passes.
    expect(guard.check(0, { totalTokens: 0, totalCostUsd: 0.5, provider: 'mock' }).isOk()).toBe(
      true
    );

    // A CONFIGURED DOLLAR BUDGET WITH NO PRICED TRACKER IS REFUSED, NOT IGNORED.
    // The loop's own ModelSpec has zero pricing, so without an injected tracker
    // the cap is unenforceable — and a spend guard that silently does nothing
    // is worse than one that refuses.
    const untrackable = new LoopCapGuard({ maxIterations: 100, maxCostUsd: 1 }).check(0, {
      totalTokens: 999_999,
      totalCostUsd: null,
    });
    expect(untrackable.isErr()).toBe(true);
    if (untrackable.isErr()) {
      expect(untrackable.error.code).toBe('CONFIG_ERROR');
      if (untrackable.error.code === 'CONFIG_ERROR') {
        expect(untrackable.error.field).toBe('agent.maxCostUsd');
        expect(untrackable.error.message).toMatch(/cannot be enforced/i);
      }
    }

    // Through the real loop with a real tracker: the cap trips on cost.
    const tracked = new CostTracker(PRICED_MODEL);
    const provider = loopingProvider({ input: 1_000_000, output: 0, total: 1_000_000 });
    const { error } = await run(provider, { maxIterations: 100, maxCostUsd: 1 }, { cost: tracked });
    expect(error?.code).toBe('COST_LIMIT');
    // $3 on turn one, so it stops immediately rather than burning 100 turns.
    expect(provider.calls).toBe(1);
  });

  it('reads defaults from config', () => {
    // `[agent]` config supplies the budgets.
    const configured = resolveCap({ maxIterations: 7, maxTokens: 500, maxCostUsd: 2 });
    expect(configured).toEqual({ maxIterations: 7, maxTokens: 500, maxCostUsd: 2 });

    // The real shipped defaults: 20 iterations and both budgets OFF.
    const parsed = defaultConfig;
    expect(parsed.agent.maxIterations).toBe(DEFAULT_MAX_ITERATIONS);
    const fromRealConfig = resolveCap(
      readCapConfig({ agent: parsed.agent } as unknown as Record<string, unknown>)
    );
    expect(fromRealConfig.maxIterations).toBe(20);
    expect(fromRealConfig.maxTokens).toBeUndefined();
    expect(fromRealConfig.maxCostUsd).toBeUndefined();
    expect(defaultConfig.agent.maxTokens).toBe(0);

    // 0 MEANS OFF. Read literally as a limit, the default 0 would stop every
    // run on its first iteration — the single most dangerous way to misread
    // this config.
    const off = resolveCap({ maxIterations: 20, maxTokens: 0, maxCostUsd: 0 });
    expect(off.maxTokens).toBeUndefined();
    expect(off.maxCostUsd).toBeUndefined();
    expect(new LoopCapGuard(off).check(0, { totalTokens: 1e9, totalCostUsd: 999 }).isOk()).toBe(
      true
    );

    // Fallback order: legacy `maxIterations`, then the built-in default.
    expect(resolveCap(undefined, undefined, 42).maxIterations).toBe(42);
    expect(resolveCap(undefined, undefined, undefined).maxIterations).toBe(DEFAULT_MAX_ITERATIONS);
    // Config wins over legacy, and a per-task override wins over both.
    expect(resolveCap({ maxIterations: 7 }, undefined, 42).maxIterations).toBe(7);
    expect(resolveCap({ maxIterations: 7 }, { maxIterations: 3 }, 42).maxIterations).toBe(3);

    // `ToolContext.config` is `Record<string, unknown>`, so reading `[agent]`
    // out of it is a narrowing job. Everything unusable is treated as absent
    // and therefore as "off", never as a limit nobody set.
    expect(readCapConfig(undefined)).toBeUndefined();
    // No `[agent]` block at all is also `undefined`, which lands on the same
    // "no cap configured" path as an empty one.
    expect(readCapConfig({})).toBeUndefined();
    expect(readCapConfig({ agent: 'nope' })).toBeUndefined();
    expect(readCapConfig({ agent: { maxTokens: 'lots', maxCostUsd: -5 } })).toEqual({});
    expect(readCapConfig({ agent: { maxIterations: 3, maxTokens: 9 } })).toEqual({
      maxIterations: 3,
      maxTokens: 9,
    });
    // NaN is finite-looking enough to slip through a naive typeof check.
    expect(readCapConfig({ agent: { maxTokens: Number.NaN } })).toEqual({});
  });

  it('stops loop on limit with usage', async () => {
    const reasoning = new ReasoningStream();
    const machine = new AgentStateMachine();
    const provider = loopingProvider();
    const { error } = await run(
      provider,
      { maxIterations: 2 },
      { reasoning, stateMachine: machine }
    );

    // Stopped, with a reason a user can read.
    expect(error?.code).toBe('LOOP_LIMIT');
    const message = error === undefined ? '' : 'message' in error ? String(error.message) : '';
    expect(message).toMatch(/2 iterations/);
    expect(message).toMatch(/30 tokens/);
    expect(message).toMatch(/cost untracked/);

    // The lifecycle knows the run ended: P-159 requires `error`, and a job
    // left in `iterating` is indistinguishable from a running one.
    expect(machine.state).toBe('error');

    // The handoff note asks for a `complete`-style event so a UI shows a
    // non-error termination. `length` is the honest FinishReason: the run ended
    // because a limit was reached, not because the model chose to stop.
    const events = reasoning.dump();
    const complete = events.filter(e => e.type === 'complete');
    expect(complete).toHaveLength(1);
    if (complete[0]?.type === 'complete') {
      expect(complete[0].finishReason).toBe('length');
    }
    // And no `streaming` transition was published for the refused iteration —
    // an iteration that never ran must not appear as though it did.
    const streaming = events.filter(e => e.type === 'state' && e.to === 'streaming');
    expect(streaming).toHaveLength(2);

    // Every one of the six spec'd codes is reachable and distinguishable.
    const codeOf = async (
      c: LoopCapLike,
      extra?: Parameters<typeof run>[2]
    ): Promise<string | undefined> => (await run(loopingProvider(), c, extra)).error?.code;
    expect(await codeOf({ maxIterations: 1 })).toBe('LOOP_LIMIT');
    expect(await codeOf({ maxIterations: 9, maxTokens: 1 })).toBe('TOKEN_LIMIT');
    expect(
      await codeOf(
        { maxIterations: 9, maxCostUsd: 0.0001 },
        { cost: new CostTracker(PRICED_MODEL) }
      )
    ).toBe('COST_LIMIT');
    expect(await codeOf({ maxIterations: 9, maxCostUsd: 1 })).toBe('CONFIG_ERROR');
  });

  it('autoRaiseBudget off by default', async () => {
    // OFF unless asked for. A loop that widened its own budget would make the
    // cap advisory, and an advisory spend limit is not a limit.
    expect(resolveCap({ maxIterations: 3 }).autoRaiseBudget).toBeUndefined();
    const guard = new LoopCapGuard({ maxIterations: 3 });
    const stop: CapStop = { kind: 'iterations', limit: 3, used: 3, reason: 'hit' };
    expect(guard.raise(stop)).toEqual({ maxIterations: 3 });
    expect(guard.raise(stop).maxIterations).toBe(3);

    // Off, with a queue present: no question is asked and the run stops.
    const quiet = freshQueue();
    const quietProvider = loopingProvider();
    const { error } = await run(quietProvider, { maxIterations: 2 }, { hilQueue: quiet.queue });
    expect(error?.code).toBe('LOOP_LIMIT');
    expect(quietProvider.calls).toBe(2);
    expect(quiet.queue.listForUser()._unsafeUnwrap()).toHaveLength(0);

    // Off, with no queue: still stops. It cannot ask, so it does not proceed.
    const headless = await run(loopingProvider(), { maxIterations: 2, autoRaiseBudget: true });
    expect(headless.error?.code).toBe('LOOP_LIMIT');

    // ON, and a human approves: the budget doubles and the run continues — then
    // STOPS, because the raise allowance is spent. An always-approving human
    // would otherwise double the cap, resume, hit it, ask again, and run
    // forever: the phase's central promise is that spend is bounded.
    const asked = freshQueue();
    // Record what the human was actually shown. `listForUser` only lists
    // PENDING requests, so it reads empty afterwards precisely BECAUSE the
    // question was answered — which is the outcome, not the evidence.
    const shown: string[] = [];
    const answerer = setInterval(() => {
      for (const req of asked.queue.listForUser()._unsafeUnwrap()) {
        if (asked.queue.get(req.id)._unsafeUnwrap()?.status === 'pending') {
          shown.push(req.id);
          asked.queue.resolve(req.id, { resolution: 'approved', by: 'tester', note: 'yes' });
        }
      }
    }, 5);
    try {
      const provider = loopingProvider();
      const raised = await run(
        provider,
        { maxIterations: 2, autoRaiseBudget: true },
        { hilQueue: asked.queue }
      );
      // Iterations 0 and 1 ran under the original cap, so 2 provider calls. The
      // refused iteration 2 consumed the raise, and `continue` in a `for` runs
      // the increment, so the raised ceiling of 4 buys exactly one more call
      // before stopping. The refused iteration counting against the cap is
      // deliberate: it is what guarantees termination, and a ceiling is a
      // maximum rather than a promise of exactly that many calls.
      expect(provider.calls).toBe(3);
      expect(raised.error?.code).toBe('LOOP_LIMIT');
      // It really did ask a human first, and got a recorded answer.
      expect(shown.length).toBeGreaterThan(0);
      const resolution = asked.queue.resolutionFor(shown[0] ?? '')._unsafeUnwrap();
      expect(resolution?.resolution).toBe('approved');
    } finally {
      clearInterval(answerer);
    }

    // The bound is on the guard, so it holds however a caller reaches it.
    // Doubling the CURRENT cap, not the stop's recorded limit: a second raise
    // that recomputed from the stale stop would return 4 again — a no-op that
    // still consumed the allowance, reading as "approved and nothing happened".
    const bounded = new LoopCapGuard({ maxIterations: 2, autoRaiseBudget: true, maxRaises: 2 });
    const hit: CapStop = { kind: 'iterations', limit: 2, used: 2, reason: 'hit' };
    expect(bounded.canRaise()).toBe(true);
    expect(bounded.raise(hit).maxIterations).toBe(4);
    expect(bounded.canRaise()).toBe(true);
    expect(bounded.raise(hit).maxIterations).toBe(8);
    expect(bounded.canRaise()).toBe(false);
    // Refuses, and leaves the cap alone.
    expect(bounded.raise(hit).maxIterations).toBe(8);
    expect(bounded.raises).toBe(2);
    // The counter survives the cap changing, because they are one object.
    expect(bounded.cap.maxIterations).toBe(8);
  });
});

// ---------------------------------------------------------------------------
// node:sqlite DbLike adapter — `bun:sqlite` is unavailable in vitest.
// ---------------------------------------------------------------------------

function makeAdapter(path: string): DbLike {
  const raw = new DatabaseSync(path);
  const toInput = (p: SQLiteValue[]): (string | number | bigint | null | Uint8Array)[] =>
    p.map(v => (typeof v === 'boolean' ? (v ? 1 : 0) : v));
  const wrap = (stmt: {
    all(...p: (string | number | bigint | null | Uint8Array)[]): Record<string, unknown>[];
    get(
      ...p: (string | number | bigint | null | Uint8Array)[]
    ): Record<string, unknown> | undefined;
    run(...p: (string | number | bigint | null | Uint8Array)[]): {
      changes: number | bigint;
      lastInsertRowid: number | bigint;
    };
  }): StatementLike => ({
    all: (...p) => stmt.all(...toInput(p)) as SQLiteRow[],
    get: (...p) => (stmt.get(...toInput(p)) as SQLiteRow | undefined) ?? null,
    run: (...p) => {
      const r = stmt.run(...toInput(p));
      return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
    },
  });
  return {
    exec: sql => raw.exec(sql),
    query: sql => wrap(raw.prepare(sql)),
    close: () => raw.close(),
  };
}

const dirs: string[] = [];
const dbs: DbLike[] = [];

function freshQueue(): { queue: HilQueue } {
  const dir = mkdtempSync(join(tmpdir(), 'stitch-cap-'));
  dirs.push(dir);
  const db = makeAdapter(join(dir, 'hil.db'));
  dbs.push(db);
  let tick = 0;
  const queue = new HilQueue({
    db,
    now: () => `t${(tick += 1)}`,
    newId: () => `id${(tick += 1)}`,
  });
  return { queue };
}

afterEach(() => {
  // Close before deleting: Windows will not remove a directory that still has
  // an open file handle, and the open handle outlives the test.
  for (const db of dbs.splice(0)) {
    try {
      db.close();
    } catch {
      // Already closed; the directory removal below is what matters.
    }
  }
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});
