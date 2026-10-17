// P-207 — `stitch audit` tests, over a REAL seeded temp sqlite db.
//
// The six required scenarios from the phase spec:
//
//   it('renders table')            it('filters time and actor')
//   it('exports json')             it('exports md')
//   it('no ai filter')             it('read only')
//
// plus one for the optional `--follow` tail (stop switch + sleep injected).

import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import {
  ProvenanceAudit,
  AiAuditLog,
  type DbLike,
  type StatementLike,
  type SQLiteRow,
  type SQLiteValue,
  type StitchError,
} from '@repo-stitcher/core';
import { ok, type Result } from 'neverthrow';
import type { GlobalOptions } from '../globals.js';
import { audit } from './audit.js';

// ---
// A local copy of core's shared node:sqlite test adapter
// (`core/src/sandbox/__tests__/fake-docker.ts`, the P-145/P-160/P-169 pattern).
// The real SQL matters here — the phase mandates a SEEDED sqlite — but a
// cross-package source import does not resolve from packages/cli, so the
// ~15-line adapter is duplicated instead of imported.
// ---

/** In-memory REAL sqlite, wrapped to core's `DbLike` shape. */
function makeTestDb(): DbLike {
  const raw = new DatabaseSync(':memory:');
  type RawStatement = {
    all(...p: SQLiteValue[]): Record<string, unknown>[];
    get(...p: SQLiteValue[]): Record<string, unknown> | undefined;
    run(...p: SQLiteValue[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  };
  const wrap = (stmt: RawStatement): StatementLike => ({
    all: (...p) => stmt.all(...p) as SQLiteRow[],
    get: (...p) => (stmt.get(...p) as SQLiteRow | undefined) ?? null,
    run: (...p) => {
      const r = stmt.run(...p);
      return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
    },
  });
  return {
    exec: sql => raw.exec(sql),
    // node:sqlite's `StatementSync` is structurally this, but its own declared
    // parameter variance does not resonate — one cast at the edge.
    query: sql => wrap(raw.prepare(sql) as unknown as RawStatement),
    close: () => raw.close(),
  };
}

const BASE: GlobalOptions = { verbose: false, yes: false, offline: false, color: true };
const T = (second: number): string => `2026-10-17T00:00:0${second}.000Z`;

type SeedRow = {
  ts: string;
  action: 'merge' | 'checksum' | 'test' | 'clone';
  actor: string;
  ok: boolean;
};

interface Seeded {
  adapter: DbLike;
  /** Append AFTER the audit command opened its handle (follow test). */
  appendMore: (row: {
    ts: string;
    action: 'merge' | 'checksum' | 'test' | 'clone' | 'push';
    actor: string;
    ok: boolean;
  }) => Promise<void>;
}

/**
 * Seed an in-memory REAL sqlite (node:sqlite adapter) through the REAL core
 * classes; the clock is fixed per row so the newest-first core read is
 * deterministic.
 */
async function seed(rows: SeedRow[], ai?: { ts: string }): Promise<Seeded> {
  const adapter = makeTestDb();
  let index = 0;
  const writer = new ProvenanceAudit({ db: adapter, now: () => rows[index]?.ts ?? T(0) });
  for (const row of rows) {
    const written = await writer.append({
      action: row.action,
      actor: row.actor,
      detail: {},
      ok: row.ok,
    });
    if (written.isErr()) throw written.error;
    index += 1;
  }
  if (ai !== undefined) {
    const aiLog = new AiAuditLog(adapter);
    aiLog.record({
      id: 'call-1',
      ts: ai.ts,
      provider: 'openrouter',
      model: 'test-model',
      promptVersion: 'v1',
      task: 'merge',
      inputTokens: 10,
      outputTokens: 20,
      costUsd: 0.5,
      latencyMs: 100,
      finishReason: 'stop',
      toolNames: [],
    });
    // `record` buffers per-instance (P-145); `flush` on the SAME instance is
    // what reaches SQL.
    aiLog.flush();
  }
  return {
    adapter,
    appendMore: async row => {
      const late = new ProvenanceAudit({ db: adapter, now: () => row.ts });
      const written = await late.append({
        action: row.action,
        actor: row.actor,
        detail: {},
        ok: row.ok,
      });
      if (written.isErr()) throw written.error;
    },
  };
}

/** A capturing sink, like the other command tests. */
function capture(): { lines: string[]; write: (line: string) => void } {
  const lines: string[] = [];
  return { lines, write: (line: string) => void lines.push(line) };
}

/** Audit deps over a SEEDED adapter: the sink from `out`, the db edge injected. */
function depsWith(
  seeded: Seeded,
  out: { write: (line: string) => void }
): {
  write: (line: string) => void;
  exists: (path: string) => boolean;
  openStateDb: (path: string) => Promise<Result<DbLike, StitchError>>;
} {
  return {
    write: out.write,
    exists: () => true,
    openStateDb: async () => ok(seeded.adapter),
  };
}

describe('P-207 stitch audit', () => {
  it('renders table', async () => {
    const seeded = await seed(
      [
        { ts: T(1), action: 'clone', actor: 'user:dev', ok: true },
        { ts: T(2), action: 'test', actor: 'pipeline', ok: false },
      ],
      { ts: T(4) }
    );
    const out = capture();
    const result = await audit(
      { ...BASE },
      {
        write: out.write,
        exists: () => true,
        openStateDb: async () => ok(seeded.adapter),
      }
    );
    expect(result.isOk()).toBe(true);

    const text = out.lines.join('\n');
    // Chronological: the clone (at :01) renders before the failed test (at :02).
    const cloneAt = text.indexOf('user:dev');
    const testAt = text.indexOf('pipeline');
    expect(cloneAt).toBeGreaterThan(-1);
    expect(testAt).toBeGreaterThan(cloneAt);
    expect(text).toContain('FAIL'); // the failed test render
    // Kind summary and the AI section (an AI call was seeded).
    expect(text).toContain('clone: 1');
    expect(text).toContain('test: 1');
    expect(text).toContain('AI calls: 1');
    expect(text).toContain('test-model');
  });

  it('filters time and actor', async () => {
    const seeded = await seed([
      { ts: T(1), action: 'clone', actor: 'user:a', ok: true },
      { ts: T(2), action: 'merge', actor: 'user:a', ok: true },
      { ts: T(3), action: 'test', actor: 'user:b', ok: false },
    ]);
    // `--from` is inclusive; the clone at :01 is gone.
    const fromOut = capture();
    const fromRes = await audit({ ...BASE, from: T(2) }, depsWith(seeded, fromOut));
    expect(fromRes.isOk()).toBe(true);
    expect(fromOut.lines.join('\n')).not.toContain('clone: 1');
    expect(fromOut.lines.join('\n')).toContain('merge');

    // `--to` is applied read-side (core only knows `since`).
    const toOut = capture();
    await audit({ ...BASE, to: T(2) }, depsWith(seeded, toOut));
    expect(toOut.lines.join('\n')).toContain('clone: 1');
    expect(toOut.lines.join('\n')).not.toContain('test: 1');

    // `--actor` narrows to that actor's rows and drives the summary.
    const actorOut = capture();
    await audit({ ...BASE, actor: 'user:b' }, depsWith(seeded, actorOut));
    expect(actorOut.lines.join('\n')).toContain('user:b');
    expect(actorOut.lines.join('\n')).toContain('test: 1');
    expect(actorOut.lines.join('\n')).not.toContain('merge: 1');

    // The "last merge" summary names the merge row and its actor.
    const sumOut = capture();
    await audit({ ...BASE }, depsWith(seeded, sumOut));
    expect(sumOut.lines.join('\n')).toContain('Last merge: 2026-10-17T00:00:02.000Z by user:a');
  });

  it('exports json', async () => {
    const seeded = await seed(
      [
        { ts: T(1), action: 'clone', actor: 'user:dev', ok: true },
        { ts: T(2), action: 'merge', actor: 'user:dev', ok: true },
        { ts: T(3), action: 'checksum', actor: 'pipeline', ok: true },
      ],
      { ts: T(4) }
    );
    const out = capture();
    const result = await audit({ ...BASE, export: 'json' }, depsWith(seeded, out));
    expect(result.isOk()).toBe(true);

    const report = JSON.parse(out.lines.join('\n')) as {
      records: Array<{ action: string; actor: string; ts: string }>;
      aiCalls: Array<{ model: string }>;
      countByAction: Record<string, number>;
      lastMerge?: { action: string };
      lastChecksum?: { action: string };
    };
    expect(report.records).toHaveLength(3);
    expect(report.records[0]?.action).toBe('clone'); // chronological, not newest-first
    expect(report.countByAction).toEqual({ clone: 1, merge: 1, checksum: 1 });
    expect(report.lastMerge?.action).toBe('merge');
    expect(report.lastChecksum?.action).toBe('checksum');
    expect(report.aiCalls[0]?.model).toBe('test-model');
  });

  it('exports md', async () => {
    const seeded = await seed(
      [
        { ts: T(1), action: 'clone', actor: 'user:dev', ok: true },
        { ts: T(2), action: 'test', actor: 'pipeline', ok: false },
      ],
      { ts: T(4) }
    );
    const out = capture();
    const result = await audit({ ...BASE, export: 'md' }, depsWith(seeded, out));
    expect(result.isOk()).toBe(true);

    const md = out.lines.join('\n');
    expect(md).toContain('# Stitch audit report');
    expect(md).toContain('| timestamp | actor | action | job | ok | detail |');
    expect(md).toContain('## Summary by kind');
    expect(md).toContain('| test | 1 |');
    expect(md).toContain('## AI calls');
  });

  it('no ai filter', async () => {
    const seeded = await seed([{ ts: T(1), action: 'clone', actor: 'user:dev', ok: true }], {
      ts: T(4),
    });
    const out = capture();
    const result = await audit({ ...BASE, noAi: true }, depsWith(seeded, out));
    expect(result.isOk()).toBe(true);

    const text = out.lines.join('\n');
    expect(text).not.toContain('AI calls:');
    expect(text).not.toContain('test-model');
    expect(text).toContain('clone'); // the provenance section survives
  });

  it('read only', async () => {
    // A MISSING db is an empty, ok read — nothing is created anywhere.
    const out = capture();
    const result = await audit(
      { ...BASE },
      {
        write: out.write,
        exists: () => false,
      }
    );
    expect(result.isOk()).toBe(true);
    expect(out.lines.join('\n')).toContain('No audit log found');

    // A PRESENT db reads back twice through the readonly open, unchanged.
    const seeded = await seed([{ ts: T(1), action: 'clone', actor: 'user:dev', ok: true }]);
    const first = capture();
    const read = await audit({ ...BASE }, depsWith(seeded, first));
    expect(read.isOk()).toBe(true);
    expect(first.lines.join('\n')).toContain('user:dev');
    const second = capture();
    await audit({ ...BASE }, depsWith(seeded, second));
    expect(second.lines).toEqual(first.lines);
  });

  it('follows new records', async () => {
    const seeded = await seed([{ ts: T(1), action: 'clone', actor: 'user:dev', ok: true }]);
    const out = capture();
    let polls = 0;
    const result = await audit(
      { ...BASE, follow: true },
      {
        ...depsWith(seeded, out),
        everyMs: 1,
        sleep: async () => {
          polls += 1;
          if (polls === 1) {
            // A NEW record lands between polls — visible only to the tail.
            await seeded.appendMore({ ts: T(9), action: 'push', actor: 'agent', ok: true });
          }
        },
        stop: iteration => iteration >= 3,
      }
    );
    expect(result.isOk()).toBe(true);
    const text = out.lines.join('\n');
    expect(text).toContain('+ '); // tailed marker
    expect(text).toContain('push');
    expect(text).toContain('agent');
    // The tailed line comes after the initial table (which holds user:dev).
    expect(text.indexOf('+ ')).toBeGreaterThan(text.indexOf('user:dev'));
  });
});
