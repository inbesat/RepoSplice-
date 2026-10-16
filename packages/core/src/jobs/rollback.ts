// P-245 — Orchestration: whole-job rollback.
//
// Rollback is the safety net for `finalize`. Before a run writes C, a SNAPSHOT is
// taken: an index of every file in the out dir (relpath + sha256 + size) plus a byte
// backup of each, and the config/lockfile paths the job may touch. If the finalised
// result turns out wrong, {@link rollbackJob} puts the tree back: files that did not
// exist at snapshot time are removed, files that changed are restored from the
// backup, and config/lockfile paths are reverted from the same store.
//
// Three properties are the point:
//
//   1. IT IS BEST-EFFORT BUT NEVER DATA-LOSING BEYOND THE SNAPSHOT SCOPE. Only files
//      inside the snapshot's own root are ever touched ({@link resolveWithin} is
//      re-checked for every path, P-205 containment), and a file that is still
//      byte-identical to the snapshot is left alone.
//   2. DRIFT BLOCKS UNLESS FORCED. If a file that the snapshot recorded has since
//      been modified, a rollback would silently discard that edit — the one outcome
//      worse than a stale C. So it refuses and names the paths, unless the caller
//      passes `force`.
//   3. IT IS REVERSIBLE TO INSPECT. {@link listRollbackPlan} computes exactly what a
//      rollback WOULD do without touching anything, which is the `--dry-run` surface.
//
// Storage: the snapshot lives in its own table (`pipeline_job_snapshots`), following
// the "own your DDL on first use" pattern P-169/P-173/P-178/P-241 established rather
// than altering `jobs/schema.ts`'s `pipeline_jobs` (ADR-063).
//
// On drift reuse: no new `StitchError` code is introduced. A refusal is a
// `CONFIG_ERROR` (a bad request against the current state), matching the P-074/P-084
// precedent, so the union does not grow for a condition the caller can fix.

import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { err, ok, type Result } from 'neverthrow';
import type { AuditDraft, AuditRecord } from '../provenance/audit.js';
import { listFiles } from '../util/glob.js';
import { resolveWithin } from '../util/paths.js';
import { dbGet, dbRun, type DbLike, type SQLiteRow } from '../store/schema.js';
import type { StitchError } from '../result/index.js';
import type { Bus, BusEnvelope } from '../events/bus.js';

/** One file as recorded at snapshot time. */
export interface SnapshotEntry {
  /** Repo-relative, posix-normalised. */
  path: string;
  sha256: string;
  sizeBytes: number;
}

/** A job's pre-finalize snapshot. */
export interface JobSnapshot {
  jobId: string;
  snapshotId: string;
  /** The absolute out dir the snapshot covers — the containment root. */
  root: string;
  /** Where the byte backups live, one copy per snapshotted file. */
  backupRoot: string;
  createdAt: string;
  index: SnapshotEntry[];
  /** Config/lockfile paths (relative to `root`) the job may touch. */
  configPaths: string[];
}

/** What a rollback would do — computed without mutating anything. */
export interface RollbackPlan {
  /** Files present now that the snapshot never saw (i.e. generated). */
  removed: string[];
  /** Files the snapshot recorded that have since changed or vanished. */
  restored: string[];
  /** Config/lockfile paths that would be reverted. */
  configReverted: string[];
  /** True when drift makes this plan un-appliable without `force`. */
  blocked: boolean;
}

/** The audit entry P-245 appends (P-187). */
export interface RollbackRecord {
  jobId: string;
  snapshotId: string;
  reason: string;
  filesRemoved: string[];
  filesRestored: string[];
  ok: boolean;
}

/** The audit surface this module needs — satisfied by P-187's `ProvenanceAudit`. */
export interface RollbackAuditSink {
  append(draft: AuditDraft): Promise<Result<AuditRecord, StitchError>>;
}

/** Options for {@link rollbackJob}. */
export interface RollbackOptions {
  reason: string;
  /** Apply despite drift. The caller is deliberately discarding an edit. */
  force?: boolean;
  /** Publish `job.rolled-back` on success. */
  bus?: Bus;
  /** Append the P-187 `RollbackRecord`. */
  audit?: RollbackAuditSink;
  /** Clock, injectable so tests are deterministic. */
  now?: () => string;
}

/** Options for {@link snapshotJob}. */
export interface SnapshotOptions {
  jobId: string;
  /** The out dir to snapshot. Required and non-blank. */
  root: string;
  /** Where byte backups go. Defaults to a sibling of `root`, never inside it. */
  backupRoot?: string;
  /** Config/lockfile paths to snapshot and later revert. */
  configPaths?: readonly string[];
  now?: () => string;
}

/** This module's table. Owned on first use — see the header. */
export const JOB_SNAPSHOTS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS pipeline_job_snapshots (
  job_id TEXT PRIMARY KEY,
  snapshot_id TEXT NOT NULL,
  root TEXT NOT NULL,
  backup_root TEXT NOT NULL,
  created_at TEXT NOT NULL,
  index_json TEXT NOT NULL,
  config_paths_json TEXT NOT NULL DEFAULT '[]'
);`;

function detailOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** Create the table if it is not there yet. Idempotent. */
function ensureTable(db: DbLike): Result<void, StitchError> {
  try {
    db.exec(JOB_SNAPSHOTS_TABLE_SQL);
    return ok(undefined);
  } catch (cause: unknown) {
    return err({
      code: 'INTERNAL',
      message: `rollback: cannot create snapshot table: ${detailOf(cause)}`,
    });
  }
}

/** Posix, root-relative. */
function relOf(root: string, absolute: string): string {
  return relative(root, absolute).split(sep).join('/');
}

/**
 * Index a directory: relpath + sha256 + size for every file.
 *
 * Reuses P-034's `listFiles` so the walk matches every other traversal in the repo,
 * and hashes each file in place rather than building a second checksum manifest —
 * this index is stored in SQLite, not rendered as `sha256sum` lines.
 */
export async function snapshotPathIndex(
  root: string
): Promise<Result<SnapshotEntry[], StitchError>> {
  if (root.trim() === '') {
    return err({
      code: 'CONFIG_ERROR',
      field: 'root',
      message: 'snapshotPathIndex: root is required',
    });
  }
  const walked = await listFiles(root, ['**/*'], { dot: true });
  if (walked.isErr()) return err(walked.error);
  const entries: SnapshotEntry[] = [];
  for (const absolute of walked.value) {
    try {
      const bytes = await readFile(absolute);
      entries.push({
        path: relOf(root, absolute),
        sha256: createHash('sha256').update(bytes).digest('hex'),
        sizeBytes: bytes.length,
      });
    } catch (cause: unknown) {
      return err({
        code: 'INTERNAL',
        message: `snapshotPathIndex: cannot hash ${absolute}: ${detailOf(cause)}`,
      });
    }
  }
  entries.sort((a, b) => a.path.localeCompare(b.path));
  return ok(entries);
}

/**
 * Record a job's pre-finalize snapshot: index, byte backups, and the row.
 *
 * The backups are taken HERE rather than at rollback time, because after `finalize`
 * has run the originals are gone — that is the whole reason a rollback can restore
 * anything at all.
 */
export async function snapshotJob(
  db: DbLike,
  opts: SnapshotOptions
): Promise<Result<JobSnapshot, StitchError>> {
  if (opts.root.trim() === '') {
    return err({ code: 'CONFIG_ERROR', field: 'root', message: 'snapshotJob: root is required' });
  }
  const table = ensureTable(db);
  if (table.isErr()) return err(table.error);

  const indexed = await snapshotPathIndex(opts.root);
  if (indexed.isErr()) return err(indexed.error);

  const createdAt = (opts.now ?? (() => new Date().toISOString()))();
  // Never inside `root`: a backup dir under the out dir would itself be indexed and
  // then deleted by the very rollback that needs it.
  const backupRoot = opts.backupRoot ?? join(opts.root, '..', '.stitch-backups');
  const backupDir = join(backupRoot, opts.jobId);
  const snapshotId = `${opts.jobId}-${createdAt}`;

  for (const entry of indexed.value) {
    const from = join(opts.root, entry.path);
    const to = join(backupDir, entry.path);
    try {
      await mkdir(dirname(to), { recursive: true });
      await cp(from, to);
    } catch (cause: unknown) {
      return err({
        code: 'INTERNAL',
        message: `snapshotJob: cannot back up ${entry.path}: ${detailOf(cause)}`,
      });
    }
  }

  const written = dbRun(
    db,
    `INSERT OR REPLACE INTO pipeline_job_snapshots
       (job_id, snapshot_id, root, backup_root, created_at, index_json, config_paths_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    opts.jobId,
    snapshotId,
    opts.root,
    backupRoot,
    createdAt,
    JSON.stringify(indexed.value),
    JSON.stringify([...(opts.configPaths ?? [])])
  );
  if (written.isErr()) return err(written.error);

  return ok({
    jobId: opts.jobId,
    snapshotId,
    root: opts.root,
    backupRoot,
    createdAt,
    index: indexed.value,
    configPaths: [...(opts.configPaths ?? [])],
  });
}

function isEntry(value: unknown): value is SnapshotEntry {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.path === 'string' &&
    typeof record.sha256 === 'string' &&
    typeof record.sizeBytes === 'number'
  );
}

/** Read a stored snapshot back, or `undefined` when the job has none. */
export function loadSnapshot(
  db: DbLike,
  jobId: string
): Result<JobSnapshot | undefined, StitchError> {
  const table = ensureTable(db);
  if (table.isErr()) return err(table.error);

  const row: Result<SQLiteRow | null, StitchError> = dbGet(
    db,
    'SELECT * FROM pipeline_job_snapshots WHERE job_id = ?',
    jobId
  );
  if (row.isErr()) return err(row.error);
  const found = row.value;
  if (found === null) return ok(undefined);

  const snapshotId = found['snapshot_id'];
  const root = found['root'];
  const backupRoot = found['backup_root'];
  const createdAt = found['created_at'];
  const indexJson = found['index_json'];
  const configJson = found['config_paths_json'];
  if (
    typeof snapshotId !== 'string' ||
    typeof root !== 'string' ||
    typeof backupRoot !== 'string' ||
    typeof createdAt !== 'string' ||
    typeof indexJson !== 'string' ||
    typeof configJson !== 'string'
  ) {
    return err({ code: 'INTERNAL', message: `loadSnapshot: corrupt row for job ${jobId}` });
  }

  let parsedIndex: unknown;
  let parsedConfig: unknown;
  try {
    parsedIndex = JSON.parse(indexJson);
    parsedConfig = JSON.parse(configJson);
  } catch (cause: unknown) {
    return err({
      code: 'INTERNAL',
      message: `loadSnapshot: bad JSON for job ${jobId}: ${detailOf(cause)}`,
    });
  }

  const index = Array.isArray(parsedIndex) ? parsedIndex.filter(isEntry) : [];
  const configPaths = Array.isArray(parsedConfig)
    ? parsedConfig.filter((value): value is string => typeof value === 'string')
    : [];

  return ok({ jobId, snapshotId, root, backupRoot, createdAt, index, configPaths });
}

/**
 * Compare a snapshot against what is on disk right now.
 *
 * Pure with respect to the filesystem's CONTENTS (it reads, never writes), so the
 * dry-run surface and the real rollback share exactly one definition of "what would
 * happen" — a divergence between the preview and the action would be the worst kind
 * of bug in a safety net.
 */
export async function planRollback(
  snapshot: JobSnapshot
): Promise<Result<RollbackPlan, StitchError>> {
  const current = await snapshotPathIndex(snapshot.root);
  if (current.isErr()) return err(current.error);

  const known = new Map(snapshot.index.map(entry => [entry.path, entry.sha256]));
  const removed = current.value.filter(entry => !known.has(entry.path)).map(entry => entry.path);

  const live = new Map(current.value.map(entry => [entry.path, entry.sha256]));
  const restored = snapshot.index
    .filter(entry => live.get(entry.path) !== entry.sha256)
    .map(entry => entry.path);

  // A config path is only reverted when it actually differs from the snapshot.
  const configReverted = snapshot.configPaths.filter(path => {
    const recorded = known.get(path);
    const now = live.get(path);
    return recorded !== undefined && recorded !== now;
  });

  return ok({
    removed: [...removed].sort(),
    restored: [...restored].sort(),
    configReverted: [...configReverted].sort(),
    blocked: restored.length > 0,
  });
}

/** A single relpath resolved inside a root, or a refusal. */
function contained(root: string, relPath: string): Result<string, StitchError> {
  const resolved = resolveWithin(root, relPath);
  if (resolved.isErr()) {
    return err({
      code: 'CONFIG_ERROR',
      field: 'path',
      message: `rollback: refusing to touch ${relPath} — outside the snapshot root`,
    });
  }
  return ok(resolved.value);
}

/** `rollback --dry-run`: what would be removed/restored, mutating nothing. */
export async function listRollbackPlan(
  db: DbLike,
  jobId: string
): Promise<Result<RollbackPlan | undefined, StitchError>> {
  const snapshot = loadSnapshot(db, jobId);
  if (snapshot.isErr()) return err(snapshot.error);
  if (snapshot.value === undefined) return ok(undefined);
  const plan = await planRollback(snapshot.value);
  if (plan.isErr()) return err(plan.error);
  return ok(plan.value);
}

/**
 * Undo a job: remove what it generated, restore what it changed, and record it.
 *
 * Refuses on drift unless `force` — see the module header, point 2. Every path is
 * re-checked for containment before it is touched, so a snapshot whose root was
 * tampered with cannot be used to delete something elsewhere.
 */
export async function rollbackJob(
  db: DbLike,
  jobId: string,
  opts: RollbackOptions
): Promise<Result<RollbackRecord, StitchError>> {
  const snapshot = loadSnapshot(db, jobId);
  if (snapshot.isErr()) return err(snapshot.error);
  const snap = snapshot.value;
  if (snap === undefined) {
    return err({
      code: 'CONFIG_ERROR',
      field: 'jobId',
      message: `rollbackJob: no snapshot recorded for job ${jobId}`,
    });
  }

  const plan = await planRollback(snap);
  if (plan.isErr()) return err(plan.error);
  const { removed, restored, configReverted } = plan.value;

  if (removed.length + restored.length + configReverted.length === 0) {
    return err({
      code: 'CONFIG_ERROR',
      field: 'jobId',
      message: `rollbackJob: job ${jobId} is already at its snapshot — nothing to undo`,
    });
  }

  if (plan.value.blocked && opts.force !== true) {
    return err({
      code: 'CONFIG_ERROR',
      field: 'force',
      message: `rollbackJob: ${restored.length} file(s) changed since the snapshot (${restored
        .slice(0, 5)
        .join(', ')}); re-run with force to discard them`,
    });
  }

  const filesRestored: string[] = [];
  for (const relPath of [...new Set([...restored, ...configReverted])]) {
    const backup = contained(join(snap.backupRoot, snap.jobId), relPath);
    if (backup.isErr()) return err(backup.error);
    const target = contained(snap.root, relPath);
    if (target.isErr()) return err(target.error);
    try {
      const bytes = await readFile(backup.value);
      await mkdir(dirname(target.value), { recursive: true });
      await writeFile(target.value, bytes);
      filesRestored.push(relPath);
    } catch (cause: unknown) {
      return err({
        code: 'INTERNAL',
        message: `rollbackJob: cannot restore ${relPath}: ${detailOf(cause)}`,
      });
    }
  }

  const filesRemoved: string[] = [];
  for (const relPath of removed) {
    const target = contained(snap.root, relPath);
    if (target.isErr()) return err(target.error);
    try {
      await unlink(target.value);
      filesRemoved.push(relPath);
    } catch (cause: unknown) {
      return err({
        code: 'INTERNAL',
        message: `rollbackJob: cannot remove ${relPath}: ${detailOf(cause)}`,
      });
    }
  }

  const at = (opts.now ?? (() => new Date().toISOString()))();
  const moved = dbRun(
    db,
    "UPDATE pipeline_jobs SET status = 'rolled_back', finished_at = ? WHERE id = ?",
    at,
    jobId
  );
  if (moved.isErr()) return err(moved.error);

  const record: RollbackRecord = {
    jobId,
    snapshotId: snap.snapshotId,
    reason: opts.reason,
    filesRemoved: [...filesRemoved].sort(),
    filesRestored: [...filesRestored].sort(),
    ok: true,
  };

  if (opts.audit !== undefined) {
    const appended = await opts.audit.append({
      action: 'rollback',
      actor: 'system',
      jobId,
      detail: {
        snapshotId: record.snapshotId,
        reason: record.reason,
        filesRemoved: record.filesRemoved,
        filesRestored: record.filesRestored,
      },
      ok: true,
    });
    if (appended.isErr()) return err(appended.error);
  }

  if (opts.bus !== undefined) emitRolledBack(opts.bus, record);

  return ok(record);
}

/** Publish `job.rolled-back` for a completed rollback (P-241's shape). */
export function emitRolledBack(bus: Bus, record: RollbackRecord): BusEnvelope<'job.rolled-back'> {
  return bus.publish('job.rolled-back', {
    jobId: record.jobId,
    snapshotId: record.snapshotId,
    reason: record.reason,
    filesRemoved: record.filesRemoved.length,
    filesRestored: record.filesRestored.length,
  });
}
