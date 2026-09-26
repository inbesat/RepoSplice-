// Minimal local SQLite helper for the AI audit log (P-145).
//
// P-030 already ships the full store (`store/db.ts` + `store/schema.ts`).
// P-230 owns the production job database; until then this phase only needs a
// handle for the `ai_calls` table, so this is the "minimal local one" the
// phase plan allows — deliberately thin, and shaped so P-230 can absorb it
// without touching callers.
//
// The P-030 rules still hold:
//   - `bun:sqlite` is loaded by DYNAMIC import. vitest workers run on Node and
//     cannot resolve `bun:sqlite` statically, so a static import here would
//     break every test file that imports the core barrel. Outside the Bun
//     runtime the import rejects and this returns a typed err instead of
//     throwing.
//   - No SQL lives in this file. Statements belong to the engine-free modules
//     that operate on the structural `DbLike`, so they stay test-covered under
//     vitest through a `node:sqlite`-backed adapter.

import type { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { ok, err, type Result } from 'neverthrow';
import { type StitchError } from '../result/index.js';
import type { DbLike } from '../store/schema.js';

/** Default database filename (P-145 spec: `stitch.db`). */
export const STITCH_DB_FILENAME = 'stitch.db';

/** An opened database. Satisfies `DbLike`, so the shared SQL helpers apply. */
export interface SqliteHandle extends DbLike {
  /** Absolute path, or `:memory:`. */
  readonly path: string;
  /** Close the handle. Safe to call twice (second is a no-op). */
  close(): void;
}

export interface OpenSqliteOptions {
  readonly?: boolean;
}

/**
 * Open (creating parent directories for non-`:memory:` paths) a SQLite
 * database and hand back a handle.
 *
 * Async because the engine arrives via dynamic import. WAL is enabled for
 * file-backed, writable handles so audit writes never block a reader (P-249);
 * `:memory:` and `readonly` opens skip it.
 *
 * @param path - Database file path, or `:memory:`
 * @returns Result with the handle, or INTERNAL when the engine is unavailable
 *   or the file cannot be opened
 */
export async function openSqlite(
  path: string,
  options: OpenSqliteOptions = {}
): Promise<Result<SqliteHandle, StitchError>> {
  if (path.trim().length === 0) {
    return err({ code: 'CONFIG_ERROR', field: 'path', message: 'database path must be non-empty' });
  }

  const readonly = options.readonly === true;
  let DatabaseCtor: new (path: string, options?: { readonly?: boolean }) => Database;
  try {
    ({ Database: DatabaseCtor } = await import('bun:sqlite'));
  } catch (cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    return err({ code: 'INTERNAL', message: `openSqlite needs the Bun runtime: ${detail}` });
  }

  let raw: Database;
  try {
    if (path !== ':memory:') {
      mkdirSync(dirname(path), { recursive: true });
    }
    raw = readonly ? new DatabaseCtor(path, { readonly: true }) : new DatabaseCtor(path);
  } catch (cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    return err({ code: 'INTERNAL', message: `openSqlite failed for ${path}: ${detail}` });
  }

  try {
    if (path !== ':memory:' && !readonly) {
      raw.exec('PRAGMA journal_mode = WAL;');
    }
  } catch {
    // WAL is an optimization; a filesystem that refuses it must not fail the open.
  }

  let closed = false;
  const handle: SqliteHandle = {
    path,
    exec: sql => raw.exec(sql),
    query: sql => raw.query(sql),
    close: () => {
      if (closed) return;
      closed = true;
      raw.close();
    },
  };
  return ok(handle);
}
