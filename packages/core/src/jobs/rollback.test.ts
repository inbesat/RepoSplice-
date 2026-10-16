// P-245 — whole-job rollback tests, against REAL temp dirs and REAL temp SQLite.
//
// A rollback is a claim about the FILESYSTEM's before-and-after, so these tests use
// real files rather than a fake fs, and real SQLite rather than an array: "the row
// says rolled_back" is a claim about what the database holds. The drift case is the
// important one — a rollback that silently discarded a human's edit would be worse
// than the stale C it was undoing — so it is asserted in both directions.
//
// The six required scenarios from the phase spec:
//
//   it('snapshot restores')  it('removes generated')  it('reverts config')
//   it('drift blocks force ok')  it('dry run list')  it('audit record')

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ok, type Result } from 'neverthrow';
import { Bus } from '../events/bus.js';
import type { AuditDraft, AuditRecord } from '../provenance/audit.js';
import type { StitchError } from '../result/index.js';
import { makeDbAdapter } from '../sandbox/__tests__/fake-docker.js';
import { dbAll, type DbLike } from '../store/schema.js';
import { PIPELINE_JOBS_TABLE_SQL } from './schema.js';
import { listRollbackPlan, rollbackJob, snapshotJob, type RollbackAuditSink } from './rollback.js';

const T1 = '2026-10-17T00:00:00.000Z';

let db: DbLike;
let root: string;
let backupRoot: string;

/** Seed the `pipeline_jobs` row the rollback flips to `rolled_back`. */
function seedJob(id: string, status = 'succeeded'): void {
  db.exec(
    `INSERT OR REPLACE INTO pipeline_jobs (id, kind, status, created_at)
     VALUES ('${id}', 'stitch', '${status}', '${T1}')`
  );
}

/** The stored status of a job, for the assertions that care about the row. */
function storedStatus(id: string): string | undefined {
  const rows = dbAll(db, 'SELECT status FROM pipeline_jobs WHERE id = ?', id);
  if (rows.isErr()) return undefined;
  const value = rows.value[0]?.['status'];
  return typeof value === 'string' ? value : undefined;
}

beforeEach(async () => {
  db = makeDbAdapter();
  db.exec(PIPELINE_JOBS_TABLE_SQL);
  root = await mkdtemp(join(tmpdir(), 'stitch-rollback-'));
  // Deliberately OUTSIDE the snapshot root: backups kept inside the out dir would
  // be indexed by the snapshot and then deleted by the rollback that needs them.
  backupRoot = await mkdtemp(join(tmpdir(), 'stitch-rollback-backups-'));
});

afterEach(async () => {
  db.close();
  await rm(root, { recursive: true, force: true });
  await rm(backupRoot, { recursive: true, force: true });
});

describe('P-245 rollback', () => {
  it('snapshot restores', async () => {
    seedJob('j1');
    await writeFile(join(root, 'src.ts'), 'export const a = 1;\n');
    const snap = await snapshotJob(db, { jobId: 'j1', root, backupRoot });
    expect(snap.isOk()).toBe(true);

    // The run "wrote C" by mutating a pre-existing file.
    await writeFile(join(root, 'src.ts'), 'export const a = 999;\n');

    const rolled = await rollbackJob(db, 'j1', { reason: 'bad merge', force: true });
    expect(rolled.isOk()).toBe(true);
    if (rolled.isErr()) return;

    expect(await readFile(join(root, 'src.ts'), 'utf8')).toBe('export const a = 1;\n');
    expect(rolled.value.filesRestored).toEqual(['src.ts']);
    expect(storedStatus('j1')).toBe('rolled_back');
  });

  it('removes generated', async () => {
    seedJob('j1');
    await writeFile(join(root, 'keep.ts'), 'kept\n');
    await snapshotJob(db, { jobId: 'j1', root, backupRoot });

    // Nothing in the snapshot: files created afterwards are what the run generated.
    await writeFile(join(root, 'generated.ts'), 'new\n');
    await mkdir(join(root, 'packet'), { recursive: true });
    await writeFile(join(root, 'packet', 'deep.ts'), 'deep\n');

    const rolled = await rollbackJob(db, 'j1', { reason: 'wrong files' });
    expect(rolled.isOk()).toBe(true);
    if (rolled.isErr()) return;

    expect(rolled.value.filesRemoved).toEqual(['generated.ts', 'packet/deep.ts']);
    expect(rolled.value.filesRestored).toEqual([]);
    // The pre-existing file is untouched — removal is scoped to what was added.
    expect(await readFile(join(root, 'keep.ts'), 'utf8')).toBe('kept\n');
  });

  it('reverts config', async () => {
    seedJob('j1');
    await writeFile(join(root, 'LICENSE'), 'MIT (original)\n');
    await writeFile(join(root, 'package.json'), '{ "name": "a" }\n');
    await snapshotJob(db, {
      jobId: 'j1',
      root,
      backupRoot,
      configPaths: ['LICENSE', 'package.json'],
    });

    // The run rewrote the licence and left the manifest alone.
    await writeFile(join(root, 'LICENSE'), 'GPL-3.0 (generated)\n');

    const rolled = await rollbackJob(db, 'j1', { reason: 'licence mis-generated', force: true });
    expect(rolled.isOk()).toBe(true);
    if (rolled.isErr()) return;

    expect(await readFile(join(root, 'LICENSE'), 'utf8')).toBe('MIT (original)\n');
    expect(rolled.value.filesRestored).toContain('LICENSE');
    // The untouched config path is not reported as reverted.
    expect(rolled.value.filesRestored).not.toContain('package.json');
  });

  it('drift blocks force ok', async () => {
    seedJob('j1');
    await writeFile(join(root, 'src.ts'), 'original\n');
    await snapshotJob(db, { jobId: 'j1', root, backupRoot });

    // A human edited a file the snapshot recorded — drift.
    await writeFile(join(root, 'src.ts'), 'human edit\n');

    const blocked = await rollbackJob(db, 'j1', { reason: 'undo' });
    expect(blocked.isErr()).toBe(true);
    if (blocked.isErr()) {
      expect(blocked.error.code).toBe('CONFIG_ERROR');
    }
    // Refused means untouched.
    expect(await readFile(join(root, 'src.ts'), 'utf8')).toBe('human edit\n');

    const forced = await rollbackJob(db, 'j1', { reason: 'undo', force: true });
    expect(forced.isOk()).toBe(true);
    expect(await readFile(join(root, 'src.ts'), 'utf8')).toBe('original\n');
  });

  it('dry run list', async () => {
    seedJob('j1');
    await writeFile(join(root, 'keep.ts'), 'kept\n');
    await snapshotJob(db, { jobId: 'j1', root, backupRoot });
    await writeFile(join(root, 'generated.ts'), 'new\n');

    const plan = await listRollbackPlan(db, 'j1');
    expect(plan.isOk()).toBe(true);
    if (plan.isErr()) return;

    expect(plan.value?.removed).toEqual(['generated.ts']);
    expect(plan.value?.restored).toEqual([]);
    expect(plan.value?.blocked).toBe(false);

    // Inspecting mutated NOTHING.
    expect(await readFile(join(root, 'generated.ts'), 'utf8')).toBe('new\n');
    expect(storedStatus('j1')).toBe('succeeded');

    // A job with no snapshot has no plan rather than an error.
    const none = await listRollbackPlan(db, 'never-ran');
    expect(none.isOk() && none.value).toBeUndefined();
  });

  it('audit record', async () => {
    seedJob('j1');
    await writeFile(join(root, 'keep.ts'), 'kept\n');
    await snapshotJob(db, { jobId: 'j1', root, backupRoot });
    await writeFile(join(root, 'generated.ts'), 'new\n');

    const appended: AuditDraft[] = [];
    const audit: RollbackAuditSink = {
      append: async (draft: AuditDraft): Promise<Result<AuditRecord, StitchError>> => {
        appended.push(draft);
        return ok({ ...draft, id: `audit-${appended.length}`, ts: T1 });
      },
    };
    const bus = new Bus({ now: () => T1 });
    let emitted: { jobId: string; filesRemoved: number; filesRestored: number } | undefined;
    bus.subscribe('job.rolled-back', payload => {
      emitted = payload;
    });

    const rolled = await rollbackJob(db, 'j1', { reason: 'CI caught a bad C', audit, bus });
    expect(rolled.isOk()).toBe(true);

    // The P-187 record, with the counts the acceptance criterion names.
    expect(appended).toHaveLength(1);
    expect(appended[0]?.action).toBe('rollback');
    expect(appended[0]?.jobId).toBe('j1');
    expect(appended[0]?.detail).toMatchObject({
      reason: 'CI caught a bad C',
      filesRemoved: ['generated.ts'],
    });

    // The P-241 event, so web/CLI see the rollback without polling.
    expect(emitted?.jobId).toBe('j1');
    expect(emitted?.filesRemoved).toBe(1);
    expect(storedStatus('j1')).toBe('rolled_back');

    // A second rollback has nothing to do and says so rather than silently passing.
    const again = await rollbackJob(db, 'j1', { reason: 'again' });
    expect(again.isErr()).toBe(true);
    if (again.isErr()) expect(again.error.code).toBe('CONFIG_ERROR');
  });
});
