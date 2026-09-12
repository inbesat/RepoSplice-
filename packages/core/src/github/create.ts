// GitHub create-repo (P-092): the child repo C comes into existence here
// (empty, then pushed by P-078/P-192) with a safe private default and an
// optional license template (P-125 selects it later; this module passes
// the string through). Availability pre-checks the exact namespace via
// `repos.get` (one call — never a paginated scan); collisions refuse
// with an ALREADY_EXISTS-shaped error whether detected pre-call or via
// a server 422 race; `createIfMissing` resumes instead of refusing.
//
// Verified behavior (probed via nock against real Octokit v22 — do not
// assume otherwise):
// - `rest.repos.get`, `rest.repos.createForAuthenticatedUser`, and
//   `rest.repos.createInOrg` exist with these exact names (P-089 lesson:
//   the nock suite proves the seam at compile time and runtime).
// - Duplicate names fail server-side with 422; missing repos read 404;
//   Octokit throws RequestError (`.status`) on non-2xx.
// - The user variant has no owner to pre-check against, so the login
//   resolves first via `users.getAuthenticated` (which also yields the
//   resume namespace) — org variants skip that call.
//
// Safety contract:
// - Private-by-default (child repos must not leak); explicit false
//   opts out per call. Names validate GitHub's charset/length up front
//   (fail fast, no wasted calls).
// - Unverifiable availability fails CLOSED (never create blindly); stuck
//   sequencers... (no sequencers here) — post-create payloads narrow
//   strictly (identity fields fail closed; default_branch coerces null).
// - 403/401 map with the login hint (the RBAC enforcement signal until
//   P-293; callers validate write scope via P-088 first, P-078
//   precedent); rate limits map with retry guidance (P-089 pattern);
//   no new codes (P-203 owns ALREADY_EXISTS et al — the message carries
//   the token until then).
// - Throwing seams map to typed errors; tests throw only inside vitest.
//
// Seams and future phases:
// - P-125 owns template meaning (string passed through verbatim);
//   P-293 owns RBAC policy (server 403s are the current gate);
//   P-250/240 own ref-level resume (existence resumes today);
//   P-243 owns creation config (safe defaults stand in);
//   P-096 owns retry/backoff (fail fast with retryAfter surfaced).
// - Error mapping duplicates the sibling GitHub modules by codebase
//   convention (P-203 consolidates when the taxonomy lands).

import { ok, err, type Result } from 'neverthrow';
import type { StitchError } from '../result/index.js';
import { statusToStitchError } from './factory.js';

const NAME_RE = /^[A-Za-z0-9._-]+$/;
const MAX_NAME_LENGTH = 100;

const LOGIN_HINT = 'run `stitch login` or check token scopes';
/** Message token P-203 will promote to a code (grep-stable contract). */
const ALREADY_EXISTS = 'ALREADY_EXISTS';

export interface CreateSpec {
  /** Org login. Absent: the authenticated user (login resolved first). */
  owner?: string;
  name: string;
  /** Default true (safe default: child repos must not leak). */
  private?: boolean;
  description?: string;
  /** SPDX/license-template name (P-125 selects; passed through verbatim). */
  licenseTemplate?: string;
  /** Exists → resume instead of refusing. Default false. */
  createIfMissing?: boolean;
}

export interface CreatedRepo {
  fullName: string;
  sshUrl: string;
  htmlUrl: string;
  /** Null for empty repos (never defaulted to a guess). */
  defaultBranch: string | null;
}

/** Narrow create seam (method names mirror Octokit exactly). */
export interface RepoCreateEndpoint {
  get(args: { owner: string; repo: string }): Promise<{
    data: unknown;
    headers: unknown;
    status: number;
  }>;
  createForAuthenticatedUser(args: {
    name: string;
    description?: string;
    private?: boolean;
    license_template?: string;
  }): Promise<{ data: unknown; headers: unknown; status: number }>;
  createInOrg(args: {
    org: string;
    name: string;
    description?: string;
    private?: boolean;
    license_template?: string;
  }): Promise<{ data: unknown; headers: unknown; status: number }>;
}

/** Narrow client seam (no full-Octokit fakes in tests). */
export interface CreateClient {
  rest: {
    repos: RepoCreateEndpoint;
    users: {
      getAuthenticated(): Promise<{ data: unknown; headers: unknown; status: number }>;
    };
  };
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

function checkClient(client: CreateClient, op: string): Result<CreateClient, StitchError> {
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

/** One raw call: throw-mapping plus resolved-status mapping. */
async function callJson(
  call: () => Promise<{ data: unknown; headers: unknown; status: number }>,
  what: string
): Promise<Result<unknown, StitchError>> {
  let response: { data: unknown; headers: unknown; status: number };
  try {
    response = await call();
  } catch (error: unknown) {
    return err(mapCallError(what, error));
  }
  if (response.status >= 400) {
    return err(mapStatus(response.status, '', what));
  }
  return ok(response.data);
}

interface NormalizedSpec {
  owner?: string | undefined;
  name: string;
  isPrivate: boolean;
  description?: string | undefined;
  licenseTemplate?: string | undefined;
  createIfMissing: boolean;
}

function normalizeSpec(spec: CreateSpec, op: string): Result<NormalizedSpec, StitchError> {
  if (spec === null || typeof spec !== 'object') {
    return invalid('spec', `${op}: spec is required`);
  }
  if (!isNonBlankString(spec.name)) {
    return invalid('name', `${op}: name is required`);
  }
  if (!NAME_RE.test(spec.name)) {
    return invalid('name', `${op}: name must match [A-Za-z0-9._-] (got "${spec.name}")`);
  }
  if (spec.name.length > MAX_NAME_LENGTH) {
    return invalid('name', `${op}: name must be at most ${MAX_NAME_LENGTH} characters`);
  }
  if (spec.owner !== undefined && !isNonBlankString(spec.owner)) {
    return invalid('owner', `${op}: owner must not be blank`);
  }
  let isPrivate = true;
  if (spec.private !== undefined) {
    if (typeof spec.private !== 'boolean') {
      return invalid('private', `${op}: private must be a boolean`);
    }
    isPrivate = spec.private;
  }
  if (spec.description !== undefined && typeof spec.description !== 'string') {
    return invalid('description', `${op}: description must be a string`);
  }
  if (spec.licenseTemplate !== undefined && typeof spec.licenseTemplate !== 'string') {
    return invalid('licenseTemplate', `${op}: licenseTemplate must be a string`);
  }
  let createIfMissing = false;
  if (spec.createIfMissing !== undefined) {
    if (typeof spec.createIfMissing !== 'boolean') {
      return invalid('createIfMissing', `${op}: createIfMissing must be a boolean`);
    }
    createIfMissing = spec.createIfMissing;
  }
  return ok({
    ...(spec.owner !== undefined ? { owner: spec.owner } : {}),
    name: spec.name,
    isPrivate,
    ...(spec.description !== undefined ? { description: spec.description } : {}),
    ...(spec.licenseTemplate !== undefined ? { licenseTemplate: spec.licenseTemplate } : {}),
    createIfMissing,
  });
}

function alreadyExists(owner: string, name: string): StitchError {
  return {
    code: 'GITHUB_API_ERROR',
    status: 422,
    message:
      `createRepoC: repo "${owner}/${name}" already exists ` +
      `(${ALREADY_EXISTS}; pass createIfMissing to resume)`,
  };
}

function parseRepo(data: unknown, op: string): Result<CreatedRepo, StitchError> {
  if (typeof data !== 'object' || data === null) {
    return err(internalError(op, 'repo malformed (not an object)'));
  }
  const rec = data as {
    full_name?: unknown;
    ssh_url?: unknown;
    html_url?: unknown;
    default_branch?: unknown;
  };
  if (!isNonBlankString(rec.full_name)) {
    return err(internalError(op, 'repo malformed (full_name)'));
  }
  if (!isNonBlankString(rec.ssh_url)) {
    return err(internalError(op, 'repo malformed (ssh_url)'));
  }
  if (!isNonBlankString(rec.html_url)) {
    return err(internalError(op, 'repo malformed (html_url)'));
  }
  const branch = rec.default_branch;
  return ok({
    fullName: rec.full_name,
    sshUrl: rec.ssh_url,
    htmlUrl: rec.html_url,
    defaultBranch: typeof branch === 'string' ? branch : null,
  });
}

/**
 * Create the child repo (or resume it): resolve the namespace (org, or
 * the authenticated login), pre-check availability, then create — or
 * return the existing repo under `createIfMissing`. Server 422 races
 * converge on the same ALREADY_EXISTS shape.
 */
export async function createRepoC(
  client: CreateClient,
  spec: CreateSpec
): Promise<Result<CreatedRepo, StitchError>> {
  const op = 'createRepoC';
  const checked = checkClient(client, op);
  if (checked.isErr()) return err(checked.error);
  const normalized = normalizeSpec(spec, op);
  if (normalized.isErr()) return err(normalized.error);
  const options = normalized.value;

  let namespace = options.owner;
  if (namespace === undefined) {
    const me = await callJson(
      () => checked.value.rest.users.getAuthenticated(),
      `${op} users.getAuthenticated`
    );
    if (me.isErr()) return err(me.error);
    const login = (me.value as { login?: unknown }).login;
    if (!isNonBlankString(login)) {
      return err(internalError(op, 'authenticated login malformed'));
    }
    namespace = login;
  }

  const existing = await callJson(
    () => checked.value.rest.repos.get({ owner: namespace, repo: options.name }),
    `${op} repos.get`
  );
  if (existing.isErr()) {
    const failure = existing.error;
    if (!(failure.code === 'GITHUB_API_ERROR' && failure.status === 404)) return err(failure);
  } else {
    if (!options.createIfMissing) {
      return err(alreadyExists(namespace, options.name));
    }
    return parseRepo(existing.value, op);
  }

  const createWhat =
    options.owner === undefined
      ? `${op} repos.createForAuthenticatedUser`
      : `${op} repos.createInOrg`;
  let response: { data: unknown; headers: unknown; status: number };
  try {
    response =
      options.owner === undefined
        ? await checked.value.rest.repos.createForAuthenticatedUser({
            name: options.name,
            ...(options.description !== undefined ? { description: options.description } : {}),
            private: options.isPrivate,
            ...(options.licenseTemplate !== undefined
              ? { license_template: options.licenseTemplate }
              : {}),
          })
        : await checked.value.rest.repos.createInOrg({
            org: options.owner,
            name: options.name,
            ...(options.description !== undefined ? { description: options.description } : {}),
            private: options.isPrivate,
            ...(options.licenseTemplate !== undefined
              ? { license_template: options.licenseTemplate }
              : {}),
          });
  } catch (error: unknown) {
    // Server-side race: the name appeared between check and create.
    // (callJson would file 422 under CONFIG per the factory taxonomy;
    // here it means exactly ALREADY_EXISTS.)
    if (error instanceof Error && (error as { status?: unknown }).status === 422) {
      return err(alreadyExists(namespace, options.name));
    }
    return err(mapCallError(createWhat, error));
  }
  if (response.status === 422) {
    return err(alreadyExists(namespace, options.name));
  }
  if (response.status >= 400) {
    return err(mapStatus(response.status, '', createWhat));
  }
  return parseRepo(response.data, op);
}
