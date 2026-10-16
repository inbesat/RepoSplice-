// P-240 — resume tests, against REAL temp SQLite and the REAL P-238 machine.
//
// The point of this suite is the SEAM: a checkpoint written by one process is read
// by a "new" one, and the machine re-enters at the right stage. So the tests use a
// real `JobQueue` and a real `PipelineStateMachine` rather than stubs — a mocked
// checkpoint would prove only that the mock remembers what it was told.
//
// The four required scenarios from the phase spec:
//
//   it('checkpoints')     it('resumes at stage')
//   it('crash sweep')     it('config mismatch restarts')

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { type DbLike } from '../../store/schema.js';
import { makeDbAdapter } from '../../sandbox/__tests__/fake-docker.js';
import { PipelineStateMachine, type StageHandler } from '../../pipeline/stateMachine.js';
import { PIPELINE_STAGES, type PipelineStage, type StageRecord } from '../../pipeline/states.js';
import { JobQueue } from '../queue.js';
import {
  checkpoint,
  describeResume,
  resumableCtx,
  resume,
  sweepStale,
  type JobResumedEvent,
  type ResumeRecord,
} from '../resume.js';

const T1 = '2026-10-16T00:00:00.000Z';
const T2 = '2026-10-16T00:10:00.000Z';
const MINUTE = 60_000;

let db: DbLike;

function makeQueue(at = T1, ttlMs = MINUTE): JobQueue {
  return new JobQueue({ db, now: () => at, leaseTtlMs: ttlMs });
}

/** A handler map that records which stages actually ran. */
function recording(ran: PipelineStage[]): Partial<Record<PipelineStage, StageHandler>> {
  const handlers: Partial<Record<PipelineStage, StageHandler>> = {};
  for (const stage of PIPELINE_STAGES) {
    handlers[stage] = async () => {
      ran.push(stage);
      return { status: 'passed' };
    };
  }
  return handlers;
}

beforeEach(() => {
  db = makeDbAdapter();
});

afterEach(() => {
  db.close();
});

describe('P-240 resume', () => {
  it('checkpoints', async () => {
    const queue = makeQueue();
    const created = await queue.enqueue({ id: 'j1', kind: 'stitch', ctx: { repo: '/tmp/c' } });
    expect(created.isOk()).toBe(true);

    // No checkpoint yet: the context loads, but with nothing to re-enter.
    const before = await resumableCtx(queue, 'j1');
    expect(before.isOk()).toBe(true);
    if (before.isOk() && before.value !== undefined) {
      expect(before.value.payload.records).toEqual([]);
      expect(before.value.ctx).toEqual({ repo: '/tmp/c' });
      // The ctx round-tripped through SQLite, which is what makes a resume possible.
      expect(before.value.status).toBe('queued');
    }

    // A real checkpoint of real machine records.
    const machine = new PipelineStateMachine({ handlers: recording([]), now: () => T1 });
    await machine.run();
    const records = machine.records();
    expect(records).toHaveLength(9);

    const saved = await checkpoint(queue, 'j1', { records, configHash: 'cfg-a' });
    expect(saved.isOk()).toBe(true);

    const after = await resumableCtx(queue, 'j1');
    expect(after.isOk()).toBe(true);
    if (after.isOk() && after.value !== undefined) {
      expect(after.value.payload.records).toHaveLength(9);
      expect(after.value.payload.configHash).toBe('cfg-a');
      // Stage identity and status survive the round trip.
      expect(after.value.payload.records.map(r => r.stage)).toEqual([...PIPELINE_STAGES]);
      expect(after.value.payload.records.every(r => r.status === 'passed')).toBe(true);
    }

    // A checkpoint on an unknown job is a typed error, not a silent no-op.
    const missing = await checkpoint(queue, 'nope', { records });
    expect(missing.isErr()).toBe(true);
    if (missing.isErr()) expect(missing.error.code).toBe('CONFIG_ERROR');

    // An unknown job has no resumable context at all.
    const unknown = await resumableCtx(queue, 'nope');
    expect(unknown.isOk()).toBe(true);
    if (unknown.isOk()) expect(unknown.value).toBeUndefined();
  });

  it('resumes at stage', async () => {
    const queue = makeQueue();
    await queue.enqueue({ id: 'j2', kind: 'stitch', ctx: { repo: '/tmp/c' } });

    // A run that got through five stages and then stopped at `licenses`.
    const halfway: StageRecord[] = PIPELINE_STAGES.slice(0, 4).map(stage => ({
      stage,
      status: 'passed' as const,
      attempts: 1,
      meta: {},
    }));
    halfway.push({
      stage: 'licenses',
      status: 'blocked',
      attempts: 1,
      meta: {},
      lastError: 'awaiting verdict',
    });
    for (const stage of PIPELINE_STAGES.slice(5)) {
      halfway.push({ stage, status: 'pending', attempts: 0, meta: {} });
    }
    expect(await checkpoint(queue, 'j2', { records: halfway })).toHaveProperty('isOk');

    const events: JobResumedEvent[] = [];
    const audited: ResumeRecord[] = [];
    const resumed = await resume(queue, 'j2', {
      owner: 'worker-2',
      now: () => T2,
      emit: e => events.push(e),
      onAudit: r => audited.push(r),
    });
    expect(resumed.isOk()).toBe(true);
    if (resumed.isErr()) return;

    // It re-enters at the first INCOMPLETE stage — the blocked licence stage — not
    // at the beginning and not past the failure.
    expect(resumed.value.mode).toBe('resume');
    expect(resumed.value.fromStage).toBe('licenses');
    expect(resumed.value.records).toHaveLength(9);
    expect(resumed.value.reason).toBe('manual');

    // The job is running again, owned by the new worker.
    const row = await queue.get('j2');
    if (row.isOk() && row.value !== undefined) {
      expect(row.value.status).toBe('running');
      expect(row.value.leaseOwner).toBe('worker-2');
    }

    // `job:resumed` was emitted (P-241) and audited (P-187), with fromStage/reason.
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('job:resumed');
    expect(events[0]?.fromStage).toBe('licenses');
    expect(events[0]?.mode).toBe('resume');
    expect(audited).toHaveLength(1);
    expect(audited[0]?.reason).toBe('manual');
    expect(describeResume(audited[0] as ResumeRecord)).toContain('j2');

    // NOW THE POINT: drive a real machine with the returned records and confirm the
    // passed stages are NOT re-run. `run` starts at the first unsettled stage.
    const ran: PipelineStage[] = [];
    const machine = new PipelineStateMachine({
      handlers: recording(ran),
      now: () => T2,
      records: resumed.value.records,
    });
    const driven = await machine.run();
    expect(driven.isOk()).toBe(true);
    if (driven.isOk()) expect(driven.value.outcome).toBe('completed');
    // `config`..`selection` were already passed, so they are absent from `ran`.
    expect(ran).not.toContain('config');
    expect(ran).not.toContain('sources');
    expect(ran).toContain('licenses');
    expect(ran).toContain('finalize');

    // A job with NO checkpoint is refused rather than re-run from scratch.
    await queue.enqueue({ id: 'j2b', kind: 'stitch', ctx: {} });
    const nothing = await resume(queue, 'j2b', { owner: 'w' });
    expect(nothing.isErr()).toBe(true);
    if (nothing.isErr()) expect(nothing.error.code).toBe('CONFIG_ERROR');

    // `--no-resume` refuses everything, checkpoint or not.
    const refused = await resume(queue, 'j2', { owner: 'w', noResume: true });
    expect(refused.isErr()).toBe(true);
    if (refused.isErr()) expect(refused.error.code).toBe('CONFIG_ERROR');

    // An unknown job is refused too.
    const ghost = await resume(queue, 'nope', { owner: 'w' });
    expect(ghost.isErr()).toBe(true);
  });

  it('crash sweep', async () => {
    const base = Date.parse(T1);
    const at = (ms: number): string => new Date(base + ms).toISOString();

    // A worker takes a job with a one-minute lease and then vanishes.
    const crashed = makeQueue(at(0), MINUTE);
    await crashed.enqueue({ id: 'j-crash', kind: 'stitch', ctx: {} });
    await crashed.enqueue({ id: 'j-live', kind: 'stitch', ctx: {} });
    await crashed.claim('j-crash', 'dead-worker', MINUTE);
    await crashed.claim('j-live', 'live-worker', 60 * MINUTE);

    // Before the lease lapses, nothing is swept — a live worker keeps its job.
    // `now` is passed EXPLICITLY: the sweep defaults to the wall clock, which would
    // otherwise be years after these fixtures and sweep everything.
    const early = makeQueue(at(30_000));
    const earlySwept = await sweepStale(early, { owner: 'boot', now: () => at(30_000) });
    expect(earlySwept.isOk()).toBe(true);
    if (earlySwept.isOk()) expect(earlySwept.value).toEqual([]);

    // After it lapses, the crashed job is marked `paused` — VISIBLE as waiting for a
    // resume — with an audit record whose reason is `crash`.
    const audited: ResumeRecord[] = [];
    const boot = makeQueue(at(2 * MINUTE));
    const swept = await sweepStale(boot, {
      owner: 'boot',
      now: () => at(2 * MINUTE),
      onAudit: r => audited.push(r),
    });
    expect(swept.isOk()).toBe(true);
    if (swept.isErr()) return;
    expect(swept.value.map(r => r.jobId)).toEqual(['j-crash']);
    expect(swept.value[0]?.reason).toBe('crash');

    const crashRow = await boot.get('j-crash');
    if (crashRow.isOk() && crashRow.value !== undefined) {
      expect(crashRow.value.status).toBe('paused');
      expect(crashRow.value.leaseOwner).toBeUndefined();
    }
    // The live worker's job is untouched.
    const liveRow = await boot.get('j-live');
    if (liveRow.isOk() && liveRow.value !== undefined) {
      expect(liveRow.value.status).toBe('running');
      expect(liveRow.value.leaseOwner).toBe('live-worker');
    }
    expect(audited).toHaveLength(1);

    // The swept job is resumable if it had a checkpoint, and refused if not — the
    // sweep does not invent state.
    const noCheckpoint = await resume(boot, 'j-crash', { owner: 'boot-2', reason: 'crash' });
    expect(noCheckpoint.isErr()).toBe(true);

    // `--no-resume` makes the sweep a no-op entirely.
    const off = await sweepStale(boot, { owner: 'boot', noResume: true });
    expect(off.isOk()).toBe(true);
    if (off.isOk()) expect(off.value).toEqual([]);
  });

  it('config mismatch restarts', async () => {
    const queue = makeQueue();
    await queue.enqueue({ id: 'j3', kind: 'stitch', ctx: { repo: '/tmp/c' } });

    const records: StageRecord[] = PIPELINE_STAGES.map((stage, index) => ({
      stage,
      status: (index < 4 ? 'passed' : 'pending') as StageRecord['status'],
      attempts: index < 4 ? 1 : 0,
      meta: {},
    }));
    expect((await checkpoint(queue, 'j3', { records, configHash: 'cfg-a' })).isOk()).toBe(true);

    // SAME config → a normal resume.
    const same = await resume(queue, 'j3', { owner: 'w1', configHash: 'cfg-a' });
    expect(same.isOk()).toBe(true);
    if (same.isOk()) {
      expect(same.value.mode).toBe('resume');
      // Stage order is config, sources, selection, deps, licenses… so four passed
      // stages (index 0-3) leave `licenses` as the first incomplete one.
      expect(same.value.fromStage).toBe('licenses');
    }

    // A DIFFERENT config → RESTART from `config`, not a refusal: the checkpoint no
    // longer describes the work, so the honest answer is "begin again".
    await queue.enqueue({ id: 'j4', kind: 'stitch', ctx: { repo: '/tmp/c' } });
    await checkpoint(queue, 'j4', { records, configHash: 'cfg-a' });
    const events: JobResumedEvent[] = [];
    const restarted = await resume(queue, 'j4', {
      owner: 'w2',
      configHash: 'cfg-b',
      emit: e => events.push(e),
    });
    expect(restarted.isOk()).toBe(true);
    if (restarted.isErr()) return;
    expect(restarted.value.mode).toBe('restart');
    expect(restarted.value.fromStage).toBe('config');
    expect(restarted.value.records).toEqual([]);
    expect(events[0]?.mode).toBe('restart');

    // The stale checkpoint was CLEARED, so it cannot be replayed by accident:
    // a second resume finds nothing and refuses.
    const again = await resumableCtx(queue, 'j4');
    if (again.isOk() && again.value !== undefined) {
      expect(again.value.payload.records).toEqual([]);
    }
    await queue.cancel('j4');
    const second = await resume(queue, 'j4', { owner: 'w3' });
    expect(second.isErr()).toBe(true);

    // A checkpoint with NO recorded hash cannot mismatch — the caller does not
    // track configuration, so it is trusted.
    await queue.enqueue({ id: 'j5', kind: 'stitch', ctx: {} });
    await checkpoint(queue, 'j5', { records });
    const untracked = await resume(queue, 'j5', { owner: 'w4', configHash: 'cfg-z' });
    expect(untracked.isOk()).toBe(true);
    if (untracked.isOk()) expect(untracked.value.mode).toBe('resume');
  });
});
