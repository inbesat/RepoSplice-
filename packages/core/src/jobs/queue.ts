// P-239 — Orchestration: the durable job queue.
//
// The spine of Wave 3. Everything that runs a pipeline goes through here, which is
// what gives cancel, resume (P-240) and metrics (P-247) a single home — and what
// lets `stitch status` (P-194) and the web history (P-224) answer questions about
// work that is no longer in memory.
//
// Four properties are load-bearing:
//
//   1. CLAIM IS ONE GUARDED UPDATE, not read-then-write. `claim` compiles to
//      `UPDATE … WHERE id = ? AND status = 'queued'` and reads `changes`; two
//      workers racing therefore produce exactly one winner. A read-then-write would
//      let both observe `queued` and both run the job — the "no double run"
//      requirement is a property of the SQL, not of the caller's care.
//   2. EVERY OTHER MUTATOR IS GUARDED THE SAME WAY — status checked against
//      {@link canJobTransition} AND re-checked inside the `WHERE`, so the guard
//      cannot be lost to a race between the check and the update.
//   3. THE LEASE IS THE CONCURRENCY AUTHORITY. `lease_expires_at` is what turns a
//      crashed worker into a recoverable job ({@link requeueStale}) instead of a
//      job that is running forever. A lease is claimed for a TTL, not forever.
//   4. A REFUSED TRANSITION IS A TYPED ERROR, using P-159's existing
//      `ILLEGAL_TRANSITION` (`{ from, to, message }` — ADR-032 kept its fields as
//      plain strings for exactly this kind of reuse). Finishing a cancelled job is
//      a caller bug, and saying so beats silently doing nothing.

import { err, ok, type Result } from 'neverthrow';
import { randomUUID } from 'node:crypto';
import { dbAll, dbGet, dbRun, type DbLike, type SQLiteRow } from '../store/schema.js';
import { type StitchError } from '../result/index.js';
import { JOBS_TABLE_NAME, PIPELINE_JOBS_TABLE_SQL } from './schema.js';
import {
  canJobTransition,
  DEFAULT_JOB_LEASE_MS,
  type JobDraft,
  type JobEvent,
  type JobQuery,
  type JobQueueOptions,
  type JobRecord,
  type JobStatus,
} from './types.js';

const COLUMNS =
  'id, kind, status, config_json, created_at, started_at, finished_at, result_json, error_json, lease_owner, lease_expires_at';

function detailOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** A `StitchError` for a move the queue's own table forbids. */
function refused(from: JobStatus, to: JobStatus, id: string): StitchError {
  return {
    code: 'ILLEGAL_TRANSITION',
    from,
    to,
    message: `job ${id} cannot move ${from} → ${to}`,
  };
}

function parseJson(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'string' || value === '') return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function toRecord(row: SQLiteRow): JobRecord | undefined {
  const id = row['id'];
  const kind = row['kind'];
  const status = row['status'];
  const createdAt = row['created_at'];
  if (
    typeof id !== 'string' ||
    typeof kind !== 'string' ||
    typeof status !== 'string' ||
    typeof createdAt !== 'string'
  ) {
    return undefined;
  }
  const startedAt = row['started_at'];
  const finishedAt = row['finished_at'];
  const leaseOwner = row['lease_owner'];
  const leaseExpiresAt = row['lease_expires_at'];
  const result = parseJson(row['result_json']);
  const error = parseJson(row['error_json']);
  return {
    id,
    kind,
    status: status as JobStatus,
    ctx: parseJson(row['config_json']) ?? {},
    ...(result !== undefined ? { result } : {}),
    ...(error !== undefined ? { error } : {}),
    createdAt,
    ...(typeof startedAt === 'string' ? { startedAt } : {}),
    ...(typeof finishedAt === 'string' ? { finishedAt } : {}),
    ...(typeof leaseOwner === 'string' ? { leaseOwner } : {}),
    ...(typeof leaseExpiresAt === 'string' ? { leaseExpiresAt } : {}),
  };
}

/** Slug a kind into an id fragment (P-205). */
function slug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

/**
 * The durable queue.
 *
 * Construct with a `DbLike`; the table and its indexes are created on first use.
 */
export class JobQueue {
  readonly #db: DbLike;
  readonly #now: () => string;
  readonly #leaseTtlMs: number;
  readonly #emit: ((event: JobEvent) => void) | undefined;
  #ready = false;

  constructor(options: JobQueueOptions) {
    this.#db = options.db;
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#leaseTtlMs = Math.max(1, options.leaseTtlMs ?? DEFAULT_JOB_LEASE_MS);
    this.#emit = options.emit;
  }

  #ensureTable(): Result<void, StitchError> {
    if (this.#ready) return ok(undefined);
    try {
      this.#db.exec(PIPELINE_JOBS_TABLE_SQL);
      this.#ready = true;
      return ok(undefined);
    } catch (cause: unknown) {
      return err({
        code: 'INTERNAL',
        message: `${JOBS_TABLE_NAME} setup failed: ${detailOf(cause)}`,
      });
    }
  }

  /** Read one job by id. */
  async get(id: string): Promise<Result<JobRecord | undefined, StitchError>> {
    const ready = this.#ensureTable();
    if (ready.isErr()) return err(ready.error);
    const row = dbGet(this.#db, `SELECT ${COLUMNS} FROM ${JOBS_TABLE_NAME} WHERE id = ?`, id);
    if (row.isErr()) return err(row.error);
    if (row.value === null) return ok(undefined);
    return ok(toRecord(row.value));
  }

  /** Add a job, `queued`. */
  async enqueue(draft: JobDraft): Promise<Result<JobRecord, StitchError>> {
    if (draft.kind.trim() === '') {
      return err({
        code: 'CONFIG_ERROR',
        field: 'kind',
        message: 'JobQueue.enqueue: kind is required',
      });
    }
    const ready = this.#ensureTable();
    if (ready.isErr()) return err(ready.error);

    const at = this.#now();
    // Slug + timestamp (P-205) is NOT sufficient on its own: two jobs of the same
    // kind enqueued within the same clock tick would collide on the PRIMARY KEY.
    // The suffix is what makes the id unique; the prefix is what makes it readable.
    const id =
      draft.id ??
      `${slug(draft.kind)}-${at.replace(/[^0-9]/g, '').slice(0, 14)}-${randomUUID().replace(/-/g, '').slice(0, 8)}`;
    const written = dbRun(
      this.#db,
      `INSERT INTO ${JOBS_TABLE_NAME} (id, kind, status, config_json, created_at)
       VALUES (?, ?, 'queued', ?, ?)`,
      id,
      draft.kind,
      JSON.stringify(draft.ctx),
      at
    );
    if (written.isErr()) return err(written.error);
    const created = await this.get(id);
    if (created.isErr()) return err(created.error);
    if (created.value === undefined) {
      return err({ code: 'INTERNAL', message: `job ${id} vanished after INSERT` });
    }
    return ok(created.value);
  }

  /**
   * Take the lease on a queued job.
   *
   * `ok(undefined)` means SOMEONE ELSE has it (or it is no longer queued) — a lost
   * race is not an error. The guard lives in the `WHERE`, so it cannot be lost.
   */
  async claim(
    id: string,
    owner: string,
    ttlMs: number = this.#leaseTtlMs
  ): Promise<Result<JobRecord | undefined, StitchError>> {
    const ready = this.#ensureTable();
    if (ready.isErr()) return err(ready.error);
    const before = await this.get(id);
    if (before.isErr()) return err(before.error);
    if (before.value === undefined) {
      return err({ code: 'CONFIG_ERROR', field: 'id', message: `JobQueue.claim: no job ${id}` });
    }
    if (!canJobTransition(before.value.status, 'running')) {
      return err(refused(before.value.status, 'running', id));
    }

    const startedAt = before.value.startedAt ?? this.#now();
    const expiresAt = new Date(Date.parse(this.#now()) + Math.max(1, ttlMs)).toISOString();
    const claimed = dbRun(
      this.#db,
      `UPDATE ${JOBS_TABLE_NAME}
          SET status = 'running', started_at = ?, lease_owner = ?, lease_expires_at = ?
        WHERE id = ? AND status = ?`,
      startedAt,
      owner,
      expiresAt,
      id,
      before.value.status
    );
    if (claimed.isErr()) return err(claimed.error);
    // `changes === 0` is the lost race: the row moved under us.
    if (claimed.value.changes === 0) return ok(undefined);

    this.#emit?.({
      type: 'job:transition',
      jobId: id,
      kind: before.value.kind,
      from: before.value.status,
      to: 'running',
      owner,
      at: this.#now(),
    });
    const after = await this.get(id);
    if (after.isErr()) return err(after.error);
    return ok(after.value);
  }

  /** Move a job to a terminal-or-paused status, guarded by the table. */
  async #settle(
    id: string,
    to: JobStatus,
    detail: { result?: Record<string, unknown>; error?: Record<string, unknown> }
  ): Promise<Result<JobRecord, StitchError>> {
    const ready = this.#ensureTable();
    if (ready.isErr()) return err(ready.error);
    const before = await this.get(id);
    if (before.isErr()) return err(before.error);
    if (before.value === undefined) {
      return err({ code: 'CONFIG_ERROR', field: 'id', message: `no job ${id}` });
    }
    if (!canJobTransition(before.value.status, to)) {
      return err(refused(before.value.status, to, id));
    }

    const at = this.#now();
    // Two explicit statements rather than one built by interpolation: the SQL is
    // the concurrency guard here, so it has to be readable at a glance.
    const resultJson = detail.result === undefined ? null : JSON.stringify(detail.result);
    const errorJson = detail.error === undefined ? null : JSON.stringify(detail.error);
    const terminal = to === 'succeeded' || to === 'failed' || to === 'cancelled';

    const updated = terminal
      ? dbRun(
          this.#db,
          `UPDATE ${JOBS_TABLE_NAME}
              SET status = ?, finished_at = ?, result_json = COALESCE(?, result_json),
                  error_json = COALESCE(?, error_json), lease_owner = NULL, lease_expires_at = NULL
            WHERE id = ? AND status = ?`,
          to,
          at,
          resultJson,
          errorJson,
          id,
          before.value.status
        )
      : dbRun(
          this.#db,
          `UPDATE ${JOBS_TABLE_NAME}
              SET status = ?, result_json = COALESCE(?, result_json),
                  error_json = COALESCE(?, error_json), lease_owner = NULL, lease_expires_at = NULL
            WHERE id = ? AND status = ?`,
          to,
          resultJson,
          errorJson,
          id,
          before.value.status
        );
    if (updated.isErr()) return err(updated.error);
    if (updated.value.changes === 0) {
      // The row moved between the check and the update — report the CURRENT move.
      const now = await this.get(id);
      const actual = now.isOk() && now.value !== undefined ? now.value.status : before.value.status;
      return err(refused(actual, to, id));
    }

    this.#emit?.({
      type: 'job:transition',
      jobId: id,
      kind: before.value.kind,
      from: before.value.status,
      to,
      at,
    });
    const after = await this.get(id);
    if (after.isErr()) return err(after.error);
    if (after.value === undefined) return err({ code: 'INTERNAL', message: `job ${id} vanished` });
    return ok(after.value);
  }

  /** Mark a job succeeded, recording its result. */
  async finish(
    id: string,
    result: Record<string, unknown> = {}
  ): Promise<Result<JobRecord, StitchError>> {
    return this.#settle(id, 'succeeded', { result });
  }

  /** Mark a job failed, recording why. */
  async fail(
    id: string,
    error: Record<string, unknown> = {}
  ): Promise<Result<JobRecord, StitchError>> {
    return this.#settle(id, 'failed', { error });
  }

  /** A human stopped it. Legal from anything that is not terminal. */
  async cancel(id: string): Promise<Result<JobRecord, StitchError>> {
    return this.#settle(id, 'cancelled', {});
  }

  /** Waiting on a licence verdict or an HIL approval (P-160). */
  async pause(
    id: string,
    reason: Record<string, unknown> = {}
  ): Promise<Result<JobRecord, StitchError>> {
    return this.#settle(id, 'paused', { error: reason });
  }

  /** Take a `paused` or `failed` job back to `running` (P-240's re-entry). */
  async resume(id: string, owner: string): Promise<Result<JobRecord | undefined, StitchError>> {
    return this.claim(id, owner);
  }

  /**
   * Claim up to `limit` queued jobs, oldest first.
   *
   * Skips anything another worker won — a lost race is normal, not exceptional.
   */
  async pollReady(
    owner: string,
    opts: { limit?: number; kind?: string; ttlMs?: number } = {}
  ): Promise<Result<JobRecord[], StitchError>> {
    const ready = this.#ensureTable();
    if (ready.isErr()) return err(ready.error);
    const limit = Math.max(1, Math.floor(opts.limit ?? 1));

    const rows = dbAll(
      this.#db,
      `SELECT id FROM ${JOBS_TABLE_NAME} WHERE status = 'queued'${
        opts.kind !== undefined ? ' AND kind = ?' : ''
      } ORDER BY created_at ASC, id ASC LIMIT ${limit}`,
      ...(opts.kind !== undefined ? [opts.kind] : [])
    );
    if (rows.isErr()) return err(rows.error);

    const claimed: JobRecord[] = [];
    for (const row of rows.value) {
      const id = row['id'];
      if (typeof id !== 'string') continue;
      const won = await this.claim(id, owner, opts.ttlMs ?? this.#leaseTtlMs);
      if (won.isErr()) return err(won.error);
      if (won.value !== undefined) claimed.push(won.value);
    }
    return ok(claimed);
  }

  /**
   * Requeue jobs whose lease lapsed — crash recovery (P-240).
   *
   * A `running` job past its lease belongs to a worker that is gone, so it goes
   * back to `queued` and its lease is cleared. This is why the lease is a clock and
   * not a flag: a crash leaves evidence behind, and the evidence expires.
   */
  async requeueStale(now: string = this.#now()): Promise<Result<number, StitchError>> {
    const ready = this.#ensureTable();
    if (ready.isErr()) return err(ready.error);
    const requeued = dbRun(
      this.#db,
      `UPDATE ${JOBS_TABLE_NAME}
          SET status = 'queued', lease_owner = NULL, lease_expires_at = NULL
        WHERE status = 'running' AND lease_expires_at IS NOT NULL AND lease_expires_at < ?`,
      now
    );
    if (requeued.isErr()) return err(requeued.error);
    return ok(requeued.value.changes);
  }

  /** Query jobs, newest first — the shape `stitch status` and the web history use. */
  async list(query: JobQuery = {}): Promise<Result<JobRecord[], StitchError>> {
    const ready = this.#ensureTable();
    if (ready.isErr()) return err(ready.error);

    const clauses: string[] = [];
    const params: string[] = [];
    if (query.kind !== undefined) {
      clauses.push('kind = ?');
      params.push(query.kind);
    }
    if (query.status !== undefined) {
      clauses.push('status = ?');
      params.push(query.status);
    }
    if (query.from !== undefined) {
      clauses.push('created_at >= ?');
      params.push(query.from);
    }
    if (query.to !== undefined) {
      clauses.push('created_at <= ?');
      params.push(query.to);
    }
    const where = clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : '';
    const limit =
      query.limit !== undefined && Number.isFinite(query.limit) && query.limit > 0
        ? ` LIMIT ${Math.floor(query.limit)}`
        : '';

    const rows = dbAll(
      this.#db,
      `SELECT ${COLUMNS} FROM ${JOBS_TABLE_NAME}${where} ORDER BY created_at DESC, id DESC${limit}`,
      ...params
    );
    if (rows.isErr()) return err(rows.error);
    const records: JobRecord[] = [];
    for (const row of rows.value) {
      const record = toRecord(row);
      if (record !== undefined) records.push(record);
    }
    return ok(records);
  }

  /**
   * Persist the state machine's per-stage records (P-240's checkpoint).
   *
   * Called by the machine after each transition. There is NO column change on the
   * hot path: `stage_status` is written on its own, so a checkpoint never has to
   * read-modify-write the rest of the row and cannot lose a concurrent lease
   * update. `null` clears it.
   */
  async setStageStatus(
    id: string,
    stageStatus: Record<string, unknown> | null
  ): Promise<Result<void, StitchError>> {
    const ready = this.#ensureTable();
    if (ready.isErr()) return err(ready.error);
    const written = dbRun(
      this.#db,
      `UPDATE ${JOBS_TABLE_NAME} SET stage_status = ? WHERE id = ?`,
      stageStatus === null ? null : JSON.stringify(stageStatus),
      id
    );
    if (written.isErr()) return err(written.error);
    if (written.value.changes === 0) {
      return err({
        code: 'CONFIG_ERROR',
        field: 'id',
        message: `JobQueue.setStageStatus: no job ${id}`,
      });
    }
    return ok(undefined);
  }

  /**
   * Everything a resume needs to rebuild the run (P-240).
   *
   * `undefined` means no such job. A job WITHOUT a checkpoint comes back with
   * `stageStatus: undefined`, which a caller must read as "nothing to resume" —
   * an empty/absent checkpoint is not a resume point.
   */
  async getResumableContext(id: string): Promise<
    Result<
      | {
          id: string;
          kind: string;
          status: JobStatus;
          ctx: Record<string, unknown>;
          stageStatus?: Record<string, unknown>;
          leaseOwner?: string;
        }
      | undefined,
      StitchError
    >
  > {
    const ready = this.#ensureTable();
    if (ready.isErr()) return err(ready.error);
    const row = dbGet(
      this.#db,
      `SELECT id, kind, status, config_json, stage_status, lease_owner FROM ${JOBS_TABLE_NAME} WHERE id = ?`,
      id
    );
    if (row.isErr()) return err(row.error);
    if (row.value === null) return ok(undefined);
    const record = row.value;
    const jobId = record['id'];
    const kind = record['kind'];
    const status = record['status'];
    if (typeof jobId !== 'string' || typeof kind !== 'string' || typeof status !== 'string') {
      return err({ code: 'INTERNAL', message: `job ${id} has an unusable row` });
    }
    const stageStatus = parseJson(record['stage_status']);
    const leaseOwner = record['lease_owner'];
    return ok({
      id: jobId,
      kind,
      status: status as JobStatus,
      ctx: parseJson(record['config_json']) ?? {},
      ...(stageStatus !== undefined ? { stageStatus } : {}),
      ...(typeof leaseOwner === 'string' && leaseOwner !== '' ? { leaseOwner } : {}),
    });
  }
}
