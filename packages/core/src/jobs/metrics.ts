// P-247 — Orchestration: run metrics.
//
// Metrics are the data that makes two runs COMPARABLE: how long each stage took, how
// much the run produced, what it cost, and what the sandbox used. They are
// EVENT-SOURCED — the collector is fed by the same P-241 events the UI renders — so
// the numbers a user saw live and the numbers persisted afterwards cannot disagree.
//
// Three deliberate properties:
//
//   1. COLLECTION IS PURE AND SYNCHRONOUS. `MetricsCollector` holds counters and a
//      stage map; nothing here does I/O. Persistence is one explicit call
//      ({@link finalizeMetrics}) at the end of a run, so a crashing stage cannot
//      leave half-written metrics behind.
//   2. TIMINGS COME FROM THE TRANSITIONS THAT ALREADY HAPPENED. P-238 stamps every
//      `StageRecord` with `startedAt`/`finishedAt` and emits a transition per move, so
//      a duration is DERIVED, never separately instrumented — the two cannot drift.
//   3. COST IS CLAMPED, NOT TRUSTED. Token and dollar totals arrive from a provider
//      (P-143); a NaN, an infinity or a negative from a misbehaving adapter must not
//      poison a trend query, so every accumulation goes through {@link safeAdd}.
//
// On storage: metrics live in their own table (`pipeline_job_metrics`) rather than on
// P-239's `pipeline_jobs` row. The phase says "the job row"; the repo's own-DDL
// precedent (ADR-063/068) and the `listMetrics({kind,from,to})` trend query both fit a
// side table better, and it keeps a metrics write from touching the queue's row.
// Recorded rather than silently chosen — see the ADR.

import { err, ok, type Result } from 'neverthrow';
import type { Bus, Unsubscribe } from '../events/bus.js';
import type { PipelineStagePayload } from '../events/topics.js';
import { dbAll, dbGet, dbRun, type DbLike, type SQLiteRow } from '../store/schema.js';
import type { StitchError } from '../result/index.js';

/** One stage's wall-clock, as observed from its transitions. */
export interface StageTiming {
  stage: string;
  /** ISO-8601 of the `→ running` transition. */
  started: string;
  /** ISO-8601 of the settling transition. */
  finished: string;
  durationMs: number;
  /** True when the stage was settled by an idempotency/cache hit (P-238 `skipped`). */
  reusedFromCache: boolean;
}

/** What the run produced. */
export interface MetricsCounts {
  files: number;
  deps: number;
  tokensIn: number;
  tokensOut: number;
  licenseDecisions: number;
  /** Agent tool invocations (P-162's `agent.tool`). */
  checks: number;
}

/** What the sandbox used (P-176). */
export interface MetricsResources {
  sandboxCpuMs: number;
  sandboxMemMb: number;
  sandboxJobs: number;
}

/** What it cost (P-143). */
export interface MetricsCost {
  estimatedUsd: number;
  provider?: string;
}

/** One job's metrics. */
export interface JobMetrics {
  jobId: string;
  stages: StageTiming[];
  counts: MetricsCounts;
  resources: MetricsResources;
  cost: MetricsCost;
}

/** Options for {@link finalizeMetrics} / {@link listMetrics}. */
export interface MetricsQuery {
  kind?: string;
  /** Inclusive lower bound on `recorded_at`, ISO-8601. */
  from?: string;
  /** Inclusive upper bound on `recorded_at`, ISO-8601. */
  to?: string;
  limit?: number;
}

/** This module's table. Owned on first use — see the header. */
export const JOB_METRICS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS pipeline_job_metrics (
  job_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'stitch',
  recorded_at TEXT NOT NULL,
  metrics_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pipeline_job_metrics_recorded ON pipeline_job_metrics (recorded_at);`;

/** The largest integer we will let an aggregate reach before clamping. */
const MAX_SAFE = Number.MAX_SAFE_INTEGER;

/**
 * Add, refusing to let a bad number in.
 *
 * A provider that reports `NaN`, `Infinity` or a negative token count is a real
 * failure mode (P-143), and one such value would silently poison every trend that
 * includes it. Non-finite inputs contribute 0; the total is clamped to the safe
 * integer range so it can never overflow into an unusable float.
 */
function safeAdd(current: number, delta: number): number {
  if (!Number.isFinite(delta) || delta < 0) return current;
  const next = current + delta;
  if (!Number.isFinite(next)) return MAX_SAFE;
  return Math.min(next, MAX_SAFE);
}

/** A non-negative count from a `Record<string, unknown>` payload. */
function countOf(payload: Record<string, unknown>, key: string): number | undefined {
  const value = payload[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** An array length from a `Record<string, unknown>` payload, when it is one. */
function lengthOf(payload: Record<string, unknown>, key: string): number | undefined {
  const value = payload[key];
  return Array.isArray(value) ? value.length : undefined;
}

/**
 * Accumulates metrics from bus events (or directly, in a test).
 *
 * Every mutator is synchronous and infallible; {@link snapshot} is a pure read. The
 * collector never touches the database — see {@link finalizeMetrics}.
 */
export class MetricsCollector {
  readonly #jobId: string;
  readonly #now: () => string;
  #stages = new Map<string, { started: string; finished?: string; reused: boolean }>();
  #counts: MetricsCounts = {
    files: 0,
    deps: 0,
    tokensIn: 0,
    tokensOut: 0,
    licenseDecisions: 0,
    checks: 0,
  };
  #resources: MetricsResources = { sandboxCpuMs: 0, sandboxMemMb: 0, sandboxJobs: 0 };
  #cost: MetricsCost = { estimatedUsd: 0 };
  readonly #subs: Unsubscribe[] = [];

  constructor(jobId: string, opts: { now?: () => string } = {}) {
    this.#jobId = jobId;
    // Injectable so a test can assert a real duration instead of whatever the wall
    // clock did between two adjacent calls.
    this.#now = opts.now ?? (() => new Date().toISOString());
  }

  /**
   * Subscribe to the run's events (P-241).
   *
   * Returns the unsubscribe so a finished job detaches — a collector that lived on
   * would keep counting events for a job that ended.
   */
  attach(bus: Bus): Unsubscribe {
    const offs = [
      bus.subscribe('pipeline.stage', payload => this.recordStageTransition(payload)),
      bus.subscribe('agent.tool', () => this.tally('checks', 1)),
      bus.subscribe('deps.merged', payload => {
        const count = countOf(payload, 'count') ?? lengthOf(payload, 'packages') ?? 1;
        this.tally('deps', count);
      }),
      bus.subscribe('license.verdict', () => this.tally('licenseDecisions', 1)),
      bus.subscribe('sandbox.run', payload => {
        this.recordResources({
          ...(countOf(payload, 'cpuMs') !== undefined ? { cpuMs: countOf(payload, 'cpuMs')! } : {}),
          ...(countOf(payload, 'memMb') !== undefined ? { memMb: countOf(payload, 'memMb')! } : {}),
          ...(countOf(payload, 'jobs') !== undefined ? { jobs: countOf(payload, 'jobs')! } : {}),
        });
      }),
    ];
    this.#subs.push(...offs);
    return () => {
      for (const off of offs) off();
      offs.length = 0;
    };
  }

  /** Stop counting. Idempotent. */
  detach(): void {
    for (const off of this.#subs) off();
    this.#subs.length = 0;
  }

  /**
   * Record one stage transition.
   *
   * `→ running` opens a span; a settling move closes it. `skipped` marks the span as
   * a reuse (P-238's cache hit), which is the number P-250's tuning reads.
   */
  recordStageTransition(payload: PipelineStagePayload): void {
    const at = this.#now();
    const { stage, to } = payload;
    if (to === 'running') {
      this.#stages.set(stage, { started: at, reused: false });
      return;
    }
    if (to !== 'passed' && to !== 'skipped' && to !== 'failed') return;
    const open = this.#stages.get(stage);
    if (open === undefined) return;
    this.#stages.set(stage, { ...open, finished: at, reused: to === 'skipped' });
  }

  /** Add to a count. Negative and non-finite deltas are ignored. */
  tally(key: keyof MetricsCounts, delta = 1): void {
    this.#counts = { ...this.#counts, [key]: safeAdd(this.#counts[key], delta) };
  }

  /** Record token and dollar spend from one provider call (P-143). */
  addTokens(opts: {
    tokensIn?: number;
    tokensOut?: number;
    costUsd?: number;
    provider?: string;
  }): void {
    if (opts.tokensIn !== undefined) this.tally('tokensIn', opts.tokensIn);
    if (opts.tokensOut !== undefined) this.tally('tokensOut', opts.tokensOut);
    if (opts.costUsd !== undefined) {
      this.#cost = {
        ...this.#cost,
        estimatedUsd: safeAdd(this.#cost.estimatedUsd, opts.costUsd),
        ...(opts.provider !== undefined ? { provider: opts.provider } : {}),
      };
    } else if (opts.provider !== undefined) {
      this.#cost = { ...this.#cost, provider: opts.provider };
    }
  }

  /** Record a sandbox resource reading (P-176). Fields are accumulated. */
  recordResources(opts: { cpuMs?: number; memMb?: number; jobs?: number }): void {
    this.#resources = {
      sandboxCpuMs: safeAdd(this.#resources.sandboxCpuMs, opts.cpuMs ?? 0),
      // Memory is a PEAK, not a sum: the highest reading is what the run used.
      sandboxMemMb: Math.max(this.#resources.sandboxMemMb, opts.memMb ?? 0),
      sandboxJobs: safeAdd(this.#resources.sandboxJobs, opts.jobs ?? 0),
    };
  }

  /** The metrics so far. Pure — call it as often as you like. */
  snapshot(): JobMetrics {
    const stages: StageTiming[] = [];
    for (const [stage, span] of this.#stages) {
      if (span.finished === undefined) continue;
      const start = Date.parse(span.started);
      const end = Date.parse(span.finished);
      stages.push({
        stage,
        started: span.started,
        finished: span.finished,
        // A clock that moved backwards yields 0, never a negative duration.
        durationMs: Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : 0,
        reusedFromCache: span.reused,
      });
    }
    return {
      jobId: this.#jobId,
      stages,
      counts: { ...this.#counts },
      resources: { ...this.#resources },
      cost: { ...this.#cost },
    };
  }
}

function isStageTiming(value: unknown): value is StageTiming {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.stage === 'string' && typeof record.durationMs === 'number';
}

/** Parse a stored row back, or `undefined` if it is not usable. */
function toMetrics(row: SQLiteRow): JobMetrics | undefined {
  const jobId = row['job_id'];
  const json = row['metrics_json'];
  if (typeof jobId !== 'string' || typeof json !== 'string') return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const record = parsed as Record<string, unknown>;
  const stages = Array.isArray(record.stages) ? record.stages.filter(isStageTiming) : [];
  const counts = typeof record.counts === 'object' && record.counts !== null ? record.counts : {};
  const resources =
    typeof record.resources === 'object' && record.resources !== null ? record.resources : {};
  const cost = typeof record.cost === 'object' && record.cost !== null ? record.cost : {};
  return {
    jobId,
    stages,
    counts: counts as MetricsCounts,
    resources: resources as MetricsResources,
    cost: cost as MetricsCost,
  };
}

function ensureTable(db: DbLike): Result<void, StitchError> {
  try {
    db.exec(JOB_METRICS_TABLE_SQL);
    return ok(undefined);
  } catch (cause: unknown) {
    return err({
      code: 'INTERNAL',
      message: `metrics: cannot create table: ${cause instanceof Error ? cause.message : String(cause)}`,
    });
  }
}

/** Persist a job's metrics. Idempotent per job — a re-finalize replaces the row. */
export function finalizeMetrics(
  db: DbLike,
  metrics: JobMetrics,
  opts: { kind?: string; now?: () => string } = {}
): Result<void, StitchError> {
  const table = ensureTable(db);
  if (table.isErr()) return err(table.error);
  const written = dbRun(
    db,
    `INSERT OR REPLACE INTO pipeline_job_metrics (job_id, kind, recorded_at, metrics_json)
     VALUES (?, ?, ?, ?)`,
    metrics.jobId,
    opts.kind ?? 'stitch',
    (opts.now ?? (() => new Date().toISOString()))(),
    JSON.stringify(metrics)
  );
  if (written.isErr()) return err(written.error);
  return ok(undefined);
}

/** One job's persisted metrics, or `undefined` when none were recorded. */
export function getMetrics(db: DbLike, jobId: string): Result<JobMetrics | undefined, StitchError> {
  const table = ensureTable(db);
  if (table.isErr()) return err(table.error);
  const row = dbGet(db, 'SELECT * FROM pipeline_job_metrics WHERE job_id = ?', jobId);
  if (row.isErr()) return err(row.error);
  return ok(row.value === null ? undefined : toMetrics(row.value));
}

/**
 * Metrics for a trend: newest first, filtered by kind and a recorded-at window.
 *
 * The WHERE clauses are built with bound parameters only — never interpolated — so a
 * caller-supplied kind cannot reach the SQL text.
 */
export function listMetrics(
  db: DbLike,
  query: MetricsQuery = {}
): Result<JobMetrics[], StitchError> {
  const table = ensureTable(db);
  if (table.isErr()) return err(table.error);

  const clauses: string[] = [];
  const params: (string | number)[] = [];
  if (query.kind !== undefined) {
    clauses.push('kind = ?');
    params.push(query.kind);
  }
  if (query.from !== undefined) {
    clauses.push('recorded_at >= ?');
    params.push(query.from);
  }
  if (query.to !== undefined) {
    clauses.push('recorded_at <= ?');
    params.push(query.to);
  }
  const where = clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : '';
  const limit = Math.max(1, Math.min(query.limit ?? 100, 1000));
  const rows = dbAll(
    db,
    `SELECT * FROM pipeline_job_metrics${where} ORDER BY recorded_at DESC LIMIT ?`,
    ...params,
    limit
  );
  if (rows.isErr()) return err(rows.error);
  const out: JobMetrics[] = [];
  for (const row of rows.value) {
    const parsed = toMetrics(row);
    if (parsed !== undefined) out.push(parsed);
  }
  return ok(out);
}
