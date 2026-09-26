// P-162 tests: the reasoning stream.
//
// The stream is a pure in-process hub, so these tests are about ORDER and
// ISOLATION rather than I/O. Two properties get the most attention because they
// are the ones that would quietly break the product:
//
//   - a throwing subscriber must not break the agent loop (the whole point of
//     an observability layer is that it is less load-bearing than what it
//     observes), and
//   - a run that fails must still say so in the feed, because "the tool call
//     vanished" and "the tool call failed" are very different things to a user.
//
// The loop test drives the real `runToolLoop` with a `ReasoningStream` attached,
// because a correct-but-unwired stream would pass every other test while the
// product shipped with no reasoning at all.

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { ok, err, type Result } from 'neverthrow';
import {
  ReasoningStream,
  MAX_REASONING_HISTORY,
  reasoningText,
  type ReasoningEvent,
} from './reasoning.js';
import { AgentStateMachine } from './state.js';
import { defaultAutonomyPolicy } from './policy.js';
import { runToolLoop } from '../ai/loop.js';
import { MockProvider } from '../ai/mock.js';
import { CostTracker } from '../ai/cost.js';
import type { ToolDefinition } from '../ai/types.js';
import type { StitchError } from '../result/index.js';
import type { ChatMessage } from '../index.js';

function testTool(
  name: string,
  execute: ToolDefinition['execute'],
  autonomy: 'auto' | 'gated' = 'auto'
): ToolDefinition {
  return {
    name,
    description: `test tool ${name}`,
    schema: { path: z.string() },
    autonomy,
    execute,
  };
}

/** A provider that scripts a fixed sequence of turns. */
function scriptedProvider(turns: MockProvider[]): Parameters<typeof runToolLoop>[0] {
  let i = 0;
  return {
    name: 'mock',
    model: 'mock-model',
    provider: 'mock' as const,
    id: 'mock/mock-model',
    chat: (...a: Parameters<MockProvider['chat']>) =>
      turns[Math.min(i++, turns.length - 1)]!.chat(...a),
    countTokens: (messages: ChatMessage[]) =>
      messages.reduce((n, m) => n + Math.ceil(m.content.length / 4), 0),
    isRetryable: () => false,
  } as unknown as Parameters<typeof runToolLoop>[0];
}

describe('P-162 ReasoningStream', () => {
  it('delivers subscribed events', () => {
    const stream = new ReasoningStream();
    const a: ReasoningEvent[] = [];
    const b: ReasoningEvent[] = [];

    const stopA = stream.subscribe(e => a.push(e));
    stream.subscribe(e => b.push(e));
    expect(stream.listenerCount).toBe(2);

    stream.emit({ type: 'state', from: 'idle', to: 'loading' });
    stream.emit({ type: 'complete', finishReason: 'stop' });

    expect(a).toHaveLength(2);
    expect(b).toHaveLength(2);
    expect(a[0]).toEqual({ type: 'state', from: 'idle', to: 'loading' });

    // Unsubscribing stops delivery to that listener only.
    stopA();
    expect(stream.listenerCount).toBe(1);
    stream.emit({ type: 'plan', text: 'after' });
    expect(a).toHaveLength(2);
    expect(b).toHaveLength(3);

    // Unsubscribing twice is harmless — a WS bridge that reconnects may tear
    // down more than once, and a double-remove must not corrupt the set.
    stopA();
    expect(stream.listenerCount).toBe(1);
    expect(() => stream.subscribe(() => undefined)()).not.toThrow();

    // A subscriber that attaches LATE does not see earlier events, and the
    // retained history is how it catches up. That is the whole point of `dump`.
    const late: ReasoningEvent[] = [];
    stream.subscribe(e => late.push(e));
    expect(late).toHaveLength(0);
    expect(stream.dump()).toHaveLength(3);

    // A THROWING SUBSCRIBER MUST NOT BREAK THE STREAM OR ITS PEERS. A WS bridge
    // with a closed socket cannot be allowed to fail the stitch.
    const stream2 = new ReasoningStream();
    const peer: ReasoningEvent[] = [];
    stream2.subscribe(() => {
      throw new Error('bridge is closed');
    });
    stream2.subscribe(e => peer.push(e));
    expect(() => stream2.emit({ type: 'plan', text: 'still works' })).not.toThrow();
    expect(peer).toHaveLength(1);
    expect(stream2.subscriberFailures).toBe(1);
    // ...and the history is unaffected by the failure.
    expect(stream2.dump()).toHaveLength(1);
  });

  it('dumps ordered events', () => {
    const stream = new ReasoningStream();
    // Order is the contract: a consumer renders in sequence, so an out-of-order
    // feed is a different story than the one that happened.
    stream.emit({ type: 'state', from: 'idle', to: 'loading' });
    stream.emit({ type: 'state', from: 'loading', to: 'preparing' });
    stream.emit({ type: 'policy', decision: { action: 'allow', reason: 'auto' }, tool: 't' });
    stream.emit({ type: 'tool_call', tool: 't', args: { a: 1 }, gate: 'auto' });
    stream.emit({ type: 'tool_result', tool: 't', ok: true, summary: 'fine' });
    stream.emit({ type: 'cost', totalCost: 0.5, tokens: { input: 1, output: 2, total: 3 } });
    stream.emit({ type: 'complete', finishReason: 'stop' });

    const dumped = stream.dump();
    expect(dumped.map(e => e.type)).toEqual([
      'state',
      'state',
      'policy',
      'tool_call',
      'tool_result',
      'cost',
      'complete',
    ]);
    // `dump` hands back a copy: mutating it must not corrupt the stream.
    dumped.push({ type: 'plan', text: 'injected' });
    expect(stream.dump()).toHaveLength(7);

    // The history is bounded, and the discards are REPORTED — a silently
    // truncated audit trail is indistinguishable from one that never happened.
    expect(MAX_REASONING_HISTORY).toBe(1000);
    const small = new ReasoningStream({ maxHistory: 3 });
    for (let i = 0; i < 6; i += 1) {
      small.emit({ type: 'plan', text: `p${i}` });
    }
    expect(small.dump()).toHaveLength(3);
    expect(small.dropped).toBe(3);
    // The OLDEST go, so a review shows the end of the run — where a problem is.
    expect(small.dump().map(e => (e as { text: string }).text)).toEqual(['p3', 'p4', 'p5']);

    // A nonsensical cap is clamped rather than producing a stream that keeps
    // nothing.
    const zero = new ReasoningStream({ maxHistory: 0 });
    zero.emit({ type: 'plan', text: 'x' });
    expect(zero.dump()).toHaveLength(1);

    zero.reset();
    expect(zero.dump()).toHaveLength(0);
    expect(zero.dropped).toBe(0);
    expect(zero.listenerCount).toBe(0);
  });

  it('loop emits all types', async () => {
    const stream = new ReasoningStream();
    const machine = new AgentStateMachine();
    // A REAL CostTracker, not a hand-rolled stand-in: the loop reads
    // `totalCost`/`totalTokens` back off the instance it was given, and a fake
    // that accumulates into a different object would silently report zero.
    const cost = new CostTracker({
      id: 'mock/mock-model',
      provider: 'mock',
      contextWindow: 128000,
      supportsTools: true,
      toolCalling: 'allowed',
      maxOutput: 4096,
      // Prices are PER MILLION TOKENS (`estimateCost` divides by 1e6), so a
      // per-token-looking figure rounds to zero at six decimal places and the
      // cost event would silently report nothing.
      cost: { input: 3, output: 15 },
      recommendedFor: [],
    });

    const first = new MockProvider({
      script: [
        { kind: 'text', text: 'I will inspect the tree first.' },
        {
          kind: 'tool_call',
          toolCall: { id: 'c1', name: 'auto_tool', arguments: { path: 'a.ts' } },
        },
        { kind: 'finish', finishReason: 'tool_calls' },
      ],
    });
    const second = new MockProvider({
      script: [
        { kind: 'text', text: 'Done.' },
        { kind: 'finish', finishReason: 'stop', usage: { input: 4, output: 6, total: 10 } },
      ],
    });

    const result = await runToolLoop(
      scriptedProvider([first, second]),
      [
        testTool('auto_tool', async () => ok('inspected')),
        testTool('gated_tool', async () => ok('approved'), 'gated'),
      ],
      [{ role: 'user', content: 'go' }],
      {
        maxIterations: 4,
        policy: defaultAutonomyPolicy(),
        stateMachine: machine,
        reasoning: stream,
        approvalGate: async () => true,
        cost,
      }
    );
    expect(result.isOk()).toBe(true);

    const events = stream.dump();
    const types = new Set(events.map(e => e.type));
    // The lifecycle transitions, the policy verdict, the call, the result, the
    // plan, the cost, and the completion are all present.
    expect(types.has('state')).toBe(true);
    expect(types.has('policy')).toBe(true);
    expect(types.has('tool_call')).toBe(true);
    expect(types.has('tool_result')).toBe(true);
    expect(types.has('plan')).toBe(true);
    expect(types.has('cost')).toBe(true);
    expect(types.has('complete')).toBe(true);

    // `complete` is LAST, so a consumer rendering in order never announces
    // completion while the lifecycle still says otherwise.
    expect(events[events.length - 1]?.type).toBe('complete');

    // State transitions are published in order, and each names both ends.
    const states = events.filter(e => e.type === 'state') as Extract<
      ReasoningEvent,
      { type: 'state' }
    >[];
    expect(states[0]).toEqual({ type: 'state', from: 'idle', to: 'loading' });
    for (let i = 1; i < states.length; i += 1) {
      expect(states[i]?.from).toBe(states[i - 1]?.to);
    }
    expect(states[states.length - 1]?.to).toBe('done');

    // The plan carries what the model actually streamed back.
    const plan = events.find(e => e.type === 'plan') as Extract<ReasoningEvent, { type: 'plan' }>;
    expect(plan?.text).toContain('inspect the tree');

    // The tool call names the tool and its GATE class, so a UI can show what is
    // about to be touched and whether a human is involved.
    const call = events.find(e => e.type === 'tool_call') as Extract<
      ReasoningEvent,
      { type: 'tool_call' }
    >;
    expect(call?.tool).toBe('auto_tool');
    expect(call?.gate).toBe('auto');

    // Cost is published as a running total, not a per-turn delta.
    const costEvent = events.find(e => e.type === 'cost') as Extract<
      ReasoningEvent,
      { type: 'cost' }
    >;
    expect(costEvent?.totalCost).toBeGreaterThan(0);
    expect(costEvent?.tokens.total).toBe(10);

    // The policy verdict is published BEFORE the gate is consulted, so a UI can
    // show "waiting on a human" the moment that becomes true.
    const policy = events.findIndex(e => e.type === 'policy');
    const gatedCall = events.findIndex(e => e.type === 'tool_call' && e.gate === 'gated');
    if (gatedCall >= 0) expect(policy).toBeLessThan(gatedCall);

    // With NO stream attached the loop still works — observability is opt-in.
    const quiet = new MockProvider({ script: [{ kind: 'text', text: 'ok' }] });
    const bare = await runToolLoop(
      scriptedProvider([quiet]),
      [],
      [{ role: 'user', content: 'go' }],
      { maxIterations: 2 }
    );
    expect(bare.isOk()).toBe(true);
  });

  it('flags tool failures', async () => {
    const stream = new ReasoningStream();

    const failing = new MockProvider({
      script: [
        { kind: 'tool_call', toolCall: { id: 'c1', name: 'boom', arguments: { path: 'a' } } },
        { kind: 'finish', finishReason: 'tool_calls' },
      ],
    });
    const after = new MockProvider({
      script: [
        { kind: 'text', text: 'recovered' },
        { kind: 'finish', finishReason: 'stop', usage: { input: 1, output: 1, total: 2 } },
      ],
    });

    const boom: Result<unknown, StitchError> = err({
      code: 'GIT_ERROR',
      message: 'fatal: could not read from remote repository',
    });
    const result = await runToolLoop(
      scriptedProvider([failing, after]),
      [testTool('boom', async () => boom)],
      [{ role: 'user', content: 'go' }],
      { maxIterations: 3, reasoning: stream, policy: defaultAutonomyPolicy() }
    );
    // A failing tool does not end the job: the model gets told and tries again.
    expect(result.isOk()).toBe(true);

    const results = stream.dump().filter(e => e.type === 'tool_result') as Extract<
      ReasoningEvent,
      { type: 'tool_result' }
    >[];
    expect(results).toHaveLength(1);
    expect(results[0]?.tool).toBe('boom');
    expect(results[0]?.ok).toBe(false);
    // The summary says what went wrong, so the UI is not reduced to "it broke".
    expect(results[0]?.summary).toContain('could not read from remote');

    // An UNKNOWN tool is reported too — a missing tool call must not vanish
    // silently, because "it never happened" and "it failed" read differently.
    const stream2 = new ReasoningStream();
    const unknownTurn = new MockProvider({
      script: [
        { kind: 'tool_call', toolCall: { id: 'c1', name: 'no_such_tool', arguments: {} } },
        { kind: 'finish', finishReason: 'tool_calls' },
      ],
    });
    const unknownAfter = new MockProvider({
      script: [
        { kind: 'text', text: 'ok' },
        { kind: 'finish', finishReason: 'stop', usage: { input: 1, output: 1, total: 2 } },
      ],
    });
    await runToolLoop(
      scriptedProvider([unknownTurn, unknownAfter]),
      [],
      [{ role: 'user', content: 'go' }],
      { maxIterations: 3, reasoning: stream2, policy: defaultAutonomyPolicy() }
    );
    const unknownResults = stream2.dump().filter(e => e.type === 'tool_result') as Extract<
      ReasoningEvent,
      { type: 'tool_result' }
    >[];
    expect(unknownResults).toHaveLength(1);
    expect(unknownResults[0]?.ok).toBe(false);
    expect(unknownResults[0]?.tool).toBe('no_such_tool');

    // A denied tool is reported as a result, not left to the policy event alone,
    // so a consumer rendering only tool activity still sees why nothing happened.
    const stream3 = new ReasoningStream();
    const gateTurn = new MockProvider({
      script: [
        { kind: 'tool_call', toolCall: { id: 'c1', name: 'gated_one', arguments: { path: 'a' } } },
        { kind: 'finish', finishReason: 'tool_calls' },
      ],
    });
    const gateAfter = new MockProvider({
      script: [
        { kind: 'text', text: 'ok' },
        { kind: 'finish', finishReason: 'stop', usage: { input: 1, output: 1, total: 2 } },
      ],
    });
    const ran: string[] = [];
    await runToolLoop(
      scriptedProvider([gateTurn, gateAfter]),
      [
        testTool(
          'gated_one',
          async () => {
            ran.push('x');
            return ok('nope');
          },
          'gated'
        ),
      ],
      [{ role: 'user', content: 'go' }],
      {
        maxIterations: 3,
        reasoning: stream3,
        policy: defaultAutonomyPolicy(),
        approvalGate: async () => false,
      }
    );
    expect(ran).toEqual([]);
    const denied = stream3.dump().filter(e => e.type === 'tool_result') as Extract<
      ReasoningEvent,
      { type: 'tool_result' }
    >[];
    expect(denied).toHaveLength(1);
    expect(denied[0]?.ok).toBe(false);
    expect(denied[0]?.summary).toContain('rejected by human review');
  });

  it('renders reasoning line', () => {
    // One readable line per variant, and no variant may render as `undefined`
    // or an empty string — a console that prints blanks is worse than none.
    const cases: Array<[ReasoningEvent, RegExp]> = [
      [{ type: 'plan', text: 'inspect the tree' }, /^plan: inspect the tree$/],
      [
        { type: 'tool_call', tool: 'edit_config', args: { path: 'a' }, gate: 'gated' },
        /^tool edit_config \(gated\): .*a/,
      ],
      [
        { type: 'tool_result', tool: 'edit_config', ok: true, summary: 'ok' },
        /^result edit_config ok: ok$/,
      ],
      [
        { type: 'tool_result', tool: 'x', ok: false, summary: 'GIT_ERROR' },
        /^result x FAILED: GIT_ERROR$/,
      ],
      [
        { type: 'policy', decision: { action: 'ask', reason: 'gated tool' }, tool: 'propose' },
        /^policy propose -> ask \(gated tool\)$/,
      ],
      [{ type: 'state', from: 'idle', to: 'loading' }, /^state idle -> loading$/],
      [
        { type: 'failover', from: 'a/1', to: 'b/2', reason: 'overloaded' },
        /^failover a\/1 -> b\/2: overloaded$/,
      ],
      [
        { type: 'cost', totalCost: 1.2345, tokens: { input: 1, output: 2, total: 3 } },
        /^cost \$1\.23 \(3 tokens\)$/,
      ],
      [{ type: 'complete', finishReason: 'stop' }, /^complete: stop$/],
    ];
    for (const [event, pattern] of cases) {
      const line = reasoningText(event);
      expect(line, JSON.stringify(event)).toMatch(pattern);
      // Never multi-line: a console row that wraps breaks scrolling.
      expect(line).not.toContain('\n');
    }

    // Newlines and runs of whitespace are flattened, so a multi-line tool
    // result cannot break the one-line contract.
    const messy = reasoningText({
      type: 'tool_result',
      tool: 't',
      ok: true,
      summary: 'line one\nline two\n\n   indented',
    });
    expect(messy).toBe('result t ok: line one line two indented');

    // Over-long text is truncated with an ellipsis rather than flooding a pane.
    const long = reasoningText({ type: 'plan', text: 'x'.repeat(500) });
    expect(long.length).toBeLessThanOrEqual(170);
    expect(long.endsWith('…')).toBe(true);

    // Displayed text is REDACTED. A tool result is arbitrary text that can carry
    // a credential shape, and this is a user-facing surface, not a redacting log
    // pipeline (the same reasoning as P-145's `redactAuditText`).
    const secret = reasoningText({
      type: 'tool_result',
      tool: 't',
      ok: false,
      summary: 'auth failed with api_key=sk-abcdefghijklmnop and ghp_ABCDEFGHIJKLMNOPQRST',
    });
    expect(secret).not.toContain('sk-abcdefghijklmnop');
    expect(secret).not.toContain('ghp_ABCDEFGHIJKLMNOPQRST');
    // P-145's `redactAuditText` marks its redactions `[REDACTED]`, uppercase.
    expect(secret).toContain('[REDACTED]');

    // Arguments that cannot be serialised render without throwing — a circular
    // object is a broken tool, not a reason for the console to crash.
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;
    const argsLine = reasoningText({
      type: 'tool_call',
      tool: 't',
      args: circular,
      gate: 'auto',
    });
    expect(argsLine).toContain('unserialisable args');

    // Absent args and a null result both render something meaningful.
    expect(reasoningText({ type: 'tool_call', tool: 't', args: undefined, gate: 'auto' })).toBe(
      'tool t (auto): no args'
    );
    expect(reasoningText({ type: 'tool_result', tool: 't', ok: true, summary: '' })).toBe(
      'result t ok: '
    );

    // Cost precision scales with magnitude. `estimateCost` divides
    // per-million-token prices by 1e6, so a short run legitimately costs a
    // fraction of a cent — a fixed 4dp would render it as `$0.0000`, which
    // reads as "free".
    expect(
      reasoningText({ type: 'cost', totalCost: 0, tokens: { input: 0, output: 0, total: 0 } })
    ).toBe('cost $0.00 (0 tokens)');
    expect(
      reasoningText({
        type: 'cost',
        totalCost: 0.000102,
        tokens: { input: 4, output: 6, total: 10 },
      })
    ).toBe('cost $0.000102 (10 tokens)');
    // Below a cent but above a hundredth-of-a-cent, the 6dp tier applies.
    expect(
      reasoningText({ type: 'cost', totalCost: 0.0042, tokens: { input: 4, output: 6, total: 10 } })
    ).toBe('cost $0.004200 (10 tokens)');
    // Between a cent and a dollar, 4dp.
    expect(
      reasoningText({ type: 'cost', totalCost: 0.42, tokens: { input: 4, output: 6, total: 10 } })
    ).toBe('cost $0.4200 (10 tokens)');
    expect(
      reasoningText({ type: 'cost', totalCost: 12.5, tokens: { input: 1, output: 1, total: 2 } })
    ).toBe('cost $12.50 (2 tokens)');
  });
});
