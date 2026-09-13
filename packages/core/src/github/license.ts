// GitHub repo license detection (P-098): declared license via the API
// (`licenses.getForRepo`), normalized to a canonical SPDX id (P-025)
// with canonical registry metadata (P-026), for the license scan
// (P-118) + picker display. Unknown stays unknown — the pipeline keeps
// flowing so the report (P-128) flags the repo instead of aborting.
//
// Verified behavior (probed against real Octokit v22 — do not assume
// otherwise):
// - `rest.licenses.getForRepo({ owner, repo, ref? })` exists (runtime +
//   type probe); the nock suite proves the name at compile time and
//   runtime, plus the wire path `GET /repos/{owner}/{repo}/license`.
// - Octokit throws RequestError (`.status`, `.headers`) on non-2xx;
//   resolved responses are 2xx (non-2xx resolutions still map).
// - `data.license` carries `{ key, name, spdx_id, url, node_id }`;
//   `spdx_id` is null or `NOASSERTION` when nothing is detectable.
//   The API `url` points at api.github.com — registry metadata wins.
//
// Safety contract:
// - Absent/null/NOASSERTION/unresolvable ids resolve to `{}` (the P-123
//   unknown path), never an error; malformed shapes refuse whole-call
//   (never invent a license — P-089 listing precedent).
// - Rate limits map like P-089 (GITHUB_API_ERROR + retry-after
//   contract, never AUTH_ERROR); other statuses reuse the factory
//   taxonomy plus the login hint (P-088); no new codes (P-203 owns it).
// - Cache keys carry owner/repo/resolved SHA (P-090 rule); without a
//   sha the call runs uncached — never cached under a moving key.
// - Throwing seams map to typed errors; tests throw only inside vitest.
//
// Seams and future phases:
// - P-118 reads this for the license scan; P-125 uses it for the child
//   LICENSE decision; P-126 attributes sources; P-128 aggregates.
// - P-119 owns the full normalization pipeline (this module funnels
//   through P-025 + P-026, the steps that exist today); P-096 loops
//   this call with backoff (fail fast with retryAfter surfaced);
//   P-303 persists the cache (raw SHA-keyed records handed over).
// - Error mapping duplicates the sibling GitHub modules by codebase
//   convention (P-203 consolidates when the taxonomy lands).

import { ok, err, type Result } from 'neverthrow';
import type { StitchError } from '../result/index.js';
import { statusToStitchError } from './factory.js';
import { normalizeLicense } from '../license/normalize.js';
import { lookupLicense } from '../license/spdxIndex.js';
import type { RefCache } from '../git/perf.js';

const SHA_RE = /^[0-9a-f]{40}$/;

const LOGIN_HINT = 'run `stitch login` or check token scopes';

/**
 * Detected license. All fields absent = unknown (P-123 path): the repo
 * declares nothing detectable, so consumers check `spdxId === undefined`
 * and the report flags it instead of aborting.
 */
export interface DetectedLicense {
  /** Canonical SPDX id (e.g. `MIT`). Absent when unknown. */
  spdxId?: string;
  /** Canonical name from the SPDX registry. Absent when unknown. */
  name?: string;
  /** Canonical reference URL from the SPDX registry. Absent when unknown. */
  url?: string;
}

export interface DetectLicenseOpts {
  /** Passed to the API as `?ref=` (branch, tag, or sha). Absent: default branch. */
  ref?: string;
  /**
   * 40-hex sha the detection is pinned to. Required for caching: keys
   * are `owner/repo@sha/license`, so branch moves refetch by
   * construction. Absent: the call runs uncached.
   */
  sha?: string;
  /** SHA-keyed detection cache (P-303 layer). Absent: no caching. */
  cache?: RefCache<DetectedLicense>;
}

/** Narrow license seam (`getForRepo`, mirroring Octokit exactly). */
export interface LicensesEndpoint {
  getForRepo(args: {
    owner: string;
    repo: string;
    ref?: string;
  }): Promise<{ data: unknown; headers: unknown; status: number }>;
}

/** Narrow client seam (no full-Octokit fakes in tests). */
export interface LicenseClient {
  rest: { licenses: LicensesEndpoint };
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

function checkClient(client: LicenseClient, op: string): Result<LicenseClient, StitchError> {
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

/**
 * Raw `spdx_id` out of the payload: null = no license info (unknown),
 * string = candidate for normalization. Anything else is malformed.
 */
function parseSpdxId(data: unknown, op: string): Result<string | null, StitchError> {
  if (typeof data !== 'object' || data === null) {
    return err(internalError(op, 'response malformed (not an object)'));
  }
  const license = (data as { license?: unknown }).license;
  if (license === null || license === undefined) {
    return ok(null);
  }
  if (typeof license !== 'object') {
    return err(internalError(op, 'license malformed (not an object)'));
  }
  const spdxId = (license as { spdx_id?: unknown }).spdx_id;
  if (spdxId === null || spdxId === undefined) {
    return ok(null);
  }
  if (typeof spdxId !== 'string' || spdxId.trim() === '') {
    return err(internalError(op, 'license spdx_id malformed'));
  }
  return ok(spdxId);
}

/**
 * Candidate id to a detection: normalize (P-025), then registry metadata
 * (P-026). Unresolvable at either step is unknown (`{}`), not an error —
 * only a throwing normalizer (upstream bug) propagates.
 */
function toDetection(rawId: string): Result<DetectedLicense, StitchError> {
  const normalized = normalizeLicense(rawId);
  // Defensive only (spdx-correct never throws for string input — the
  // no-throw rule needs the guard, and so does its caller below).
  if (normalized.isErr()) return err(normalized.error);
  const lookedUp = lookupLicense(normalized.value);
  if (lookedUp.isErr()) {
    return ok({});
  }
  const info = lookedUp.value;
  const detection: DetectedLicense = { spdxId: info.id, name: info.name, url: info.url };
  return ok(detection);
}

function cacheKey(owner: string, repo: string, sha: string): string {
  return `${owner}/${repo}@${sha}/license`;
}

/**
 * Declared repo license via the API, normalized to canonical SPDX with
 * registry metadata. Unknown (`{}`) when the repo declares nothing
 * detectable; typed errors for transport and shape failures.
 */
export async function detectRepoLicense(
  client: LicenseClient,
  owner: string,
  repo: string,
  opts: DetectLicenseOpts = {}
): Promise<Result<DetectedLicense, StitchError>> {
  const op = 'detectRepoLicense';
  const checked = checkClient(client, op);
  if (checked.isErr()) return err(checked.error);
  if (!isNonBlankString(owner)) {
    return invalid('owner', `${op}: owner is required`);
  }
  if (!isNonBlankString(repo)) {
    return invalid('repo', `${op}: repo is required`);
  }
  if (opts.ref !== undefined && !isNonBlankString(opts.ref)) {
    return invalid('ref', `${op}: ref must not be blank`);
  }
  if (opts.sha !== undefined && (typeof opts.sha !== 'string' || !SHA_RE.test(opts.sha))) {
    return invalid('sha', `${op}: sha must be a 40-hex commit sha`);
  }
  if (opts.cache !== undefined && typeof opts.cache?.get !== 'function') {
    return invalid('cache', `${op}: cache is required`);
  }

  const useCache = opts.cache !== undefined && opts.sha !== undefined;
  const key = useCache ? cacheKey(owner, repo, opts.sha as string) : null;
  if (useCache && opts.cache !== undefined && key !== null && opts.sha !== undefined) {
    const hit = opts.cache.get(key);
    if (hit !== undefined && hit.sha === opts.sha) {
      return ok(hit.value);
    }
  }

  let response: { data: unknown; headers: unknown; status: number };
  try {
    response = await checked.value.rest.licenses.getForRepo({
      owner,
      repo,
      ...(opts.ref !== undefined ? { ref: opts.ref } : {}),
    });
  } catch (error: unknown) {
    return err(mapCallError(`${op} licenses.getForRepo`, error));
  }
  if (response.status >= 400) {
    return err(mapStatus(response.status, '', `${op} licenses.getForRepo`));
  }

  const parsed = parseSpdxId(response.data, op);
  if (parsed.isErr()) return err(parsed.error);
  const detection = parsed.value === null ? ok({} as DetectedLicense) : toDetection(parsed.value);
  if (detection.isErr()) return err(detection.error);
  if (useCache && opts.cache !== undefined && key !== null && opts.sha !== undefined) {
    opts.cache.set(key, opts.sha, detection.value);
  }
  return ok(detection.value);
}
