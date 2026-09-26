// P-156 tests: agent tool `ask_user` (gated).
//
// The human responder is a controllable fake, so every terminal outcome is
// driven deterministically — no real timers, no waiting. The audit assertions
// read the trail back through a `node:sqlite`-backed `DbLike`, the same seam
// P-145's suite uses.

import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { askUserTool, askUser, resolveAskTimeout, validateAnswer } from './ask_user.js';
import {
  selectFilesTool,
  resolveDepsTool,
  detectGapsTool,
  fixDependencyTool,
  editConfigTool,
  moveFileTool,
  proposeComponentTool,
  runBuildTool,
  askUserTool as askAlias,
  registerAgentTool,
  clearAgentToolsForTests,
  listAgentTools,
} from './index.js';
import { AiAuditLog, ASK_USER_TASK } from '../../ai/audit.js';
import { DEFAULT_MAX_ASK_TIMEOUT_MS, type UserQuestion } from '../types.js';
import type { DbLike, SQLiteRow, SQLiteValue, StatementLike } from '../../store/schema.js';
import type { HumanResponse, ToolContext } from '../../ai/types.js';
import { stitchErrorMessage } from '../../result/index.js';

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

const QUESTION: UserQuestion = {
  id: 'q1',
  prompt: 'Which license should the merged repo adopt?',
  options: ['MIT', 'Apache-2.0'],
  defaultValue: 'MIT',
};

/** Build a ctx whose `human.present` is driven by the supplied responses. */
function makeCtx(
  opts: {
    responses?: HumanResponse[];
    config?: Record<string, unknown>;
    delayMs?: number;
    reject?: boolean;
  } = {}
): {
  ctx: ToolContext;
  presented: Array<{ id: string; prompt: string; options?: readonly string[] }>;
} {
  const presented: Array<{ id: string; prompt: string; options?: readonly string[] }> = [];
  const responses = opts.responses ?? [{ kind: 'answered' as const, value: 'MIT' }];
  let index = 0;
  const inert = {
    diff: async (): Promise<string> => '',
    status: async (): Promise<string> => '',
    commit: async (): Promise<void> => {},
    add: async (): Promise<void> => {},
    analyze: async (): Promise<Record<string, string>> => ({}),
    install: async (): Promise<void> => {},
    scan: async (): Promise<string[]> => [],
    check: async (): Promise<boolean> => true,
  };
  const ctx = {
    cwd: '/repo',
    config: opts.config ?? {},
    logger: { ...inert, info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    costTracker: { ...inert, add: () => {}, totalTokens: { input: 0, output: 0, total: 0 } },
    git: inert,
    deps: inert,
    license: inert,
    human: {
      present: async (q: {
        id: string;
        prompt: string;
        options?: readonly string[];
      }): Promise<HumanResponse> => {
        presented.push({
          id: q.id,
          prompt: q.prompt,
          ...(q.options ? { options: q.options } : {}),
        });
        if (opts.delayMs !== undefined) {
          await new Promise(resolve => setTimeout(resolve, opts.delayMs));
        }
        if (opts.reject === true) throw new Error('responder exploded');
        const next = responses[Math.min(index, responses.length - 1)];
        index += 1;
        return next ?? { kind: 'cancelled' };
      },
    },
  } as unknown as ToolContext;
  return { ctx, presented };
}

beforeEach(() => {
  clearAgentToolsForTests();
  for (const t of [
    selectFilesTool,
    resolveDepsTool,
    detectGapsTool,
    fixDependencyTool,
    editConfigTool,
    moveFileTool,
    proposeComponentTool,
    runBuildTool,
    askAlias,
  ]) {
    expect(registerAgentTool(t).isOk()).toBe(true);
  }
});

describe('P-156 ask_user', () => {
  it('returns chosen option', async () => {
    const { ctx, presented } = makeCtx({
      responses: [{ kind: 'answered', value: 'Apache-2.0' }],
    });
    const result = await askUser(QUESTION, ctx);
    expect(result.isOk()).toBe(true);
    const answer = result._unsafeUnwrap();
    // The answer is bound to the question it answers.
    expect(answer.id).toBe('q1');
    expect(answer.value).toBe('Apache-2.0');
    expect(answer.freeForm).toBe(false);
    expect(answer.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // The human actually saw the question and its options.
    expect(presented).toHaveLength(1);
    expect(presented[0]?.options).toEqual(['MIT', 'Apache-2.0']);

    // An answer outside the options is refused rather than silently accepted.
    const bogus = await askUser(
      QUESTION,
      makeCtx({
        responses: [{ kind: 'answered', value: 'WTFPL' }],
      }).ctx
    );
    expect(bogus.isErr()).toBe(true);
    expect(bogus._unsafeUnwrapErr().code).toBe('TOOL_ARGS_VALIDATION');

    // The tool is gated, and it is the second gated tool in the registry.
    expect(askUserTool.autonomy).toBe('gated');
    const gated = listAgentTools()
      .filter(t => t.autonomy === 'gated')
      .map(t => t.name);
    expect(gated).toEqual(['propose_component', 'ask_user']);
  });

  it('returns free form answer', async () => {
    const { ctx } = makeCtx({
      responses: [{ kind: 'answered', value: 'Use the vendored subtree as-is' }],
    });
    const result = await askUser(
      { id: 'q2', prompt: 'How should the vendored subtree be handled?', freeForm: true },
      ctx
    );
    expect(result.isOk()).toBe(true);
    const answer = result._unsafeUnwrap();
    expect(answer.value).toBe('Use the vendored subtree as-is');
    expect(answer.freeForm).toBe(true);

    // An empty free-form answer is still refused: resuming the loop with
    // nothing learned would be worse than failing.
    const empty = await askUser(
      { id: 'q3', prompt: 'Anything?', freeForm: true },
      makeCtx({ responses: [{ kind: 'answered', value: '   ' }] }).ctx
    );
    expect(empty.isErr()).toBe(true);

    // A free-form question ignores `options` entirely.
    const unconstrained = await askUser(
      { id: 'q4', prompt: 'Describe the resolution.', options: ['a', 'b'], freeForm: true },
      makeCtx({ responses: [{ kind: 'answered', value: 'anything at all' }] }).ctx
    );
    expect(unconstrained.isOk()).toBe(true);
    expect(unconstrained._unsafeUnwrap().value).toBe('anything at all');
  });

  it('times out', async () => {
    // A responder that never answers, against a 10ms bound.
    const { ctx } = makeCtx({ delayMs: 60, config: { ai: { maxAskTimeoutMs: 10 } } });
    const result = await askUser(QUESTION, ctx);
    expect(result.isErr()).toBe(true);
    const error = result._unsafeUnwrapErr();
    // Timeout is its own code, distinct from cancellation.
    expect(error.code).toBe('USER_TIMEOUT');
    if (error.code === 'USER_TIMEOUT') {
      expect(error.timeoutMs).toBe(10);
    }

    // An explicit override beats config.
    const overridden = await askUser(QUESTION, ctx, { timeoutMs: 5 });
    expect(overridden._unsafeUnwrapErr().code).toBe('USER_TIMEOUT');

    // No configured bound and no override -> the spec's 120s default.
    expect(resolveAskTimeout(makeCtx().ctx)).toBe(DEFAULT_MAX_ASK_TIMEOUT_MS);
    expect(DEFAULT_MAX_ASK_TIMEOUT_MS).toBe(120_000);
    expect(resolveAskTimeout(ctx)).toBe(10);
    // Garbage config falls back rather than producing a NaN timeout.
    expect(resolveAskTimeout(makeCtx({ config: { ai: { maxAskTimeoutMs: -5 } } }).ctx)).toBe(
      DEFAULT_MAX_ASK_TIMEOUT_MS
    );
  });

  it('aborts on cancel', async () => {
    // Active cancellation by the human.
    const cancelled = await askUser(QUESTION, makeCtx({ responses: [{ kind: 'cancelled' }] }).ctx);
    expect(cancelled.isErr()).toBe(true);
    expect(cancelled._unsafeUnwrapErr().code).toBe('ABORTED');

    // AbortSignal fires while waiting.
    const controller = new AbortController();
    const { ctx, presented } = makeCtx({ delayMs: 50 });
    const pending = askUser(QUESTION, ctx, { signal: controller.signal });
    controller.abort();
    const aborted = await pending;
    expect(aborted.isErr()).toBe(true);
    expect(aborted._unsafeUnwrapErr().code).toBe('ABORTED');
    // The question WAS presented before the abort — the human saw it.
    expect(presented).toHaveLength(1);

    // An already-aborted signal never reaches the human at all.
    const pre = new AbortController();
    pre.abort();
    const { ctx: untouched, presented: never } = makeCtx();
    const shortCircuit = await askUser(QUESTION, untouched, { signal: pre.signal });
    expect(shortCircuit._unsafeUnwrapErr().code).toBe('ABORTED');
    expect(never).toHaveLength(0);

    // No responder wired -> a loud CONFIG_ERROR, not a silent hang.
    const noHuman = makeCtx().ctx as ToolContext & { human?: unknown };
    const stripped = { ...noHuman, human: undefined } as unknown as ToolContext;
    const missing = await askUser(QUESTION, stripped);
    expect(missing.isErr()).toBe(true);
    expect(missing._unsafeUnwrapErr().code).toBe('CONFIG_ERROR');

    // A responder that rejects does not take the loop down.
    const crashed = await askUser(QUESTION, makeCtx({ reject: true }).ctx);
    expect(crashed._unsafeUnwrapErr().code).toBe('ABORTED');
  });

  it('records audit', async () => {
    const db = makeAdapter();
    const audit = new AiAuditLog(db, { flushEvery: 1 });

    // An answered exchange.
    const answered = await askUser(
      QUESTION,
      makeCtx({
        responses: [{ kind: 'answered', value: 'Apache-2.0' }],
      }).ctx,
      { audit }
    );
    expect(answered.isOk()).toBe(true);

    // A timeout is recorded too — "nobody answered" is provenance worth keeping.
    await askUser(QUESTION, makeCtx({ delayMs: 40, config: { ai: { maxAskTimeoutMs: 5 } } }).ctx, {
      audit,
    });

    // And a cancellation.
    await askUser(QUESTION, makeCtx({ responses: [{ kind: 'cancelled' }] }).ctx, { audit });

    const rows = await audit.query({ task: ASK_USER_TASK });
    expect(rows).toHaveLength(3);
    const outcomes = rows.map(r => r.question?.outcome).sort();
    expect(outcomes).toEqual(['answered', 'cancelled', 'timeout']);

    const answerRow = rows.find(r => r.question?.outcome === 'answered');
    expect(answerRow?.question?.questionId).toBe('q1');
    expect(answerRow?.question?.answer).toBe('Apache-2.0');
    expect(answerRow?.question?.freeForm).toBe(false);
    // An ask calls no model, so it carries no fabricated cost or latency.
    expect(answerRow?.inputTokens).toBe(0);
    expect(answerRow?.costUsd).toBe(0);
    expect(answerRow?.latencyMs).toBe(0);
    expect(answerRow?.toolNames).toEqual(['ask_user']);

    // Secret hygiene (P-156 handoff): a free-form answer carrying a
    // credential-shaped value is redacted before it reaches the column AND
    // before it leaves the tool.
    const leaky = await askUser(
      { id: 'q9', prompt: 'Paste the API key you used.', freeForm: true },
      makeCtx({
        responses: [{ kind: 'answered', value: 'sk-abcdef0123456789abcdef01' }],
      }).ctx,
      { audit }
    );
    expect(leaky.isOk()).toBe(true);
    expect(leaky._unsafeUnwrap().value).not.toContain('abcdef0123456789abcdef01');

    const afterLeak = await audit.query({ task: ASK_USER_TASK });
    const leakRow = afterLeak.find(r => r.question?.questionId === 'q9');
    expect(leakRow).toBeDefined();
    expect(leakRow?.question?.answer).not.toContain('abcdef0123456789abcdef01');
    expect(leakRow?.question?.outcome).toBe('answered');

    // Answer validation is exported and independently correct.
    expect(validateAnswer(QUESTION, 'MIT').isOk()).toBe(true);
    expect(validateAnswer(QUESTION, 'nope').isErr()).toBe(true);
    expect(validateAnswer({ id: 'x', prompt: 'p', freeForm: true }, 'anything').isOk()).toBe(true);
    expect(stitchErrorMessage(validateAnswer(QUESTION, 'nope')._unsafeUnwrapErr())).toContain(
      'not one of the offered options'
    );
  });
});
