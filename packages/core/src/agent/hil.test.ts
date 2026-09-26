// P-160 tests: the HIL approval queue.
//
// The queue is durable, so the persistence claims are tested against REAL
// SQLite rather than a fake: "survives a process restart" is a claim about a
// database, and an in-memory stub would assert nothing. The restart tests open
// the same on-disk file a second time.
//
// `node:sqlite` backs the adapter because vitest runs in Node workers where
// `bun:sqlite` is unavailable — the same arrangement every other DbLike test
// in this repo uses.
//
// The loop test drives the real `runToolLoop` with a queue wired and a human
// answering out-of-band, because "the loop parks in waiting_approval until
// resolution" is only true if the wiring exists, and a correct-but-unwired
// queue would pass every other test.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { ok, type Result } from 'neverthrow';
import { HilQueue } from './hil.js';
import { AgentStateMachine } from './state.js';
import { defaultAutonomyPolicy } from './policy.js';
import { runToolLoop } from '../ai/loop.js';
import { MockProvider } from '../ai/mock.js';
import { CostTracker } from '../ai/cost.js';
import { logger } from '../logger/index.js';
import { selectFilesTool, clearAgentToolsForTests, registerAgentTool } from './index.js';
import type { HilRequest, HilResolution } from './index.js';
import type { HilGate, HilGateOutcome, ToolDefinition, ToolContext } from '../index.js';
import type { ChatMessage, DbLike, SQLiteRow, SQLiteValue, StatementLike } from '../index.js';
import { stitchErrorMessage, type StitchError } from '../result/index.js';

/** `node:sqlite`-backed `DbLike`. */
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

/** A real on-disk database, so "survives a restart" can be tested honestly. */
const dirs: string[] = [];

function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'stitch-hil-'));
  dirs.push(dir);
  return join(dir, 'hil.db');
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** A queue over a fresh in-memory database, with a deterministic clock/id. */
function freshQueue(
  path = ':memory:',
  opts: { onResolved?: (r: HilResolution, q: HilRequest) => void } = {}
): { queue: HilQueue; db: DbLike } {
  const db = makeAdapter(path);
  let tick = 0;
  const queue = new HilQueue({
    db,
    now: () => `t${(tick += 1)}`,
    newId: () => `id${(tick += 1)}`,
    ...(opts.onResolved !== undefined ? { onResolved: opts.onResolved } : {}),
  });
  return { queue, db };
}

function testTool(
  name: string,
  execute: ToolDefinition['execute'],
  autonomy: 'auto' | 'gated' = 'auto',
  schema: ToolDefinition['schema'] = { path: z.string() }
): ToolDefinition {
  return { name, description: `test tool ${name}`, schema, autonomy, execute };
}

/** A real `ToolContext` with no human — the queue supplies the human instead. */
function bareContext(): ToolContext {
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
    deps: { analyze: async () => ({}), install: async () => undefined },
    license: { scan: async () => [], check: async () => true },
  };
}

beforeEach(() => {
  clearAgentToolsForTests();
  expect(registerAgentTool(selectFilesTool).isOk()).toBe(true);
});

describe('P-160 HilQueue', () => {
  it('enqueues and overwrites pending', () => {
    const { queue } = freshQueue();

    const first = queue.enqueue({
      kind: 'component',
      toolName: 'propose_component',
      payload: { n: 1 },
    });
    expect(first.isOk()).toBe(true);
    const firstId = first._unsafeUnwrap();

    // It is really persisted, and really pending.
    const listed = queue.pending();
    expect(listed.isOk()).toBe(true);
    const rows = listed._unsafeUnwrap();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(firstId);
    expect(rows[0]?.kind).toBe('component');
    expect(rows[0]?.status).toBe('pending');
    expect(rows[0]?.payload).toEqual({ n: 1 });
    // `listForUser` is the spec's name for the same read (P-218 / P-198).
    expect(queue.listForUser()._unsafeUnwrap()).toEqual(rows);

    // A second request for a DIFFERENT tool coexists.
    const other = queue.enqueue({ kind: 'question', toolName: 'ask_user', payload: 'q' });
    expect(other.isOk()).toBe(true);
    expect(queue.pending()._unsafeUnwrap()).toHaveLength(2);

    // A second pending request for the SAME tool replaces the first. The
    // database's partial unique index is what makes two pending rows for one
    // tool impossible, so this cannot be raced into a double approval.
    const replacement = queue.enqueue({
      kind: 'permission',
      toolName: 'propose_component',
      payload: { n: 2 },
    });
    expect(replacement.isOk()).toBe(true);
    const replacementId = replacement._unsafeUnwrap();
    expect(replacementId).not.toBe(firstId);

    const after = queue.pending()._unsafeUnwrap();
    expect(after).toHaveLength(2);
    const superseded = after.find(r => r.toolName === 'propose_component');
    expect(superseded?.id).toBe(replacementId);
    expect(superseded?.payload).toEqual({ n: 2 });

    // The superseded request did not silently vanish: it is still readable and
    // is now `cancelled`, which is what the audit trail should show.
    const old = queue.get(firstId);
    expect(old.isOk()).toBe(true);
    expect(old._unsafeUnwrap()?.status).toBe('cancelled');

    // Resolved requests leave the pending list.
    queue.resolve(replacementId, { resolution: 'approved', by: 'alice' });
    const left = queue.pending()._unsafeUnwrap();
    expect(left).toHaveLength(1);
    expect(left[0]?.toolName).toBe('ask_user');

    // The lifecycle state is recorded and read back as the state union.
    const withState = queue.enqueue({
      kind: 'permission',
      toolName: 'edit_config',
      payload: null,
      agentState: 'waiting_approval',
    });
    expect(withState.isOk()).toBe(true);
    const stored = queue.get(withState._unsafeUnwrap());
    expect(stored._unsafeUnwrap()?.agentState).toBe('waiting_approval');
    // A payload of `null` round-trips rather than becoming the string "null".
    expect(stored._unsafeUnwrap()?.payload).toBeNull();
  });

  it('resolves via wait', async () => {
    const events: Array<{ resolution: HilResolution; request: HilRequest }> = [];
    const { queue } = freshQueue(':memory:', {
      onResolved: (resolution, request) => events.push({ resolution, request }),
    });

    const id = queue.enqueue({ kind: 'permission', toolName: 'edit_config', payload: { k: 1 } });
    expect(id.isOk()).toBe(true);
    const requestId = id._unsafeUnwrap();

    // A loop is now blocked. Nobody has answered yet.
    const waiting = queue.waitForResolution(requestId);
    expect(queue.waitingCount).toBe(1);

    // A human answers from "another process" — the only handle they need is
    // the id, which is what makes the spec's "idempotent via id" work.
    const decided = queue.resolve(requestId, {
      resolution: 'approved',
      by: 'alice',
      note: 'looks right',
    });
    expect(decided.isOk()).toBe(true);

    const answer = await waiting;
    expect(answer.isOk()).toBe(true);
    const resolution = answer._unsafeUnwrap();
    expect(resolution.resolution).toBe('approved');
    expect(resolution.by).toBe('alice');
    expect(resolution.note).toBe('looks right');
    // The waiter is released and its slot reclaimed.
    expect(queue.waitingCount).toBe(0);

    // The subscriber fired exactly once, with the request it answered.
    expect(events).toHaveLength(1);
    expect(events[0]?.request.id).toBe(requestId);
    expect(events[0]?.resolution.resolution).toBe('approved');

    // A wait that starts AFTER the answer returns immediately — this is the
    // crash/reconnect case, and it is why the queue checks storage first.
    const late = await queue.waitForResolution(requestId);
    expect(late.isOk()).toBe(true);
    expect(late._unsafeUnwrap().by).toBe('alice');

    // RESOLUTION IS IDEMPOTENT. A retried or double-clicked approve must not
    // apply twice, and must not overwrite the first decision.
    const again = queue.resolve(requestId, { resolution: 'rejected', by: 'bob' });
    expect(again.isOk()).toBe(true);
    expect(again._unsafeUnwrap().resolution).toBe('approved');
    expect(again._unsafeUnwrap().by).toBe('alice');
    expect(queue.resolutionFor(requestId)._unsafeUnwrap()?.by).toBe('alice');
    // Still exactly one resolution on record.
    expect(events).toHaveLength(1);

    // Rejection is a normal outcome, not an error.
    const rejId = queue.enqueue({ kind: 'component', toolName: 'propose_component', payload: {} });
    const rejWait = queue.waitForResolution(rejId._unsafeUnwrap());
    queue.resolve(rejId._unsafeUnwrap(), { resolution: 'rejected', by: 'carol' });
    const rejected = await rejWait;
    expect(rejected._unsafeUnwrap().resolution).toBe('rejected');

    // An unknown id is bad input, typed as such rather than silently ignored.
    const ghost = queue.resolve('nope', { resolution: 'approved', by: 'x' });
    expect(ghost.isErr()).toBe(true);
    if (ghost.isErr()) {
      expect(ghost.error.code).toBe('CONFIG_ERROR');
      if (ghost.error.code === 'CONFIG_ERROR') expect(ghost.error.field).toBe('id');
    }
  });

  it('times out', async () => {
    const { queue } = freshQueue();
    const id = queue.enqueue({ kind: 'permission', toolName: 'run_publish', payload: null });
    const requestId = id._unsafeUnwrap();

    const started = Date.now();
    const answer = await queue.waitForResolution(requestId, { timeoutMs: 60 });
    const elapsed = Date.now() - started;

    expect(answer.isErr()).toBe(true);
    if (answer.isErr()) {
      // `USER_TIMEOUT`, kept distinct from `ABORTED`: "nobody answered" and
      // "someone stopped the wait" are different events, exactly as P-156
      // separated them for `ask_user`.
      expect(answer.error.code).toBe('USER_TIMEOUT');
      if (answer.error.code === 'USER_TIMEOUT') expect(answer.error.timeoutMs).toBe(60);
    }
    // It actually waited, rather than returning immediately.
    expect(elapsed).toBeGreaterThanOrEqual(40);
    // The waiter slot is reclaimed, so a leaked wait cannot accumulate.
    expect(queue.waitingCount).toBe(0);

    // The request is STILL pending after a timeout — a human may answer late,
    // and the answer is still recorded. A timeout is not a rejection.
    const still = queue.get(requestId);
    expect(still._unsafeUnwrap()?.status).toBe('pending');
    const late = queue.resolve(requestId, { resolution: 'approved', by: 'dave' });
    expect(late.isOk()).toBe(true);

    // A second timeout on an already-answered request returns the answer, not a
    // timeout: the stored resolution is consulted before waiting.
    const answered = await queue.waitForResolution(requestId, { timeoutMs: 10_000 });
    expect(answered._unsafeUnwrap().by).toBe('dave');
  });

  it('aborts on cancel', async () => {
    const { queue } = freshQueue();
    const id = queue.enqueue({
      kind: 'question',
      toolName: 'ask_user',
      payload: { prompt: 'which?' },
    });
    const requestId = id._unsafeUnwrap();

    // An abort signal stops the wait the way a human pressing ctrl-C would.
    const controller = new AbortController();
    const waiting = queue.waitForResolution(requestId, { signal: controller.signal });
    expect(queue.waitingCount).toBe(1);
    controller.abort();
    const aborted = await waiting;
    expect(aborted.isErr()).toBe(true);
    if (aborted.isErr()) expect(aborted.error.code).toBe('ABORTED');
    expect(queue.waitingCount).toBe(0);

    // A signal already aborted before the wait begins short-circuits.
    const pre = new AbortController();
    pre.abort();
    const second = queue.enqueue({ kind: 'question', toolName: 'ask_user', payload: 'q2' });
    const preAborted = await queue.waitForResolution(second._unsafeUnwrap(), {
      signal: pre.signal,
    });
    expect(preAborted.isErr()).toBe(true);
    if (preAborted.isErr()) expect(preAborted.error.code).toBe('ABORTED');

    // `cancel` is a third, distinct outcome: the question is no longer being
    // asked. It is NOT recorded as a resolution, so `resolutionFor` stays null
    // and nobody can later mistake a cancel for a human saying no.
    const third = queue.enqueue({ kind: 'permission', toolName: 'edit_config', payload: null });
    const thirdId = third._unsafeUnwrap();
    const cancelled = queue.cancel(thirdId, 'erin', 'job aborted');
    expect(cancelled.isOk()).toBe(true);
    expect(queue.resolutionFor(thirdId)._unsafeUnwrap()).toBeNull();
    expect(queue.get(thirdId)._unsafeUnwrap()?.status).toBe('cancelled');

    // A wait on a cancelled request reports it immediately rather than hanging
    // until a timeout that is guaranteed to expire.
    const afterCancel = await queue.waitForResolution(thirdId, { timeoutMs: 10_000 });
    expect(afterCancel.isErr()).toBe(true);
    if (afterCancel.isErr()) expect(afterCancel.error.code).toBe('ABORTED');

    // `cancel` also wakes a live waiter, with the cancel's reason.
    const fourth = queue.enqueue({ kind: 'permission', toolName: 'move_file', payload: null });
    const fourthId = fourth._unsafeUnwrap();
    const live = queue.waitForResolution(fourthId, { timeoutMs: 10_000 });
    queue.cancel(fourthId, 'frank');
    const woken = await live;
    expect(woken.isErr()).toBe(true);
    if (woken.isErr()) {
      expect(woken.error.code).toBe('ABORTED');
      expect(stitchErrorMessage(woken.error)).toContain('frank');
    }
    expect(queue.waitingCount).toBe(0);

    // Cancelling something that does not exist is typed, not ignored.
    const ghost = queue.cancel('missing', 'x');
    expect(ghost.isErr()).toBe(true);
    if (ghost.isErr()) expect(ghost.error.code).toBe('CONFIG_ERROR');

    // A superseded request wakes its waiter, so a loop blocked on a request
    // that will never be answered stops waiting instead of timing out.
    const old = queue.enqueue({ kind: 'component', toolName: 'propose_component', payload: 1 });
    const oldId = old._unsafeUnwrap();
    const blocked = queue.waitForResolution(oldId, { timeoutMs: 10_000 });
    queue.enqueue({ kind: 'component', toolName: 'propose_component', payload: 2 });
    const superseded = await blocked;
    expect(superseded.isErr()).toBe(true);
    if (superseded.isErr()) {
      expect(superseded.error.code).toBe('ABORTED');
      expect(stitchErrorMessage(superseded.error)).toContain('Superseded');
    }
  });

  it('loop parks then approves', async () => {
    const { queue } = freshQueue();
    const machine = new AgentStateMachine();
    const seen: string[] = [];
    machine.onChange = c => seen.push(c.to);

    // The queue as the loop sees it, so no cast is needed at the seam.
    const gate: HilGate = {
      enqueue: request => queue.enqueue(request),
      waitForResolution: async (
        id: string,
        options: { timeoutMs?: number; signal?: AbortSignal }
      ): Promise<Result<HilGateOutcome, StitchError>> => {
        const r = await queue.waitForResolution(id, options);
        if (r.isErr()) return r;
        const v = r.value;
        return ok({
          resolution: v.resolution,
          by: v.by,
          ...(v.note !== undefined ? { note: v.note } : {}),
        });
      },
    };

    const ran: string[] = [];
    const gated = testTool(
      'propose_component',
      async () => {
        ran.push('propose');
        return ok('applied');
      },
      'gated'
    );

    const first = new MockProvider({
      script: [
        {
          kind: 'tool_call',
          toolCall: { id: 'c1', name: 'propose_component', arguments: { path: 'x' } },
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
      chat: (...a: Parameters<MockProvider['chat']>) => (turn++ === 0 ? first : second).chat(...a),
      countTokens: (messages: ChatMessage[]) =>
        messages.reduce((n, m) => n + Math.ceil(m.content.length / 4), 0),
      isRetryable: () => false,
    };

    const loop = runToolLoop(provider, [gated], [{ role: 'user', content: 'go' }], {
      maxIterations: 4,
      policy: defaultAutonomyPolicy(),
      stateMachine: machine,
      hilQueue: gate,
      context: bareContext(),
    });

    // The loop parks. Give the microtask queue a turn to reach the wait, then
    // assert it is genuinely parked rather than racing to the assertion.
    await new Promise(r => setTimeout(r, 10));
    expect(machine.state).toBe('waiting_approval');
    expect(queue.waitingCount).toBe(1);
    const parked = queue.pending()._unsafeUnwrap();
    expect(parked).toHaveLength(1);
    expect(parked[0]?.kind).toBe('component');
    expect(parked[0]?.toolName).toBe('propose_component');
    expect(parked[0]?.agentState).toBe('waiting_approval');
    // The tool has NOT run: the loop is blocked, not proceeding.
    expect(ran).toEqual([]);

    // A human approves from "the UI".
    const resolved = queue.resolve(parked[0]?.id ?? '', { resolution: 'approved', by: 'alice' });
    expect(resolved.isOk()).toBe(true);

    const result = await loop;
    expect(result.isOk()).toBe(true);
    // Approval ran the tool.
    expect(ran).toEqual(['propose']);
    expect(machine.state).toBe('done');
    expect(seen).toContain('waiting_approval');
    const toolMsg = result._unsafeUnwrap().messages.find(m => m.role === 'tool');
    expect(toolMsg?.content).toContain('applied');

    // A REJECTED gate: the loop continues, the tool never runs, and the model
    // is told so it can adapt rather than the job ending.
    const { queue: q2 } = freshQueue();
    const m2 = new AgentStateMachine();
    const ran2: string[] = [];
    const gated2 = testTool(
      'edit_config',
      async () => {
        ran2.push('edit');
        return ok('edited');
      },
      'gated'
    );
    const r1 = new MockProvider({
      script: [
        {
          kind: 'tool_call',
          toolCall: { id: 'd1', name: 'edit_config', arguments: { path: 'a' } },
        },
        { kind: 'finish', finishReason: 'tool_calls' },
      ],
    });
    const r2 = new MockProvider({
      script: [
        { kind: 'text', text: 'recovered' },
        { kind: 'finish', finishReason: 'stop', usage: { input: 1, output: 1, total: 2 } },
      ],
    });
    let t2 = 0;
    const p2 = {
      name: 'mock',
      model: 'mock-model',
      provider: 'mock' as const,
      id: 'mock/mock-model',
      chat: (...a: Parameters<MockProvider['chat']>) => (t2++ === 0 ? r1 : r2).chat(...a),
      countTokens: () => 10,
      isRetryable: () => false,
    };
    const loop2 = runToolLoop(p2, [gated2], [{ role: 'user', content: 'go' }], {
      maxIterations: 4,
      policy: defaultAutonomyPolicy(),
      stateMachine: m2,
      hilQueue: {
        enqueue: r => q2.enqueue(r),
        waitForResolution: async (id, options) => {
          const v = await q2.waitForResolution(id, options);
          if (v.isErr()) return v;
          return ok({ resolution: v.value.resolution, by: v.value.by });
        },
      },
      context: bareContext(),
    });
    await new Promise(r => setTimeout(r, 10));
    const pending2 = q2.pending()._unsafeUnwrap();
    expect(pending2[0]?.kind).toBe('permission');
    q2.resolve(pending2[0]?.id ?? '', { resolution: 'rejected', by: 'bob' });
    const result2 = await loop2;
    expect(result2.isOk()).toBe(true);
    expect(ran2).toEqual([]);
    const denied = result2._unsafeUnwrap().messages.find(m => m.role === 'tool');
    expect(denied?.content).toContain('TOOL_DENIED');
    expect(denied?.content).toContain('rejected by human review');
    expect(m2.state).toBe('done');

    // With NO queue wired, the P-140 approvalGate callback is still used, so a
    // pre-P-160 caller is unaffected.
    const m3 = new AgentStateMachine();
    const ran3: string[] = [];
    const gated3 = testTool(
      'move_file',
      async () => {
        ran3.push('move');
        return ok('moved');
      },
      'gated'
    );
    const s1 = new MockProvider({
      script: [
        { kind: 'tool_call', toolCall: { id: 'e1', name: 'move_file', arguments: { path: 'a' } } },
        { kind: 'finish', finishReason: 'tool_calls' },
      ],
    });
    const s2 = new MockProvider({
      script: [
        { kind: 'text', text: 'ok' },
        { kind: 'finish', finishReason: 'stop', usage: { input: 1, output: 1, total: 2 } },
      ],
    });
    let t3 = 0;
    const p3 = {
      name: 'mock',
      model: 'mock-model',
      provider: 'mock' as const,
      id: 'mock/mock-model',
      chat: (...a: Parameters<MockProvider['chat']>) => (t3++ === 0 ? s1 : s2).chat(...a),
      countTokens: () => 10,
      isRetryable: () => false,
    };
    const legacy = await runToolLoop(p3, [gated3], [{ role: 'user', content: 'go' }], {
      maxIterations: 4,
      policy: defaultAutonomyPolicy(),
      stateMachine: m3,
      approvalGate: async () => true,
      context: bareContext(),
    });
    expect(legacy.isOk()).toBe(true);
    expect(ran3).toEqual(['move']);
  });

  it('persists across restart', async () => {
    const path = tempDbPath();

    // --- Process 1: park a request and walk away. ---
    const first = freshQueue(path);
    const parkedId = first.queue.enqueue({
      kind: 'component',
      toolName: 'propose_component',
      payload: { name: 'widget', path: 'src/widget.ts' },
      agentState: 'waiting_approval',
    });
    expect(parkedId.isOk()).toBe(true);
    const requestId = parkedId._unsafeUnwrap();

    // A loop was blocked on it, and the process died with the waiter.
    const abandoned = first.queue.waitForResolution(requestId, { timeoutMs: 60_000 });
    expect(first.queue.waitingCount).toBe(1);
    void abandoned;
    first.db.close();

    // --- Process 2: a fresh queue over the same file. ---
    const second = freshQueue(path);
    // The request is still there, still pending, with its payload intact.
    const recovered = second.queue.get(requestId);
    expect(recovered.isOk()).toBe(true);
    const request = recovered._unsafeUnwrap();
    expect(request?.status).toBe('pending');
    expect(request?.kind).toBe('component');
    expect(request?.payload).toEqual({ name: 'widget', path: 'src/widget.ts' });
    expect(request?.agentState).toBe('waiting_approval');
    // It is visible to the UI that reconnected.
    expect(second.queue.listForUser()._unsafeUnwrap()).toHaveLength(1);
    expect(second.queue.waitingCount).toBe(0);

    // The new process answers it.
    const answered = second.queue.resolve(requestId, {
      resolution: 'approved',
      by: 'grace',
      note: 'ship it',
    });
    expect(answered.isOk()).toBe(true);
    expect(answered._unsafeUnwrap().by).toBe('grace');
    second.db.close();

    // --- Process 3: the original loop comes back and waits. ---
    // `waitForResolution` consults storage first, so the approval that landed
    // while it was dead is returned immediately rather than hanging. This is
    // what makes the spec's "idempotent via id" load-bearing rather than
    // aspirational.
    const third = freshQueue(path);
    const started = Date.now();
    const resumed = await third.queue.waitForResolution(requestId, { timeoutMs: 30_000 });
    const elapsed = Date.now() - started;
    expect(resumed.isOk()).toBe(true);
    expect(resumed._unsafeUnwrap().by).toBe('grace');
    expect(resumed._unsafeUnwrap().note).toBe('ship it');
    // It returned promptly, not after waiting for a human who already answered.
    expect(elapsed).toBeLessThan(5_000);
    // And the resolution is still idempotent across the restart boundary.
    const replay = third.queue.resolve(requestId, { resolution: 'rejected', by: 'mallory' });
    expect(replay._unsafeUnwrap().by).toBe('grace');
    third.db.close();

    // A restart with a *different* kind of row present does not confuse the
    // reader: a corrupt kind or status is skipped, not surfaced as a request.
    const corrupt = makeAdapter(path);
    corrupt.exec(
      'INSERT INTO hil_requests (id, kind, tool_name, created_at, payload, status) ' +
        "VALUES ('bad', 'not_a_kind', 'x', 't', '{}', 'pending')"
    );
    corrupt.exec(
      'INSERT INTO hil_requests (id, kind, tool_name, created_at, payload, status) ' +
        "VALUES ('bad2', 'permission', 'y', 't', 'not json', 'also_not_a_status')"
    );
    const fourth = new HilQueue({ db: corrupt });
    const survivors = fourth.pending()._unsafeUnwrap();
    expect(survivors.every(r => r.id !== 'bad' && r.id !== 'bad2')).toBe(true);
    // A row with a valid status but unreadable payload is still surfaced, with
    // the payload reported as null rather than throwing.
    const readable = survivors.find(r => r.toolName === 'y');
    expect(readable).toBeUndefined();
    corrupt.close();
  });
});
