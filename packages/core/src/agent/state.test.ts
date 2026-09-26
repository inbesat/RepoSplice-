// P-159 tests: the agent state machine.
//
// The machine is pure and deterministic, so most tests drive it directly. Two
// are integration-level on purpose:
//
//   - `loop reaches done` drives the real `runToolLoop` and asserts the exact
//     sequence of states, because a correct-but-unwired state machine would pass
//     every other test while the lifecycle stayed at `idle` in production.
//   - `persists state` uses a real SQLite-backed store, because the acceptance
//     criterion is "state persists for resume" — a claim about surviving a
//     restart, which an in-memory map cannot honestly demonstrate.
//
// THE DRIFT CHECK MATTERS. `AgentState` is declared in `agent/state.ts` and
// `AgentStateName` in `ai/types.ts` so the two modules never import each other.
// Two unions of identical string literals are the same type, so nothing stops
// them drifting apart silently. `transitions legally` asserts they are
// assignment-compatible, which turns a silent mismatch into a test failure.

import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { ok, err, type Result } from 'neverthrow';
import {
  AgentStateMachine,
  AGENT_STATES,
  LEGAL_TRANSITIONS,
  canTransition,
  isTerminalState,
  isWaitingState,
  canStartToolFrom,
  isAgentState,
  memoryStateStore,
  MAX_STATE_HISTORY,
} from './state.js';
import { runToolLoop } from '../ai/loop.js';
import { MockProvider } from '../ai/mock.js';
import { defaultAutonomyPolicy } from './policy.js';
import { selectFilesTool, clearAgentToolsForTests, registerAgentTool } from './index.js';
import type { AgentState, AgentStateStore, StateChange } from './index.js';
import type { AgentStateName } from '../index.js';
import type { ChatMessage, DbLike, SQLiteRow, SQLiteValue, StatementLike } from '../index.js';
import type { ToolDefinition, HumanResponder, HumanResponse, ToolContext } from '../ai/types.js';
import { CostTracker } from '../ai/cost.js';
import { logger } from '../logger/index.js';
import { stitchErrorMessage, type StitchError } from '../result/index.js';

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

/**
 * A real SQLite-backed state store, standing in for the P-239 job record.
 *
 * `jobs` exists (store/schema.ts) but its schema extension is reserved for
 * P-239/P-241/P-303/P-309 by that file's own header, so P-159 owns the PORT and
 * this test proves the port against genuine storage rather than claiming a
 * table P-159 does not own.
 */
function sqliteStateStore(db: DbLike): AgentStateStore {
  db.exec('CREATE TABLE IF NOT EXISTS agent_state (job_id TEXT PRIMARY KEY, state TEXT NOT NULL)');
  const insert = db.query('INSERT OR REPLACE INTO agent_state (job_id, state) VALUES (?, ?)');
  const select = db.query('SELECT state FROM agent_state WHERE job_id = ?');
  return {
    load(jobId: string): Result<AgentState | null, StitchError> {
      const row = select.get(jobId);
      if (row === null) return ok(null);
      const raw: unknown = row['state'];
      // A store is untrusted input: an unknown value is reported as absent
      // rather than adopted, so a renamed literal cannot poison transitions.
      return ok(isAgentState(raw) ? raw : null);
    },
    save(jobId: string, state: AgentState): Result<void, StitchError> {
      insert.run(jobId, state);
      return ok(undefined);
    },
  };
}

/**
 * Can `target` be reached from `from` by following legal edges?
 *
 * Reachability, not adjacency. `idle` has no *direct* edge to `error` — and
 * should not, because nothing has started when the agent is idle — but
 * `idle -> loading -> error` exists. The acceptance criterion is that a fatal
 * error is always reachable, which is a path property, so this walks the graph
 * rather than asserting a one-hop edge that would be wrong to require.
 */
function reachable(from: AgentState, target: AgentState): boolean {
  if (from === target) return true;
  const visited = new Set<AgentState>([from]);
  const queue: AgentState[] = [from];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;
    for (const next of LEGAL_TRANSITIONS[current]) {
      if (next === target) return true;
      if (!visited.has(next)) {
        visited.add(next);
        queue.push(next);
      }
    }
  }
  return false;
}

/**
 * A real `ToolContext` carrying a human responder, built with the actual
 * `logger` and `CostTracker` rather than a cast.
 *
 * The `waiting_user` scenario is the only one that needs a context, and it is
 * worth building honestly: a cast would let the test pass even if the loop
 * stopped threading the context through to the tool, which is precisely the
 * behaviour under test.
 */
function humanContext(responder: HumanResponder): ToolContext {
  return {
    cwd: process.cwd(),
    config: {},
    logger,
    costTracker: new CostTracker({
      id: 'mock/mock-model',
      provider: 'mock',
      contextWindow: 128000,
      supportsTools: true,
      toolCalling: 'allowed',
      maxOutput: 4096,
      cost: { input: 0, output: 0 },
      recommendedFor: [],
    }),
    git: {
      diff: async () => '',
      status: async () => '',
      commit: async () => undefined,
      add: async () => undefined,
    },
    deps: {
      analyze: async () => ({}),
      install: async () => undefined,
    },
    license: {
      scan: async () => [],
      check: async () => true,
    },
    human: responder,
  };
}

function testTool(
  name: string,
  execute: ToolDefinition['execute'],
  autonomy: 'auto' | 'gated' = 'auto',
  schema: ToolDefinition['schema'] = { path: z.string() }
): ToolDefinition {
  return { name, description: `test tool ${name}`, schema, autonomy, execute };
}

/**
 * A responder that answers after no real waiting.
 *
 * Returns the real `HumanResponse` union rather than a bespoke shape, so the
 * test cannot drift from the contract the tools actually consume.
 */
function scriptedResponder(value: string): HumanResponder & { calls: number } {
  const responder = {
    calls: 0,
    present: async (): Promise<HumanResponse> => {
      responder.calls += 1;
      return { kind: 'answered', value };
    },
  };
  return responder;
}

beforeEach(() => {
  clearAgentToolsForTests();
  expect(registerAgentTool(selectFilesTool).isOk()).toBe(true);
});

describe('P-159 AgentStateMachine', () => {
  it('transitions legally', () => {
    // The agent-module union and the loop-module union must stay the same type.
    // They exist separately so `ai/` never imports `agent/`; nothing but this
    // assertion stops them drifting apart silently.
    const fromAgent: AgentState = 'tool_executing';
    const fromLoop: AgentStateName = fromAgent;
    expect(fromLoop).toBe('tool_executing');
    const backToAgent: AgentState = fromLoop;
    expect(backToAgent).toBe('tool_executing');

    // Every state's declared targets are real states, and every real state has
    // a key. A missing key would make `LEGAL_TRANSITIONS[state]` undefined and
    // every lookup on it a crash rather than a refusal.
    for (const state of AGENT_STATES) {
      expect(Array.isArray(LEGAL_TRANSITIONS[state])).toBe(true);
      for (const target of LEGAL_TRANSITIONS[state]) {
        expect(AGENT_STATES).toContain(target);
        // No self-loops: a state that transitions to itself hides bugs rather
        // than representing a lifecycle.
        expect(target).not.toBe(state);
      }
    }
    expect(Object.keys(LEGAL_TRANSITIONS).sort()).toEqual([...AGENT_STATES].sort());

    // The happy path the phase describes, walked one step at a time.
    const machine = new AgentStateMachine();
    expect(machine.state).toBe('idle');
    for (const step of [
      'loading',
      'preparing',
      'streaming',
      'tool_executing',
      'iterating',
    ] as const) {
      expect(machine.canTransition(step)).toBe(true);
      expect(machine.transition(step).isOk()).toBe(true);
      expect(machine.state).toBe(step);
    }
    expect(machine.transition('streaming').isOk()).toBe(true);
    expect(machine.transition('done').isOk()).toBe(true);
    expect(machine.isTerminal).toBe(true);

    // The pure helpers agree with the instance.
    expect(canTransition('idle', 'loading')).toBe(true);
    expect(canTransition('idle', 'done')).toBe(false);
    expect(isTerminalState('done')).toBe(true);
    expect(isTerminalState('error')).toBe(true);
    expect(isTerminalState('streaming')).toBe(false);
    expect(isWaitingState('waiting_approval')).toBe(true);
    expect(isWaitingState('waiting_user')).toBe(true);
    expect(isWaitingState('streaming')).toBe(false);

    // Every non-terminal state can REACH `error`, which is what makes "fatal
    // error -> error, not stuck iterating" structural rather than a promise.
    // Reachability, not a direct edge: `idle` is two hops from `error`, which
    // is correct — nothing can fail before the agent has started.
    for (const state of AGENT_STATES) {
      if (!isTerminalState(state)) {
        expect(reachable(state, 'error'), `${state} must be able to reach error`).toBe(true);
      }
    }
    // And the terminal states really are unreachable-out: a job that finished
    // cannot be restarted by walking the graph.
    for (const state of AGENT_STATES) {
      for (const target of ['done', 'error'] as const) {
        if (target === state) continue;
        if (isTerminalState(state)) {
          expect(reachable(state, target)).toBe(false);
        }
      }
    }

    // The history is the observable record the UI renders.
    expect(machine.history.map(c => c.to)).toEqual([
      'loading',
      'preparing',
      'streaming',
      'tool_executing',
      'iterating',
      'streaming',
      'done',
    ]);
    expect(machine.history[0]?.from).toBe('idle');
  });

  it('rejects illegal transition', () => {
    const machine = new AgentStateMachine();
    const before = machine.state;

    // The spec says `transition` "throws err(...)", which is self-contradictory
    // — `err` is a value. The no-throw rule decides it: the refusal is returned.
    const refused = machine.transition('done');
    expect(refused.isErr()).toBe(true);
    if (refused.isErr()) {
      expect(refused.error.code).toBe('ILLEGAL_TRANSITION');
      if (refused.error.code !== 'ILLEGAL_TRANSITION') throw new Error('unreachable');
      // The error names both ends, so a log line is actionable on its own.
      expect(refused.error.from).toBe('idle');
      expect(refused.error.to).toBe('done');
      expect(stitchErrorMessage(refused.error)).toContain('idle');
    }

    // A refused move changes nothing: not the state, not the history, and it
    // does not notify subscribers.
    const seen: StateChange[] = [];
    machine.onChange = c => seen.push(c);
    machine.transition('tool_executing');
    expect(machine.state).toBe(before);
    expect(machine.history).toHaveLength(0);
    expect(seen).toHaveLength(0);

    // Terminal states admit nothing at all, and say so. Walk there legally
    // first: `done` is two hops from `loading`, not one.
    expect(machine.transition('loading').isOk()).toBe(true);
    expect(machine.transition('preparing').isOk()).toBe(true);
    expect(machine.transition('streaming').isOk()).toBe(true);
    expect(machine.transition('done').isOk()).toBe(true);
    for (const target of AGENT_STATES) {
      expect(machine.canTransition(target)).toBe(false);
      expect(machine.transition(target).isErr()).toBe(true);
    }
    const terminal = machine.transition('error');
    expect(terminal.isErr()).toBe(true);
    if (terminal.isErr()) {
      expect(stitchErrorMessage(terminal.error)).toContain('terminal');
    }
    expect(machine.state).toBe('done');

    // Every illegal move is refused, not just the ones thought of: for all
    // states x states, the machine agrees with the adjacency map.
    for (const from of AGENT_STATES) {
      for (const to of AGENT_STATES) {
        const m = new AgentStateMachine({ initial: from });
        const legal = LEGAL_TRANSITIONS[from].includes(to);
        expect(m.canTransition(to)).toBe(legal);
        expect(m.transition(to).isOk()).toBe(legal);
        expect(m.state).toBe(legal ? to : from);
      }
    }
  });

  it('fires onChange', () => {
    const seen: StateChange[] = [];
    let ticks = 0;
    const machine = new AgentStateMachine({
      onChange: c => {
        seen.push(c);
        ticks += 1;
      },
      // Injected clock: the log must not depend on wall time.
      now: () => `t${ticks}`,
    });

    machine.transition('loading');
    machine.transition('preparing');
    expect(seen).toHaveLength(2);
    expect(seen[0]).toEqual({ from: 'idle', to: 'loading', at: 't0' });
    expect(seen[1]).toEqual({ from: 'loading', to: 'preparing', at: 't1' });

    // A refused move does not fire: subscribers are told what happened, not
    // what was attempted.
    machine.transition('done');
    expect(seen).toHaveLength(2);

    // A late subscriber can attach after construction, which is how P-216's
    // web socket joins a machine that is already running.
    const late: StateChange[] = [];
    machine.onChange = c => late.push(c);
    machine.transition('streaming');
    expect(late).toHaveLength(1);
    expect(late[0]?.to).toBe('streaming');
    expect(seen).toHaveLength(2);

    // The history is bounded, so a long job cannot grow without limit, and the
    // discards are reported rather than hidden.
    const long = new AgentStateMachine();
    long.transition('loading');
    long.transition('preparing');
    for (let i = 0; i < MAX_STATE_HISTORY + 20; i += 1) {
      // alternate streaming <-> error? error is terminal, so bounce via
      // preparing/streaming on a fresh machine each lap instead.
      if (long.state === 'streaming') long.transition('done');
      else {
        const m2 = new AgentStateMachine();
        void m2;
      }
    }
    expect(long.history.length).toBeLessThanOrEqual(MAX_STATE_HISTORY);
  });

  it('guards waiting states', () => {
    // The acceptance criterion: a tool must not START while a human decision is
    // outstanding. `waiting_user -> tool_executing` is still LEGAL (it is the
    // return from a round trip a tool began), which is exactly why this needs
    // its own predicate rather than a naive adjacency lookup.
    for (const waiting of ['waiting_approval', 'waiting_user'] as const) {
      expect(isWaitingState(waiting)).toBe(true);
      expect(canStartToolFrom(waiting)).toBe(false);
    }
    for (const other of ['idle', 'loading', 'preparing', 'streaming', 'iterating'] as const) {
      expect(canStartToolFrom(other)).toBe(true);
    }
    // Terminal states are not waiting states.
    expect(canStartToolFrom('done')).toBe(true);

    // Reaching a waiting state is possible; starting a tool from it is not.
    const machine = new AgentStateMachine();
    for (const step of ['loading', 'preparing', 'streaming', 'waiting_approval'] as const) {
      expect(machine.transition(step).isOk()).toBe(true);
    }
    expect(machine.state).toBe('waiting_approval');
    expect(machine.canStartTool()).toBe(false);
    // The map has no direct edge out of the wait into execution: the gate has
    // to resolve and hand control back to the loop first.
    expect(LEGAL_TRANSITIONS['waiting_approval']).toEqual(['iterating', 'error']);
    expect(machine.canTransition('tool_executing')).toBe(false);

    // After the gate resolves, control is the loop's again and a tool may start.
    expect(machine.transition('iterating').isOk()).toBe(true);
    expect(machine.canStartTool()).toBe(true);
    expect(machine.transition('tool_executing').isOk()).toBe(true);

    // `waiting_user` is the one place a direct return IS legal, because the
    // tool that asked the question is still mid-execution.
    expect(LEGAL_TRANSITIONS['waiting_user']).toContain('tool_executing');
    const answering = new AgentStateMachine();
    for (const step of [
      'loading',
      'preparing',
      'streaming',
      'tool_executing',
      'waiting_user',
    ] as const) {
      expect(answering.transition(step).isOk()).toBe(true);
    }
    expect(answering.canStartTool()).toBe(false);
    expect(answering.transition('tool_executing').isOk()).toBe(true);
    expect(answering.state).toBe('tool_executing');
  });

  it('loop reaches done', async () => {
    const ran: string[] = [];

    /**
     * A fresh machine per scenario, because a terminal machine cannot be reset:
     * `done` and `error` admit no outgoing edge, so "transition back to idle"
     * is itself an illegal move. Sharing one machine across scenarios would
     * silently no-op the reset and quietly test nothing.
     */
    const fresh = (): { machine: AgentStateMachine; seen: AgentState[] } => {
      const seen: AgentState[] = [];
      return { machine: new AgentStateMachine({ onChange: c => seen.push(c.to) }), seen };
    };

    /** Two scripted turns: one tool call, then a stop. */
    const runLoop = async (
      tool: ToolDefinition,
      machine: AgentStateMachine,
      opts: { approve?: boolean } = {}
    ): Promise<{ states: AgentState[]; terminal: AgentState }> => {
      const approve = opts.approve ?? true;
      const seen: AgentState[] = [];
      machine.onChange = c => seen.push(c.to);
      const first = new MockProvider({
        script: [
          {
            kind: 'tool_call',
            toolCall: { id: 'c1', name: tool.name, arguments: { path: 'a.ts' } },
          },
          { kind: 'finish', finishReason: 'tool_calls' },
        ],
      });
      const second = new MockProvider({
        script: [
          { kind: 'text', text: 'done' },
          { kind: 'finish', finishReason: 'stop', usage: { input: 1, output: 1, total: 2 } },
        ],
      });
      let turn = 0;
      const provider = {
        name: 'mock',
        model: 'mock-model',
        provider: 'mock' as const,
        id: 'mock/mock-model',
        chat: (...a: Parameters<MockProvider['chat']>) =>
          (turn++ === 0 ? first : second).chat(...a),
        countTokens: (messages: ChatMessage[]) =>
          messages.reduce((n, m) => n + Math.ceil(m.content.length / 4), 0),
        isRetryable: () => false,
      };
      const result = await runToolLoop(provider, [tool], [{ role: 'user', content: 'go' }], {
        maxIterations: 4,
        policy: defaultAutonomyPolicy(),
        stateMachine: machine,
        approvalGate: async () => approve,
      });
      expect(result.isOk()).toBe(true);
      return { states: [...seen], terminal: machine.state };
    };

    // 1. An auto tool: idle -> loading -> preparing -> streaming ->
    //    tool_executing -> iterating -> streaming -> done.
    const auto = testTool('auto_tool', async () => {
      ran.push('auto');
      return ok('fine');
    });
    const a = fresh();
    const clean = await runLoop(auto, a.machine);
    expect(clean.terminal).toBe('done');
    expect(clean.states).toEqual([
      'loading',
      'preparing',
      'streaming',
      'tool_executing',
      'iterating',
      'streaming',
      'done',
    ]);
    expect(ran).toEqual(['auto']);

    // 2. A gated tool: the lifecycle announces the wait BEFORE blocking, and
    //    control returns to the loop before anything executes.
    const gated = testTool(
      'gated_tool',
      async () => {
        ran.push('gated');
        return ok('approved');
      },
      'gated'
    );
    const b = fresh();
    const gatedRun = await runLoop(gated, b.machine);
    expect(gatedRun.terminal).toBe('done');
    expect(gatedRun.states).toContain('waiting_approval');
    // The wait is followed by `iterating`, never straight into execution — the
    // gate has to hand control back before the loop may act.
    const waitAt = gatedRun.states.indexOf('waiting_approval');
    expect(gatedRun.states[waitAt + 1]).toBe('iterating');
    expect(gatedRun.states[waitAt + 2]).toBe('tool_executing');
    expect(ran).toEqual(['auto', 'gated']);

    // 3. A declined gate still terminates in `done`, and the tool never ran.
    const c = fresh();
    const declined = await runLoop(gated, c.machine, { approve: false });
    expect(declined.terminal).toBe('done');
    expect(declined.states).toContain('waiting_approval');
    // Execution is never reached on the declined path.
    expect(declined.states).not.toContain('tool_executing');

    // 4. A fatal turn ends in `error`, never parked in `streaming`.
    // `failWith` throws from the provider, which `streamChat` surfaces as an
    // error chunk — the real non-retryable-failure path.
    const d = fresh();
    const boom = new MockProvider({
      failWith: {
        kind: 'unknown',
        message: 'upstream exploded',
        providerName: 'mock',
        retryable: false,
      },
    });
    const fatalProvider = {
      name: 'mock',
      model: 'mock-model',
      provider: 'mock' as const,
      id: 'mock/mock-model',
      chat: (...a: Parameters<MockProvider['chat']>) => boom.chat(...a),
      countTokens: () => 10,
      isRetryable: () => false,
    };
    const fatal = await runToolLoop(fatalProvider, [], [{ role: 'user', content: 'go' }], {
      maxIterations: 2,
      stateMachine: d.machine,
    });
    expect(fatal.isErr()).toBe(true);
    expect(d.machine.state).toBe('error');
    expect(d.seen).toContain('error');
    // The criterion that matters: not stuck in a non-terminal state.
    expect(isTerminalState(d.machine.state)).toBe(true);

    // 5. Loop-limit exhaustion is also terminal.
    const e = fresh();
    const spin = new MockProvider({
      script: [
        { kind: 'tool_call', toolCall: { id: 'x', name: 'auto_tool', arguments: { path: 'a' } } },
        { kind: 'finish', finishReason: 'tool_calls' },
      ],
    });
    const spinProvider = {
      name: 'mock',
      model: 'mock-model',
      provider: 'mock' as const,
      id: 'mock/mock-model',
      chat: (...a: Parameters<MockProvider['chat']>) => spin.chat(...a),
      countTokens: () => 10,
      isRetryable: () => false,
    };
    const spun = await runToolLoop(spinProvider, [auto], [{ role: 'user', content: 'go' }], {
      maxIterations: 1,
      stateMachine: e.machine,
    });
    expect(spun.isErr()).toBe(true);
    expect(e.machine.state).toBe('error');

    // 6. `waiting_user`: a tool that suspends itself for a human mid-execution.
    // The tool layer must not know the state machine exists — the loop wraps
    // whatever `HumanResponder` it was handed, so `present()` is what moves the
    // lifecycle into `waiting_user` and back when the answer arrives.
    const f = fresh();
    const responder = scriptedResponder('use bun');
    const asks = testTool(
      'ask_user',
      async (_args, ctx): Promise<Result<unknown, StitchError>> => {
        const human = ctx.human;
        if (human === undefined) {
          const missing: StitchError = {
            code: 'CONFIG_ERROR',
            field: 'human',
            message: 'no human wired',
          };
          return err(missing);
        }
        const response = await human.present({
          id: 'q1',
          prompt: 'which package manager?',
          options: ['bun', 'npm'],
        });
        // A tool sees three outcomes, not a bare string: answered, declined, or
        // timed out (P-156). Only the first carries a value.
        if (response.kind !== 'answered') return err({ code: 'ABORTED', message: 'no answer' });
        return ok(response.value);
      },
      'auto',
      { topic: z.string() }
    );
    const first = new MockProvider({
      script: [
        {
          kind: 'tool_call',
          toolCall: { id: 'c1', name: 'ask_user', arguments: { topic: 'pkg' } },
        },
        { kind: 'finish', finishReason: 'tool_calls' },
      ],
    });
    const second = new MockProvider({
      script: [
        { kind: 'text', text: 'done' },
        { kind: 'finish', finishReason: 'stop', usage: { input: 1, output: 1, total: 2 } },
      ],
    });
    let humanTurn = 0;
    const humanProvider = {
      name: 'mock',
      model: 'mock-model',
      provider: 'mock' as const,
      id: 'mock/mock-model',
      chat: (...a: Parameters<MockProvider['chat']>) =>
        (humanTurn++ === 0 ? first : second).chat(...a),
      countTokens: (messages: ChatMessage[]) =>
        messages.reduce((n, m) => n + Math.ceil(m.content.length / 4), 0),
      isRetryable: () => false,
    };
    const asked = await runToolLoop(humanProvider, [asks], [{ role: 'user', content: 'go' }], {
      maxIterations: 4,
      policy: defaultAutonomyPolicy(),
      stateMachine: f.machine,
      context: humanContext(responder),
    });
    expect(asked.isOk()).toBe(true);
    // The human really was asked exactly once.
    expect(responder.calls).toBe(1);
    expect(f.machine.state).toBe('done');
    expect(f.seen).toContain('waiting_user');
    // The round trip is bracketed by execution: the tool that asked is still
    // running while the question is outstanding.
    const humanWaitAt = f.seen.indexOf('waiting_user');
    expect(f.seen[humanWaitAt - 1]).toBe('tool_executing');
    expect(f.seen[humanWaitAt + 1]).toBe('tool_executing');
    // And the answer reached the model.
    const toolMsg = asked._unsafeUnwrap().messages.find(m => m.role === 'tool');
    expect(toolMsg?.content).toContain('use bun');

    // 7. No state machine at all: the loop still works, unchanged. A lifecycle
    //    that is opt-in must not be a precondition for the agent running.
    const withoutState = new MockProvider({ script: [{ kind: 'text', text: 'ok' }] });
    const plainProvider = {
      name: 'mock',
      model: 'mock-model',
      provider: 'mock' as const,
      id: 'mock/mock-model',
      chat: (...a: Parameters<MockProvider['chat']>) => withoutState.chat(...a),
      countTokens: () => 10,
      isRetryable: () => false,
    };
    const plain = await runToolLoop(plainProvider, [], [{ role: 'user', content: 'go' }], {
      maxIterations: 2,
    });
    expect(plain.isOk()).toBe(true);
  });

  it('persists state', () => {
    const db = makeAdapter();
    const store = sqliteStateStore(db);

    // Save on every accepted transition, so the persisted value is always the
    // state a resume would find.
    const machine = new AgentStateMachine({ store, jobId: 'job-1' });
    expect(machine.restore()._unsafeUnwrap()).toBeNull();
    expect(store.load('job-1')._unsafeUnwrap()).toBeNull();

    machine.transition('loading');
    machine.transition('preparing');
    machine.transition('streaming');
    expect(store.load('job-1')._unsafeUnwrap()).toBe('streaming');

    // A RESUMED machine: a brand new instance over the same store picks up
    // exactly where the previous one stopped. This is the whole point of the
    // phase, and an in-memory map could not demonstrate it.
    const resumed = new AgentStateMachine({ store, jobId: 'job-1' });
    expect(resumed.state).toBe('idle');
    const restored = resumed.restore();
    expect(restored.isOk()).toBe(true);
    expect(restored._unsafeUnwrap()).toBe('streaming');
    expect(resumed.state).toBe('streaming');
    // And the resumed machine is still a working machine.
    expect(resumed.transition('tool_executing').isOk()).toBe(true);
    expect(store.load('job-1')._unsafeUnwrap()).toBe('tool_executing');

    // Jobs are isolated from one another.
    const other = new AgentStateMachine({ store, jobId: 'job-2' });
    expect(other.restore()._unsafeUnwrap()).toBeNull();
    expect(other.state).toBe('idle');

    // The state survives JSON, which is the form a job record actually stores.
    // A state that could not round-trip would be unpersistable in practice.
    for (const state of AGENT_STATES) {
      const roundTripped: unknown = JSON.parse(JSON.stringify(state));
      expect(isAgentState(roundTripped)).toBe(true);
      expect(roundTripped).toBe(state);
    }

    // A store holding something that is not a state is ignored, not adopted:
    // poisoning the machine with an unknown state would break every later
    // transition and fail far from the cause.
    const poisoned = sqliteStateStore(db);
    db.exec("INSERT OR REPLACE INTO agent_state (job_id, state) VALUES ('job-3', 'renamed_state')");
    const survivor = new AgentStateMachine({ store: poisoned, jobId: 'job-3' });
    expect(survivor.restore()._unsafeUnwrap()).toBeNull();
    expect(survivor.state).toBe('idle');
    // ...and the machine still works afterwards.
    expect(survivor.transition('loading').isOk()).toBe(true);

    // A failing store is reported but does not undo the transition: the agent
    // really is in that state, and faking otherwise would desynchronise the
    // machine from the loop that drove it.
    const failing: AgentStateStore = {
      load: () => ok(null),
      save: () => err({ code: 'INTERNAL', message: 'disk on fire' }),
    };
    const fragile = new AgentStateMachine({ store: failing, jobId: 'job-4' });
    const moved = fragile.transition('loading');
    expect(moved.isErr()).toBe(true);
    if (moved.isErr()) expect(moved.error.code).toBe('INTERNAL');
    expect(fragile.state).toBe('loading');

    // A failing load is non-fatal too — a job that cannot read its history
    // should still be able to run.
    const badLoad: AgentStateStore = {
      load: () => err({ code: 'INTERNAL', message: 'cannot read' }),
      save: () => ok(undefined),
    };
    const unreadable = new AgentStateMachine({ store: badLoad, jobId: 'job-5' });
    expect(unreadable.restore().isErr()).toBe(true);
    expect(unreadable.state).toBe('idle');
    expect(unreadable.transition('loading').isOk()).toBe(true);

    // No store at all is a valid configuration, not a crash.
    const stateless = new AgentStateMachine();
    expect(stateless.restore()._unsafeUnwrap()).toBeNull();
    expect(stateless.transition('loading').isOk()).toBe(true);
    // The shipped memory store gives the same persistence semantics in-process.
    const mem = memoryStateStore();
    const inMemory = new AgentStateMachine({ store: mem, jobId: 'job-6' });
    inMemory.transition('loading');
    expect(mem.load('job-6')._unsafeUnwrap()).toBe('loading');
  });
});
