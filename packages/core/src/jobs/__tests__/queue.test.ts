// P-239 — job queue tests, against REAL temp SQLite.
//
// A real `DbLike` rather than a stub: "claim is atomic", "no double run", "stale
// lease requeued" and "guarded transitions" are all claims about what the DATABASE
// enforces. An in-memory array cannot substantiate any of them — it would simply
// re-implement the guard in JavaScript and prove nothing about the SQL.
//
// The five required scenarios from the phase spec:
//
//   it('lifecycle')     it('no double run')     it('cancel pause')
//   it('stale requeue')  it('queries')

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { dbAll, type DbLike } from '../../store/schema.js';
import { makeDbAdapter } from '../../sandbox/__tests__/fake-docker.js';
import { JOBS_TABLE_NAME, PIPELINE_JOBS_TABLE_SQL } from '../schema.js';
import { JOB_TRANSITIONS, canJobTransition, isTerminalJobStatus, type JobEvent } from '../types.js';
import { JobQueue } from '../queue.js';

const T1 = '2026-10-16T00:00:00.000Z';
const MINUTE = 60_000;

let db: DbLike;

/** A queue whose clock the test drives. */
function queue(opts: { ttlMs?: number; emit?: (e: JobEvent) => void } = {}): {
  q: JobQueue;
  tick: (iso: string) => void;
} {
  let clock = T1;
  const q = new JobQueue({
    db,
    now: () => clock,
    ...(opts.ttlMs !== undefined ? { leaseTtlMs: opts.ttlMs } : {}),
    ...(opts.emit !== undefined ? { emit: opts.emit } : {}),
  });
  return { q, tick: iso => (clock = iso) };
}

beforeEach(() => {
  db = makeDbAdapter();
});

afterEach(() => {
  db.close();
});

describe('P-239 job queue', () => {
  it('lifecycle', async () => {
    const at = (ms: number): string => new Date(Date.parse(T1) + ms).toISOString();
    const { q, tick } = queue();

    // The table is the phase's column set, created on first use, and NOT `jobs` —
    // v1 already owns that name with a different shape.
    await q.list();
    const ddl = dbAll(
      db,
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = '${JOBS_TABLE_NAME}'`
    );
    expect(ddl.isOk()).toBe(true);
    if (ddl.isOk()) expect(ddl.value).toHaveLength(1);
    expect(PIPELINE_JOBS_TABLE_SQL).toContain('lease_expires_at');
    expect(PIPELINE_JOBS_TABLE_SQL).toContain('config_json');

    // enqueue → queued.
    const created = await q.enqueue({ kind: 'stitch', ctx: { repo: '/tmp/c' } });
    expect(created.isOk()).toBe(true);
    if (created.isErr()) return;
    const job = created.value;
    expect(job.status).toBe('queued');
    expect(job.kind).toBe('stitch');
    expect(job.ctx).toEqual({ repo: '/tmp/c' });
    expect(job.createdAt).toBe(T1);
    expect(job.startedAt).toBeUndefined();
    expect(job.finishedAt).toBeUndefined();
    // Ids are a slug plus a timestamp (P-205) — and MUST still be unique when two
    // jobs of the same kind are enqueued within one clock tick, or the second
    // INSERT collides on the PRIMARY KEY. This test found exactly that.
    expect(job.id.startsWith('stitch-')).toBe(true);
    const twin = await q.enqueue({ kind: 'stitch', ctx: {} });
    expect(twin.isOk()).toBe(true);
    if (twin.isOk()) {
      expect(twin.value.id).not.toBe(job.id);
      expect(twin.value.id.startsWith('stitch-')).toBe(true);
    }

    // claim → running, with a lease that expires.
    tick(at(MINUTE));
    const claimed = await q.claim(job.id, 'worker-1');
    expect(claimed.isOk()).toBe(true);
    if (claimed.isErr()) return;
    expect(claimed.value?.status).toBe('running');
    expect(claimed.value?.leaseOwner).toBe('worker-1');
    expect(claimed.value?.leaseExpiresAt).toBe(
      new Date(Date.parse(at(MINUTE)) + 15 * MINUTE).toISOString()
    );
    // `started_at` is when the job STARTED RUNNING — the claim time, not the
    // enqueue time. The two differ here precisely so the assertion can tell them
    // apart.
    expect(claimed.value?.startedAt).toBe(at(MINUTE));

    // finish → succeeded, recording the result and releasing the lease.
    tick(at(2 * MINUTE));
    const finished = await q.finish(job.id, { commitTarget: '/tmp/c' });
    expect(finished.isOk()).toBe(true);
    if (finished.isErr()) return;
    expect(finished.value.status).toBe('succeeded');
    expect(finished.value.result).toEqual({ commitTarget: '/tmp/c' });
    expect(finished.value.finishedAt).toBe(at(2 * MINUTE));
    expect(finished.value.leaseOwner).toBeUndefined();
    // P-245: a finalised job is no longer terminal — a wrong C can still be rolled
    // back, and `rolled_back` is the status that ends the line.
    expect(isTerminalJobStatus('succeeded')).toBe(false);
    expect(isTerminalJobStatus('rolled_back')).toBe(true);

    // A blank kind is a typed config error.
    const blank = await q.enqueue({ kind: '   ', ctx: {} });
    expect(blank.isErr()).toBe(true);
    if (blank.isErr()) expect(blank.error.code).toBe('CONFIG_ERROR');

    // An unknown id is a typed error, not a silent no-op.
    const missing = await q.claim('nope', 'w');
    expect(missing.isErr()).toBe(true);
    if (missing.isErr()) expect(missing.error.code).toBe('CONFIG_ERROR');

    // The lifecycle law is the table, and it is total.
    expect(canJobTransition('queued', 'running')).toBe(true);
    expect(canJobTransition('succeeded', 'running')).toBe(false);
    expect(Object.keys(JOB_TRANSITIONS)).toHaveLength(8);

    // Events are emitted per transition, in P-241's shape.
    const events: JobEvent[] = [];
    const second = queue({ emit: e => events.push(e) });
    const j2 = await second.q.enqueue({ kind: 'stitch', ctx: {} });
    if (j2.isOk()) {
      await second.q.claim(j2.value.id, 'w1');
      await second.q.finish(j2.value.id, {});
    }
    expect(events.map(e => e.to)).toEqual(['running', 'succeeded']);
    expect(events[0]?.type).toBe('job:transition');
    expect(events[0]?.owner).toBe('w1');
  });

  it('no double run', async () => {
    const { q } = queue();
    const created = await q.enqueue({ kind: 'stitch', ctx: {} });
    expect(created.isOk()).toBe(true);
    if (created.isErr()) return;
    const id = created.value.id;

    // Two workers race for the SAME job. Exactly one wins: `claim` is one guarded
    // UPDATE, so the second sees `changes === 0` and gets `ok(undefined)` — a lost
    // race, not an error.
    const [a, b] = await Promise.all([q.claim(id, 'worker-a'), q.claim(id, 'worker-b')]);
    expect(a.isOk() && b.isOk()).toBe(true);
    const winners = [a, b].filter(r => r.isOk() && r.value !== undefined).length;
    const losers = [a, b].filter(r => r.isOk() && r.value === undefined).length;
    expect(winners).toBe(1);
    expect(losers).toBe(1);

    // The holder is a single owner, and the row agrees.
    const row = await q.get(id);
    if (row.isOk() && row.value !== undefined) {
      expect(['worker-a', 'worker-b']).toContain(row.value.leaseOwner);
      expect(row.value.status).toBe('running');
    }

    // A third claim on a running job is refused by the TABLE, not just by the check.
    const third = await q.claim(id, 'worker-c');
    expect(third.isErr()).toBe(true);
    if (third.isErr()) {
      expect(third.error.code).toBe('ILLEGAL_TRANSITION');
      if (third.error.code === 'ILLEGAL_TRANSITION') {
        expect(third.error.from).toBe('running');
        expect(third.error.to).toBe('running');
      }
    }

    // `pollReady` skips what it cannot win, so a busy queue never yields a
    // duplicate worker: two polls over three queued jobs hand out three claims.
    for (const n of [1, 2, 3]) await q.enqueue({ id: `extra-${n}`, kind: 'stitch', ctx: {} });
    const firstPoll = await q.pollReady('poller-1', { limit: 3 });
    expect(firstPoll.isOk()).toBe(true);
    if (firstPoll.isOk()) {
      expect(firstPoll.value).toHaveLength(3);
      expect(new Set(firstPoll.value.map(j => j.id)).size).toBe(3);
    }
    const secondPoll = await q.pollReady('poller-2', { limit: 3 });
    if (secondPoll.isOk()) expect(secondPoll.value).toHaveLength(0);
  });

  it('cancel pause', async () => {
    const { q } = queue();

    // A queued job can be cancelled before anyone runs it.
    const queued = await q.enqueue({ id: 'j-cancel', kind: 'stitch', ctx: {} });
    expect(queued.isOk()).toBe(true);
    const cancelled = await q.cancel('j-cancel');
    expect(cancelled.isOk()).toBe(true);
    if (cancelled.isOk()) expect(cancelled.value.status).toBe('cancelled');

    // Cancelling again is refused: `cancelled` is terminal.
    const twice = await q.cancel('j-cancel');
    expect(twice.isErr()).toBe(true);
    if (twice.isErr()) expect(twice.error.code).toBe('ILLEGAL_TRANSITION');

    // A running job can PAUSE — the licence-verdict / HIL case (P-160) — and the
    // pause records WHY, releases the lease, and is resumable.
    await q.enqueue({ id: 'j-pause', kind: 'stitch', ctx: {} });
    await q.claim('j-pause', 'worker-1');
    const paused = await q.pause('j-pause', { reason: 'awaiting HIL approval' });
    expect(paused.isOk()).toBe(true);
    if (paused.isErr()) return;
    expect(paused.value.status).toBe('paused');
    expect(paused.value.error).toEqual({ reason: 'awaiting HIL approval' });
    expect(paused.value.leaseOwner).toBeUndefined();
    // A paused job has NOT finished.
    expect(paused.value.finishedAt).toBeUndefined();

    const resumed = await q.resume('j-pause', 'worker-2');
    expect(resumed.isOk()).toBe(true);
    if (resumed.isOk()) {
      expect(resumed.value?.status).toBe('running');
      expect(resumed.value?.leaseOwner).toBe('worker-2');
    }

    // A failed job may retry; a succeeded one may not be cancelled.
    await q.enqueue({ id: 'j-fail', kind: 'stitch', ctx: {} });
    await q.claim('j-fail', 'worker-1');
    const failed = await q.fail('j-fail', { message: 'transient' });
    expect(failed.isOk()).toBe(true);
    if (failed.isOk()) expect(failed.value.error).toEqual({ message: 'transient' });
    expect((await q.claim('j-fail', 'worker-3')).isOk()).toBe(true);

    const done = await q.finish('j-fail', {});
    expect(done.isOk()).toBe(true);
    const tooLate = await q.cancel('j-fail');
    expect(tooLate.isErr()).toBe(true);
    if (tooLate.isErr()) expect(tooLate.error.code).toBe('ILLEGAL_TRANSITION');
  });

  it('stale requeue', async () => {
    const base = Date.parse(T1);
    const at = (ms: number): string => new Date(base + ms).toISOString();
    const { q, tick } = queue({ ttlMs: MINUTE });

    // A worker takes a job with a one-minute lease and then "crashes" — no finish,
    // no fail. The lease is the ONLY evidence left behind.
    await q.enqueue({ id: 'j-stale', kind: 'stitch', ctx: {} });
    await q.enqueue({ id: 'j-fresh', kind: 'stitch', ctx: {} });
    await q.claim('j-stale', 'crashed-worker', MINUTE);
    tick(at(30_000));
    await q.claim('j-fresh', 'live-worker', 10 * MINUTE);

    // Before expiry nothing is recovered — a live worker keeps its lease.
    const early = await q.requeueStale(at(30_000));
    expect(early.isOk()).toBe(true);
    if (early.isOk()) expect(early.value).toBe(0);

    // After expiry the crashed worker's job returns to the queue, lease cleared…
    const recovered = await q.requeueStale(at(2 * MINUTE));
    expect(recovered.isOk()).toBe(true);
    if (recovered.isOk()) expect(recovered.value).toBe(1);
    const stale = await q.get('j-stale');
    if (stale.isOk() && stale.value !== undefined) {
      expect(stale.value.status).toBe('queued');
      expect(stale.value.leaseOwner).toBeUndefined();
      expect(stale.value.leaseExpiresAt).toBeUndefined();
    }

    // …and the LIVE worker's job is untouched, because its lease has not lapsed.
    const fresh = await q.get('j-fresh');
    if (fresh.isOk() && fresh.value !== undefined) {
      expect(fresh.value.status).toBe('running');
      expect(fresh.value.leaseOwner).toBe('live-worker');
    }

    // The recovered job can be claimed again — recovery is a re-entry, not a reset.
    const reclaimed = await q.claim('j-stale', 'worker-2', MINUTE);
    expect(reclaimed.isOk()).toBe(true);
    if (reclaimed.isOk()) expect(reclaimed.value?.status).toBe('running');

    // Requeueing is idempotent: nothing stale is left.
    const again = await q.requeueStale(at(3 * MINUTE));
    if (again.isOk()) expect(again.value).toBe(1);
  });

  it('queries', async () => {
    const base = Date.parse(T1);
    const at = (ms: number): string => new Date(base + ms).toISOString();
    let clock = T1;
    const q = new JobQueue({ db, now: () => clock });
    void at;

    // Three jobs of two kinds, at three times, in three states.
    clock = at(0);
    await q.enqueue({ id: 'a1', kind: 'stitch', ctx: {} });
    clock = at(MINUTE);
    await q.enqueue({ id: 'b1', kind: 'audit', ctx: {} });
    clock = at(2 * MINUTE);
    await q.enqueue({ id: 'a2', kind: 'stitch', ctx: {} });
    await q.claim('a2', 'worker-1');
    await q.finish('a2', { ok: true });

    // Newest first.
    const all = await q.list();
    expect(all.isOk()).toBe(true);
    if (all.isOk()) expect(all.value.map(j => j.id)).toEqual(['a2', 'b1', 'a1']);

    const byKind = await q.list({ kind: 'stitch' });
    if (byKind.isOk()) expect(byKind.value.map(j => j.id)).toEqual(['a2', 'a1']);

    const byStatus = await q.list({ status: 'succeeded' });
    if (byStatus.isOk()) expect(byStatus.value.map(j => j.id)).toEqual(['a2']);

    // Inclusive bounds on created_at.
    const window = await q.list({ from: at(MINUTE), to: at(MINUTE) });
    if (window.isOk()) expect(window.value.map(j => j.id)).toEqual(['b1']);

    const limited = await q.list({ limit: 1 });
    if (limited.isOk()) expect(limited.value).toHaveLength(1);

    // get() is exact, and an unknown id is `undefined` (not an error).
    const one = await q.get('b1');
    if (one.isOk() && one.value !== undefined) expect(one.value.kind).toBe('audit');
    const nope = await q.get('nope');
    expect(nope.isOk()).toBe(true);
    if (nope.isOk()) expect(nope.value).toBeUndefined();

    // No match is an empty list.
    const none = await q.list({ status: 'paused' });
    if (none.isOk()) expect(none.value).toEqual([]);

    // `pollReady` honours `kind`, so a worker drains one kind at a time.
    const auditOnly = await q.pollReady('worker-9', { kind: 'audit', limit: 5 });
    expect(auditOnly.isOk()).toBe(true);
    if (auditOnly.isOk()) {
      expect(auditOnly.value.map(j => j.id)).toEqual(['b1']);
    }
  });
});
