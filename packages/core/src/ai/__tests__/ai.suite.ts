// P-147 — full AI stack integration suite.
//
// Glues every AI module together through the real tool loop: prompts -> context
// -> model -> tool adapter -> retry -> cost -> audit -> switch. Every scenario
// runs against `MockProvider` (P-144), so the suite is fully offline and
// deterministic. This is the regression net for `core/src/ai/*`.
//
// Live-provider tests are opt-in via `STITCH_AI_LIVE=1` (spec step 4); nothing
// here reaches the network without it.
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import type { DbLike, SQLiteRow, SQLiteValue, StatementLike } from '../../store/schema.js';
import { AiAuditLog, PROVIDER_SWITCH_TASK } from '../audit.js';
import { CostTracker } from '../cost.js';
import { MODELS } from '../models.js';
import { enforceToolCallPolicy } from '../block.js';
import { ProviderManager } from '../switch.js';
import { clearActiveProviderForTests } from '../registry.js';
import { trimMessages, estimateWindowUsage } from '../context.js';
import { promptVersion } from '../prompts.js';
import { runToolLoop } from '../loop.js';
import { MockProvider, type MockConfig } from '../mock.js';
import { isRetryableError, type ChatProvider } from '../provider.js';
import { createFakeRepo, toolDefs, type FakeRepo } from './fixtures/tool-defs.js';
import type { ChatMessage, ModelSpec, ProviderError, ToolCall } from '../types.js';

/** `node:sqlite`-backed `DbLike` (vitest runs on Node; `bun:sqlite` is unavailable). */
function makeAdapter(path = ':memory:'): DbLike {
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

const TEST_MESSAGES: ChatMessage[] = [{ role: 'user', content: 'Read src/app.ts' }];

/** Tool call helper for scripts. */
function call(id: string, name: string, args: Record<string, unknown>): ToolCall {
  return { id, name, arguments: args };
}

/**
 * A ChatProvider that serves one `MockConfig` script per call, in order.
 *
 * `MockProvider` deliberately replays a single script forever (P-144) — right
 * for unit tests, but unable to express a multi-turn loop. This queues per-turn
 * `MockProvider` instances so every turn is still driven by a real
 * `MockProvider` script rather than a hand-rolled fake.
 */
function queuedProvider(turns: MockConfig[]): ChatProvider {
  const queue = turns.map(t => new MockProvider(t));
  const head = queue[0]!;
  let index = 0;
  return {
    name: head.name,
    model: head.model,
    provider: head.provider,
    id: head.id,
    chat(...args: Parameters<MockProvider['chat']>): ReturnType<MockProvider['chat']> {
      const current = queue[Math.min(index, queue.length - 1)]!;
      index++;
      return current.chat(...args);
    },
    countTokens: (messages: ChatMessage[]): number =>
      messages.reduce((n, m) => n + Math.ceil(m.content.length / 4), 0),
    isRetryable: (e: ProviderError): boolean => isRetryableError(e),
  };
}

beforeEach(() => {
  clearActiveProviderForTests();
});

afterEach(() => {
  clearActiveProviderForTests();
});

describe('P-147 AI suite: happy loop executes tool', () => {
  it('happy loop executes tool', async () => {
    const repo: FakeRepo = createFakeRepo({ 'src/app.ts': 'export const x = 1;' });
    const tools = toolDefs(repo);
    const audit = new AiAuditLog(makeAdapter(), { flushEvery: 1 });

    // Turn 1 asks for a tool; turn 2 is satisfied with the result.
    const provider = queuedProvider([
      {
        script: [
          {
            kind: 'tool_call',
            toolCall: call('c1', 'read_file', { path: 'src/app.ts' }),
          },
          {
            kind: 'finish',
            finishReason: 'tool_calls',
            usage: { input: 10, output: 5, total: 15 },
          },
        ],
      },
      {
        script: [
          { kind: 'text', text: 'The file exports x.' },
          { kind: 'finish', finishReason: 'stop', usage: { input: 20, output: 8, total: 28 } },
        ],
      },
    ]);

    const result = await runToolLoop(provider, tools, TEST_MESSAGES, { maxIterations: 4, audit });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const loopResult = result.value;
      // The tool actually ran, with args parsed through the Zod adapter.
      expect(loopResult.toolCalls.map(t => t.name)).toEqual(['read_file']);
      // Two iterations: the tool call, then the final stop.
      expect(loopResult.iterations).toBe(2);
      expect(loopResult.finishReason).toBe('stop');
      expect(loopResult.finalContent).toContain('The file exports x.');

      // The tool's reply is in the conversation, carrying the file content.
      const toolReplies = loopResult.messages.filter(m => m.role === 'tool');
      expect(toolReplies).toHaveLength(1);
      expect(toolReplies[0]?.content).toContain('export const x = 1;');
      expect(toolReplies[0]?.toolCallId).toBe('c1');
    }

    // Both provider calls are audited, each carrying the prompt version.
    const rows = await audit.query();
    expect(rows).toHaveLength(2);
    expect(rows.every(r => r.promptVersion === promptVersion())).toBe(true);
  });
});

describe('P-147 AI suite: retries on retryable error', () => {
  it('retries on retryable error', async () => {
    const repo = createFakeRepo({});
    const tools = toolDefs(repo);

    // Fails once with a retryable error, then succeeds.
    let callCount = 0;
    const inner = new MockProvider({
      script: [
        { kind: 'text', text: 'recovered after retry' },
        { kind: 'finish', finishReason: 'stop', usage: { input: 4, output: 4, total: 8 } },
      ],
    });
    const flaky: ChatProvider = {
      name: inner.name,
      model: inner.model,
      provider: inner.provider,
      id: inner.id,
      async *chat(...args: Parameters<MockProvider['chat']>) {
        callCount++;
        if (callCount === 1) {
          // Throw a real Error (never a literal) that still carries the
          // ProviderError fields, so the loop's retry predicate can classify it.
          const failure = Object.assign(new Error('429 slow down'), {
            kind: 'rate_limit',
            message: '429 slow down',
            providerName: 'mock',
            retryable: true,
          } satisfies ProviderError);
          throw failure;
        }
        yield* inner.chat(...args);
      },
      countTokens: (m: ChatMessage[]) => inner.countTokens(m),
      isRetryable: (e: ProviderError) => isRetryableError(e),
    };

    const result = await runToolLoop(flaky, tools, TEST_MESSAGES, {
      maxIterations: 2,
      retry: {
        attempts: 3,
        baseMs: 1,
        capMs: 2,
        jitter: false,
        retryable: e => (e as { retryable?: boolean })?.retryable === true,
      },
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.finalContent).toContain('recovered after retry');
      expect(result.value.retryCount).toBe(1);
    }
    // The loop called the provider twice (one failure, one success).
    expect(callCount).toBe(2);
  });
});

describe('P-147 AI suite: fails over to next provider', () => {
  it('fails over to next provider', async () => {
    const repo = createFakeRepo({});
    const tools = toolDefs(repo);
    const audit = new AiAuditLog(makeAdapter(), { flushEvery: 1 });

    const primary = new MockProvider({
      name: 'primary',
      failWith: {
        kind: 'rate_limit',
        message: 'primary is rate limited',
        providerName: 'primary',
        retryable: true,
      },
    });
    const failover = new MockProvider({
      name: 'failover',
      script: [
        { kind: 'text', text: 'failover answer' },
        { kind: 'finish', finishReason: 'stop', usage: { input: 6, output: 6, total: 12 } },
      ],
    });
    const manager = new ProviderManager(primary, [failover]);

    const result = await runToolLoop(primary, tools, TEST_MESSAGES, {
      maxIterations: 2,
      providerManager: manager,
      audit,
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.finalContent).toContain('failover answer');
      expect(result.value.failoverCount).toBe(1);
    }

    // The switch is audited with reason and from -> to.
    const switches = await audit.query({ task: PROVIDER_SWITCH_TASK });
    expect(switches).toHaveLength(1);
    expect(switches[0]?.switch?.from).toBe(primary.id);
    expect(switches[0]?.switch?.to).toBe(failover.id);
  });
});

describe('P-147 AI suite: trims context under budget', () => {
  it('trims context under budget', async () => {
    const model: ModelSpec = {
      id: 'test/model',
      provider: 'mock',
      contextWindow: 10000,
      supportsTools: true,
      toolCalling: 'allowed',
      maxOutput: 4096,
      cost: { input: 0, output: 0 },
      recommendedFor: ['test'],
    };

    const long = 'x'.repeat(2000);
    const messages: ChatMessage[] = [
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: long },
      { role: 'assistant', content: long },
      { role: 'user', content: long },
      { role: 'assistant', content: long },
    ];

    const { messages: trimmed, dropped } = trimMessages(messages, model, { safetyFactor: 0.5 });
    const usage = estimateWindowUsage(trimmed, model);
    const budget = Math.floor(model.contextWindow * 0.5) - model.maxOutput;

    expect(dropped).toBeGreaterThan(0);
    // System message is always preserved.
    expect(trimmed[0]?.role).toBe('system');
    // Result fits the budget.
    expect(usage).toBeLessThanOrEqual(budget);

    // The loop still runs to completion with a trimmed history.
    const provider = new MockProvider({
      script: [
        { kind: 'text', text: 'ok' },
        { kind: 'finish', finishReason: 'stop', usage: { input: 1, output: 1, total: 2 } },
      ],
    });
    const result = await runToolLoop(provider, [], trimmed, { maxIterations: 1 });
    expect(result.isOk()).toBe(true);
  });
});

describe('P-147 AI suite: enforces gemini tool block', () => {
  it('enforces gemini tool block', () => {
    const blocked = MODELS.find(m => m.toolCalling === 'blocked-by-default');
    if (!blocked) throw new Error('fixture: expected a blocked-by-default model');

    // Not opted in -> blocked.
    const notOptedIn = enforceToolCallPolicy(blocked, { overrideToolModels: [] });
    expect(notOptedIn.isErr()).toBe(true);
    if (notOptedIn.isErr()) {
      expect(notOptedIn.error.code).toBe('TOOL_CALLING_BLOCKED');
    }

    // Opted in via override -> allowed.
    const optedIn = enforceToolCallPolicy(blocked, {
      overrideToolModels: [blocked.id],
    });
    expect(optedIn.isOk()).toBe(true);
  });
});

describe('P-147 AI suite: caps loop iterations', () => {
  it('caps loop iterations', async () => {
    const repo = createFakeRepo({});
    const tools = toolDefs(repo);

    // A provider that always asks for a tool call (never stops).
    const looping = new MockProvider({
      script: [
        {
          kind: 'tool_call',
          toolCall: call('loop', 'read_file', { path: 'src/app.ts' }),
        },
        { kind: 'finish', finishReason: 'tool_calls' },
      ],
    });

    const result = await runToolLoop(looping, tools, TEST_MESSAGES, { maxIterations: 3 });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.code).toBe('LOOP_LIMIT');
    }
  });
});

describe('P-147 AI suite: tracks cost and audits calls', () => {
  it('tracks cost and audits calls', async () => {
    const repo = createFakeRepo({ 'a.ts': 'const a = 1;' });
    const tools = toolDefs(repo);
    const audit = new AiAuditLog(makeAdapter(), { flushEvery: 1 });

    // Use a real curated model so cost is priced.
    const spec = MODELS.find(m => m.cost.input > 0);
    if (!spec) throw new Error('fixture: expected a priced model');
    const provider = new MockProvider({
      name: `priced/${spec.id}`,
      model: spec.id,
      script: [
        { kind: 'text', text: 'done' },
        { kind: 'finish', finishReason: 'stop', usage: { input: 1000, output: 500, total: 1500 } },
      ],
    });

    const cost = new CostTracker(spec);
    const result = await runToolLoop(provider, tools, TEST_MESSAGES, {
      maxIterations: 1,
      cost,
      audit,
    });

    expect(result.isOk()).toBe(true);

    // CostTracker accumulated the usage.
    const tracked = cost.totalTokens;
    expect(tracked.input).toBe(1000);
    expect(tracked.output).toBe(500);
    expect(cost.totalCost).toBeGreaterThan(0);

    // AiAuditLog recorded a row with cost, latency, and prompt version.
    const rows = await audit.query();
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const row = rows[0]!;
    expect(row.inputTokens).toBe(1000);
    expect(row.outputTokens).toBe(500);
    expect(row.costUsd).toBeGreaterThan(0);
    expect(row.latencyMs).toBeGreaterThanOrEqual(0);
    expect(row.promptVersion).toBe(promptVersion());

    // costTotal reflects the same spend.
    expect(await audit.costTotal()).toBeCloseTo(row.costUsd, 6);
  });
});
