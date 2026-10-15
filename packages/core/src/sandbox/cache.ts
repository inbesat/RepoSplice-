// P-178 — Sandbox: layer cache.
//
// Base images are re-pulled and dependencies re-installed on every run, which is
// slow and wasteful. This module makes a repeat run for the SAME content skip
// both: a cache key derived from the ecosystem's manifest + lockfile (+ an opt-in
// source shortlist) identifies "this exact dependency state", and a successful
// install records the image tag it produced so the next run can reuse it.
//
// Invalidation is automatic and needs no bookkeeping: the key IS the content, so
// a changed lockfile or manifest is a different key and therefore a miss. The
// escape hatch is `SandboxCache.clear()` (`sandbox cache clear`, P-190).
//
// Three deliberate properties:
//
//   1. THE KEY IS MODEST BY DEFAULT. Manifests + lockfile only. Hashing the whole
//      repository would invalidate on every unrelated source edit — churning the
//      cache for no benefit — so `includeFiles` is opt-in and, for a full tree,
//      gated behind `config.sandbox.cacheKeyFullTree` (default `false`).
//   2. A FULL-TREE WALK EXCLUDES INSTALL/BUILD OUTPUT. Without the ignore list the
//      install itself would change the tree, so the key would change on every run
//      and the cache would MISS FOREVER. That is a correctness trap, not a
//      performance tweak, which is why {@link FULL_TREE_IGNORES} is not optional.
//   3. A BROKEN CACHE NEVER BREAKS A RUN. Every read/write failure is reported
//      through the event sink and degrades to "no cached answer" / "entry not
//      saved" — a cache is an optimization and must never fail a stitch. Same rule
//      P-177 applies to cleanup.
//
// Storage follows the P-169/P-173 precedent: the store's own migration slots are
// reserved for other phases, so `sandbox_cache` is created on first use by the
// owner of the table rather than added to `store/schema.ts`.
//
// There is no P-186 "checksum helper" to reuse (P-186 is a later phase; only its
// forward reference exists in `git/blameMap.ts`/`git/binary.ts`), so hashing is
// local — the same choice `license/generate.ts` makes for its own sha256.

import { ok, err, type Result } from 'neverthrow';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { type StitchError } from '../result/index.js';
import { dbAll, dbGet, dbRun, type DbLike, type SQLiteRow } from '../store/schema.js';
import { listFiles } from '../util/glob.js';
import { pathExists } from '../util/fs.js';
import { toPosix } from '../util/paths.js';
import type { Ecosystem } from '../deps/index.js';

// ---------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------

/** The `sandbox_cache` table (created on first use by its owner). */
export const SANDBOX_CACHE_TABLE_SQL = `CREATE TABLE IF NOT EXISTS sandbox_cache (
  cache_key TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  created_at TEXT NOT NULL,
  meta JSON
);`;

/** The cache-key format version. Bumping it invalidates every entry at once. */
export const CACHE_KEY_VERSION = 'v1';

// ---------------------------------------------------------------------------
// What identifies a dependency state
// ---------------------------------------------------------------------------

/** The manifest naming an ecosystem's own dependencies. */
export const ECOSYSTEM_MANIFESTS: Readonly<Record<Ecosystem, readonly string[]>> = {
  node: ['package.json'],
  python: ['pyproject.toml'],
  rust: ['Cargo.toml'],
  go: ['go.mod'],
};

/**
 * The lockfiles a workspace may commit.
 *
 * `requirements.txt` appears for python because it pins exactly as a lockfile
 * does — it is the same file that would otherwise be treated as a manifest, and
 * treating it as absent would under-key every pip workspace.
 */
export const ECOSYSTEM_LOCKFILES: Readonly<Record<Ecosystem, readonly string[]>> = {
  node: ['bun.lock', 'bun.lockb', 'package-lock.json'],
  python: ['uv.lock', 'poetry.lock', 'requirements.txt'],
  rust: ['Cargo.lock'],
  go: ['go.sum'],
};

/**
 * Directories excluded from a full-tree key.
 *
 * These are install/build OUTPUTS. Including any of them would let the install
 * change the key that is supposed to describe the install's input, so the cache
 * would miss on every run (see the module header, property 2).
 */
export const FULL_TREE_IGNORES = [
  '**/node_modules/**',
  '**/.git/**',
  '**/target/**',
  '**/dist/**',
  '**/build/**',
  '**/out/**',
  '**/.venv/**',
  '**/venv/**',
  '**/__pycache__/**',
  '**/vendor/**',
  '**/.cache/**',
] as const;

/** The marker contributed by a file that is legitimately absent. */
const ABSENT_MARKER = '-';

/** Options for {@link cacheKey}. */
export interface CacheKeyOptions {
  /**
   * Include the lockfile hashes. Default `true` — the lockfile is the primary
   * invalidation signal (phase acceptance: "key includes lockfile hash").
   */
  includeLock?: boolean;
  /**
   * Extra source content to fold into the key. `string[]` hashes exactly those
   * workspace-relative paths; `true` hashes the whole tree and therefore
   * REQUIRES {@link CacheKeyOptions.fullTreeAllowed}.
   */
  includeFiles?: boolean | readonly string[];
  /**
   * `config.sandbox.cacheKeyFullTree` (default `false`). The gate for
   * `includeFiles: true`, because a full walk is the expensive option.
   */
  fullTreeAllowed?: boolean;
}

function detailOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** A `StitchError`'s message, narrowed (not every variant carries one). */
function errorText(error: StitchError): string {
  return 'message' in error && typeof error.message === 'string' ? error.message : error.code;
}

/** Hash one workspace file, or return the stable absent-marker. */
async function contentHash(root: string, rel: string): Promise<Result<string, StitchError>> {
  const exists = await pathExists(root, rel);
  if (exists.isErr()) return err(exists.error);
  if (!exists.value) return ok(ABSENT_MARKER);
  try {
    return ok(
      createHash('sha256')
        .update(await readFile(join(root, rel)))
        .digest('hex')
    );
  } catch (cause: unknown) {
    return err({ code: 'INTERNAL', message: `cacheKey: cannot hash ${rel}: ${detailOf(cause)}` });
  }
}

/**
 * Compute the content key for an ecosystem's dependency state.
 *
 * Deterministic: the same workspace content always yields the same key, and any
 * change to a manifest or lockfile yields a different one. Names are sorted and
 * the input is version-prefixed so the digest does not depend on iteration order.
 */
export async function cacheKey(
  ecosystem: Ecosystem,
  repoPath: string,
  opts: CacheKeyOptions = {}
): Promise<Result<string, StitchError>> {
  if (repoPath.trim() === '') {
    return err({
      code: 'CONFIG_ERROR',
      field: 'repoPath',
      message: 'cacheKey: repoPath is required',
    });
  }
  if (!Object.hasOwn(ECOSYSTEM_MANIFESTS, ecosystem)) {
    return err({
      code: 'CONFIG_ERROR',
      field: 'ecosystem',
      message: `cacheKey: unknown ecosystem ${JSON.stringify(ecosystem)}`,
    });
  }

  const parts: string[] = [CACHE_KEY_VERSION, `ecosystem=${ecosystem}`];

  // 1. Manifests — always part of the key.
  for (const name of [...ECOSYSTEM_MANIFESTS[ecosystem]].sort()) {
    const hash = await contentHash(repoPath, name);
    if (hash.isErr()) return err(hash.error);
    parts.push(`manifest:${name}:${hash.value}`);
  }

  // 2. Lockfiles — the primary invalidation signal, unless the caller opted out.
  if (opts.includeLock !== false) {
    for (const name of [...ECOSYSTEM_LOCKFILES[ecosystem]].sort()) {
      const hash = await contentHash(repoPath, name);
      if (hash.isErr()) return err(hash.error);
      parts.push(`lock:${name}:${hash.value}`);
    }
  }

  // 3. Optional source content.
  const includeFiles = opts.includeFiles;
  if (includeFiles === true) {
    if (opts.fullTreeAllowed !== true) {
      // Refusing beats silently downgrading: a manifest-only key would keep
      // serving stale entries the caller explicitly asked not to trust.
      return err({
        code: 'CONFIG_ERROR',
        field: 'includeFiles',
        message:
          'cacheKey: includeFiles: true needs the full-tree gate, but config.sandbox.cacheKeyFullTree is not enabled',
      });
    }
    const walked = await listFiles(repoPath, ['**/*'], {
      dot: true,
      ignore: [...FULL_TREE_IGNORES],
    });
    if (walked.isErr()) return err(walked.error);
    for (const absolute of walked.value) {
      const rel = toPosix(relative(repoPath, absolute));
      if (rel === '' || rel.startsWith('..')) continue;
      const hash = await contentHash(repoPath, rel);
      if (hash.isErr()) return err(hash.error);
      parts.push(`file:${rel}:${hash.value}`);
    }
  } else if (includeFiles !== undefined && includeFiles !== false) {
    for (const rel of [...includeFiles].sort()) {
      const hash = await contentHash(repoPath, rel);
      if (hash.isErr()) return err(hash.error);
      parts.push(`file:${rel}:${hash.value}`);
    }
  }

  return ok(createHash('sha256').update(parts.join('\n')).digest('hex'));
}

// ---------------------------------------------------------------------------
// The cache
// ---------------------------------------------------------------------------

/** One cache observation, for the P-248 tracing seam (none exists yet). */
export interface CacheEvent {
  type: 'hit' | 'miss' | 'saved' | 'cleared' | 'read-failed' | 'write-failed';
  /** Absent for `cleared`, which is not scoped to one ecosystem. */
  ecosystem?: Ecosystem;
  cacheKey: string;
  imageTag?: string;
  message?: string;
}

/** The answer to "do we already have this dependency state?". */
export interface CacheLookup {
  hit: boolean;
  cacheKey: string;
  /** The image tag a previous install recorded, when the entry carries one. */
  imageTag?: string;
}

/** What `put` records. */
export interface CacheEntry {
  /** The image tag the install produced (P-169's resolved ref). */
  imageTag?: string;
  /** The install command line, for diagnostics. */
  command?: string;
}

/** One stored entry, as read back by {@link SandboxCache.entries}. */
export interface CacheEntryRecord {
  cacheKey: string;
  ecosystem: Ecosystem;
  createdAt: string;
  imageTag?: string;
}

/** Options for {@link SandboxCache.get}/{@link SandboxCache.put}. */
export interface CacheAccessOptions extends CacheKeyOptions {
  /**
   * A key already computed by the caller. Supplying it avoids hashing the same
   * workspace twice when a caller looks up and then stores (the install path).
   */
  cacheKey?: string;
}

/** Options for the {@link SandboxCache} constructor. */
export interface SandboxCacheOptions {
  /** Optional sqlite store. Without it only the in-memory cache is used. */
  db?: DbLike;
  /** Clock, injectable so tests are deterministic. */
  now?: () => string;
  /** Receives every cache observation. */
  onEvent?: (event: CacheEvent) => void;
  /** `config.sandbox.cacheKeyFullTree` — the default full-tree gate. */
  fullTreeAllowed?: boolean;
  /** Default key options, overridable per call. */
  keyOptions?: CacheKeyOptions;
}

/** In-memory fallback, used when no `DbLike` is supplied. */
const memoryCache = new Map<string, CacheEntryRecord>();

/** Test-only: drop the in-memory fallback. */
export function clearCacheForTests(): void {
  memoryCache.clear();
}

function parseMeta(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'string' || value === '') return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function stringField(meta: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = meta?.[key];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/**
 * The install-layer cache.
 *
 * Records "dependencies for this content key were installed, from this image",
 * so a repeat run skips the install. Reads and writes degrade to events; neither
 * throws nor fails the caller.
 */
export class SandboxCache {
  readonly #db: DbLike | undefined;
  readonly #now: () => string;
  readonly #onEvent: ((event: CacheEvent) => void) | undefined;
  readonly #fullTreeAllowed: boolean;
  readonly #defaultKeyOptions: CacheKeyOptions;
  #tableReady = false;

  constructor(opts: SandboxCacheOptions = {}) {
    this.#db = opts.db;
    this.#now = opts.now ?? (() => new Date().toISOString());
    this.#onEvent = opts.onEvent;
    this.#fullTreeAllowed = opts.fullTreeAllowed === true;
    this.#defaultKeyOptions = opts.keyOptions ?? {};
  }

  /** Whether the full-tree key is permitted (from config). */
  get fullTreeAllowed(): boolean {
    return this.#fullTreeAllowed;
  }

  #emit(event: CacheEvent): void {
    this.#onEvent?.(event);
  }

  #ensureTable(): Result<void, StitchError> {
    if (this.#db === undefined || this.#tableReady) return ok(undefined);
    try {
      this.#db.exec(SANDBOX_CACHE_TABLE_SQL);
      this.#tableReady = true;
      return ok(undefined);
    } catch (cause: unknown) {
      return err({
        code: 'INTERNAL',
        message: `sandbox_cache table setup failed: ${detailOf(cause)}`,
      });
    }
  }

  /** Per-call key options, falling back to the instance defaults. */
  #effectiveKeyOptions(opts: CacheAccessOptions): CacheKeyOptions {
    const includeLock = opts.includeLock ?? this.#defaultKeyOptions.includeLock;
    const includeFiles = opts.includeFiles ?? this.#defaultKeyOptions.includeFiles;
    const fullTreeAllowed =
      opts.fullTreeAllowed ?? this.#defaultKeyOptions.fullTreeAllowed ?? this.#fullTreeAllowed;
    return {
      ...(includeLock !== undefined ? { includeLock } : {}),
      ...(includeFiles !== undefined ? { includeFiles } : {}),
      fullTreeAllowed,
    };
  }

  async #resolveKey(
    ecosystem: Ecosystem,
    repoPath: string,
    opts: CacheAccessOptions
  ): Promise<Result<string, StitchError>> {
    if (opts.cacheKey !== undefined) return ok(opts.cacheKey);
    return cacheKey(ecosystem, repoPath, this.#effectiveKeyOptions(opts));
  }

  /**
   * Look up the entry for an ecosystem's current content.
   *
   * `hit: false` is a valid answer, not an error. A storage failure is an `err`
   * (after emitting `read-failed`) so the caller can decide — the install path
   * treats it as a miss.
   */
  async get(
    ecosystem: Ecosystem,
    repoPath: string,
    opts: CacheAccessOptions = {}
  ): Promise<Result<CacheLookup, StitchError>> {
    const key = await this.#resolveKey(ecosystem, repoPath, opts);
    if (key.isErr()) return err(key.error);
    const cacheKeyValue = key.value;

    if (this.#db === undefined) {
      const inMemory = memoryCache.get(cacheKeyValue);
      const imageTag = inMemory?.imageTag;
      this.#emit({
        type: inMemory === undefined ? 'miss' : 'hit',
        ecosystem,
        cacheKey: cacheKeyValue,
        ...(imageTag !== undefined ? { imageTag } : {}),
      });
      return ok({
        hit: inMemory !== undefined,
        cacheKey: cacheKeyValue,
        ...(imageTag !== undefined ? { imageTag } : {}),
      });
    }

    const ready = this.#ensureTable();
    if (ready.isErr()) return err(ready.error);

    const row = dbGet(
      this.#db,
      'SELECT meta, kind FROM sandbox_cache WHERE cache_key = ?',
      cacheKeyValue
    );
    if (row.isErr()) {
      this.#emit({
        type: 'read-failed',
        ecosystem,
        cacheKey: cacheKeyValue,
        message: errorText(row.error),
      });
      return err(row.error);
    }
    if (row.value === null) {
      this.#emit({ type: 'miss', ecosystem, cacheKey: cacheKeyValue });
      return ok({ hit: false, cacheKey: cacheKeyValue });
    }

    const imageTag = stringField(parseMeta(row.value['meta']), 'imageTag');
    this.#emit({
      type: 'hit',
      ecosystem,
      cacheKey: cacheKeyValue,
      ...(imageTag !== undefined ? { imageTag } : {}),
    });
    return ok({
      hit: true,
      cacheKey: cacheKeyValue,
      ...(imageTag !== undefined ? { imageTag } : {}),
    });
  }

  /**
   * Record a successful install for the current content.
   *
   * An upsert, so a re-install for the same key never duplicates a row.
   */
  async put(
    ecosystem: Ecosystem,
    repoPath: string,
    entry: CacheEntry = {},
    opts: CacheAccessOptions = {}
  ): Promise<Result<void, StitchError>> {
    const key = await this.#resolveKey(ecosystem, repoPath, opts);
    if (key.isErr()) return err(key.error);
    const cacheKeyValue = key.value;
    const createdAt = this.#now();

    if (this.#db === undefined) {
      memoryCache.set(cacheKeyValue, {
        cacheKey: cacheKeyValue,
        ecosystem,
        createdAt,
        ...(entry.imageTag !== undefined ? { imageTag: entry.imageTag } : {}),
      });
      this.#emit({
        type: 'saved',
        ecosystem,
        cacheKey: cacheKeyValue,
        ...(entry.imageTag !== undefined ? { imageTag: entry.imageTag } : {}),
      });
      return ok(undefined);
    }

    const ready = this.#ensureTable();
    if (ready.isErr()) return err(ready.error);

    const meta = JSON.stringify({
      ecosystem,
      ...(entry.imageTag !== undefined ? { imageTag: entry.imageTag } : {}),
      ...(entry.command !== undefined ? { command: entry.command } : {}),
    });
    const written = dbRun(
      this.#db,
      `INSERT INTO sandbox_cache (cache_key, kind, created_at, meta)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(cache_key) DO UPDATE SET
         created_at = excluded.created_at,
         meta = excluded.meta`,
      cacheKeyValue,
      ecosystem,
      createdAt,
      meta
    );
    if (written.isErr()) {
      this.#emit({
        type: 'write-failed',
        ecosystem,
        cacheKey: cacheKeyValue,
        message: errorText(written.error),
      });
      return err(written.error);
    }
    this.#emit({
      type: 'saved',
      ecosystem,
      cacheKey: cacheKeyValue,
      ...(entry.imageTag !== undefined ? { imageTag: entry.imageTag } : {}),
    });
    return ok(undefined);
  }

  /** Every stored entry, newest first. Backs the P-190 `sandbox cache` view. */
  async entries(): Promise<Result<CacheEntryRecord[], StitchError>> {
    if (this.#db === undefined) {
      return ok([...memoryCache.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    }
    const ready = this.#ensureTable();
    if (ready.isErr()) return err(ready.error);

    const rows = dbAll(
      this.#db,
      'SELECT cache_key, kind, created_at, meta FROM sandbox_cache ORDER BY created_at DESC, cache_key ASC'
    );
    if (rows.isErr()) return err(rows.error);

    const records: CacheEntryRecord[] = [];
    for (const row of rows.value) {
      const record = toEntryRecord(row);
      if (record !== undefined) records.push(record);
    }
    return ok(records);
  }

  /** Evict every entry. The programmatic half of `sandbox cache clear` (P-190). */
  async clear(): Promise<Result<number, StitchError>> {
    if (this.#db === undefined) {
      const count = memoryCache.size;
      memoryCache.clear();
      this.#emit({ type: 'cleared', cacheKey: '*' });
      return ok(count);
    }
    const ready = this.#ensureTable();
    if (ready.isErr()) return err(ready.error);

    const before = dbGet(this.#db, 'SELECT COUNT(*) AS n FROM sandbox_cache');
    if (before.isErr()) return err(before.error);
    const raw = before.value?.['n'];
    const count = typeof raw === 'number' ? raw : Number(raw ?? 0);

    const deleted = dbRun(this.#db, 'DELETE FROM sandbox_cache');
    if (deleted.isErr()) return err(deleted.error);

    this.#emit({ type: 'cleared', cacheKey: '*' });
    return ok(Number.isFinite(count) ? count : 0);
  }
}

/** Map a `sandbox_cache` row to a record; `undefined` when it is unusable. */
function toEntryRecord(row: SQLiteRow): CacheEntryRecord | undefined {
  const cacheKey = row['cache_key'];
  const kind = row['kind'];
  const createdAt = row['created_at'];
  if (typeof cacheKey !== 'string' || typeof kind !== 'string' || typeof createdAt !== 'string') {
    return undefined;
  }
  const imageTag = stringField(parseMeta(row['meta']), 'imageTag');
  // `kind` carries the ecosystem, so an entry is identifiable without JSON.
  return {
    cacheKey,
    ecosystem: kind as Ecosystem,
    createdAt,
    ...(imageTag !== undefined ? { imageTag } : {}),
  };
}

// ---------------------------------------------------------------------------
// Declarative wrappers (the phase's `restoreCache` / `saveCache`)
// ---------------------------------------------------------------------------

/** Restore the cached image for an ecosystem's current content. */
export async function restoreCache(
  cache: SandboxCache,
  ecosystem: Ecosystem,
  repoPath: string,
  opts: CacheAccessOptions = {}
): Promise<Result<CacheLookup, StitchError>> {
  return cache.get(ecosystem, repoPath, opts);
}

/** Record an install result for an ecosystem's current content. */
export async function saveCache(
  cache: SandboxCache,
  ecosystem: Ecosystem,
  repoPath: string,
  entry: CacheEntry = {},
  opts: CacheAccessOptions = {}
): Promise<Result<void, StitchError>> {
  return cache.put(ecosystem, repoPath, entry, opts);
}
