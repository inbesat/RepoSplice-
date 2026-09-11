// Performance (P-086): bounded parallel git work plus the repo-metadata
// cache layer — the two levers that keep merges snappy on large repos.
// `mapParallel` throttles independent roots over P-031 (never reimplements
// the throttle); `RefCache`/`fetchCached` skip rework while a ref stands
// still (ref-consistency, P-181); `runExclusive` is the single-writer
// guard for ops sharing a worktree; `cloneMany` clones independent roots
// in parallel, shallow + blobless by default.
//
// Verified behavior (probed on real git 2.47 — do not assume otherwise):
// - `--depth`/`--filter` are IGNORED with a warning in local-path clones
//   (exit 0) but HONORED over `file://` — so tests clone via `file://`
//   and assert `.git/shallow` exists as proof of real depth effect.
// - `--filter=blob:none` combines with `--depth` (standard partial-clone
//   pair); appending it after cloneRepo's own argv is order-safe.
// - p-limit drains FIFO under contention, so queued exclusives grant in
//   call order (asserted, not assumed).
//
// Safety contract:
// - Parallelism is ONLY for independent roots: cloneMany refuses duplicate
//   targetDirs before any spawn, and same-worktree ops must serialize
//   through runExclusive (documented at mapParallel — the mapper cannot
//   tell which paths an op touches, so the guard lives with the caller).
// - Outcomes never depend on completion order (P-282): mapParallel keeps
//   input order (P-031), the cache is sha-keyed, exclusives are FIFO.
// - Failures are per-item Results, never wholesale rejection (P-031):
//   one bad repo cannot kill a batch.
// - No new StitchError codes (P-203 owns taxonomy): misuse is
//   CONFIG_ERROR, caller throws are INTERNAL (P-031 precedent), git
//   failures pass through untouched.
// - Only counts + op names reach the logs; no file contents, no URLs
//   (cloneRepo already redacts credentials, P-069).
//
// Seams and future phases:
// - No process seam of its own: this module composes cloneRepo (seam:
//   CloneRuntime.createGit) and P-031. resolveSha/fetch inject the
//   fetchers P-090/P-181 will provide; progress hooks belong to
//   P-242/P-199 (no fake progress surface here).
// - RefCache is the in-memory P-303 layer: P-303 persists/generalizes it
//   (per (owner,repo,ref→sha) keys); the sha-consistency rule
//   (hit only when the stored sha still resolves) is already final.
// - P-069 owns CloneOptions: blobless travels via the createGit wrapper
//   (no clone.ts changes — perf.ts was the only file in scope).

import { ok, err, type Result } from 'neverthrow';
import type { StitchError } from '../result/index.js';
import { mapLimit } from '../util/limit.js';
import { toPosix } from '../util/paths.js';
import { createGit, type GitFactoryOptions } from './factory.js';
import {
  cloneRepo,
  DEFAULT_CLONE_DEPTH,
  DEFAULT_CLONE_TIMEOUT_MS,
  type CloneGit,
  type CloneRuntime,
} from './clone.js';

/** Default cap for parallel git work (network-bound like doctor's 4). */
export const DEFAULT_PERF_CONCURRENCY = 4;

/** Partial-clone flag cutting blob transfer (honored by servers). */
export const BLOBLESS_FILTER_ARG = '--filter=blob:none';

function invalid(field: string, message: string): Result<never, StitchError> {
  return err({ code: 'CONFIG_ERROR', field, message });
}

function internalError(op: string, cause: unknown): StitchError {
  const detail = cause instanceof Error ? cause.message : String(cause);
  return {
    code: 'INTERNAL',
    message: `${op}: ${detail}`,
    ...(cause instanceof Error ? { cause } : {}),
  };
}

/** Non-string or whitespace-only (covers both misuse shapes at once). */
function isBlank(value: unknown): boolean {
  return typeof value !== 'string' || value.trim() === '';
}

/**
 * Bounded parallel map for INDEPENDENT roots (P-031 throttle, reused not
 * reimplemented). Results stay in input order with per-item outcomes —
 * completion order never leaks into the output (P-282). Use runExclusive
 * (or cloneMany's target check) for ops sharing a worktree: the mapper
 * cannot tell which paths an op touches.
 */
export async function mapParallel<I, O>(
  items: readonly I[],
  concurrency: number,
  op: (item: I, index: number) => Promise<O> | O
): Promise<Result<Array<Result<O, StitchError>>, StitchError>> {
  const where = 'mapParallel';
  if (!Array.isArray(items)) {
    return invalid('items', `${where}: items must be an array`);
  }
  if (typeof op !== 'function') {
    return invalid('op', `${where}: op must be a function`);
  }
  return mapLimit(items, concurrency, op);
}

// ─── Ref cache (P-303 layer) ────────────────────────────────────────────

/** One cached metadata record, pinned to the sha it was read at. */
export interface RefEntry<V> {
  sha: string;
  value: V;
}

/**
 * In-memory ref→(sha,value) store. Keys are trimmed (blank-safe: blanks
 * miss/no-op, never collide). P-303 persists/generalizes this shape.
 */
export interface RefCache<V> {
  readonly size: number;
  get(ref: string): RefEntry<V> | undefined;
  set(ref: string, sha: string, value: V): void;
  hasLive(ref: string, sha: string): boolean;
  /** Drop one ref; resolves whether anything was stored. */
  invalidate(ref: string): boolean;
  clear(): void;
}

/** Infallible constructor (pure in-memory map, nothing to validate). */
export function createRefCache<V>(): RefCache<V> {
  const entries = new Map<string, RefEntry<V>>();
  const keyOf = (ref: string): string | null => {
    const key = ref.trim();
    return key === '' ? null : key;
  };
  return {
    get size() {
      return entries.size;
    },
    get(ref: string) {
      const key = keyOf(ref);
      return key === null ? undefined : entries.get(key);
    },
    set(ref: string, sha: string, value: V) {
      const key = keyOf(ref);
      if (key !== null) entries.set(key, { sha, value });
    },
    hasLive(ref: string, sha: string) {
      const key = keyOf(ref);
      return key !== null && entries.get(key)?.sha === sha;
    },
    invalidate(ref: string) {
      const key = keyOf(ref);
      return key !== null && entries.delete(key);
    },
    clear() {
      entries.clear();
    },
  };
}

export interface CachedValue<V> {
  value: V;
  /** True when the stored sha still resolved (zero rework). */
  cached: boolean;
}

/**
 * Ref-consistent read: resolve the live sha, serve the entry when its
 * stored sha still matches, else fetch at the new sha and replace.
 * Failures (resolve or fetch) propagate WITHOUT caching. Throwing seams
 * map to INTERNAL (P-031 precedent). resolveSha/fetch arrive by injection
 * (P-090's tree fetch, P-181's consistency check plug in here).
 */
export async function fetchCached<V>(
  cache: RefCache<V>,
  ref: string,
  resolveSha: () => Promise<Result<string, StitchError>>,
  fetch: (sha: string) => Promise<Result<V, StitchError>>
): Promise<Result<CachedValue<V>, StitchError>> {
  const op = 'fetchCached';
  if (typeof cache?.get !== 'function') {
    return invalid('cache', `${op}: cache is required`);
  }
  if (isBlank(ref)) {
    return invalid('ref', `${op}: ref is required`);
  }
  if (typeof resolveSha !== 'function') {
    return invalid('resolveSha', `${op}: resolveSha must be a function`);
  }
  if (typeof fetch !== 'function') {
    return invalid('fetch', `${op}: fetch must be a function`);
  }
  let sha: string;
  try {
    const resolved = await resolveSha();
    if (resolved.isErr()) return err(resolved.error);
    sha = resolved.value;
  } catch (cause: unknown) {
    return err(internalError(`${op} resolveSha`, cause));
  }
  if (sha.trim() === '') {
    return err(internalError(op, 'resolver returned a blank sha (fail-closed)'));
  }
  const hit = cache.get(ref);
  if (hit !== undefined && hit.sha === sha) {
    return ok({ value: hit.value, cached: true });
  }
  let value: V;
  try {
    const fetched = await fetch(sha);
    if (fetched.isErr()) return err(fetched.error);
    value = fetched.value;
  } catch (cause: unknown) {
    return err(internalError(`${op} fetch`, cause));
  }
  cache.set(ref, sha, value);
  return ok({ value, cached: false });
}

// ─── Single-writer guard ────────────────────────────────────────────────

/** FIFO chains per key (module-owned; entries delete themselves). */
const exclusiveChains = new Map<string, Promise<void>>();

/**
 * Serialize ops sharing one key (a worktree path, a repo dir). Grants in
 * call order; different keys run fully parallel. Results AND op errors
 * pass through untouched; a THROWING op maps to INTERNAL and still
 * releases (the chain never wedges).
 */
export async function runExclusive<T>(
  key: string,
  op: () => Promise<Result<T, StitchError>>
): Promise<Result<T, StitchError>> {
  const where = 'runExclusive';
  if (isBlank(key)) {
    return invalid('key', `${where}: key is required`);
  }
  if (typeof op !== 'function') {
    return invalid('op', `${where}: op must be a function`);
  }
  const name = key.trim();
  const prior = exclusiveChains.get(name);
  let release!: () => void;
  const gate = new Promise<void>(resolve => {
    release = resolve;
  });
  const mine = (prior ?? Promise.resolve()).then(() => gate);
  exclusiveChains.set(name, mine);
  await prior;
  try {
    return await op();
  } catch (cause: unknown) {
    return err(internalError(where, cause));
  } finally {
    release();
    if (exclusiveChains.get(name) === mine) exclusiveChains.delete(name);
  }
}

// ─── Shallow + blobless cloning ─────────────────────────────────────────

/**
 * Wrap a git-client factory so every clone carries the blobless partial-
 * clone flag after the caller's own argv (P-069 builds depth/branch/auth
 * first; appending is order-safe). Honors servers, warns-and-ignores on
 * local paths (probed) — never an error either way.
 */
export function withBloblessFilter(
  createGitFn: (options: GitFactoryOptions) => CloneGit
): (options: GitFactoryOptions) => CloneGit {
  return options => {
    const git = createGitFn(options);
    return {
      ...git,
      clone: (repo, target, cloneOptions) =>
        git.clone(repo, target, [...(cloneOptions ?? []), BLOBLESS_FILTER_ARG]),
    };
  };
}

/** One clone target (branch inherits the remote default when absent). */
export interface CloneSpec {
  url: string;
  targetDir: string;
  branch?: string;
}

export interface CloneManyOpts {
  /** Cap for parallel clones. Default: 4. */
  concurrency?: number;
  /** Shallow `--depth` clone. Default: true. */
  shallow?: boolean;
  /** Depth for shallow clones. Default: 1 (P-069). */
  depth?: number;
  /** Append the blobless flag. Default: true. */
  blobless?: boolean;
  /** Silence timeout ms per clone. Default: 120_000 (P-069 budget). */
  timeoutMs?: number;
  /** Job id for structured logs (P-069 acceptance). */
  jobId?: string;
}

/** Default factory mirror (P-069's is module-private; seam-compatible). */
function defaultCreateGit(options: GitFactoryOptions): CloneGit {
  const git = createGit(options);
  return {
    clone: (repo, target, cloneOptions) => git.clone(repo, target, cloneOptions),
    status: () => git.status(),
  };
}

/** Normalize a target for duplicate detection (posix, no trailing /). */
function targetKey(targetDir: string): string {
  return toPosix(targetDir).replace(/\/+$/, '');
}

/**
 * Clone independent roots in parallel (shallow + blobless by default to
 * cut network). Duplicate targetDirs refuse BEFORE any spawn or mkdir —
 * the structural single-writer rule. Per-target Results stay in spec
 * order; misuse is one outer CONFIG_ERROR.
 */
export async function cloneMany(
  specs: readonly CloneSpec[],
  opts: CloneManyOpts = {},
  runtime?: CloneRuntime
): Promise<Result<Array<Result<string, StitchError>>, StitchError>> {
  const op = 'cloneMany';
  if (!Array.isArray(specs)) {
    return invalid('specs', `${op}: specs must be an array`);
  }
  const seen = new Set<string>();
  let index = 0;
  for (const spec of specs) {
    if (spec === null || typeof spec !== 'object') {
      return invalid(`specs[${index}]`, `${op}: specs[${index}] must be an object`);
    }
    if (isBlank(spec.url)) {
      return invalid(`specs[${index}].url`, `${op}: specs[${index}].url is required`);
    }
    if (isBlank(spec.targetDir)) {
      return invalid(`specs[${index}].targetDir`, `${op}: specs[${index}].targetDir is required`);
    }
    if (spec.branch !== undefined && isBlank(spec.branch)) {
      return invalid(`specs[${index}].branch`, `${op}: specs[${index}].branch must not be blank`);
    }
    const key = targetKey(spec.targetDir);
    if (seen.has(key)) {
      return invalid(
        `specs[${index}].targetDir`,
        `${op}: duplicate targetDir "${spec.targetDir}" (never parallelize over one tree)`
      );
    }
    seen.add(key);
    index += 1;
  }
  if (opts.depth !== undefined && (!Number.isInteger(opts.depth) || opts.depth < 1)) {
    return invalid('depth', `${op}: depth must be an integer >= 1`);
  }

  const shallow = opts.shallow ?? true;
  const depth = opts.depth ?? DEFAULT_CLONE_DEPTH;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_CLONE_TIMEOUT_MS;
  const baseCreateGit = runtime?.createGit ?? defaultCreateGit;
  const createGitFn = opts.blobless === false ? baseCreateGit : withBloblessFilter(baseCreateGit);
  const cloneRuntime: CloneRuntime = { createGit: createGitFn };

  return mapParallel(specs, opts.concurrency ?? DEFAULT_PERF_CONCURRENCY, spec =>
    cloneRepo(
      {
        url: spec.url,
        targetDir: spec.targetDir,
        shallow,
        // Depth is rejected unless shallow (P-069 rule): only send it
        // for shallow clones so explicit full clones stay valid.
        ...(shallow ? { depth } : {}),
        ...(spec.branch !== undefined ? { branch: spec.branch } : {}),
        timeoutMs,
        ...(opts.jobId !== undefined ? { jobId: opts.jobId } : {}),
      },
      cloneRuntime
    )
  ).then(mapped => {
    if (mapped.isErr()) return err(mapped.error);
    // Flatten the runner envelope: cloneRepo never throws (P-069 no-throw
    // contract), so every item is ok(inner) and the inner Result IS the
    // per-target outcome. A runner-level err passes through untouched as
    // the item — loud if P-069 ever regresses.
    return ok(
      mapped.value.map((item): Result<string, StitchError> => {
        if (item.isErr()) return err(item.error);
        return item.value;
      })
    );
  });
}
