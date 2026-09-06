// P-030 tests: migration idempotency, CRUD round-trip, WAL/concurrency,
// and prepared-statement injection safety — all against REAL SQL.
//
// vitest workers run on Node and cannot resolve `bun:sqlite`, so these
// tests drive `schema.ts` (same DDL, same `migrate()`, same helpers the
// production `openDb` uses) through a `node:sqlite`-backed `DbLike`
// adapter. `bun:sqlite`'s `Database` satisfies `DbLike` structurally
// (asserted by `db.ts`'s `const db: DbLike = raw`), so identical SQL
// runs identically in production. `openDb` itself is additionally
// verified via `bun` execution (see P-030 handoff).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDb } from '../db.js';
import { STITCH_STORE_FILENAME, defaultStorePath, stitchHomeDir } from '../db.js';
import {
  migrate,
  migrations,
  SCHEMA_VERSION,
  dbAll,
  dbGet,
  dbRun,
  type DbLike,
  type SQLiteValue,
  type SQLiteRow,
  type StatementLike,
} from '../schema.js';

/**
 * `node:sqlite`-backed `DbLike`. Normalizes the small semantic gaps
 * between engines so tests assert the single `DbLike` contract:
 * - `node:sqlite` returns `undefined` for "no row", `bun:sqlite`
 *   returns `null` → adapter maps to `null`.
 * - `node:sqlite`'s types reject `boolean` params (SQLite has no bool
 *   column type anyway) → adapter binds them as 0/1, exactly what both
 *   engines store.
 * - `changes` may come back as bigint → normalized with `Number()`.
 */
function makeAdapter(path = ':memory:'): DbLike & { raw: DatabaseSync } {
  const raw = new DatabaseSync(path);
  const toInput = (p: SQLiteValue[]): (string | number | bigint | null | Uint8Array)[] =>
    p.map(v => (typeof v === 'boolean' ? (v ? 1 : 0) : v));
  const wrap = (stmt: {
    all(
      ...p: (string | number | bigint | null | Uint8Array)[]
    ): Record<string, string | number | bigint | boolean | null | Uint8Array>[];
    get(
      ...p: (string | number | bigint | null | Uint8Array)[]
    ): Record<string, string | number | bigint | boolean | null | Uint8Array> | undefined;
    run(...p: (string | number | bigint | null | Uint8Array)[]): {
      changes: number | bigint;
      lastInsertRowid: number | bigint;
    };
  }): StatementLike => ({
    all: (...p) => stmt.all(...toInput(p)) as SQLiteRow[],
    get: (...p) => (stmt.get(...toInput(p)) as SQLiteRow | undefined) ?? null,
    run: (...p) => {
      const r = stmt.run(...toInput(p));
      return { changes: Number(r.changes), lastInsertRowid: r.lastInsertRowid };
    },
  });
  return {
    raw,
    exec: sql => raw.exec(sql),
    query: sql => wrap(raw.prepare(sql)),
    close: () => raw.close(),
  };
}

describe('P-030 schema: migration list is well-formed', () => {
  it('versions are 1-based, gapless, sorted, and match SCHEMA_VERSION', () => {
    expect(migrations.length).toBeGreaterThan(0);
    migrations.forEach((m, i) => {
      expect(m.version).toBe(i + 1);
    });
    const last = migrations[migrations.length - 1];
    expect(last?.version).toBe(SCHEMA_VERSION);
  });

  it('initial migration creates all six spec tables', () => {
    const up = migrations[0]?.up ?? '';
    for (const table of ['jobs', 'events', 'provenance', 'audit', 'baselines', 'cache']) {
      expect(up).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    }
    expect(up).toContain('schema_version');
  });
});

describe('P-030 migrate(): idempotency (spec test)', () => {
  let db: DbLike & { raw: DatabaseSync };

  beforeEach(() => {
    db = makeAdapter();
  });
  afterEach(() => {
    db.close();
  });

  it('first run applies migrations and returns SCHEMA_VERSION', () => {
    const r = migrate(db);
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      expect(r.value).toBe(SCHEMA_VERSION);
    }
  });

  it('second run applies nothing and returns the same version', () => {
    const first = migrate(db);
    const second = migrate(db);
    expect(first.isOk()).toBe(true);
    expect(second.isOk()).toBe(true);
    if (first.isOk() && second.isOk()) {
      expect(second.value).toBe(first.value);
    }
    // Exactly one row per version recorded — no duplicates.
    const rows = dbAll(db, 'SELECT version FROM schema_version ORDER BY version');
    if (rows.isErr()) throw rows.error;
    expect(rows.value.map(r => r['version'])).toEqual([1]);
  });

  it('tables survive re-migration with data intact', () => {
    if (migrate(db).isErr()) throw new Error('migrate failed');
    if (dbRun(db, "INSERT INTO jobs (id, status) VALUES ('j1', 'queued')").isErr()) {
      throw new Error('insert failed');
    }
    if (migrate(db).isErr()) throw new Error('re-migrate failed');
    const row = dbGet(db, 'SELECT id, status FROM jobs WHERE id = ?', 'j1');
    if (row.isErr()) throw row.error;
    expect(row.value).toMatchObject({ id: 'j1', status: 'queued' });
  });
});

describe('P-030 CRUD round-trip (spec test)', () => {
  let db: DbLike & { raw: DatabaseSync };

  beforeEach(() => {
    db = makeAdapter();
    const m = migrate(db);
    if (m.isErr()) throw m.error;
  });
  afterEach(() => {
    db.close();
  });

  it('insert → select → update → delete on jobs', () => {
    const ins = dbRun(
      db,
      'INSERT INTO jobs (id, status, payload) VALUES (?, ?, ?)',
      'j1',
      'queued',
      '{"a":1}'
    );
    expect(ins.isOk()).toBe(true);

    const got = dbGet(db, 'SELECT id, status, payload FROM jobs WHERE id = ?', 'j1');
    if (got.isErr()) throw got.error;
    expect(got.value).toMatchObject({ id: 'j1', status: 'queued', payload: '{"a":1}' });

    const upd = dbRun(db, 'UPDATE jobs SET status = ? WHERE id = ?', 'done', 'j1');
    if (upd.isErr()) throw upd.error;
    expect(upd.value.changes).toBe(1);

    const del = dbRun(db, 'DELETE FROM jobs WHERE id = ?', 'j1');
    if (del.isErr()) throw del.error;
    expect(del.value.changes).toBe(1);

    const gone = dbGet(db, 'SELECT id FROM jobs WHERE id = ?', 'j1');
    if (gone.isErr()) throw gone.error;
    expect(gone.value).toBeNull();
  });

  it('dbAll returns all rows; dbGet returns null for missing row', () => {
    dbRun(db, "INSERT INTO cache (key, value) VALUES ('k1', 'v1')");
    dbRun(db, "INSERT INTO cache (key, value) VALUES ('k2', 'v2')");
    const all = dbAll(db, 'SELECT key FROM cache ORDER BY key');
    if (all.isErr()) throw all.error;
    expect(all.value.map(r => r['key'])).toEqual(['k1', 'k2']);

    const missing = dbGet(db, 'SELECT key FROM cache WHERE key = ?', 'nope');
    if (missing.isErr()) throw missing.error;
    expect(missing.value).toBeNull();
  });

  it('SQL errors map to err(INTERNAL), not throws', () => {
    const bad = dbAll(db, 'SELECT * FROM no_such_table_xyz');
    expect(bad.isErr()).toBe(true);
    if (bad.isErr()) {
      expect(bad.error.code).toBe('INTERNAL');
    }
  });

  it('non-Error throws map to err with String(cause) detail', () => {
    // Deliberately throws a non-Error to exercise the `String(cause)`
    // fallback side of each catch. Justified eslint-disable: the point
    // of this test IS the non-Error throw (exotic driver behavior).
    const throwing: DbLike = {
      exec: () => {
        // eslint-disable-next-line no-throw-literal
        throw { reason: 'non-error-failure' };
      },
      query: () => {
        // eslint-disable-next-line no-throw-literal
        throw { reason: 'non-error-failure' };
      },
      close: () => undefined,
    };
    const cases: [string, () => unknown, string][] = [
      ['migrate', () => migrate(throwing), 'migration failed'],
      ['dbAll', () => dbAll(throwing, 'SELECT 1'), 'query failed'],
      ['dbGet', () => dbGet(throwing, 'SELECT 1'), 'query failed'],
      ['dbRun', () => dbRun(throwing, 'SELECT 1'), 'write failed'],
    ];
    for (const [label, fn, prefix] of cases) {
      const r = fn() as { isErr(): boolean; error?: { code?: string; message?: string } };
      expect(r.isErr(), label).toBe(true);
      if (r.isErr()) {
        expect(r.error?.code, label).toBe('INTERNAL');
        expect(r.error?.message ?? '', label).toContain(prefix);
      }
    }
  });
});

describe('P-030 WAL + concurrency (spec test)', () => {
  let dir: string;
  let a: DbLike & { raw: DatabaseSync };
  let b: DbLike & { raw: DatabaseSync };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'stitch-db-test-'));
    a = makeAdapter(join(dir, 'store.db'));
    b = makeAdapter(join(dir, 'store.db'));
    const m = migrate(a);
    if (m.isErr()) throw m.error;
  });
  afterEach(() => {
    a.close();
    b.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('WAL mode can be enabled on a file db', () => {
    a.exec('PRAGMA journal_mode = WAL;');
    const mode = dbGet(a, 'PRAGMA journal_mode');
    if (mode.isErr()) throw mode.error;
    expect(String(mode.value?.['journal_mode'] ?? '').toLowerCase()).toBe('wal');
  });

  it('a write on one connection is visible from another after commit', () => {
    dbRun(a, "INSERT INTO baselines (id, payload) VALUES ('b1', '{}')");
    const seen = dbGet(b, 'SELECT id FROM baselines WHERE id = ?', 'b1');
    if (seen.isErr()) throw seen.error;
    expect(seen.value).toMatchObject({ id: 'b1' });
  });
});

describe('P-030 prepared statements are injection-safe (spec test)', () => {
  let db: DbLike & { raw: DatabaseSync };

  beforeEach(() => {
    db = makeAdapter();
    const m = migrate(db);
    if (m.isErr()) throw m.error;
  });
  afterEach(() => {
    db.close();
  });

  it('hostile input is stored literally; tables intact', () => {
    const hostile = "x'); DROP TABLE jobs; --";
    const ins = dbRun(db, 'INSERT INTO jobs (id, status) VALUES (?, ?)', hostile, 'queued');
    expect(ins.isOk()).toBe(true);

    // Table still exists and holds exactly one row with the literal value.
    const got = dbGet(db, 'SELECT id FROM jobs WHERE id = ?', hostile);
    if (got.isErr()) throw got.error;
    expect(got.value).toMatchObject({ id: hostile });

    const count = dbGet(db, 'SELECT COUNT(*) AS n FROM jobs');
    if (count.isErr()) throw count.error;
    expect(count.value?.['n']).toBe(1);
  });
});

describe('P-030 openDb: runtime contract (dual-runtime)', () => {
  const isBun = typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined';

  it('opens :memory: under Bun, or returns typed err outside Bun (never throws)', async () => {
    const r = await openDb(':memory:');
    if (isBun) {
      expect(r.isOk()).toBe(true);
      if (r.isOk()) {
        expect(r.value.schemaVersion).toBe(SCHEMA_VERSION);
        r.value.close();
      }
    } else {
      // vitest/Node: the dynamic bun:sqlite import rejects, yielding typed err.
      expect(r.isErr()).toBe(true);
      if (r.isErr()) {
        expect(r.error.code).toBe('INTERNAL');
      }
    }
  });
});

describe('P-030 store paths', () => {
  it('STITCH_STORE_FILENAME is store.db', () => {
    expect(STITCH_STORE_FILENAME).toBe('store.db');
  });

  it('defaultStorePath lives under the stitch home dir', () => {
    expect(defaultStorePath()).toBe(join(stitchHomeDir(), 'store.db'));
    expect(stitchHomeDir().endsWith('.stitch')).toBe(true);
  });
});
