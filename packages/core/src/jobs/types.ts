// P-239 — Orchestration: the job vocabulary.
//
// A job is a DURABLE wrap around one pipeline run: it exists before the run does
// (queued), outlives the process that ran it (running → succeeded/failed), and can
// be paused for a decision or cancelled by a human. That durability is the whole
// point — it is what lets `stitch status` answer "what happened", what lets a
// worker crash be recovered (P-240), and what gives cancel/resume/metrics one home.

/** The lifecycle of a job. */
export const JOB_STATUSES = [
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
  'paused',
] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];

/**
 * Which statuses a job may move to, per current status.
 *
 * The queue is the concurrency AUTHORITY (the handoff says so), so the law lives
 * here as one table rather than as `if` statements scattered across the mutators.
 *   - `queued` STARTS, or is abandoned before it ever runs.
 *   - `running` is the only status that may reach a verdict, and the only one that
 *     may pause (a licence verdict or an HIL approval, P-160).
 *   - `paused` RESUMES into `running` — that is what makes P-240 a re-entry.
 *   - `failed` may RETRY, because a transient failure is not a verdict.
 *   - `succeeded`/`cancelled` are TERMINAL.
 */
export const JOB_TRANSITIONS: Readonly<Record<JobStatus, readonly JobStatus[]>> = {
  queued: ['running', 'cancelled'],
  running: ['succeeded', 'failed', 'paused', 'cancelled'],
  paused: ['running', 'cancelled', 'failed'],
  failed: ['running', 'cancelled'],
  succeeded: [],
  cancelled: [],
};

/** May a job move `from → to`? */
export function canJobTransition(from: JobStatus, to: JobStatus): boolean {
  return JOB_TRANSITIONS[from].includes(to);
}

/** The statuses nothing can leave. */
export function isTerminalJobStatus(status: JobStatus): boolean {
  return JOB_TRANSITIONS[status].length === 0;
}

/** One job, as stored and as read back. */
export interface JobRecord {
  id: string;
  /** What kind of job this is (e.g. `stitch`). */
  kind: string;
  status: JobStatus;
  /** The pipeline context the job wraps, verbatim (P-238). */
  ctx: Record<string, unknown>;
  /** The pipeline's result, once it produced one. */
  result?: Record<string, unknown>;
  /** Why it failed, when it did. */
  error?: Record<string, unknown>;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  /** Which worker holds the lease, while it is running. */
  leaseOwner?: string;
  /** When the lease lapses — the crash-recovery clock. */
  leaseExpiresAt?: string;
}

/** What a caller supplies to enqueue. */
export interface JobDraft {
  /** Defaults to a slug plus a timestamp (P-205). */
  id?: string;
  kind: string;
  ctx: Record<string, unknown>;
}

/** Filters for {@link JobQueue.list}. */
export interface JobQuery {
  kind?: string;
  status?: JobStatus;
  /** Inclusive lower bound on `created_at`. */
  from?: string;
  /** Inclusive upper bound on `created_at`. */
  to?: string;
  limit?: number;
}

/** Options for {@link JobQueue}. */
export interface JobQueueOptions {
  /** Durable storage. REQUIRED — a queue that evaporates is not a queue. */
  db: import('../store/schema.js').DbLike;
  /** Clock, injectable so tests are deterministic. */
  now?: () => string;
  /** Lease lifetime in ms before a `running` job is considered abandoned. */
  leaseTtlMs?: number;
  /** Receives a `job:<status>` event on every transition (P-241's shape). */
  emit?: (event: JobEvent) => void;
}

/** One job observation, for the event bus (P-241) and metrics (P-247). */
export interface JobEvent {
  type: 'job:transition';
  jobId: string;
  kind: string;
  from: JobStatus;
  to: JobStatus;
  owner?: string;
  at: string;
}

/** The default lease lifetime: long enough for a real stage, short enough to recover. */
export const DEFAULT_JOB_LEASE_MS = 15 * 60 * 1000;
