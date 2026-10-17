// P-194 — `stitch status` tests.
//
// The five mandated cases from the phase's "Tests Required" section, driven
// against a real temp project, a real user-config store (in a temp dir), and a
// real `node:sqlite` state db injected through `openStoreDb` (the adapter
// pattern the core suites established — vitest runs on Node, so `bun:sqlite`
// is out). The checksum case runs the REAL build → write → verify round trip;
// no seam there is stubbed.
//
//   it('renders status summary')   it('emits json')   it('shows sandbox availability')
//   it('shows checksum verify')    it('read only exit 0')   + 1 no-mutation extra

import { describe, it, expect, afterEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { err, ok, type Result } from 'neverthrow';
import {
  CHECKSUM_MANIFEST_FILENAME,
  HilQueue,
  ProvenanceAudit,
  buildChecksumManifest,
  renderChecksumFile,
  type DbLike,
  type SQLiteRow,
  type SQLiteValue,
  type StatementLike,
  type StitchError,
} from '@repo-stitcher/core';
import {
  status,
  messageOf,
  type StatusDeps,
  type StatusOptions,
  type StatusReport,
} from './status.js';
import { STITCH_CONFIG_FILE, openStore, type JsonValue } from '../config.js';

/** Where the sqlite parameter unions stay typed in this suite. */
type SqlParam = string | number | bigint | null | Uint8Array;

/**
 * A `node:sqlite`-backed `DbLike`, normalizing the two engine gaps the core
 * suites established: `get` maps to `null`, `changes` to `number`.
 */
function makeDb(path?: string): DbLike {
  const raw = new DatabaseSync(path ?? ':memory:');
  const toInput = (params: readonly SQLiteValue[]): SqlParam[] =>
    params.map(param => (typeof param === 'boolean' ? (param ? 1 : 0) : param));
  const wrap = (statement: ReturnType<DatabaseSync['prepare']>): StatementLike => ({
    all: (...params) => statement.all(...toInput(params)) as unknown as SQLiteRow[],
    get: (...params) => (statement.get(...toInput(params)) as unknown as SQLiteRow) ?? null,
    run: (...params) => {
      const info = statement.run(...toInput(params));
      return { changes: Number(info.changes), lastInsertRowid: Number(info.lastInsertRowid) };
    },
  });
  return {
    exec: sql => raw.exec(sql),
    query: sql => wrap(raw.prepare(sql)),
    close: () => raw.close(),
  };
}

/** The P-239 queue's table (copied verbatim from jobs/schema.ts, whose DDL is not barrel-exported). */
const PIPELINE_JOBS_DDL = `CREATE TABLE IF NOT EXISTS pipeline_jobs (
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
);`;

const AUDIT_STAMP = '2000-01-01T00:00:00.000Z';
const JOB_START_STAMP = '2000-01-01T00:00:01.000Z';

/**
 * Seed the state db with one live HIL question, one pending permission gate,
 * one finished merge audit record, and one running job — through the REAL
 * core classes, never hand-written rows (except the job insert, whose queue
 * class is barrel-internal).
 */
async function seedStateDb(path?: string): Promise<DbLike> {
  const db = makeDb(path);
  let nextHilId = 0;
  const queue = new HilQueue({ db, newId: () => `hil-${String(++nextHilId)}` });
  const question = queue.enqueue({ kind: 'question', toolName: 'pick_merge_order', payload: {} });
  const permission = queue.enqueue({
    kind: 'permission',
    toolName: 'push_to_origin',
    payload: null,
  });
  expect(question.isOk()).toBe(true);
  expect(permission.isOk()).toBe(true);

  const audit = new ProvenanceAudit({ db, now: () => AUDIT_STAMP });
  const appended = await audit.append({
    action: 'merge',
    actor: 'you',
    jobId: 'job-1',
    detail: {},
    ok: true,
  });
  expect(appended.isOk()).toBe(true);

  db.exec(PIPELINE_JOBS_DDL);
  db.exec(
    `INSERT INTO pipeline_jobs (id, kind, status, created_at, started_at) VALUES ('job-1', 'stitch', 'running', '${AUDIT_STAMP}', '${JOB_START_STAMP}')`
  );
  return db;
}

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

let tempRoots: string[] = [];
afterEach(() => {
  for (const root of tempRoots) rmSync(root, { recursive: true, force: true });
  tempRoots = [];
});

interface World {
  projectDir: string;
  storeDir: string;
  dbFile: string;
  /** The seeded state db, or `null` when the dashboard must find no db file. */
  db: DbLike | null;
}

async function makeWorld(options: { seedDb: boolean; seedStore: boolean }): Promise<World> {
  const root = mkdtempSync(join(tmpdir(), 'stitch-status-'));
  tempRoots.push(root);
  const world: World = {
    projectDir: join(root, 'project'),
    storeDir: join(root, 'home-stitch'),
    dbFile: join(root, 'store.db'),
    db: null,
  };
  mkdirSync(world.projectDir, { recursive: true });
  writeFileSync(join(world.projectDir, 'a.txt'), 'alpha');
  writeFileSync(join(world.projectDir, 'b.txt'), 'beta');
  if (options.seedDb) {
    // The pre-open gate is real: the state-db file must exist (a previous
    // pipeline run created it) before status opens it. A FILE-backed seed db
    // goes through that exact path (status will close the injected handle —
    // ownership transfers — and tests reopen the file where they count rows).
    writeFileSync(world.dbFile, '');
    world.db = await seedStateDb(world.dbFile);
  }
  if (options.seedStore) seedUserStore(world);
  return world;
}

/** Seed the user store the way P-190/P-191 write it: sources + a provider key. */
function seedUserStore(world: World): void {
  const opened = openStore(world.storeDir);
  if (opened.isErr()) throw new Error(messageOf(opened.error));
  const storedSources = opened.value.set('sources', [
    { source: 'pkg/lib', paths: ['src/**', 'README.md'], ref: 'main' },
  ] as unknown as JsonValue);
  if (storedSources.isErr()) throw new Error(messageOf(storedSources.error));
  const storedKey = opened.value.set('anthropic.apiKey', 'sk-not-printed');
  if (storedKey.isErr()) throw new Error(messageOf(storedKey.error));
}

async function runStatus(
  world: World,
  opts: Partial<StatusOptions>,
  deps: Partial<StatusDeps>
): Promise<{ lines: string[]; result: Result<void, StitchError>; json: StatusReport | null }> {
  const captured: string[] = [];
  const stateDb = world.db;
  const base: StatusDeps = {
    storeDir: world.storeDir,
    storePath: world.dbFile,
    probeSandbox: async () => true,
    write: line => void captured.push(line),
    ...(stateDb !== null
      ? { openStoreDb: async (): Promise<Result<DbLike, StitchError>> => ok(stateDb) }
      : {}),
    ...deps,
  };
  const options: StatusOptions = {
    verbose: false,
    yes: false,
    offline: false,
    color: false,
    ...(opts.configPath !== undefined ? { configPath: opts.configPath } : {}),
    ...(opts.cwd !== undefined ? { cwd: opts.cwd } : { cwd: world.projectDir }),
    ...(opts.json === true ? { json: true } : {}),
  };
  const result = await status(options, base);
  const json = opts.json === true ? (JSON.parse(captured.join('')) as StatusReport) : null;
  return { lines: captured, result, json };
}

function countRows(db: DbLike, table: string): number {
  const row = db.query(`SELECT COUNT(*) AS n FROM ${table}`).get();
  return row === null ? 0 : Number(row['n']);
}

// ---------------------------------------------------------------------------
// the five mandated cases + one no-mutation extra
// ---------------------------------------------------------------------------

describe('P-194 stitch status', () => {
  it('renders status summary', async () => {
    const world = await makeWorld({ seedDb: true, seedStore: true });
    const run = await runStatus(world, {}, {});
    expect(run.result.isOk()).toBe(true);
    expect(run.lines).toContain('stitch status');
    expect(run.lines).toContain(`project dir: ${world.projectDir}`);
    expect(run.lines).toContain('provider: anthropic');
    expect(run.lines).toContain('model: not set');
    // Substring matches: these lines carry a full path/gloss, never bare.
    expect(run.lines.some(line => line.includes('stitch.toml (not found)'))).toBe(true);
    expect(run.lines).toContain('sources: 1');
    expect(run.lines).toContain('  - pkg/lib (2 paths) @main');
    expect(run.lines).toContain('hil: 2 pending (question 1, permission 1)');
    expect(run.lines.some(line => line.startsWith('jobs: job-1 (stitch, started '))).toBe(true);
    expect(run.lines).toContain('recent activity: merge @2000-01-01T00:00:00.000Z (you)');
    expect(run.lines).toContain('sandbox: docker available');
    expect(run.lines.some(line => line.includes('checksums: no manifest'))).toBe(true);
  });

  it('emits json', async () => {
    const world = await makeWorld({ seedDb: true, seedStore: true });
    const run = await runStatus(world, { json: true }, {});
    expect(run.result.isOk()).toBe(true);
    const report = run.json;
    expect(report).not.toBeNull();
    expect(report?.config.providers).toEqual(['anthropic']);
    expect(report?.config.model).toBeNull();
    expect(report?.config.projectDir).toBe(world.projectDir);
    expect(report?.config.stateDbPresent).toBe(true);
    expect(report?.config.storePresent).toBe(true);
    expect(report?.sources).toEqual([{ source: 'pkg/lib', paths: 2, ref: 'main' }]);
    expect(report?.hil?.total).toBe(2);
    expect(report?.hil?.pending).toEqual({ component: 0, question: 1, permission: 1 });
    expect(report?.jobs?.running).toEqual([
      { id: 'job-1', kind: 'stitch', startedAt: JOB_START_STAMP },
    ]);
    expect(report?.jobs?.recent).toEqual([
      { ts: AUDIT_STAMP, action: 'merge', actor: 'you', jobId: 'job-1', ok: true },
    ]);
    expect(report?.sandbox).toEqual({ docker: 'available', ghFallback: false });
    expect(report?.checksums).toEqual({ state: 'no-manifest' });
  });

  it('shows sandbox availability', async () => {
    const world = await makeWorld({ seedDb: false, seedStore: false });
    const up = await runStatus(world, {}, {});
    expect(up.lines).toContain('sandbox: docker available');
    const down = await runStatus(world, {}, { probeSandbox: async () => false });
    // Config defaults have no `[ci]` section and no GitHub credential, so the
    // core selector (fallbackSelection) reports the GH path unusable here.
    expect(down.lines).toContain('sandbox: docker unavailable (gh-fallback disabled)');
  });

  it('shows checksum verify', async () => {
    const world = await makeWorld({ seedDb: false, seedStore: false });
    const built = await buildChecksumManifest(world.projectDir);
    const manifest = built.match(
      value => value,
      error => {
        throw new Error(messageOf(error));
      }
    );
    writeFileSync(
      join(world.projectDir, CHECKSUM_MANIFEST_FILENAME),
      renderChecksumFile(manifest.entries)
    );

    const clean = await runStatus(world, {}, {});
    expect(clean.lines).toContain('checksums: verified');
    const cleanJson = await runStatus(world, { json: true }, {});
    expect(cleanJson.json?.checksums).toEqual({ state: 'verified' });

    // A real drift: change one recorded file, expect it (alone) named.
    writeFileSync(join(world.projectDir, 'a.txt'), 'alpha has drifted');
    const drifted = await runStatus(world, {}, {});
    expect(drifted.lines).toContain('checksums: drift — a.txt');
    const driftedJson = await runStatus(world, { json: true }, {});
    expect(driftedJson.json?.checksums).toEqual({ state: 'drift', mismatches: ['a.txt'] });
  });

  it('read only exit 0', async () => {
    const world = await makeWorld({ seedDb: true, seedStore: true });
    const stateDb = world.db;
    if (stateDb === null) throw new Error('fixture seed failed');
    const beforeHil = countRows(stateDb, 'hil_requests');
    const beforeAudit = countRows(stateDb, 'provenance_audit');
    const beforeJobs = countRows(stateDb, 'pipeline_jobs');
    const storeJsonBefore = readFileSync(join(world.storeDir, STITCH_CONFIG_FILE), 'utf8');

    const run = await runStatus(world, {}, {});
    expect(run.result.isOk()).toBe(true);
    // status OWNS (and closes) the handle `openStoreDb` handed it — ownership
    // transfers with the injection — so the after-counts come from a fresh
    // handle on the same file.
    const reopened = makeDb(world.dbFile);
    expect(countRows(reopened, 'hil_requests')).toBe(beforeHil);
    expect(countRows(reopened, 'provenance_audit')).toBe(beforeAudit);
    expect(countRows(reopened, 'pipeline_jobs')).toBe(beforeJobs);
    reopened.close();
    expect(readFileSync(join(world.storeDir, STITCH_CONFIG_FILE), 'utf8')).toBe(storeJsonBefore);
  });

  it('reports zero state without touching an absent store db', async () => {
    const world = await makeWorld({ seedDb: false, seedStore: false });
    let openedDb = false;
    const run = await runStatus(
      world,
      {},
      {
        openStoreDb: async (): Promise<Result<DbLike, StitchError>> => {
          openedDb = true;
          return err({ code: 'INTERNAL', message: 'must never be opened without a state-db file' });
        },
      }
    );
    expect(run.result.isOk()).toBe(true);
    expect(openedDb).toBe(false);
    expect(existsSync(world.dbFile)).toBe(false);
    // The user config store must not be created by a status call either.
    expect(existsSync(join(world.storeDir, STITCH_CONFIG_FILE))).toBe(false);
    expect(run.lines).toContain(`store: ${join(world.storeDir, STITCH_CONFIG_FILE)} (not found)`);
    expect(run.lines).toContain(`state db: ${world.dbFile} (absent)`);
    expect(run.lines).toContain('provider: not configured');
    expect(run.lines).toContain('hil: no HIL state yet');
    expect(run.lines).toContain('jobs: no pipeline state yet');
    const zero = await runStatus(world, { json: true }, {});
    expect(zero.json?.hil).toBeNull();
    expect(zero.json?.jobs).toBeNull();
    expect(zero.json?.config.storePresent).toBe(false);
    expect(zero.json?.config.stateDbPresent).toBe(false);
  });
});
