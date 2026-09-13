// GitHub fork support (P-099): provision a fork when the upstream is
// not writable, then route push/PR through it — so `stitch add` + merge
// work read-write against any public repo (P-092/078 consumers).
// `ensureFork` checks writability first (short-circuit), creates via
// `repos.createFork`, and polls the fork until it reads back; the
// result carries everything P-078 (push target) and P-094 (fork head
// + upstream base) need, and nothing else performs network calls here.
//
// Verified behavior (probed against real Octokit v22 — do not assume
// otherwise):
// - `rest.repos.get` and `rest.repos.createFork({ owner, repo })` exist
//   (runtime + type probe); the nock suite proves the names at compile
//   time and runtime, plus the wire paths `GET /repos/{owner}/{repo}`
//   and `POST /repos/{owner}/{repo}/forks`.
// - Authenticated `repos.get` carries `permissions: { admin, maintain,
//   push, triage, pull }` (typed on the endpoint); Octokit throws
//   RequestError (`.status`, `.headers`) on non-2xx.
// - createFork answers 202 with the fork Repository object (`name`,
//   `full_name`, `owner.login`); the new fork 404s briefly, then 200s.
//
// Safety contract:
// - Absent permissions fail closed toward forking (never push to an
//   upstream without proven push rights); writable upstreams never
//   fork (no stray forks — creation needs a proven reason).
// - Forking needs explicit `allowFork` authorization (P-293 port,
//   P-093 allowForce precedent); server 403s stay the hard gate.
// - Polls are bounded (attempts + interval); exhaustion refuses with
//   the attempt count — P-096 owns retry/backoff (fail fast here with
//   retry guidance surfaced on rate limits, never AUTH_ERROR).
// - Other statuses reuse the factory taxonomy plus the login hint
//   (P-088); no new codes (P-203 owns taxonomy).
// - Cache keys carry owner/repo/upstream-sha (P-090 rule); without a
//   sha the call runs uncached — never cached under a moving key.
// - Throwing seams map to typed errors; tests throw only inside vitest.
//
// Seams and future phases:
// - P-078 pushes to `ForkInfo.owner/repo`; P-094 opens the PR with head
//   `forkPrHead(...)` against `upstream` base; P-191/211 consume both.
// - P-293 owns RBAC policy (server 403s are the current gate;
//   `allowFork` is the explicit permit until it lands); P-250/240 own
//   ref-level resume (the cache is the dedup layer — a server-side
//   pre-existing fork reached via createFork reports created:true);
//   P-303 persists the cache (raw SHA-keyed records handed over).
// - Error mapping duplicates the sibling GitHub modules by codebase
//   convention (P-203 consolidates when the taxonomy lands).

import { ok, err, type Result } from 'neverthrow';
import type { StitchError } from '../result/index.js';
import { statusToStitchError } from './factory.js';
import type { RefCache } from '../git/perf.js';

const SHA_RE = /^[0-9a-f]{40}$/;

const LOGIN_HINT = 'run `stitch login` or check token scopes';

/** Readiness polls after a 202 (forks 404 briefly, then read back). */
export const DEFAULT_FORK_POLL_ATTEMPTS = 10;
/** Ms between readiness polls. */
export const DEFAULT_FORK_POLL_INTERVAL_MS = 1000;

/** Upstream the fork points at (the PR base side for P-094). */
export interface ForkUpstream {
  owner: string;
  repo: string;
  /** Default branch when the upstream reports one (PR base default). */
  defaultBranch?: string;
}

/**
 * Where to push (P-078) and what to PR from (P-094). `forked:false`
 * means the upstream is writable — push there directly. `created:true`
 * means this call provisioned the fork via createFork.
 */
export interface ForkInfo {
  /** Owner to push to (fork owner when forked, upstream otherwise). */
  owner: string;
  /** Repo to push to (fork repo when forked, upstream otherwise). */
  repo: string;
  /** `owner/repo` of the push target. */
  fullName: string;
  /** True when pushing goes to a fork. */
  forked: boolean;
  /** True when this call provisioned the fork via createFork. */
  created: boolean;
  /** Upstream the fork points at (absent when pushing upstream). */
  upstream?: ForkUpstream;
}

export interface EnsureForkOpts {
  /**
   * Upstream sha the fork must track. Required for caching: keys are
   * `owner/repo@sha/fork`, so upstream moves refetch by construction.
   * Absent: the call runs uncached.
   */
  upstreamSha?: string;
  /** SHA-keyed fork cache (P-303 layer). Absent: no caching. */
  cache?: RefCache<ForkInfo>;
  /**
   * Permit creating a fork when the upstream is not writable (P-293
   * port). Default: true. False refuses before any API call.
   */
  allowFork?: boolean;
  /** Readiness polls after a 202 (>= 1). Default: 10. */
  pollAttempts?: number;
  /** Ms between polls (>= 0). Default: 1000. Tests pass 0. */
  pollIntervalMs?: number;
}

/** Narrow fork seam (`get` + `createFork`, mirroring Octokit exactly). */
export interface ForkReposEndpoint {
  get(args: { owner: string; repo: string }): Promise<{
    data: unknown;
    headers: unknown;
    status: number;
  }>;
  createFork(args: { owner: string; repo: string }): Promise<{
    data: unknown;
    headers: unknown;
    status: number;
  }>;
}

/** Narrow client seam (no full-Octokit fakes in tests). */
export interface ForkClient {
  rest: { repos: ForkReposEndpoint };
}

function invalid(field: string, message: string): Result<never, StitchError> {
  return err({ code: 'CONFIG_ERROR', field, message });
}

function internalError(op: string, message: string): StitchError {
  return { code: 'INTERNAL', message: `${op}: ${message}` };
}

/** Non-blank string (type predicate so callers narrow safely). */
function isNonBlankString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function checkClient(client: ForkClient, op: string): Result<ForkClient, StitchError> {
  if (client === null || typeof client !== 'object') {
    return invalid('client', `${op}: client is required`);
  }
  return ok(client);
}

/** Status mapping reuses the factory taxonomy, enriched with the hint. */
function mapStatus(status: number, statusText: string, op: string): StitchError {
  const base = statusToStitchError(status, statusText, op);
  if (base.code !== 'AUTH_ERROR') return base;
  return { ...base, message: `${base.message} (${LOGIN_HINT})` };
}

/** Case-tolerant single-header read (plain bags and Headers instances). */
function headerValue(headers: unknown, name: string): string | undefined {
  if (typeof headers !== 'object' || headers === null) return undefined;
  const rec = headers as Record<string, unknown>;
  const direct = rec[name];
  if (typeof direct === 'string') return direct;
  const getter = rec['get'];
  if (typeof getter === 'function') {
    const out = (getter as (headerName: string) => unknown).call(rec, name);
    return typeof out === 'string' ? out : undefined;
  }
  return undefined;
}

/** Response headers off a thrown RequestError (direct bag, then nested). */
function thrownHeaders(error: object): unknown {
  const rec = error as { headers?: unknown; response?: unknown };
  if (rec.headers !== undefined) return rec.headers;
  if (typeof rec.response === 'object' && rec.response !== null) {
    return (rec.response as { headers?: unknown }).headers;
  }
  return undefined;
}

/** 429 outright; 403 only with the rate-limit signature (else auth). */
function isRateLimited(status: number, message: string, headers: unknown): boolean {
  if (status !== 403 && status !== 429) return false;
  if (status === 429) return true;
  const remaining = headerValue(headers, 'x-ratelimit-remaining');
  if (remaining !== undefined && remaining.trim() === '0') return true;
  return /rate limit/i.test(message);
}

/**
 * Seconds to wait: `retry-after` first, else the reset epoch, else null.
 * The `(retry after Ns)` message format is the P-096 parse contract.
 */
function retryAfterSecs(headers: unknown): number | null {
  const direct = headerValue(headers, 'retry-after');
  if (direct !== undefined) {
    const secs = Number(direct);
    if (Number.isFinite(secs) && secs >= 0) return Math.floor(secs);
  }
  const reset = headerValue(headers, 'x-ratelimit-reset');
  if (reset !== undefined) {
    const epoch = Number(reset);
    if (Number.isFinite(epoch)) {
      return Math.max(0, Math.ceil(epoch - Date.now() / 1000));
    }
  }
  return null;
}

function rateLimitError(op: string, status: number, headers: unknown): StitchError {
  const after = retryAfterSecs(headers);
  const when = after === null ? 'retry delay unknown' : `retry after ${after}s`;
  return {
    code: 'GITHUB_API_ERROR',
    status,
    message: `${op}: rate limited by GitHub (${when})`,
  };
}

/** Thrown-call mapping: rate limits first, then the status taxonomy. */
function mapCallError(op: string, error: unknown): StitchError {
  if (error instanceof Error) {
    const rec = error as { status?: unknown };
    const status = typeof rec.status === 'number' ? rec.status : 0;
    const headers = thrownHeaders(error);
    if (isRateLimited(status, error.message, headers)) {
      return rateLimitError(op, status, headers);
    }
    return mapStatus(status, error.message, op);
  }
  return {
    code: 'GITHUB_API_ERROR',
    status: 0,
    message: `${op} failed: ${String(error)}`,
  };
}

/** Upstream truth: push rights plus the default branch for routing. */
interface UpstreamTruth {
  push: boolean;
  defaultBranch?: string;
}

function parseUpstream(data: unknown, op: string): Result<UpstreamTruth, StitchError> {
  if (typeof data !== 'object' || data === null) {
    return err(internalError(op, 'repos.get response malformed (not an object)'));
  }
  const rec = data as { permissions?: unknown; default_branch?: unknown };
  let push = false;
  if (rec.permissions !== undefined && rec.permissions !== null) {
    if (typeof rec.permissions !== 'object') {
      return err(internalError(op, 'repos.get permissions malformed (not an object)'));
    }
    push = (rec.permissions as { push?: unknown }).push === true;
  }
  const truth: UpstreamTruth = { push };
  if (isNonBlankString(rec.default_branch)) {
    truth.defaultBranch = rec.default_branch;
  }
  return ok(truth);
}

/** Fork identity out of a 202: owner login + repo name (never invented). */
function parseFork(
  data: unknown,
  op: string
): Result<{ owner: string; repo: string }, StitchError> {
  if (typeof data !== 'object' || data === null) {
    return err(internalError(op, 'createFork response malformed (not an object)'));
  }
  const rec = data as { owner?: unknown; name?: unknown };
  const login =
    typeof rec.owner === 'object' && rec.owner !== null
      ? (rec.owner as { login?: unknown }).login
      : undefined;
  if (!isNonBlankString(login)) {
    return err(internalError(op, 'createFork response malformed (owner.login)'));
  }
  if (!isNonBlankString(rec.name)) {
    return err(internalError(op, 'createFork response malformed (name)'));
  }
  return ok({ owner: login, repo: rec.name });
}

function sleep(ms: number): Promise<void> {
  return new Promise<void>(resolve => {
    setTimeout(resolve, ms);
  });
}

function cacheKey(owner: string, repo: string, sha: string): string {
  return `${owner}/${repo}@${sha}/fork`;
}

function upstreamInfo(owner: string, repo: string, fullName: string): ForkInfo {
  return { owner, repo, fullName, forked: false, created: false };
}

function forkedInfo(owner: string, repo: string, upstream: ForkUpstream): ForkInfo {
  return {
    owner,
    repo,
    fullName: `${owner}/${repo}`,
    forked: true,
    created: true,
    upstream,
  };
}

/**
 * Readiness poll: the fork 404s briefly after a 202, then reads back.
 * 404 keeps polling — resolved AND thrown (real Octokit throws
 * RequestError on non-2xx while fakes resolve statuses; both shapes
 * mean "not ready yet"). Anything else >= 400 or any other throw
 * fails fast (P-096 loops with backoff — this layer surfaces, never
 * spins).
 */
async function waitReady(
  client: ForkClient,
  owner: string,
  repo: string,
  attempts: number,
  intervalMs: number,
  op: string
): Promise<Result<void, StitchError>> {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let status: number;
    try {
      const response = await client.rest.repos.get({ owner, repo });
      status = response.status;
    } catch (error: unknown) {
      const rec = error as { status?: unknown };
      if (error instanceof Error && rec.status === 404) {
        status = 404;
      } else {
        return err(mapCallError(`${op} repos.get(fork)`, error));
      }
    }
    if (status === 404) {
      if (attempt === attempts) break;
      await sleep(intervalMs);
      continue;
    }
    if (status >= 400) {
      return err(mapStatus(status, '', `${op} repos.get(fork)`));
    }
    return ok(undefined);
  }
  return err({
    code: 'GITHUB_API_ERROR',
    status: 0,
    message: `${op}: fork ${owner}/${repo} not ready after ${attempts} polls`,
  });
}

/**
 * Cross-fork PR head for P-094: `owner:branch` (the format openPR
 * consumes as head against the upstream base).
 */
export function forkPrHead(forkOwner: string, branch: string): Result<string, StitchError> {
  const op = 'forkPrHead';
  if (!isNonBlankString(forkOwner) || forkOwner.includes(':') || forkOwner.includes('/')) {
    return invalid('forkOwner', `${op}: forkOwner must be a bare login`);
  }
  if (!isNonBlankString(branch) || branch.includes(':')) {
    return invalid('branch', `${op}: branch must not be blank or contain ':'`);
  }
  return ok(`${forkOwner}:${branch}`);
}

/**
 * Push target for an upstream: the upstream itself when writable, else
 * a provisioned (and ready) fork. Cached per upstream sha when asked.
 */
export async function ensureFork(
  client: ForkClient,
  owner: string,
  repo: string,
  opts: EnsureForkOpts = {}
): Promise<Result<ForkInfo, StitchError>> {
  const op = 'ensureFork';
  const checked = checkClient(client, op);
  if (checked.isErr()) return err(checked.error);
  if (!isNonBlankString(owner)) {
    return invalid('owner', `${op}: owner is required`);
  }
  if (!isNonBlankString(repo)) {
    return invalid('repo', `${op}: repo is required`);
  }
  if (opts.upstreamSha !== undefined && !SHA_RE.test(opts.upstreamSha)) {
    return invalid('upstreamSha', `${op}: upstreamSha must be a 40-hex commit sha`);
  }
  if (opts.cache !== undefined && typeof opts.cache?.get !== 'function') {
    return invalid('cache', `${op}: cache is required`);
  }
  if (opts.allowFork !== undefined && typeof opts.allowFork !== 'boolean') {
    return invalid('allowFork', `${op}: allowFork must be a boolean`);
  }
  if (
    opts.pollAttempts !== undefined &&
    (!Number.isInteger(opts.pollAttempts) || opts.pollAttempts < 1)
  ) {
    return invalid('pollAttempts', `${op}: pollAttempts must be an integer >= 1`);
  }
  if (
    opts.pollIntervalMs !== undefined &&
    (!Number.isInteger(opts.pollIntervalMs) || opts.pollIntervalMs < 0)
  ) {
    return invalid('pollIntervalMs', `${op}: pollIntervalMs must be an integer >= 0`);
  }

  const useCache = opts.cache !== undefined && opts.upstreamSha !== undefined;
  const key = useCache ? cacheKey(owner, repo, opts.upstreamSha as string) : null;
  if (useCache && opts.cache !== undefined && key !== null && opts.upstreamSha !== undefined) {
    const hit = opts.cache.get(key);
    if (hit !== undefined && hit.sha === opts.upstreamSha) {
      return ok(hit.value);
    }
  }

  let upstream: { data: unknown; headers: unknown; status: number };
  try {
    upstream = await checked.value.rest.repos.get({ owner, repo });
  } catch (error: unknown) {
    return err(mapCallError(`${op} repos.get`, error));
  }
  if (upstream.status >= 400) {
    return err(mapStatus(upstream.status, '', `${op} repos.get`));
  }
  const truth = parseUpstream(upstream.data, op);
  if (truth.isErr()) return err(truth.error);

  if (truth.value.push) {
    const direct = upstreamInfo(owner, repo, `${owner}/${repo}`);
    if (useCache && opts.cache !== undefined && key !== null && opts.upstreamSha !== undefined) {
      opts.cache.set(key, opts.upstreamSha, direct);
    }
    return ok(direct);
  }

  if (opts.allowFork === false) {
    return invalid(
      'allowFork',
      `${op}: forking ${owner}/${repo} requires explicit allowFork authorization`
    );
  }

  let forked: { data: unknown; headers: unknown; status: number };
  try {
    forked = await checked.value.rest.repos.createFork({ owner, repo });
  } catch (error: unknown) {
    return err(mapCallError(`${op} repos.createFork`, error));
  }
  if (forked.status >= 400) {
    return err(mapStatus(forked.status, '', `${op} repos.createFork`));
  }
  const identity = parseFork(forked.data, op);
  if (identity.isErr()) return err(identity.error);

  const attempts = opts.pollAttempts ?? DEFAULT_FORK_POLL_ATTEMPTS;
  const intervalMs = opts.pollIntervalMs ?? DEFAULT_FORK_POLL_INTERVAL_MS;
  const ready = await waitReady(
    checked.value,
    identity.value.owner,
    identity.value.repo,
    attempts,
    intervalMs,
    op
  );
  if (ready.isErr()) return err(ready.error);

  const upstreamRef: ForkUpstream = { owner, repo };
  if (truth.value.defaultBranch !== undefined) {
    upstreamRef.defaultBranch = truth.value.defaultBranch;
  }
  const info = forkedInfo(identity.value.owner, identity.value.repo, upstreamRef);
  if (useCache && opts.cache !== undefined && key !== null && opts.upstreamSha !== undefined) {
    opts.cache.set(key, opts.upstreamSha, info);
  }
  return ok(info);
}
