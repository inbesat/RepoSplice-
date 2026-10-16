// P-240 — Orchestration: resume jobs.
//
// A long stitch should not start from zero because a worker died, a human paused
// it, or the box rebooted. Resume is possible only because of two decisions already
// made: P-238 keeps the pipeline's RECORDS as its cursor (so re-entry needs no
// second code path) and P-239 persists the job and its context (so the state
// survives the process). This module is the bridge between them.
//
// Three properties are load-bearing:
//
//   1. A MISSING CHECKPOINT IS NOT A RESUME POINT. A job that never checkpointed
//      has nothing to re-enter, and treating "no records" as "start at the
//      beginning" would silently re-run stages the caller believed were done. It is
//      refused, explicitly.
//   2. A CONFIG MISMATCH RESTARTS, it does not refuse. If the saved context was
//      produced under a different configuration, the checkpoint no longer describes
//      the work — so the honest outcome is "begin again from `config`", with the
//      stale checkpoint cleared so it cannot be replayed by accident. That is a
//      different outcome from "cannot resume", and it is modelled as one.
//   3. RESUME IS A RE-ENTRY, NOT A RESET. `resumePoint` picks the first stage the
//      P-238 table does NOT consider settled, so a stage that already passed is
//      skipped and a stage that failed or paused is retried — exactly the machine's
//      own definition, not a second one.

import { err, ok, type Result } from 'neverthrow';
import { type StitchError } from '../result/index.js';
import { type JobQueue } from './queue.js';
import { resumePoint } from '../pipeline/stateMachine.js';
import { type PipelineStage, type StageRecord } from '../pipeline/states.js';

/** Why a resume happened. */
export type ResumeReason = 'crash' | 'manual' | 'hil';

/** One resume observation, for the audit log (P-187) and for tracing. */
export interface ResumeRecord {
  jobId: string;
  fromStage: PipelineStage | 'config';
  reason: ResumeReason;
  at: string;
}

/** The `job:resumed` event (P-241's shape). */
export interface JobResumedEvent {
  type: 'job:resumed';
  jobId: string;
  kind: string;
  fromStage: PipelineStage | 'config';
  reason: ResumeReason;
  mode: 'resume' | 'restart';
  at: string;
}

/** What a checkpoint stores. The records are `StageRecord[]`, persisted as JSON. */
export interface CheckpointPayload {
  records: readonly StageRecord[];
  /**
   * A hash of the configuration the run was started under (P-243).
   *
   * Absent means "the caller does not track configuration", in which case a
   * mismatch cannot be detected and the checkpoint is trusted.
   */
  configHash?: string;
}

/** Options for {@link resume} and {@link sweepStale}. */
export interface ResumeOptions {
  /** The worker taking the job. */
  owner: string;
  /** Defaults to `'manual'` (an explicit `--resume`). */
  reason?: ResumeReason;
  /** The CURRENT configuration hash. A mismatch forces a restart. */
  configHash?: string;
  /** `--no-resume`: refuse to resume at all. */
  noResume?: boolean;
  /** Clock, injectable so tests are deterministic. */
  now?: () => string;
  /** Receives the `job:resumed` event. */
  emit?: (event: JobResumedEvent) => void;
  /** Records the resume in the audit log (P-187). */
  onAudit?: (record: ResumeRecord) => void;
}

/** What a resume produced. */
export interface ResumeOutcome {
  jobId: string;
  mode: 'resume' | 'restart';
  /** Where the machine should (re-)enter. */
  fromStage: PipelineStage;
  /** The records to hand back to the machine, for a resume. */
  records: StageRecord[];
  reason: ResumeReason;
}

/** What {@link resumableCtx} returns. */
export interface ResumeContext {
  jobId: string;
  kind: string;
  status: string;
  ctx: Record<string, unknown>;
  payload: CheckpointPayload;
}

function detailOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** Read a persisted checkpoint, tolerating anything a tolerant parse can. */
function parseCheckpoint(value: unknown): CheckpointPayload | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const record = value as { records?: unknown; configHash?: unknown };
  if (!Array.isArray(record.records)) return undefined;
  const records: StageRecord[] = [];
  for (const entry of record.records) {
    if (typeof entry !== 'object' || entry === null) continue;
    const stage = (entry as { stage?: unknown }).stage;
    const status = (entry as { status?: unknown }).status;
    if (typeof stage !== 'string' || typeof status !== 'string') continue;
    const attempts = (entry as { attempts?: unknown }).attempts;
    const meta = (entry as { meta?: unknown }).meta;
    records.push({
      stage: stage as PipelineStage,
      status: status as StageRecord['status'],
      attempts: typeof attempts === 'number' ? attempts : 0,
      meta: typeof meta === 'object' && meta !== null ? (meta as Record<string, unknown>) : {},
    });
  }
  return {
    records,
    ...(typeof record.configHash === 'string' ? { configHash: record.configHash } : {}),
  };
}

/**
 * Persist the machine's state after a transition.
 *
 * Granularity is per-STAGE, not per-line: the handoff asks for that explicitly,
 * and it is what makes a checkpoint a single small row write rather than a stream.
 */
export async function checkpoint(
  queue: JobQueue,
  jobId: string,
  payload: CheckpointPayload
): Promise<Result<void, StitchError>> {
  const stored: Record<string, unknown> = {
    records: payload.records.map(record => ({
      stage: record.stage,
      status: record.status,
      attempts: record.attempts,
      meta: record.meta,
    })),
    ...(payload.configHash !== undefined ? { configHash: payload.configHash } : {}),
  };
  return queue.setStageStatus(jobId, stored);
}

/**
 * Load what a resume needs, or `undefined` when there is no such job.
 *
 * A job with no checkpoint comes back with `payload.records` EMPTY — see the
 * module header, point 1: `resume` refuses that rather than guessing.
 */
export async function resumableCtx(
  queue: JobQueue,
  jobId: string
): Promise<Result<ResumeContext | undefined, StitchError>> {
  const loaded = await queue.getResumableContext(jobId);
  if (loaded.isErr()) return err(loaded.error);
  if (loaded.value === undefined) return ok(undefined);
  const parsed = parseCheckpoint(loaded.value.stageStatus);
  return ok({
    jobId: loaded.value.id,
    kind: loaded.value.kind,
    status: loaded.value.status,
    ctx: loaded.value.ctx,
    payload: parsed ?? { records: [] },
  });
}

/**
 * Re-enter a job at its first incomplete stage.
 *
 * Refuses (typed) when the job is unknown, has no checkpoint, or `--no-resume` is
 * set; RESTARTS from `config` when the configuration hash does not match.
 */
export async function resume(
  queue: JobQueue,
  jobId: string,
  opts: ResumeOptions
): Promise<Result<ResumeOutcome, StitchError>> {
  const reason: ResumeReason = opts.reason ?? 'manual';
  const now = opts.now ?? (() => new Date().toISOString());
  const at = now();

  if (opts.noResume === true) {
    return err({
      code: 'CONFIG_ERROR',
      field: 'noResume',
      message: `resume refused for job ${jobId}: --no-resume is set`,
    });
  }

  const loaded = await resumableCtx(queue, jobId);
  if (loaded.isErr()) return err(loaded.error);
  if (loaded.value === undefined) {
    return err({ code: 'CONFIG_ERROR', field: 'id', message: `resume: no job ${jobId}` });
  }
  const context = loaded.value;

  if (context.payload.records.length === 0) {
    // Nothing was ever checkpointed, so there is no faithful re-entry point.
    return err({
      code: 'CONFIG_ERROR',
      field: 'checkpoint',
      message: `resume: job ${jobId} has no checkpoint to resume from`,
    });
  }

  const mismatch =
    opts.configHash !== undefined &&
    context.payload.configHash !== undefined &&
    opts.configHash !== context.payload.configHash;

  // Take the lease first: a job owned by a live worker must not be stolen, and the
  // queue's guarded claim is what enforces that.
  const claimed = await queue.resume(jobId, opts.owner);
  if (claimed.isErr()) return err(claimed.error);
  if (claimed.value === undefined) {
    return err({
      code: 'ILLEGAL_TRANSITION',
      from: context.status,
      to: 'running',
      message: `resume: job ${jobId} is held by another worker or already finished`,
    });
  }

  const emit = (mode: 'resume' | 'restart', fromStage: PipelineStage | 'config'): void => {
    const record: ResumeRecord = { jobId, fromStage, reason, at };
    opts.emit?.({
      type: 'job:resumed',
      jobId,
      kind: context.kind,
      fromStage,
      reason,
      mode,
      at,
    });
    opts.onAudit?.(record);
  };

  if (mismatch) {
    // The checkpoint describes work under a different configuration, so it is
    // cleared (it must not be replayed) and the run begins at `config`.
    const cleared = await queue.setStageStatus(jobId, null);
    if (cleared.isErr()) return err(cleared.error);
    emit('restart', 'config');
    return ok({
      jobId,
      mode: 'restart',
      fromStage: 'config',
      records: [],
      reason,
    });
  }

  const fromStage = resumePoint(context.payload.records) ?? 'finalize';
  emit('resume', fromStage);
  return ok({
    jobId,
    mode: 'resume',
    fromStage,
    records: [...context.payload.records],
    reason,
  });
}

/**
 * Crash sweep: a `running` job whose lease lapsed belongs to a worker that is gone.
 *
 * Such a job is marked `paused` (not silently requeued) so it is VISIBLE as waiting
 * for a resume, and the caller decides when to re-enter it. `--no-resume` makes the
 * sweep a no-op, which is what a caller asking for a clean start wants.
 */
export async function sweepStale(
  queue: JobQueue,
  opts: ResumeOptions
): Promise<Result<ResumeRecord[], StitchError>> {
  if (opts.noResume === true) return ok([]);
  const now = (opts.now ?? (() => new Date().toISOString()))();

  const running = await queue.list({ status: 'running' });
  if (running.isErr()) return err(running.error);

  const swept: ResumeRecord[] = [];
  for (const job of running.value) {
    const expiry = job.leaseExpiresAt;
    if (expiry === undefined || expiry >= now) continue;
    const paused = await queue.pause(job.id, { reason: 'lease expired', sweptAt: now });
    if (paused.isErr()) return err(paused.error);
    const record: ResumeRecord = { jobId: job.id, fromStage: 'config', reason: 'crash', at: now };
    opts.onAudit?.(record);
    swept.push(record);
  }
  return ok(swept);
}

/** A one-line description of a resume, for a log line or an audit row. */
export function describeResume(record: ResumeRecord): string {
  return `${record.jobId}: ${record.reason} from ${record.fromStage} (${detailOf(record.at)})`;
}
