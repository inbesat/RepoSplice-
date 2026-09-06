// Schema + migration runner for the local SQLite store (P-030).
//
// This module is intentionally `bun:sqlite`-FREE: everything operates on
// the structural `DbLike` interface, so vitest (Node workers, which
// cannot resolve `bun:sqlite`) can exercise the real SQL through a
// `node:sqlite`-backed adapter in `__tests__/db.test.ts`. Production
// opens the real engine in `db.ts` (`openDb`), whose `Database` satisfies
// `DbLike` structurally.
//
// Tables (initial migration v1 — extended by P-181/187/230/239/241/303/309):
//   schema_version | jobs | events | provenance | audit | baselines | cache

import { ok, err, type Result } from 'neverthrow';
import { type StitchError } from '../result/index.js';

/** Scalar values SQLite binds as statement parameters. */
export type SQLiteValue = string | number | bigint | boolean | null | Uint8Array;

/** Rows come back as plain column-name → value maps. */
export type SQLiteRow = Record<string, SQLiteValue>;

/** Outcome of a write statement. */
export interface SQLiteRunInfo {
  changes: number;
  lastInsertRowid: number | bigint;
}

/**
 * Minimal structural surface of a database connection. Satisfied by
 * `bun:sqlite`'s `Database` (production, `db.ts`) and by the
 * `node:sqlite`-backed adapter (tests) — same SQL, both engines.
 */
export interface DbLike {
  exec(sql: string): void;
  query(sql: string): StatementLike;
  close(): void;
}

/** Minimal structural surface of a prepared statement. */
export interface StatementLike {
  all(...params: SQLiteValue[]): SQLiteRow[];
  get(...params: SQLiteValue[]): SQLiteRow | null;
  run(...params: SQLiteValue[]): SQLiteRunInfo;
}

/** One forward-only migration. Versions are 1-based and gapless. */
export interface Migration {
  version: number;
  name: string;
  up: string;
}

/** Current schema version (= last entry of `migrations`). */
export const SCHEMA_VERSION = 1;

/**
 * Ordered migration list. Deterministic (P-282): same input order on
 * every machine, every run. New migrations append with version = length+1.
 */
export const migrations: readonly Migration[] = [
  {
    version: 1,
    name: 'initial-tables',
    up: `
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_events_job_id ON events (job_id);
CREATE TABLE IF NOT EXISTS provenance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repo TEXT NOT NULL,
  commit_sha TEXT,
  payload TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS baselines (
  id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS cache (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`.trim(),
  },
];

/**
 * Run pending migrations in order, recording each in `schema_version`.
 * Idempotent: re-running applies nothing and returns the current version.
 * Returns ok(version) with the post-run schema version.
 */
export function migrate(db: DbLike): Result<number, StitchError> {
  try {
    db.exec(
      `CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      );`
    );
    const row = db.query('SELECT MAX(version) AS v FROM schema_version').get() as {
      v: number | null;
    } | null;
    const current = row?.v ?? 0;
    let applied = current;
    for (const m of migrations) {
      if (m.version > current) {
        db.exec(m.up);
        db.query('INSERT INTO schema_version (version) VALUES (?)').run(m.version);
        applied = m.version;
      }
    }
    return ok(applied);
  } catch (cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    return err({ code: 'INTERNAL', message: `migration failed: ${detail}` });
  }
}

/**
 * Typed SELECT-many helper. Returns ok(rows), or err(INTERNAL) on SQL
 * errors (syntax, missing table). Parameters are always bound — never
 * interpolate values into `sql` (injection safety, spec step 5).
 */
export function dbAll(
  db: DbLike,
  sql: string,
  ...params: SQLiteValue[]
): Result<SQLiteRow[], StitchError> {
  try {
    return ok(db.query(sql).all(...params));
  } catch (cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    return err({ code: 'INTERNAL', message: `query failed: ${detail}` });
  }
}

/**
 * Typed SELECT-one helper. Returns ok(row | null) — `null` means "no
 * row", not an error. SQL errors map to err(INTERNAL).
 */
export function dbGet(
  db: DbLike,
  sql: string,
  ...params: SQLiteValue[]
): Result<SQLiteRow | null, StitchError> {
  try {
    return ok(db.query(sql).get(...params));
  } catch (cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    return err({ code: 'INTERNAL', message: `query failed: ${detail}` });
  }
}

/**
 * Typed write helper (INSERT/UPDATE/DELETE). Returns ok({ changes,
 * lastInsertRowid }), or err(INTERNAL) on SQL errors.
 */
export function dbRun(
  db: DbLike,
  sql: string,
  ...params: SQLiteValue[]
): Result<SQLiteRunInfo, StitchError> {
  try {
    return ok(db.query(sql).run(...params));
  } catch (cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    return err({ code: 'INTERNAL', message: `write failed: ${detail}` });
  }
}
