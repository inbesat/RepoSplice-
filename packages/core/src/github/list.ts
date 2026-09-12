// GitHub list/search (P-089): enumerate and search repos for the source
// pickers (P-191/P-211) and the batch scheduler (P-290/291).
// `listRepos` pages `listForAuthenticatedUser` to exhaustion (short page
// or maxPages); `searchRepos` pages `search.repos` surfacing total +
// incompleteness. Both return typed summaries; failures are typed errors
// with the failing page attached.
//
// Verified behavior (probed via nock against real Octokit v22 — do not
// assume otherwise):
// - Octokit throws RequestError (`.status`, `.headers`) on non-2xx, so
//   resolved responses are 2xx; the seam still maps resolved non-2xx
//   defensively (fakes can produce them).
// - PAT list/search responses carry no scopes header of interest; rate
//   limits surface as 403 with `x-ratelimit-remaining: 0` (or a "rate
//   limit" message) and 429 outright, with `retry-after` (seconds) or
//   `x-ratelimit-reset` (epoch seconds) hinting the wait.
// - Real Octokit satisfies the narrow seam structurally (proven by the
//   nock tests passing a genuine client — compile time and runtime).
//
// Safety contract:
// - Malformed identities fail CLOSED (INTERNAL, whole call): listing is
//   identity data, so one bad repo refuses the batch rather than
//   inventing owners (unlike P-031 work batches, which isolate per item).
// - `defaultBranch: null` is honest (empty repos have none) — never
//   defaulted to a branch name that might not exist.
// - Rate limits are GITHUB_API_ERROR (never AUTH_ERROR: the token is
//   fine) with a stable `(retry after Ns)` message contract P-096 will
//   parse for its wait-and-retry loop — no sleep loop is faked here.
// - Non-rate 401/403 reuse the factory taxonomy plus the login hint
//   (P-088); no new StitchError codes (P-203 owns taxonomy).
// - Throwing seams map to typed errors; tests throw only inside vitest.
//
// Seams and future phases:
// - P-096 owns backoff/retry (this module fails fast with retryAfter
//   surfaced); P-303 owns cursor persistence (maxPages bounds the walk
//   until cursors land); P-252 owns license-policy meaning (license is
//   carried, not judged).

import { ok, err, type Result } from 'neverthrow';
import type { StitchError } from '../result/index.js';
import { statusToStitchError } from './factory.js';

export type RepoVisibility = 'all' | 'public' | 'private';
export type RepoSort = 'created' | 'updated' | 'pushed' | 'full_name';

const VISIBILITIES: readonly RepoVisibility[] = ['all', 'public', 'private'];
const SORTS: readonly RepoSort[] = ['created', 'updated', 'pushed', 'full_name'];

const DEFAULT_PER_PAGE = 30;
const MAX_PER_PAGE = 100;
const DEFAULT_MAX_PAGES = 10;

const LOGIN_HINT = 'run `stitch login` or check token scopes';

export interface ListReposOpts {
  visibility?: RepoVisibility;
  sort?: RepoSort;
  /** Page size 1..100. Default: 30. */
  perPage?: number;
  /** Page cap >= 1 (P-303 cursors lift this later). Default: 10. */
  maxPages?: number;
}

export interface SearchReposOpts {
  /** Page size 1..100. Default: 30. */
  perPage?: number;
  /** Page cap >= 1. Default: 10. */
  maxPages?: number;
}

/** Picker-ready repo identity (P-252-adjacent; license carried, unjudged). */
export interface RepoSummary {
  owner: string;
  name: string;
  fullName: string;
  /** Null for empty repos (never defaulted to a guess). */
  defaultBranch: string | null;
  private: boolean;
  /** SPDX id preferred, registry key fallback, absent when unknown. */
  license?: string;
}

export interface RepoSearchResult {
  total: number;
  /** True when GitHub timed out server-side (results partial). */
  incomplete: boolean;
  items: RepoSummary[];
}

/** Narrow list seam (real Octokit satisfies this structurally). */
export interface RepoListEndpoint {
  listForAuthenticatedUser(args: {
    visibility?: RepoVisibility;
    sort?: RepoSort;
    per_page?: number;
    page?: number;
  }): Promise<{ data: unknown; headers: unknown; status: number }>;
}

/** Narrow search seam (`repos`, mirroring Octokit exactly). */
export interface RepoSearchEndpoint {
  repos(args: {
    q: string;
    per_page?: number;
    page?: number;
  }): Promise<{ data: unknown; headers: unknown; status: number }>;
}

/** Narrow client seam (no full-Octokit fakes in tests). */
export interface RepoClient {
  rest: { repos: RepoListEndpoint; search: RepoSearchEndpoint };
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

function checkClient(client: RepoClient, op: string): Result<RepoClient, StitchError> {
  if (client === null || typeof client !== 'object') {
    return invalid('client', `${op}: client is required`);
  }
  return ok(client);
}

function checkPaging(
  perPage: number | undefined,
  maxPages: number | undefined,
  op: string
): Result<{ perPage: number; maxPages: number }, StitchError> {
  const per = perPage ?? DEFAULT_PER_PAGE;
  if (!Number.isInteger(per) || per < 1 || per > MAX_PER_PAGE) {
    return invalid('perPage', `${op}: perPage must be an integer 1..${MAX_PER_PAGE}`);
  }
  const max = maxPages ?? DEFAULT_MAX_PAGES;
  if (!Number.isInteger(max) || max < 1) {
    return invalid('maxPages', `${op}: maxPages must be an integer >= 1`);
  }
  return ok({ perPage: per, maxPages: max });
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

function parseRepo(data: unknown, where: string): Result<RepoSummary, StitchError> {
  if (typeof data !== 'object' || data === null) {
    return err(internalError(where, 'repo malformed (not an object)'));
  }
  const rec = data as {
    owner?: unknown;
    name?: unknown;
    full_name?: unknown;
    default_branch?: unknown;
    private?: unknown;
    license?: unknown;
  };
  const ownerRec = rec.owner;
  if (typeof ownerRec !== 'object' || ownerRec === null) {
    return err(internalError(where, 'repo malformed (owner)'));
  }
  const login = (ownerRec as { login?: unknown }).login;
  if (!isNonBlankString(login)) {
    return err(internalError(where, 'repo malformed (owner.login)'));
  }
  if (!isNonBlankString(rec.name)) {
    return err(internalError(where, 'repo malformed (name)'));
  }
  if (!isNonBlankString(rec.full_name)) {
    return err(internalError(where, 'repo malformed (full_name)'));
  }
  let defaultBranch: string | null = null;
  if (rec.default_branch !== null && rec.default_branch !== undefined) {
    if (!isNonBlankString(rec.default_branch)) {
      return err(internalError(where, 'repo malformed (default_branch)'));
    }
    defaultBranch = rec.default_branch;
  }
  if (typeof rec.private !== 'boolean') {
    return err(internalError(where, 'repo malformed (private)'));
  }
  let license: string | undefined;
  const lic = rec.license;
  if (lic !== null && lic !== undefined) {
    if (typeof lic !== 'object') {
      return err(internalError(where, 'repo malformed (license)'));
    }
    const lrec = lic as { spdx_id?: unknown; key?: unknown };
    if (isNonBlankString(lrec.spdx_id)) license = lrec.spdx_id;
    else if (isNonBlankString(lrec.key)) license = lrec.key;
  }
  return ok({
    owner: login,
    name: rec.name,
    fullName: rec.full_name,
    defaultBranch,
    ...(license !== undefined ? { license } : {}),
    private: rec.private,
  });
}

function parseSearchBody(
  data: unknown,
  where: string
): Result<{ total: number; incomplete: boolean; items: RepoSummary[] }, StitchError> {
  if (typeof data !== 'object' || data === null) {
    return err(internalError(where, 'search body malformed (not an object)'));
  }
  const rec = data as { total_count?: unknown; incomplete_results?: unknown; items?: unknown };
  if (typeof rec.total_count !== 'number') {
    return err(internalError(where, 'search body malformed (total_count)'));
  }
  if (!Array.isArray(rec.items)) {
    return err(internalError(where, 'search body malformed (items)'));
  }
  const items: RepoSummary[] = [];
  for (const [index, raw] of rec.items.entries()) {
    const parsed = parseRepo(raw, `${where} item ${index}`);
    if (parsed.isErr()) return err(parsed.error);
    items.push(parsed.value);
  }
  return ok({
    total: rec.total_count,
    incomplete: rec.incomplete_results === true,
    items,
  });
}

/**
 * Enumerate the authenticated user's repos, oldest page first. Stops at
 * the first short page or maxPages (a full multiple costs one empty
 * trailing fetch — documented, harmless, and covered).
 */
export async function listRepos(
  client: RepoClient,
  opts: ListReposOpts = {}
): Promise<Result<RepoSummary[], StitchError>> {
  const op = 'listRepos';
  const checked = checkClient(client, op);
  if (checked.isErr()) return err(checked.error);
  const paging = checkPaging(opts.perPage, opts.maxPages, op);
  if (paging.isErr()) return err(paging.error);
  if (opts.visibility !== undefined && !VISIBILITIES.includes(opts.visibility)) {
    return invalid('visibility', `${op}: visibility must be all, public, or private`);
  }
  if (opts.sort !== undefined && !SORTS.includes(opts.sort)) {
    return invalid('sort', `${op}: sort must be created, updated, pushed, or full_name`);
  }
  const { perPage, maxPages } = paging.value;
  const items: RepoSummary[] = [];
  for (let page = 1; page <= maxPages; page += 1) {
    let response: { data: unknown; headers: unknown; status: number };
    try {
      response = await checked.value.rest.repos.listForAuthenticatedUser({
        ...(opts.visibility !== undefined ? { visibility: opts.visibility } : {}),
        ...(opts.sort !== undefined ? { sort: opts.sort } : {}),
        per_page: perPage,
        page,
      });
    } catch (error: unknown) {
      return err(mapCallError(`${op} page ${page}`, error));
    }
    if (response.status >= 400) {
      return err(mapStatus(response.status, '', `${op} page ${page}`));
    }
    if (!Array.isArray(response.data)) {
      return err(internalError(op, `page ${page} malformed (items not an array)`));
    }
    for (const [index, raw] of response.data.entries()) {
      const parsed = parseRepo(raw, `${op} page ${page} item ${index}`);
      if (parsed.isErr()) return err(parsed.error);
      items.push(parsed.value);
    }
    if (response.data.length < perPage) break;
  }
  return ok(items);
}

/**
 * Search repos by query, surfacing the server total (which may exceed the
 * paged items) and whether the result set is incomplete.
 */
export async function searchRepos(
  client: RepoClient,
  query: string,
  opts: SearchReposOpts = {}
): Promise<Result<RepoSearchResult, StitchError>> {
  const op = 'searchRepos';
  const checked = checkClient(client, op);
  if (checked.isErr()) return err(checked.error);
  if (!isNonBlankString(query)) {
    return invalid('query', `${op}: query is required`);
  }
  const paging = checkPaging(opts.perPage, opts.maxPages, op);
  if (paging.isErr()) return err(paging.error);
  const { perPage, maxPages } = paging.value;
  let total = 0;
  let incomplete = false;
  const items: RepoSummary[] = [];
  for (let page = 1; page <= maxPages; page += 1) {
    let response: { data: unknown; headers: unknown; status: number };
    try {
      response = await checked.value.rest.search.repos({
        q: query,
        per_page: perPage,
        page,
      });
    } catch (error: unknown) {
      return err(mapCallError(`${op} page ${page}`, error));
    }
    if (response.status >= 400) {
      return err(mapStatus(response.status, '', `${op} page ${page}`));
    }
    const body = parseSearchBody(response.data, `${op} page ${page}`);
    if (body.isErr()) return err(body.error);
    if (page === 1) total = body.value.total;
    incomplete = incomplete || body.value.incomplete;
    items.push(...body.value.items);
    if (body.value.items.length < perPage) break;
  }
  return ok({ total, incomplete, items });
}
