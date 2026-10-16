// P-239 — Orchestration: the job queue's SQLite schema.
//
// WHY THE TABLE IS `pipeline_jobs` AND NOT `jobs` (ADR-063).
//
// `store/schema.ts` (migration v1, P-030) ALREADY defines a table named `jobs`:
//
//     jobs(id TEXT PRIMARY KEY, status TEXT, payload TEXT, created_at, updated_at)
//
// The phase mandates a table named `jobs` with a DIFFERENT, eleven-column shape
// (kind, config_json, lease_owner, lease_expires_at, …). `CREATE TABLE IF NOT
// EXISTS jobs` would therefore SILENTLY NO-OP against the existing table, and every
// INSERT would then fail against columns that do not exist — a landmine that only
// fires at runtime, in the one component whose job is to make failures durable.
// So the phase's exact COLUMN SET is kept and the table is named distinctly.
//
// (The alternative — and `store/schema.ts:10` does reserve an extension slot for
// this phase — is to ALTER the v1 table through a new migration. That is a larger
// change to another phase's surface; this phase's own file mandate is a `schema.ts`
// that owns its DDL, the same arrangement P-169/P-173/P-178 used. Recorded rather
// than silently chosen.)
//
// The lease columns are the concurrency authority: `claim` is a single guarded
// UPDATE, and `lease_expires_at` is the clock that lets a crashed worker's job be
// recovered instead of running twice or being stuck forever.

/** The queue's table. Deliberately not `jobs` — see the header. */
export const JOBS_TABLE_NAME = 'pipeline_jobs';

/** The DDL, created on first use by the queue that owns it. */
export const PIPELINE_JOBS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS pipeline_jobs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  config_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  result_json TEXT,
  error_json TEXT,
  stage_status TEXT,
  lease_owner TEXT,
  lease_expires_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_pipeline_jobs_status ON pipeline_jobs (status);
CREATE INDEX IF NOT EXISTS idx_pipeline_jobs_created ON pipeline_jobs (created_at);`;
