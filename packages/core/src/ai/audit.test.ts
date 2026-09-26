// P-145 tests: the AI call audit log against REAL SQL.
//
// vitest workers run on Node and cannot resolve `bun:sqlite`, so these tests
// drive `AiAuditLog` (same DDL, same INSERT/SELECT, same helpers) through a
// `node:sqlite`-backed `DbLike` adapter — the pattern P-030 established in
// `store/__tests__/db.test.ts`. `bun:sqlite`'s `Database` satisfies `DbLike`
// structurally, so the identical SQL runs identically in production.
import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { ok } from 'neverthrow';
import type { DbLike, SQLiteRow, SQLiteValue, StatementLike } from '../store/schema.js';
import { AiAuditLog, redactAuditText, newAuditId, nowIso } from './audit.js';
import type { AiCallAudit } from './audit.js';
import { runToolLoop } from './loop.js';
import { MockProvider } from './mock.js';
import { z } from 'zod';
import type { ChatMessage, LoopConfig, ToolDefinition } from './types.js';

/**
 * `node:sqlite`-backed `DbLike`, normalized to the single engine contract:
 * `undefined` -> `null` for "no row", booleans bound as 0/1, bigint counts
 * coerced to number.
 */
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

function makeCall(overrides: Partial<AiCallAudit> = {}): AiCallAudit {
  return {
    id: newAuditId(),
    ts: '2026-09-23T10:00:00.000Z',
    provider: 'openrouter',
    model: 'anthropic/claude-sonnet-4',
    promptVersion: 'abc123def456',
    task: 'resolve-deps',
    inputTokens: 1000,
    outputTokens: 500,
    costUsd: 0.0123,
    latencyMs: 842,
    finishReason: 'stop',
    toolNames: ['select_files', 'resolve_dependency_closure'],
    ...overrides,
  };
}

describe('P-145 audit: records a call', () => {
  it('records a call', async () => {
    const db = makeAdapter();
    const audit = new AiAuditLog(db);
    const call = makeCall();

    audit.record(call);
    expect(audit.pendingCount).toBe(1);
    expect(audit.flush()).toBe(1);
    expect(audit.pendingCount).toBe(0);

    const rows = await audit.query();
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.id).toBe(call.id);
    expect(row.ts).toBe(call.ts);
    expect(row.provider).toBe('openrouter');
    expect(row.model).toBe('anthropic/claude-sonnet-4');
    expect(row.inputTokens).toBe(1000);
    expect(row.outputTokens).toBe(500);
    expect(row.costUsd).toBeCloseTo(0.0123, 6);
    expect(row.latencyMs).toBe(842);
    expect(row.finishReason).toBe('stop');
    expect(row.error).toBeUndefined();
  });
});

describe('P-145 audit: batches writes', () => {
  it('batches writes', async () => {
    const db = makeAdapter();
    const audit = new AiAuditLog(db, { flushEvery: 3 });

    audit.record(makeCall({ ts: '2026-09-23T10:00:01.000Z' }));
    audit.record(makeCall({ ts: '2026-09-23T10:00:02.000Z' }));
    // Below the batch size: still buffered, nothing written yet.
    expect(audit.pendingCount).toBe(2);
    expect(await audit.query()).toHaveLength(0);

    // Third call trips the batch and all three land together.
    audit.record(makeCall({ ts: '2026-09-23T10:00:03.000Z' }));
    expect(audit.pendingCount).toBe(0);
    expect(await audit.query({ limit: 10 })).toHaveLength(3);

    // An empty flush is a no-op.
    expect(audit.flush()).toBe(0);
  });
});

describe('P-145 audit: queries rows', () => {
  it('queries rows', async () => {
    const db = makeAdapter();
    const audit = new AiAuditLog(db, { flushEvery: 100 });

    audit.record(makeCall({ task: 'resolve-deps', model: 'm-a', ts: '2026-09-23T09:00:00.000Z' }));
    audit.record(
      makeCall({ task: 'generate-component', model: 'm-b', ts: '2026-09-23T11:00:00.000Z' })
    );
    audit.record(makeCall({ task: 'resolve-deps', model: 'm-b', ts: '2026-09-23T12:00:00.000Z' }));
    audit.flush();

    expect(await audit.query({ task: 'resolve-deps' })).toHaveLength(2);
    expect(await audit.query({ model: 'm-b' })).toHaveLength(2);
    expect(await audit.query({ task: 'resolve-deps', model: 'm-b' })).toHaveLength(1);
    expect(await audit.query({ since: '2026-09-23T11:30:00.000Z' })).toHaveLength(1);
    expect(await audit.query({ limit: 2 })).toHaveLength(2);

    // Newest first, and the limit is honored deterministically.
    const all = await audit.query({ limit: 10 });
    expect(all.map(r => r.ts)).toEqual([
      '2026-09-23T12:00:00.000Z',
      '2026-09-23T11:00:00.000Z',
      '2026-09-23T09:00:00.000Z',
    ]);

    // A filter that matches nothing is empty, not an error.
    expect(await audit.query({ task: 'no-such-task' })).toHaveLength(0);
  });
});

describe('P-145 audit: sums cost', () => {
  it('sums cost', async () => {
    const db = makeAdapter();
    const audit = new AiAuditLog(db, { flushEvery: 100 });

    audit.record(makeCall({ costUsd: 0.1, ts: '2026-09-23T09:00:00.000Z' }));
    audit.record(makeCall({ costUsd: 0.25, ts: '2026-09-23T10:00:00.000Z' }));
    audit.record(makeCall({ costUsd: 0.5, ts: '2026-09-23T11:00:00.000Z' }));
    audit.flush();

    expect(await audit.costTotal()).toBeCloseTo(0.85, 6);
    expect(await audit.costTotal('2026-09-23T10:30:00.000Z')).toBeCloseTo(0.5, 6);

    // An empty log sums to zero rather than null/undefined.
    const empty = new AiAuditLog(makeAdapter());
    expect(await empty.costTotal()).toBe(0);
  });
});

describe('P-145 audit: records failures', () => {
  it('records failures', async () => {
    const db = makeAdapter();
    const audit = new AiAuditLog(db, { flushEvery: 1 });

    audit.record(
      makeCall({
        finishReason: 'error',
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        error: {
          kind: 'rate_limit',
          message: '429 rate limited',
          providerName: 'openrouter',
          retryable: true,
        },
      })
    );

    const rows = await audit.query();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.finishReason).toBe('error');
    expect(rows[0]?.error).toBeDefined();
    expect(rows[0]?.error?.kind).toBe('rate_limit');
    expect(rows[0]?.error?.message).toContain('rate limited');
  });

  it('redacts credentials from stored errors', async () => {
    const db = makeAdapter();
    const audit = new AiAuditLog(db, { flushEvery: 1 });

    audit.record(
      makeCall({
        finishReason: 'error',
        error: {
          kind: 'auth',
          message: '401 invalid apiKey=sk-live-ABCDEFGH12345678 for tenant',
          providerName: 'openrouter',
          retryable: false,
        },
      })
    );

    const rows = await audit.query();
    const stored = rows[0]?.error?.message ?? '';
    expect(stored).not.toContain('sk-live-ABCDEFGH12345678');
    expect(stored).toContain('[REDACTED]');

    // The scrubber is exported so callers can assert the same guarantee.
    expect(redactAuditText('token: ghp_ABCDEFGHIJKLMNOPQRST')).not.toContain(
      'ghp_ABCDEFGHIJKLMNOPQRST'
    );
    expect(redactAuditText('Authorization: Bearer abcdefgh12345678')).toContain('[REDACTED]');
  });
});

describe('P-145 audit: stores prompt version and tools', () => {
  it('stores prompt version and tools', async () => {
    const db = makeAdapter();
    const audit = new AiAuditLog(db, { flushEvery: 1 });

    audit.record(
      makeCall({
        promptVersion: 'v-template-42',
        toolNames: ['select_files', 'detect_gaps', 'propose_component'],
      })
    );

    const row = (await audit.query())[0]!;
    expect(row.promptVersion).toBe('v-template-42');
    expect(row.toolNames).toEqual(['select_files', 'detect_gaps', 'propose_component']);
  });
});

describe('P-145 audit: loop records every provider call', () => {
  const noopTool: ToolDefinition = {
    name: 'noop',
    description: 'does nothing',
    schema: { value: z.string() },
    execute: async () => ok('done'),
    autonomy: 'auto',
  };

  function loopConfig(overrides: Partial<LoopConfig> = {}): LoopConfig {
    return { maxIterations: 1, ...overrides };
  }

  /** A provider that reports a known token usage, so the audit row can be checked. */
  function scriptedProvider(): MockProvider {
    return new MockProvider({
      name: 'mock',
      model: 'mock-model',
      script: [
        { kind: 'text', text: 'done' },
        {
          kind: 'finish',
          finishReason: 'stop',
          usage: { input: 120, output: 45, total: 165 },
        },
      ],
    });
  }

  const messages: ChatMessage[] = [{ role: 'user', content: 'hello' }];

  it('records a successful call with prompt version, tools, and usage', async () => {
    const audit = new AiAuditLog(makeAdapter(), { flushEvery: 1 });

    const result = await runToolLoop(
      scriptedProvider(),
      [noopTool],
      messages,
      loopConfig({ audit })
    );
    expect(result.isOk()).toBe(true);

    const rows = await audit.query();
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.provider).toBe('mock');
    expect(row.model).toBe('mock-model');
    expect(row.task).toBe('agent-loop');
    expect(row.finishReason).toBe('stop');
    expect(row.promptVersion).toMatch(/^[0-9a-f]{12}$/);
    expect(row.toolNames).toEqual(['noop']);
    expect(row.inputTokens).toBe(120);
    expect(row.outputTokens).toBe(45);
    expect(row.costUsd).toBeGreaterThanOrEqual(0);
    expect(row.latencyMs).toBeGreaterThanOrEqual(0);
    expect(row.error).toBeUndefined();
  });

  it('records a failed call with the provider error populated', async () => {
    const audit = new AiAuditLog(makeAdapter(), { flushEvery: 1 });
    // The provider throws on its first stream iteration, so the loop must both
    // fail AND leave an audit row behind (recorded in `finally`).
    const provider = new MockProvider({
      failWith: {
        kind: 'rate_limit',
        message: '429 slow down',
        providerName: 'mock',
        retryable: true,
      },
    });

    const result = await runToolLoop(provider, [noopTool], messages, loopConfig({ audit }));
    expect(result.isErr()).toBe(true);

    const rows = await audit.query();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.finishReason).toBe('error');
    expect(rows[0]?.error?.kind).toBe('rate_limit');
    expect(rows[0]?.error?.message).toContain('slow down');
  });

  it('uses the task and prompt version supplied by the caller', async () => {
    const audit = new AiAuditLog(makeAdapter(), { flushEvery: 1 });

    await runToolLoop(
      scriptedProvider(),
      [noopTool],
      messages,
      loopConfig({ audit, task: 'detect-gaps', promptVersion: 'v-explicit' })
    );

    const row = (await audit.query({ task: 'detect-gaps' }))[0]!;
    expect(row.task).toBe('detect-gaps');
    expect(row.promptVersion).toBe('v-explicit');
  });
});

describe('P-145 audit: never throws on database failure', () => {
  it('keeps the loop working when the audit sink is broken', async () => {
    // A DbLike whose every operation throws stands in for a locked/corrupt db.
    const broken: DbLike = {
      exec: () => {
        throw new Error('database is locked');
      },
      query: () => {
        throw new Error('database is locked');
      },
      close: () => undefined,
    };
    const audit = new AiAuditLog(broken, { flushEvery: 1 });

    expect(() => audit.record(makeCall())).not.toThrow();
    // A failed flush re-queues the batch for the next attempt rather than
    // losing the row, so reads stay empty but nothing has been dropped yet.
    expect(audit.droppedCount).toBe(0);
    expect(await audit.query()).toEqual([]);
    expect(await audit.costTotal()).toBe(0);

    // The buffer is bounded: past the cap the oldest row is dropped and
    // counted instead of growing without limit.
    const bounded = new AiAuditLog(broken, { flushEvery: 1_000_000 });
    for (let i = 0; i < 1001; i++) bounded.record(makeCall());
    expect(bounded.droppedCount).toBe(1);
    expect(bounded.pendingCount).toBe(1000);

    // The stamp helpers stay usable for callers building their own records.
    expect(newAuditId()).toMatch(/^[0-9a-f-]{36}$/);
    expect(nowIso()).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
