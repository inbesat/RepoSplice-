// Local SQLite store entry point (P-030).
//
// `openDb(path)` opens (creating parent dirs) a `bun:sqlite` database,
// enables WAL mode for reader/writer concurrency (P-249), runs pending
// migrations (`schema.ts`), and hands back a `StitchDb` with
// Result-returning helpers. Default location is `~/.stitch/store.db`
// (P-200/P-205).
//
// NOTE on the `bun:sqlite` import: vitest workers run on Node and cannot
// resolve `bun:sqlite` statically, which would break EVERY test file that
// imports the core barrel. So this module uses `import type` (erased at
// runtime — safe for vitest collection) plus a dynamic `await import`
// inside `openDb` (which therefore returns a Promise). Outside the Bun
// runtime the dynamic import rejects and `openDb` returns a typed err
// instead of throwing. Keep ALL SQL and branching logic in `schema.ts`
// so it stays test-covered under vitest.

import type { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { ok, err, type Result } from 'neverthrow';
import { type StitchError } from '../result/index.js';
import {
  migrate,
  dbAll,
  dbGet,
  dbRun,
  type DbLike,
  type SQLiteRow,
  type SQLiteRunInfo,
  type SQLiteValue,
} from './schema.js';

/** Store filename inside the stitch home dir. */
export const STITCH_STORE_FILENAME = 'store.db';

/** Stitch home dir (`~/.stitch`), holding the store + working dirs. */
export function stitchHomeDir(): string {
  return join(homedir(), '.stitch');
}

/** Default store path: `~/.stitch/store.db` (P-200/P-205). */
export function defaultStorePath(): string {
  return join(stitchHomeDir(), STITCH_STORE_FILENAME);
}

/** Options for `openDb`. `readonly` opens without write access. */
export interface OpenDbOptions {
  readonly?: boolean;
}

/**
 * Opened store handle. `raw` is the underlying `bun:sqlite` Database
 * (escape hatch for P-230 transactions/advanced use); prefer the
 * typed helpers for normal reads/writes.
 */
export interface StitchDb {
  /** Absolute path of the opened database file (`:memory:` allowed). */
  path: string;
  /** Current schema version after migrations ran. */
  schemaVersion: number;
  /** Raw engine handle. */
  raw: Database;
  /** SELECT many. Parameters are bound, never interpolated. */
  all(sql: string, ...params: SQLiteValue[]): Result<SQLiteRow[], StitchError>;
  /** SELECT one (`null` = no row). */
  get(sql: string, ...params: SQLiteValue[]): Result<SQLiteRow | null, StitchError>;
  /** INSERT/UPDATE/DELETE. */
  run(sql: string, ...params: SQLiteValue[]): Result<SQLiteRunInfo, StitchError>;
  /** Execute raw DDL/batches (migrations, PRAGMAs). */
  exec(sql: string): Result<void, StitchError>;
  /** Close the handle. Safe to call twice (second is a no-op). */
  close(): void;
}

/**
 * Open (creating parent dirs) the store at `path`, enable WAL, run
 * pending migrations, and return the handle.
 *
 * WAL is skipped for `:memory:` (SQLite keeps those in `memory` mode)
 * and for `readonly` opens. Migration failure closes the handle and
 * returns err — a half-migrated store must never be handed out.
 *
 * Async because the `bun:sqlite` engine is loaded via dynamic import
 * (static imports break vitest collection — see header note). Outside
 * the Bun runtime the import rejects and this returns a typed err.
 */
export async function openDb(
  path: string,
  options: OpenDbOptions = {}
): Promise<Result<StitchDb, StitchError>> {
  const readonly = options.readonly === true;
  let DatabaseCtor: new (path: string, options?: { readonly?: boolean }) => Database;
  try {
    ({ Database: DatabaseCtor } = await import('bun:sqlite'));
  } catch (cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    return err({ code: 'INTERNAL', message: `openDb needs the Bun runtime: ${detail}` });
  }
  let raw: Database;
  try {
    if (path !== ':memory:') {
      mkdirSync(dirname(path), { recursive: true });
    }
    raw = readonly ? new DatabaseCtor(path, { readonly: true }) : new DatabaseCtor(path);
  } catch (cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    return err({ code: 'INTERNAL', message: `openDb failed for ${path}: ${detail}` });
  }
  const db: DbLike = raw;
  try {
    if (path !== ':memory:' && !readonly) {
      raw.exec('PRAGMA journal_mode = WAL;');
    }
    const migrated = migrate(db);
    if (migrated.isErr()) {
      raw.close();
      return err(migrated.error);
    }
    let closed = false;
    const handle: StitchDb = {
      path,
      schemaVersion: migrated.value,
      raw,
      all: (sql, ...params) => dbAll(db, sql, ...params),
      get: (sql, ...params) => dbGet(db, sql, ...params),
      run: (sql, ...params) => dbRun(db, sql, ...params),
      exec: sql => {
        try {
          db.exec(sql);
          return ok(undefined);
        } catch (cause: unknown) {
          const detail = cause instanceof Error ? cause.message : String(cause);
          return err({ code: 'INTERNAL', message: `exec failed: ${detail}` });
        }
      },
      close: () => {
        if (!closed) {
          closed = true;
          raw.close();
        }
      },
    };
    return ok(handle);
  } catch (cause: unknown) {
    try {
      raw.close();
    } catch {
      // Ignore close errors during failure teardown.
    }
    const detail = cause instanceof Error ? cause.message : String(cause);
    return err({ code: 'INTERNAL', message: `openDb failed for ${path}: ${detail}` });
  }
}
