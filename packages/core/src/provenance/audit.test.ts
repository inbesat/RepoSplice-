// P-187 — audit log tests, against REAL temp SQLite.
//
// A real `DbLike` (the `node:sqlite` adapter the P-169/P-173/P-178/P-186 suites
// use) rather than a stub: "append-only" and "query filters" are claims about what
// the DATABASE holds, and a fake that keeps an array cannot substantiate either.
//
// The six required scenarios from the phase spec:
//
//   it('appends records')      it('is append only')     it('queries filters')
//   it('sanitizes details')    it('records approvals')  it('exports json')

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { dbAll, type DbLike } from '../store/schema.js';
import { makeDbAdapter } from '../sandbox/__tests__/fake-docker.js';
import {
  AUDIT_ACTIONS,
  PROVENANCE_AUDIT_TABLE_SQL,
  ProvenanceAudit,
  sanitizeDetail,
  type AuditDraft,
} from './audit.js';

const T1 = '2026-10-16T00:00:00.000Z';
const T2 = '2026-10-16T00:01:00.000Z';
const T3 = '2026-10-16T00:02:00.000Z';

let db: DbLike;
let audit: ProvenanceAudit;

/** A draft with sensible defaults. */
function draft(over: Partial<AuditDraft> = {}): AuditDraft {
  return { action: 'merge', actor: 'agent', detail: {}, ok: true, ...over };
}

beforeEach(() => {
  db = makeDbAdapter();
  audit = new ProvenanceAudit({ db, now: () => T1 });
});

afterEach(() => {
  db.close();
});

describe('P-187 audit', () => {
  it('appends records', async () => {
    const appended = await audit.append(draft({ jobId: 'job-1', detail: { repos: ['a', 'b'] } }));
    expect(appended.isOk()).toBe(true);
    if (appended.isErr()) return;

    // `id` and `ts` are ASSIGNED by append, and returned.
    expect(appended.value.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(appended.value.ts).toBe(T1);
    expect(appended.value.action).toBe('merge');
    expect(appended.value.actor).toBe('agent');
    expect(appended.value.jobId).toBe('job-1');
    expect(appended.value.ok).toBe(true);

    // The row is actually in the database, not just in the return value.
    const rows = dbAll(db, 'SELECT id, action, detail FROM provenance_audit');
    expect(rows.isOk()).toBe(true);
    if (rows.isOk()) {
      expect(rows.value).toHaveLength(1);
      expect(rows.value[0]?.['detail']).toBe('{"repos":["a","b"]}');
    }

    // The full action vocabulary is available for validation.
    expect(AUDIT_ACTIONS).toHaveLength(18);
    expect(AUDIT_ACTIONS).toContain('checksum');

    // Blank action/actor is a typed config error, not a row.
    const blank = await audit.append(draft({ actor: '   ' }));
    expect(blank.isErr()).toBe(true);
    if (blank.isErr()) expect(blank.error.code).toBe('CONFIG_ERROR');

    // `ok:false` round-trips as a boolean (stored as 0/1).
    const failed = await audit.append(draft({ ok: false, action: 'build' }));
    if (failed.isOk()) {
      const read = await audit.query({ action: 'build' });
      if (read.isOk()) expect(read.value[0]?.ok).toBe(false);
    }
  });

  it('is append only', async () => {
    // THE GUARANTEE: there is no update and no delete to call.
    const surface = new Set(Object.getOwnPropertyNames(Object.getPrototypeOf(audit)));
    for (const forbidden of ['update', 'delete', 'remove', 'edit', 'clear', 'reset', 'truncate']) {
      expect(surface.has(forbidden)).toBe(false);
    }
    expect(surface.has('append')).toBe(true);

    await audit.append(draft({ detail: { note: 'first' } }));
    await audit.append(draft({ detail: { note: 'second' } }));
    await audit.append(draft({ detail: { note: 'third' } }));

    const all = await audit.fullAudit();
    expect(all.isOk()).toBe(true);
    if (all.isErr()) return;
    expect(all.value).toHaveLength(3);

    // The FIRST row's bytes are unchanged after two more appends.
    const first = all.value.find(record => record.detail['note'] === 'first');
    expect(first).toBeDefined();
    expect(first?.ts).toBe(T1);

    // A re-read returns the identical set — appending is the only mutation that
    // can happen, so the count only ever grows.
    const again = await audit.fullAudit();
    if (again.isOk()) {
      expect(again.value.map(r => r.id)).toEqual(all.value.map(r => r.id));
    }

    // The table is created on first use, by its owner (no store migration).
    expect(PROVENANCE_AUDIT_TABLE_SQL).toContain('provenance_audit');
  });

  it('queries filters', async () => {
    let clock = T1;
    const timed = new ProvenanceAudit({ db, now: () => clock });
    await timed.append(draft({ action: 'clone', actor: 'pipeline', jobId: 'job-1' }));
    clock = T2;
    await timed.append(draft({ action: 'build', actor: 'agent', jobId: 'job-1' }));
    clock = T3;
    await timed.append(draft({ action: 'build', actor: 'user', jobId: 'job-2' }));

    const byAction = await timed.query({ action: 'build' });
    expect(byAction.isOk()).toBe(true);
    if (byAction.isOk()) {
      expect(byAction.value).toHaveLength(2);
      // Newest first.
      expect(byAction.value[0]?.ts).toBe(T3);
    }

    const byActor = await timed.query({ actor: 'user' });
    if (byActor.isOk()) {
      expect(byActor.value).toHaveLength(1);
      expect(byActor.value[0]?.action).toBe('build');
    }

    const byJob = await timed.query({ jobId: 'job-1' });
    if (byJob.isOk()) expect(byJob.value).toHaveLength(2);

    const since = await timed.query({ since: T2 });
    if (since.isOk()) {
      expect(since.value).toHaveLength(2);
      expect(since.value.map(r => r.ts)).toEqual([T3, T2]);
    }

    const limited = await timed.query({ limit: 1 });
    if (limited.isOk()) expect(limited.value).toHaveLength(1);

    // Filters COMBINE (AND), not OR.
    const combined = await timed.query({ action: 'build', actor: 'agent' });
    if (combined.isOk()) {
      expect(combined.value).toHaveLength(1);
      expect(combined.value[0]?.jobId).toBe('job-1');
    }

    // No match is an empty list, not an error.
    const none = await timed.query({ actor: 'nobody' });
    expect(none.isOk()).toBe(true);
    if (none.isOk()) expect(none.value).toEqual([]);
  });

  it('sanitizes details', async () => {
    // The sanitizer is exercised directly…
    const direct = sanitizeDetail({
      token: 'API_KEY=supersecretvalue123',
      nested: { authorization: 'Authorization: Bearer abcdefgh1234' },
      list: ['ghp_ABCDEFGHIJKLMNOPQRST'],
      count: 3,
      flag: true,
    });
    expect(JSON.stringify(direct)).not.toContain('supersecretvalue123');
    expect(JSON.stringify(direct)).not.toContain('abcdefgh1234');
    expect(JSON.stringify(direct)).not.toContain('ghp_ABCDEFGHIJKLMNOPQRST');
    expect(JSON.stringify(direct)).toContain('[REDACTED]');
    // Non-strings keep their type.
    expect(direct['count']).toBe(3);
    expect(direct['flag']).toBe(true);

    // …and is applied BEFORE the row exists, which is the point: the credential
    // never reaches the database, so a compliance dump cannot leak it.
    const appended = await audit.append(
      draft({ detail: { env: 'GITHUB_TOKEN=ghp_ABCDEFGHIJKLMNOPQRST', plain: 'ok' } })
    );
    expect(appended.isOk()).toBe(true);
    const rows = dbAll(db, 'SELECT detail FROM provenance_audit');
    expect(rows.isOk()).toBe(true);
    if (rows.isOk()) {
      const stored = String(rows.value[0]?.['detail']);
      expect(stored).not.toContain('ghp_ABCDEFGHIJKLMNOPQRST');
      expect(stored).toContain('[REDACTED]');
      expect(stored).toContain('ok');
    }

    // Reading back returns the SCRUBBED detail, not the original.
    const read = await audit.query();
    if (read.isOk()) {
      expect(JSON.stringify(read.value[0]?.detail)).not.toContain('ghp_ABCDEFGHIJKLMNOPQRST');
    }
  });

  it('records approvals', async () => {
    // HIL decisions are first-class audit actions (P-160 approvals/rejects).
    let clock = T1;
    const timed = new ProvenanceAudit({ db, now: () => clock });
    await timed.append(
      draft({ action: 'approve', actor: 'user:ada', jobId: 'job-9', detail: { tool: 'run_build' } })
    );
    clock = T2;
    await timed.append(
      draft({
        action: 'reject',
        actor: 'user:grace',
        jobId: 'job-9',
        detail: { tool: 'edit_config', reason: 'not now' },
        ok: false,
      })
    );

    const approvals = await timed.query({ action: 'approve' });
    expect(approvals.isOk()).toBe(true);
    if (approvals.isOk()) {
      expect(approvals.value).toHaveLength(1);
      expect(approvals.value[0]?.actor).toBe('user:ada');
      expect(approvals.value[0]?.detail['tool']).toBe('run_build');
      expect(approvals.value[0]?.ok).toBe(true);
    }

    const rejections = await timed.query({ action: 'reject' });
    if (rejections.isOk()) {
      expect(rejections.value).toHaveLength(1);
      expect(rejections.value[0]?.ok).toBe(false);
      expect(rejections.value[0]?.detail['reason']).toBe('not now');
    }

    // Both are attributable to the same job, so a reviewer can replay it.
    const forJob = await timed.query({ jobId: 'job-9' });
    if (forJob.isOk()) expect(forJob.value).toHaveLength(2);
  });

  it('exports json', async () => {
    let clock = T1;
    const timed = new ProvenanceAudit({ db, now: () => clock });
    await timed.append(draft({ action: 'init', actor: 'pipeline' }));
    clock = T2;
    await timed.append(
      draft({ action: 'checksum', actor: 'agent', detail: { manifestSha256: 'a'.repeat(64) } })
    );
    clock = T3;
    await timed.append(draft({ action: 'git_notes', actor: 'agent', detail: { wrote: true } }));

    const exported = await timed.exportJson();
    expect(exported.isOk()).toBe(true);
    if (exported.isErr()) return;

    const parsed: unknown = JSON.parse(exported.value);
    expect(Array.isArray(parsed)).toBe(true);
    if (!Array.isArray(parsed)) return;
    const records = parsed as { ts: string; action: string }[];
    expect(records).toHaveLength(3);
    // OLDEST first, so an auditor reads the story in order.
    expect(records.map(record => record.ts)).toEqual([T1, T2, T3]);
    expect(records.map(record => record.action)).toEqual(['init', 'checksum', 'git_notes']);
    expect(exported.value.endsWith('\n')).toBe(true);

    // Two exports of the same log are byte-identical (diffable).
    const again = await timed.exportJson();
    if (again.isOk()) expect(again.value).toBe(exported.value);

    // An empty log exports an empty array rather than failing.
    const empty = new ProvenanceAudit({ db: makeDbAdapter(), now: () => T1 });
    const emptyExport = await empty.exportJson();
    expect(emptyExport.isOk()).toBe(true);
    if (emptyExport.isOk()) expect(emptyExport.value.trim()).toBe('[]');
  });
});
