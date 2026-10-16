// P-246 — cancellation tests.
//
// Cancellation is a claim about ORDER and ABSENCE: the status is durable before the
// token fires, a finished job is never cancelled, and only the FIRST signal takes
// the graceful path. So the tests assert sequencing (the states the queue was driven
// through), not just the final value.
//
// `resume refuses cancelled` runs against a REAL `JobQueue` on real temp SQLite,
// because that refusal is enforced by the transition guard in SQL-backed state, not
// by a branch in this module — a fake would prove nothing about it.
//
// The four required scenarios from the phase spec:
//
//   it('cancels mid op')  it('already done errors')
//   it('sigint graceful')  it('resume refuses cancelled')

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ok, type Result } from 'neverthrow';
import { Bus } from '../events/bus.js';
import type { AuditDraft, AuditRecord } from '../provenance/audit.js';
import type { StitchError } from '../result/index.js';
import { makeDbAdapter } from '../sandbox/__tests__/fake-docker.js';
import { type DbLike } from '../store/schema.js';
import {
  createSignalHandler,
  cancelJob,
  type CancelAuditSink,
  type CancelQueue,
} from './cancel.js';
import { JobQueue } from './queue.js';
import { PIPELINE_JOBS_TABLE_SQL } from './schema.js';
import type { JobRecord, JobStatus } from './types.js';

const T1 = '2026-10-17T00:00:00.000Z';

/** A job record in whatever status the test needs. */
function record(status: JobStatus): JobRecord {
  return { id: 'j1', kind: 'stitch', status, ctx: {}, createdAt: T1 };
}

/** A queue double that records the sequence of status writes it was driven through. */
function fakeQueue(initial: JobStatus, present = true): { queue: CancelQueue; states: string[] } {
  const states: string[] = [];
  let status = initial;
  return {
    states,
    queue: {
      get: async () => ok(present ? record(status) : undefined),
      markCancelling: async () => {
        status = 'cancelling';
        states.push('cancelling');
        return ok(record(status));
      },
      cancel: async () => {
        status = 'cancelled';
        states.push('cancelled');
        return ok(record(status));
      },
    },
  };
}

let db: DbLike;

beforeEach(() => {
  db = makeDbAdapter();
  db.exec(PIPELINE_JOBS_TABLE_SQL);
});

afterEach(() => {
  db.close();
});

describe('P-246 cancel', () => {
  it('cancels mid op', async () => {
    const { queue, states } = fakeQueue('running');
    const controller = new AbortController();

    // A long op that respects the token, exactly like the AI stream or a sandbox run.
    let interrupted = false;
    const longOp = new Promise<void>(resolve => {
      controller.signal.addEventListener('abort', () => {
        interrupted = true;
        resolve();
      });
    });

    const appended: AuditDraft[] = [];
    const audit: CancelAuditSink = {
      append: async (draft: AuditDraft): Promise<Result<AuditRecord, StitchError>> => {
        appended.push(draft);
        return ok({ ...draft, id: `a${appended.length}`, ts: T1 });
      },
    };
    const bus = new Bus({ now: () => T1 });
    let reason: string | undefined;
    bus.subscribe('job.cancelled', payload => {
      reason = payload.reason;
    });

    const result = await cancelJob(queue, 'j1', {
      reason: 'user pressed Ctrl-C',
      controller,
      stagesCompleted: ['config', 'sources', 'selection'],
      audit,
      bus,
    });
    await longOp;

    expect(result.isOk()).toBe(true);
    // The op was actually interrupted, not merely asked to stop.
    expect(interrupted).toBe(true);
    expect(controller.signal.aborted).toBe(true);
    // Durable-before-token ordering, asserted as a sequence.
    expect(states).toEqual(['cancelling', 'cancelled']);

    // Audit `CancelRecord` (P-187) with the settled stages.
    expect(appended).toHaveLength(1);
    expect(appended[0]?.action).toBe('cancel');
    expect(appended[0]?.detail).toMatchObject({
      reason: 'user pressed Ctrl-C',
      stagesCompleted: ['config', 'sources', 'selection'],
    });
    // Event carries the reason.
    expect(reason).toBe('user pressed Ctrl-C');
    if (result.isOk()) expect(result.value.record.stagesCompleted).toHaveLength(3);
  });

  it('already done errors', async () => {
    // A finished job cannot be cancelled — the attempt is a typed error, not a no-op.
    for (const status of ['succeeded', 'failed', 'cancelled', 'rolled_back'] as const) {
      const { queue, states } = fakeQueue(status);
      const result = await cancelJob(queue, 'j1', { reason: 'too late' });
      expect(result.isErr(), `expected ${status} to refuse`).toBe(true);
      if (result.isErr()) expect(result.error.code).toBe('CONFIG_ERROR');
      // Nothing was written.
      expect(states).toEqual([]);
    }

    // An unknown job is also a typed error.
    const missing = fakeQueue('running', false);
    const unknown = await cancelJob(missing.queue, 'ghost', { reason: 'x' });
    expect(unknown.isErr()).toBe(true);
    if (unknown.isErr()) expect(unknown.error.code).toBe('CONFIG_ERROR');

    // A blank id never reaches the queue.
    const blank = await cancelJob(fakeQueue('running').queue, '   ', { reason: 'x' });
    expect(blank.isErr()).toBe(true);
  });

  it('sigint graceful', async () => {
    const graceful: string[] = [];
    const exits: number[] = [];
    const handler = createSignalHandler({
      onFirst: () => void graceful.push('cancel-running + flush-audit'),
      exit: (code: number) => void exits.push(code),
    });

    // First signal: graceful only — the process keeps running.
    handler('SIGINT');
    expect(graceful).toEqual(['cancel-running + flush-audit']);
    expect(exits).toEqual([]);

    // Second signal: the operator is done waiting; hard exit 130.
    handler('SIGINT');
    expect(graceful).toHaveLength(1); // exactly once — never a second graceful cancel
    expect(exits).toEqual([130]);

    // A third signal does not re-run the graceful path either.
    handler('SIGTERM');
    expect(graceful).toHaveLength(1);
    expect(exits).toEqual([130, 130]);
  });

  it('resume refuses cancelled', async () => {
    const queue = new JobQueue({ db, now: () => T1 });
    const enqueued = await queue.enqueue({ id: 'j1', kind: 'stitch', ctx: {} });
    expect(enqueued.isOk()).toBe(true);
    await queue.claim('j1', 'worker-1');

    const cancelled = await cancelJob(queue, 'j1', { reason: 'user stopped it' });
    expect(cancelled.isOk()).toBe(true);
    if (cancelled.isOk()) expect(cancelled.value.status).toBe('cancelled');

    // P-240's resume runs through `claim`, whose transition guard refuses
    // `cancelled -> running`: a cancelled run is re-enqueued fresh, never resumed.
    const resumed = await queue.resume('j1', 'worker-2');
    expect(resumed.isErr()).toBe(true);

    const after = await queue.get('j1');
    expect(after.isOk() && after.value?.status).toBe('cancelled');
  });
});
