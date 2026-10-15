// P-169 — Sandbox: ephemeral image per ecosystem.
//
// Build/test must behave identically everywhere, so each P-103 ecosystem maps
// to one pinned base image (or a locally-built `Dockerfile.<ecosystem>`), and
// the resolved ref is cached so a repeated run does not hit the registry.
//
// Resolution order (phase step 2):
//   1. `sandbox.overrideImage[ecosystem]` — a user tag wins outright.
//   2. `sandbox.buildLocal` + an existing `Dockerfile.<ecosystem>` → build it.
//   3. otherwise → pull `ECOSYSTEM_IMAGES[ecosystem]`.
//
// The cache is keyed `ecosystem|tag|platform` (phase step 2 / acceptance
// "deterministic per ecosystem|tag|platform") and backed by BOTH an in-memory
// map and, when a `DbLike` is supplied, the `sandbox_images` table — the same
// "own the table, create it on use" arrangement P-145 (`ai_calls`) and P-160
// (`hil_requests`) use, because `store/schema.ts`'s header reserves its own
// migration slots for other phases.
//
// The client seam is NARROW (`ImageClient`): `SandboxClient` (P-168) has
// `#private` fields and is therefore nominally typed, so a test fake could not
// be assigned to it — the same structural-seam rule every other injected
// capability in this codebase follows (ADR-030).

import { ok, err, type Result } from 'neverthrow';
import { createHash } from 'node:crypto';
import { type StitchError } from '../result/index.js';
import { pathExists } from '../util/fs.js';
import { dbAll, dbRun, type DbLike } from '../store/schema.js';
import type { Ecosystem } from '../deps/index.js';
import type { BuildImageOptions } from './client.js';

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------

/**
 * The pinned base image per ecosystem.
 *
 * Keyed by the P-103 `Ecosystem` (`node | python | rust | go`) — NOT by the
 * parser ids (`npm | cargo`) the phase sketch used — because every consumer of
 * this map (`BuildEcosystem` in P-155's `run_build`, `detectEcosystems` in
 * P-103) speaks the `Ecosystem` union. See ADR-042.
 *
 * The `node` entry is the BUN-READY image (the P-008 base, `oven/bun:1.1`),
 * not `node:22-alpine`: P-169's own step-1 note requires it ("For npm use the
 * bun-ready node image"), and both P-155's build/test (`bun run build`,
 * `bun test`) and P-170's install (`bun install`) invoke bun, which
 * `node:22-alpine` does not carry. See ADR-043.
 */
export const ECOSYSTEM_IMAGES: Readonly<Record<Ecosystem, string>> = {
  node: 'oven/bun:1.1',
  python: 'python:3.12-slim',
  rust: 'rust:1.80-alpine',
  go: 'golang:1.23-alpine',
};

/** Marker P-177's cleanup prunes locally-built images by. */
export const EPHEMERAL_PREFIX = 'stitch-ephemeral-';

/** The `sandbox_images` cache table (created on first use). */
export const SANDBOX_IMAGES_TABLE_SQL = `CREATE TABLE IF NOT EXISTS sandbox_images (
  cache_key TEXT PRIMARY KEY,
  ecosystem TEXT NOT NULL,
  tag TEXT NOT NULL,
  platform TEXT,
  image_id TEXT NOT NULL,
  resolved_at TEXT NOT NULL
);`;

// ---------------------------------------------------------------------------
// Pure lookups
// ---------------------------------------------------------------------------

/** The pinned tag for an ecosystem (phase step 4). Pure. */
export function imageFor(ecosystem: Ecosystem): string {
  return ECOSYSTEM_IMAGES[ecosystem];
}

/** Is this ref a locally-built image P-177 should prune? */
export function isEphemeralTag(ref: string): boolean {
  return ref.includes(`:${EPHEMERAL_PREFIX}`) || ref.startsWith(EPHEMERAL_PREFIX);
}

/**
 * The deterministic ephemeral tag for one resolution.
 *
 * Same `ecosystem|tag|platform` ⇒ same tag, so a rebuild reuses the image
 * instead of leaking a new one per call (the phase handoff's pin/cache rule).
 */
export function ephemeralTagFor(ecosystem: Ecosystem, tag: string, platform?: string): string {
  const digest = createHash('sha256')
    .update(`${ecosystem}|${tag}|${platform ?? 'default'}`)
    .digest('hex')
    .slice(0, 12);
  return `stitch-${ecosystem}:${EPHEMERAL_PREFIX}${digest}`;
}

// ---------------------------------------------------------------------------
// The client seam
// ---------------------------------------------------------------------------

/** What `ensureImage` needs from a container client (P-168 `SandboxClient`). */
export interface ImageClient {
  pull(image: string, opts?: { platform?: string }): Promise<Result<void, StitchError>>;
  buildImage(options: BuildImageOptions): Promise<Result<string, StitchError>>;
}

/** Options for {@link ensureImage}. Mirrors the `config.sandbox` slice. */
export interface EnsureImageOptions {
  /** `config.sandbox.overrideImage` — a user tag that wins outright. */
  overrideImage?: Record<string, string>;
  /** `config.sandbox.buildLocal` — build `Dockerfile.<ecosystem>` instead. */
  buildLocal?: boolean;
  /** Target platform (part of the cache key; forwarded to the pull). */
  platform?: string;
  /** Optional sqlite cache. Without it only the in-memory cache is used. */
  db?: DbLike;
  /**
   * Directory holding `Dockerfile.<ecosystem>`. Required for the build path:
   * the Dockerfiles ship beside this module but must be packaged/resolved by
   * the caller (see ADR-042), so a missing dir is a typed `CONFIG_ERROR`
   * rather than a guess that cannot work in a built bundle.
   */
  dockerfileDir?: string;
  /** Build context (a tar path or stream). Default: `dockerfileDir`. */
  buildContext?: string | NodeJS.ReadableStream;
  /** `--build-arg` values for the local build. */
  buildArgs?: Record<string, string>;
  /** Clock, injectable so tests are deterministic. */
  now?: () => string;
  /** Streaming-progress hook for pull/build. */
  onProgress?: (chunk: string) => void;
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

/** In-memory cache keyed `ecosystem|tag|platform`. */
const imageCache = new Map<string, string>();

/** Test-only: drop the in-memory cache. */
export function clearImageCacheForTests(): void {
  imageCache.clear();
}

const tablesReady = new WeakSet<DbLike>();

function ensureTable(db: DbLike): Result<void, StitchError> {
  if (tablesReady.has(db)) return ok(undefined);
  try {
    db.exec(SANDBOX_IMAGES_TABLE_SQL);
    tablesReady.add(db);
    return ok(undefined);
  } catch (cause: unknown) {
    return err({
      code: 'INTERNAL',
      message: `sandbox_images table setup failed: ${detailOf(cause)}`,
    });
  }
}

/** Read a cached ref for a key. A missing row is `ok(null)`, not an error. */
function readCached(db: DbLike, cacheKey: string): Result<string | null, StitchError> {
  const ready = ensureTable(db);
  if (ready.isErr()) return err(ready.error);
  const rows = dbAll(db, 'SELECT image_id FROM sandbox_images WHERE cache_key = ?', cacheKey);
  if (rows.isErr()) return err(rows.error);
  const first = rows.value[0];
  if (first === undefined) return ok(null);
  const value = first['image_id'];
  return typeof value === 'string' && value !== ''
    ? ok(value)
    : err({ code: 'INTERNAL', message: `sandbox_images row "${cacheKey}" has no image_id` });
}

/** Replace the row for a key (upsert, so a re-resolve never duplicates). */
function writeCached(
  db: DbLike,
  row: {
    cacheKey: string;
    ecosystem: string;
    tag: string;
    platform: string | null;
    imageId: string;
    resolvedAt: string;
  }
): Result<void, StitchError> {
  const ready = ensureTable(db);
  if (ready.isErr()) return err(ready.error);
  return dbRun(
    db,
    `INSERT INTO sandbox_images (cache_key, ecosystem, tag, platform, image_id, resolved_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(cache_key) DO UPDATE SET
       image_id = excluded.image_id,
       resolved_at = excluded.resolved_at`,
    row.cacheKey,
    row.ecosystem,
    row.tag,
    row.platform,
    row.imageId,
    row.resolvedAt
  ).map(() => undefined);
}

// ---------------------------------------------------------------------------
// ensureImage
// ---------------------------------------------------------------------------

function detailOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function cacheKeyFor(ecosystem: Ecosystem, tag: string, platform: string | undefined): string {
  return `${ecosystem}|${tag}|${platform ?? 'default'}`;
}

/**
 * Resolve the image ref to run for an ecosystem, caching the answer.
 *
 * Honours `overrideImage` first, then a local build when `buildLocal` is set
 * and the Dockerfile exists, and otherwise pulls the pinned tag. Every failure
 * is a typed `StitchError` (`DOCKER_PULL_FAILED` / `DOCKER_BUILD_FAILED` /
 * `CONFIG_ERROR`), and a successful resolution is cached in memory and, when a
 * `db` is supplied, in `sandbox_images`.
 */
export async function ensureImage(
  ecosystem: Ecosystem,
  client: ImageClient,
  opts: EnsureImageOptions = {}
): Promise<Result<string, StitchError>> {
  if (!Object.hasOwn(ECOSYSTEM_IMAGES, ecosystem)) {
    return err({
      code: 'CONFIG_ERROR',
      field: 'ecosystem',
      message: `ensureImage: unknown ecosystem ${JSON.stringify(ecosystem)}`,
    });
  }

  const tag = imageFor(ecosystem);

  // 1. A user-provided tag wins outright — no cache, no network.
  const override = opts.overrideImage?.[ecosystem];
  if (override !== undefined && override.trim() !== '') {
    return ok(override);
  }

  const cacheKey = cacheKeyFor(ecosystem, tag, opts.platform);

  // 2. In-memory cache.
  const fromMemory = imageCache.get(cacheKey);
  if (fromMemory !== undefined) return ok(fromMemory);

  // 3. sqlite cache.
  if (opts.db !== undefined) {
    const cached = readCached(opts.db, cacheKey);
    if (cached.isErr()) return err(cached.error);
    if (cached.value !== null) {
      imageCache.set(cacheKey, cached.value);
      return ok(cached.value);
    }
  }

  // 4. Resolve: a local build, else the pinned pull.
  let resolved: string;
  if (opts.buildLocal === true) {
    const built = await buildLocalImage(ecosystem, tag, client, opts);
    if (built.isErr()) return err(built.error);
    resolved = built.value;
  } else {
    const pulled = await client.pull(tag, {
      ...(opts.platform !== undefined ? { platform: opts.platform } : {}),
      ...(opts.onProgress !== undefined ? { onProgress: opts.onProgress } : {}),
    });
    if (pulled.isErr()) return err(pulled.error);
    resolved = tag;
  }

  // 5. Cache the resolution.
  imageCache.set(cacheKey, resolved);
  if (opts.db !== undefined) {
    const stored = writeCached(opts.db, {
      cacheKey,
      ecosystem,
      tag,
      platform: opts.platform ?? null,
      imageId: resolved,
      resolvedAt: (opts.now ?? (() => new Date().toISOString()))(),
    });
    if (stored.isErr()) return err(stored.error);
  }
  return ok(resolved);
}

/** The `buildLocal` branch: locate the Dockerfile, then build it. */
async function buildLocalImage(
  ecosystem: Ecosystem,
  tag: string,
  client: ImageClient,
  opts: EnsureImageOptions
): Promise<Result<string, StitchError>> {
  if (opts.dockerfileDir === undefined || opts.dockerfileDir.trim() === '') {
    return err({
      code: 'CONFIG_ERROR',
      field: 'dockerfileDir',
      message: `buildLocal is set but no dockerfileDir was provided, so Dockerfile.${ecosystem} cannot be located`,
    });
  }
  const fileName = `Dockerfile.${ecosystem}`;
  const exists = await pathExists(opts.dockerfileDir, fileName);
  if (exists.isErr()) return err(exists.error);
  if (!exists.value) {
    return err({
      code: 'CONFIG_ERROR',
      field: 'dockerfileDir',
      message: `buildLocal is set but ${fileName} does not exist in ${opts.dockerfileDir}`,
    });
  }

  const ephemeral = ephemeralTagFor(ecosystem, tag, opts.platform);
  const built = await client.buildImage({
    context: opts.buildContext ?? opts.dockerfileDir,
    tag: ephemeral,
    dockerfile: `${opts.dockerfileDir}/${fileName}`,
    ...(opts.buildArgs !== undefined ? { buildArgs: opts.buildArgs } : {}),
    ...(opts.onProgress !== undefined ? { onProgress: opts.onProgress } : {}),
  });
  if (built.isErr()) return err(built.error);
  // The client returns the produced tag; fall back to the deterministic one.
  return ok(built.value.trim() !== '' ? built.value : ephemeral);
}
