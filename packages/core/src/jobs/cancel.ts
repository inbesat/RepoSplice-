// P-246 — Orchestration: cooperative cancellation.
//
// Cancellation is COOPERATIVE, not preemptive. Nothing here kills work mid-write:
// {@link cancelJob} records that a stop was requested (`cancelling`), fires the
// `AbortSignal` every long op already holds, and then settles the job to `cancelled`.
// A stage observes the token at its own boundaries, so an interrupt lands between
// steps rather than inside one — which is what keeps a cancelled run's tree
// consistent instead of half-written.
//
// Three properties are the point:
//
//   1. `cancelled` IS NOT `failed`. The run did what it was told; a retry is a fresh
//      enqueue, not a resume. The transition table enforces it: `cancelled` has no
//      edge back to `running`, so P-240's `resume` refuses by construction.
//   2. THE STATUS IS DURABLE BEFORE THE TOKEN FIRES. A token that fired first could
//      abort a stage while the queue still believed the job was running.
//   3. EXACTLY ONCE. A second signal never re-fires the graceful path — see
//      {@link createSignalHandler}, where the first signal cancels and the second
//      is the operator asking to stop waiting.
//
// On the seam: `RunOptions.signal` / `PipelineCtx.signal` already exist (P-238) and
// `#ctxFor` already forwards the signal to every stage handler, so this phase adds
// the CALLER of that seam, not the seam itself.

import { err, ok, type Result } from 'neverthrow';
import type { Bus, BusEnvelope } from '../events/bus.js';
import type { AuditDraft, AuditRecord } from '../provenance/audit.js';
import type { StitchError } from '../result/index.js';
import type { JobRecord, JobStatus } from './types.js';

/** The audit entry P-246 appends (P-187). */
export interface CancelRecord {
  jobId: string;
  reason: string;
  /** The stages that had already settled when the stop arrived. */
  stagesCompleted: string[];
}

/** What a cancel reports. */
export interface CancelOutcome {
  jobId: string;
  status: 'cancelled';
  record: CancelRecord;
}

/** The audit surface this module needs — satisfied by P-187's `ProvenanceAudit`. */
export interface CancelAuditSink {
  append(draft: AuditDraft): Promise<Result<AuditRecord, StitchError>>;
}

/** The queue surface a cancel drives — satisfied structurally by P-239's `JobQueue`. */
export interface CancelQueue {
  get(id: string): Promise<Result<JobRecord | undefined, StitchError>>;
  markCancelling(id: string): Promise<Result<JobRecord, StitchError>>;
  cancel(id: string): Promise<Result<JobRecord, StitchError>>;
}

/** Options for {@link cancelJob}. */
export interface CancelOptions {
  reason: string;
  /** The token every long op holds. Aborted once the stop is durable. */
  controller?: AbortController;
  /** What had settled when the stop arrived, for the audit record. */
  stagesCompleted?: readonly string[];
  bus?: Bus;
  audit?: CancelAuditSink;
}

/** Statuses a cancellation cannot act on: the run is over, one way or another. */
const FINISHED: readonly JobStatus[] = ['succeeded', 'failed', 'cancelled', 'rolled_back'];

/** The sandbox stop port (P-168/P-177), so this module never imports Docker. */
export interface SandboxStopper {
  stop(runId: string): Promise<Result<void, StitchError>>;
}

/**
 * Request a stop, then settle the job.
 *
 * Order is deliberate and load-bearing: mark `cancelling`, THEN abort the token,
 * THEN settle `cancelled`. Aborting first would let a stage finish its cleanup and
 * report success before the queue knew a stop was in flight.
 */
export async function cancelJob(
  queue: CancelQueue,
  id: string,
  opts: CancelOptions
): Promise<Result<CancelOutcome, StitchError>> {
  if (id.trim() === '') {
    return err({ code: 'CONFIG_ERROR', field: 'jobId', message: 'cancelJob: jobId is required' });
  }

  const found = await queue.get(id);
  if (found.isErr()) return err(found.error);
  const job = found.value;
  if (job === undefined) {
    return err({ code: 'CONFIG_ERROR', field: 'jobId', message: `cancelJob: no such job ${id}` });
  }
  if (FINISHED.includes(job.status)) {
    return err({
      code: 'CONFIG_ERROR',
      field: 'status',
      message: `cancelJob: job ${id} is already ${job.status} — nothing to cancel`,
    });
  }

  const marking = await queue.markCancelling(id);
  if (marking.isErr()) return err(marking.error);

  // Durable first, token second — see the module header, point 2.
  opts.controller?.abort();

  const settled = await queue.cancel(id);
  if (settled.isErr()) return err(settled.error);

  const record: CancelRecord = {
    jobId: id,
    reason: opts.reason,
    stagesCompleted: [...(opts.stagesCompleted ?? [])],
  };

  if (opts.audit !== undefined) {
    const appended = await opts.audit.append({
      action: 'cancel',
      actor: 'system',
      jobId: id,
      detail: { reason: record.reason, stagesCompleted: record.stagesCompleted },
      ok: true,
    });
    if (appended.isErr()) return err(appended.error);
  }

  if (opts.bus !== undefined) emitCancelled(opts.bus, settled.value, record);

  return ok({ jobId: id, status: 'cancelled', record });
}

/** Publish `job.cancelled` (P-241's contract), carrying the reason. */
export function emitCancelled(
  bus: Bus,
  job: JobRecord,
  record: CancelRecord
): BusEnvelope<'job.cancelled'> {
  return bus.publish('job.cancelled', {
    jobId: record.jobId,
    kind: job.kind,
    status: 'cancelled',
    reason: record.reason,
  });
}

/**
 * Stop a sandbox run (P-168) through its port.
 *
 * A blank run id is refused rather than passed on: a port that treats `''` as "all
 * containers" would turn a cancel for one job into a stop for every job.
 */
export async function cancelSandbox(
  stopper: SandboxStopper,
  runId: string
): Promise<Result<void, StitchError>> {
  if (runId.trim() === '') {
    return err({
      code: 'CONFIG_ERROR',
      field: 'runId',
      message: 'cancelSandbox: runId is required',
    });
  }
  return stopper.stop(runId);
}

/** How a process signal pair should behave. */
export interface SignalPlan {
  /** First signal: cancel running jobs and flush the audit log. */
  onFirst: () => void | Promise<void>;
  /** Second signal: the operator is done waiting. */
  onSecond?: () => void;
  /** Where the hard exit goes. Defaults to setting `process.exitCode`. */
  exit?: (code: number) => void;
}

/**
 * Build the SIGINT/SIGTERM handler.
 *
 * Returned as a plain function of the signal name so the graceful path is testable
 * without raising a real signal — the phase's own test asserts the pair without
 * touching the process. The FIRST call runs `onFirst`; every call after runs
 * `onSecond` (or exits 130), so a repeated Ctrl-C is never a second graceful cancel.
 */
export function createSignalHandler(plan: SignalPlan): (signal: string) => void {
  let seen = 0;
  return () => {
    seen += 1;
    if (seen === 1) {
      void plan.onFirst();
      return;
    }
    if (plan.onSecond !== undefined) {
      plan.onSecond();
      return;
    }
    const exit = plan.exit ?? ((code: number) => void (process.exitCode = code));
    exit(130);
  };
}
