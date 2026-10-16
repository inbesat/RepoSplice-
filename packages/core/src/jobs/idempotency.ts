// P-250 — Orchestration: idempotency.
//
// A re-run must not duplicate work or drift. Three mechanisms, one idea — identify the
// work by its INPUTS so repeating it with the same inputs is recognisably the same job:
//
//   1. A CONTENT-ADDRESSED STAGE CACHE. The key is `sha256(canonical({stage,
//      configHash, inputs}))`, where `inputs` is every hash the stage declared it
//      depends on. Re-running a stage whose inputs are unchanged reuses the stored
//      result; changing ANY declared input produces a different key, so a stale hit is
//      impossible by construction rather than by luck. The handoff is explicit that
//      this is the whole risk: "include every input that matters or you'll silently
//      serve stale results".
//   2. ONLY PURE, VERIFIABLE STAGES ARE CACHED. `deps`, `licenses`, `provenance` and
//      the sandbox VERDICT are functions of their inputs. AI generation is not (it is
//      gated, P-146, and non-deterministic) and fs writes are not (their effect IS the
//      work), so {@link putCache} refuses them rather than trusting the caller.
//   3. A JOB SIGNATURE MAKES DOUBLE-SUBMIT VISIBLE. Enqueueing the same kind + config
//      hash + sources while an identical job is still queued or running returns the
//      existing id instead of starting a second merge.
//
// Plus the two "already done" checks the phase asks for: `finalizeNoOp` (C is already
// the checksummed result, so re-writing is a no-op) and LRU eviction so the store
// cannot grow forever.
//
// No-throw: every entry point returns `Result<_, StitchError>`. A bad cache row is
// `INTERNAL`; an uncacheable stage is `CONFIG_ERROR`; a corrupt key is `CONFIG_ERROR`.

import { createHash } from 'node:crypto';
import { err, ok, type Result } from 'neverthrow';
import { verifyChecksums, type ChecksumManifest } from '../provenance/checksums.js';
import { dbAll, dbGet, dbRun, type DbLike, type SQLiteRow } from '../store/schema.js';
import type { StitchError } from '../result/index.js';

/** The stages whose result is a pure function of their declared inputs. */
export const CACHEABLE_STAGES = ['deps', 'licenses', 'provenance', 'sandbox'] as const;
export type CacheableStage = (typeof CACHEABLE_STAGES)[number];

/**
 * May this stage's result be reused?
 *
 * Deliberately a positive list rather than a negative one: a stage added later is
 * uncacheable until someone proves it is pure, so the default fails safe.
 */
export function isCacheable(stage: string): stage is CacheableStage {
  return (CACHEABLE_STAGES as readonly string[]).includes(stage);
}

/** The inputs a stage declared, as `name → hash`. */
export type StageInputs = Record<string, string>;

/** What the cache key is computed over. */
export interface CacheKeyParts {
  stage: string;
  /** P-243's `configHash` — a change in config must miss the cache. */
  configHash: string;
  inputs: StageInputs;
}

/** JSON with object keys sorted, so equal inputs always hash identically. */
function canonicalJson(value: unknown): string {
  if (typeof value !== 'object' || value === null) return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, child]) => child !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

/**
 * The content address of one stage result.
 *
 * Sorted-key JSON, so two callers that build the same inputs in a different order get
 * the same key — otherwise the cache would miss on nothing.
 */
export function cacheKey(parts: CacheKeyParts): string {
  return createHash('sha256')
    .update(
      canonicalJson({ stage: parts.stage, configHash: parts.configHash, inputs: parts.inputs }),
      'utf8'
    )
    .digest('hex');
}

/** One cached stage result. */
export interface CacheEntry {
  key: string;
  stage: string;
  configHash: string;
  inputs: StageInputs;
  /** The stage's result, stored verbatim. */
  result: Record<string, unknown>;
  createdAt: string;
  lastAccess: string;
}

/** This module's table. Owned on first use — the repo's standing pattern. */
export const STAGE_CACHE_TABLE_SQL = `CREATE TABLE IF NOT EXISTS pipeline_stage_cache (
  key TEXT PRIMARY KEY,
  stage TEXT NOT NULL,
  config_hash TEXT NOT NULL,
  inputs_json TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_access TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pipeline_stage_cache_access ON pipeline_stage_cache (last_access);`;

function detailOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function ensureTable(db: DbLike): Result<void, StitchError> {
  try {
    db.exec(STAGE_CACHE_TABLE_SQL);
    return ok(undefined);
  } catch (cause: unknown) {
    return err({
      code: 'INTERNAL',
      message: `idempotency: cannot create cache table: ${detailOf(cause)}`,
    });
  }
}

function isStringMap(value: unknown): value is StageInputs {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return Object.values(value as Record<string, unknown>).every(v => typeof v === 'string');
}

/** Read a row back, or `undefined` when it is not usable. */
function toEntry(row: SQLiteRow): CacheEntry | undefined {
  const key = row['key'];
  const stage = row['stage'];
  const configHash = row['config_hash'];
  const inputsJson = row['inputs_json'];
  const resultJson = row['result_json'];
  const createdAt = row['created_at'];
  const lastAccess = row['last_access'];
  if (
    typeof key !== 'string' ||
    typeof stage !== 'string' ||
    typeof configHash !== 'string' ||
    typeof inputsJson !== 'string' ||
    typeof resultJson !== 'string' ||
    typeof createdAt !== 'string' ||
    typeof lastAccess !== 'string'
  ) {
    return undefined;
  }
  let inputs: unknown;
  let result: unknown;
  try {
    inputs = JSON.parse(inputsJson);
    result = JSON.parse(resultJson);
  } catch {
    return undefined;
  }
  if (!isStringMap(inputs)) return undefined;
  if (typeof result !== 'object' || result === null || Array.isArray(result)) return undefined;
  return {
    key,
    stage,
    configHash,
    inputs,
    result: result as Record<string, unknown>,
    createdAt,
    lastAccess,
  };
}

/** Store a stage result. Refuses a stage that is not provably pure. */
export function putCache(
  db: DbLike,
  entry: Omit<CacheEntry, 'createdAt' | 'lastAccess'>,
  opts: { now?: () => string } = {}
): Result<void, StitchError> {
  if (!isCacheable(entry.stage)) {
    return err({
      code: 'CONFIG_ERROR',
      field: 'stage',
      message: `idempotency: refusing to cache stage "${entry.stage}" — only pure stages are cacheable`,
    });
  }
  const table = ensureTable(db);
  if (table.isErr()) return err(table.error);
  const at = (opts.now ?? (() => new Date().toISOString()))();
  const written = dbRun(
    db,
    `INSERT OR REPLACE INTO pipeline_stage_cache
       (key, stage, config_hash, inputs_json, result_json, created_at, last_access)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    entry.key,
    entry.stage,
    entry.configHash,
    JSON.stringify(entry.inputs),
    JSON.stringify(entry.result),
    at,
    at
  );
  if (written.isErr()) return err(written.error);
  return ok(undefined);
}

/**
 * Read a cached result, verifying the inputs still match.
 *
 * The key already encodes the inputs, so a mismatch here means the CALLER is asking
 * for a key it did not build from these inputs — a wiring bug. It returns `undefined`
 * rather than the row, because serving a result whose inputs differ is exactly the
 * silent staleness this module exists to prevent.
 *
 * A hit touches `last_access`, which is what makes eviction LRU rather than FIFO.
 */
export function getCache(
  db: DbLike,
  key: string,
  expected?: StageInputs,
  opts: { now?: () => string } = {}
): Result<CacheEntry | undefined, StitchError> {
  const table = ensureTable(db);
  if (table.isErr()) return err(table.error);
  const row = dbGet(db, 'SELECT * FROM pipeline_stage_cache WHERE key = ?', key);
  if (row.isErr()) return err(row.error);
  if (row.value === null) return ok(undefined);
  const entry = toEntry(row.value);
  if (entry === undefined) return ok(undefined);

  if (expected !== undefined) {
    const wanted = canonicalJson(expected);
    if (canonicalJson(entry.inputs) !== wanted) return ok(undefined);
  }

  const at = (opts.now ?? (() => new Date().toISOString()))();
  const touched = dbRun(
    db,
    'UPDATE pipeline_stage_cache SET last_access = ? WHERE key = ?',
    at,
    key
  );
  if (touched.isErr()) return err(touched.error);
  return ok({ ...entry, lastAccess: at });
}

/** Is there a usable entry for this key? */
export function hasCache(db: DbLike, key: string): Result<boolean, StitchError> {
  const found = getCache(db, key);
  if (found.isErr()) return err(found.error);
  return ok(found.value !== undefined);
}

/**
 * Keep only the `limit` most-recently-used entries.
 *
 * Returns how many were dropped. Called by a caller that owns the policy (and skipped
 * entirely by `--no-cache`), so this module never decides on its own to discard data.
 */
export function evictLru(db: DbLike, limit: number): Result<number, StitchError> {
  const table = ensureTable(db);
  if (table.isErr()) return err(table.error);
  const keep = Math.max(0, Math.floor(limit));
  const doomed = dbAll(
    db,
    `SELECT key FROM pipeline_stage_cache
      ORDER BY last_access DESC
      LIMIT -1 OFFSET ?`,
    keep
  );
  if (doomed.isErr()) return err(doomed.error);
  let removed = 0;
  for (const row of doomed.value) {
    const key = row['key'];
    if (typeof key !== 'string') continue;
    const dropped = dbRun(db, 'DELETE FROM pipeline_stage_cache WHERE key = ?', key);
    if (dropped.isErr()) return err(dropped.error);
    removed += 1;
  }
  return ok(removed);
}

/** The identity of a submitted job. */
export interface JobSignature {
  kind: string;
  /** P-243's `configHash`. */
  configHash: string;
  /** The resolved source refs, order-insensitive. */
  sources: readonly string[];
}

/** A stable signature string for a job. */
export function jobSignature(sig: JobSignature): string {
  return createHash('sha256')
    .update(
      canonicalJson({
        kind: sig.kind,
        configHash: sig.configHash,
        sources: [...sig.sources].sort(),
      }),
      'utf8'
    )
    .digest('hex');
}

/** The statuses in which a duplicate submission is still "the same run in flight". */
const LIVE_STATUSES = ['queued', 'running', 'paused', 'cancelling'];

/**
 * Find an identical job that is still live (P-250 step 3).
 *
 * The signature is read from the row's stored context (`ctx.signature`), which is where
 * the enqueuing caller stamps it — this module does not own the queue's DDL. Only
 * `queued`/`running`/`paused`/`cancelling` jobs count: a FINISHED job is history, and
 * re-running it deliberately must not be silently redirected.
 */
export function findDuplicateJob(
  db: DbLike,
  sig: JobSignature,
  opts: { windowMs?: number; now?: () => string } = {}
): Result<{ id: string; duplicate: true } | undefined, StitchError> {
  const want = jobSignature(sig);
  // Built from the constant rather than inlined, so the SQL and the documented policy
  // cannot drift apart.
  const placeholders = LIVE_STATUSES.map(() => '?').join(', ');
  const rows = dbAll(
    db,
    `SELECT id, created_at, config_json FROM pipeline_jobs
      WHERE kind = ? AND status IN (${placeholders})`,
    sig.kind,
    ...LIVE_STATUSES
  );
  if (rows.isErr()) return err(rows.error);

  const nowMs = Date.parse((opts.now ?? (() => new Date().toISOString()))());
  const windowMs = opts.windowMs ?? Number.POSITIVE_INFINITY;

  for (const row of rows.value) {
    const id = row['id'];
    const createdAt = row['created_at'];
    const configJson = row['config_json'];
    if (typeof id !== 'string' || typeof createdAt !== 'string' || typeof configJson !== 'string') {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(configJson);
    } catch {
      continue;
    }
    if (typeof parsed !== 'object' || parsed === null) continue;
    const signature = (parsed as Record<string, unknown>)['signature'];
    if (signature !== want) continue;
    const createdMs = Date.parse(createdAt);
    if (Number.isFinite(createdMs) && Number.isFinite(nowMs) && nowMs - createdMs > windowMs) {
      continue;
    }
    return ok({ id, duplicate: true });
  }
  return ok(undefined);
}

/** What {@link finalizeNoOp} reports. */
export interface FinalizeCheck {
  /** True when C is already exactly the recorded result — nothing to write. */
  unchanged: boolean;
  /** Paths whose bytes drifted from the manifest. */
  drifted: string[];
}

/**
 * Is finalize already done? (P-250 step 4)
 *
 * "Already done" needs BOTH halves: C must still match its recorded checksums (nothing
 * changed on disk) AND the run must have produced no diff. Either one alone is not
 * enough — a matching tree with a pending diff still has work, and an empty diff over a
 * tampered tree would hide the tampering.
 */
export async function finalizeNoOp(
  outDir: string,
  manifest: ChecksumManifest,
  diff: { isEmpty: boolean }
): Promise<Result<FinalizeCheck, StitchError>> {
  const verified = await verifyChecksums(outDir, manifest);
  if (verified.isErr()) return err(verified.error);
  const drifted = verified.value.mismatches;
  return ok({ unchanged: verified.value.valid && diff.isEmpty, drifted });
}
