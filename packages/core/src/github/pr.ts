// GitHub open-PR (P-094): the visible, reviewable deliverable of a
// merge — deterministic bodies from report/provenance/CREDITS sections,
// sandbox statuses posted ahead of creation, and idempotent skips when
// the head already has an open PR (P-250).
//
// Verified behavior (probed via nock against real Octokit v22 — do not
// assume otherwise):
// - `rest.pulls.create` and `rest.pulls.list` exist with these exact
//   names (P-089 lesson: the nock suite proves the seam at compile time
//   and runtime); list filters by `state` + `head`, create takes the
//   bare branch (forks use `user:ref`, same-repo uses the branch).
// - Duplicate PRs fail with 422 ("already exists"); Octokit throws
//   RequestError (`.status`) on non-2xx.
//
// Safety contract:
// - Skip-check FIRST (list + local match-back on open state and exact
//   head ref): closed decoys and other heads never trigger a skip, and
//   a filter-ignoring server still cannot cause a wrong skip.
// - Statuses post BEFORE creation (so checks exist when the PR opens);
//   a failing status aborts the whole op (fail-closed — no gateless
//   PRs). Skips post nothing (the open PR already has its checks; a
//   crash between status and create resumes cleanly through the same
//   path — repost is a context-keyed update).
// - Bodies build deterministically from sections (P-282: identical
//   input, identical bytes); garbage sections coerce to absent, never
//   throw.
// - Duplicate races converge on an ALREADY_EXISTS-shaped error whether
//   pre-detected or via server 422 (P-092 pattern, P-203 promotes).
// - Rate limits map with retry guidance (P-089 pattern, never
//   AUTH_ERROR); other statuses reuse the factory taxonomy plus the
//   login hint (P-088); no new codes (P-203 owns taxonomy).
// - Throwing seams map to typed errors; tests throw only inside vitest.
//
// Seams and future phases:
// - P-116/P-128 own the merge report, P-181/182 provenance/CREDITS
//   (sections arrive as input, embedded verbatim); P-177 supplies
//   verdicts (posted via P-093's setStatus, reused — never
//   reimplemented); P-096 owns retry/backoff (fail fast with retryAfter
//   surfaced); P-192 drives this end to end.
// - Error mapping duplicates the sibling GitHub modules by codebase
//   convention (P-203 consolidates when the taxonomy lands).

import { ok, err, type Result } from 'neverthrow';
import type { StitchError } from '../result/index.js';
import { statusToStitchError } from './factory.js';
import { setStatus, type BranchClient, type CommitState } from './branches.js';

const SHA_RE = /^[0-9a-f]{40}$/;

const LOGIN_HINT = 'run `stitch login` or check token scopes';
/** Message token P-203 will promote to a code (grep-stable contract). */
const ALREADY_EXISTS = 'ALREADY_EXISTS';

const LIST_PER_PAGE = 30;

/** Body sections (P-116/P-128 report, P-181/182 provenance+CREDITS). */
export interface PrBodySections {
  summary?: string;
  credits?: string;
  provenance?: string[];
}

export interface PrSpec {
  base: string;
  head: string;
  title: string;
  /** Verbatim text, or sections for the deterministic builder. */
  body?: string | PrBodySections;
  draft?: boolean;
}

export interface PrStatusOpts {
  sha: string;
  context: string;
  state: CommitState;
  description?: string;
  targetUrl?: string;
}

export interface PrOpts {
  status?: PrStatusOpts;
}

export interface OpenedPr {
  number: number;
  url: string;
  headSha: string;
  skipped: boolean;
}

/** Narrow pulls seam (method names + literal shapes mirror Octokit exactly). */
export interface PrPullsEndpoint {
  create(args: {
    owner: string;
    repo: string;
    title: string;
    head: string;
    base: string;
    body: string;
    draft: boolean;
  }): Promise<{ data: unknown; headers: unknown; status: number }>;
  list(args: {
    owner: string;
    repo: string;
    state: 'open' | 'closed' | 'all';
    head: string;
    per_page?: number;
  }): Promise<{ data: unknown; headers: unknown; status: number }>;
}

/** Narrow client seam (P-093's client plus pulls). */
export type PrClient = BranchClient & { rest: { pulls: PrPullsEndpoint } };

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

function checkClient(client: PrClient, op: string): Result<PrClient, StitchError> {
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

/**
 * Deterministic body builder: sections in fixed order, blank sections
 * dropped, garbage coerced to absent (never throws). Identical input
 * always yields identical bytes (P-282).
 */
export function buildPrBody(input: PrBodySections): string {
  const src = (input ?? {}) as { summary?: unknown; credits?: unknown; provenance?: unknown };
  const text = (value: unknown): string | null => {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  };
  const sections: string[] = [];
  const summary = text(src.summary);
  if (summary !== null) sections.push(summary);
  const credits = text(src.credits);
  if (credits !== null) sections.push(`## Credits\n${credits}`);
  const rawProvenance = Array.isArray(src.provenance) ? src.provenance : [];
  const lines: string[] = [];
  for (const item of rawProvenance) {
    const line = text(item);
    if (line !== null) lines.push(`- ${line}`);
  }
  if (lines.length > 0) sections.push(`## Provenance\n${lines.join('\n')}`);
  return sections.join('\n\n');
}

function checkBranchRef(value: string, field: string, op: string): Result<string, StitchError> {
  if (!isNonBlankString(value)) {
    return invalid(field, `${op}: ${field} is required`);
  }
  // The server is the final ref-format validator (422-mapped); the
  // client only rejects what cannot travel (whitespace).
  if (/\s/.test(value)) {
    return invalid(field, `${op}: ${field} must not contain whitespace ("${value}")`);
  }
  return ok(value);
}

function parsePrHead(
  data: unknown,
  op: string
): Result<{ ref: string; sha: string; number: number; url: string } | null, StitchError> {
  if (typeof data !== 'object' || data === null) {
    return err(internalError(op, 'pull malformed (not an object)'));
  }
  const rec = data as { number?: unknown; html_url?: unknown; head?: unknown; state?: unknown };
  if (typeof rec.number !== 'number' || !Number.isInteger(rec.number)) {
    return err(internalError(op, 'pull malformed (number)'));
  }
  if (!isNonBlankString(rec.html_url)) {
    return err(internalError(op, 'pull malformed (html_url)'));
  }
  const head = rec.head;
  if (typeof head !== 'object' || head === null) {
    return err(internalError(op, 'pull malformed (head)'));
  }
  const hrec = head as { ref?: unknown; sha?: unknown };
  if (!isNonBlankString(hrec.ref)) {
    return err(internalError(op, 'pull malformed (head.ref)'));
  }
  if (!isNonBlankString(hrec.sha) || !SHA_RE.test(hrec.sha)) {
    return err(internalError(op, 'pull malformed (head.sha)'));
  }
  if (rec.state !== undefined && rec.state !== 'open') {
    return ok(null);
  }
  return ok({ ref: hrec.ref, sha: hrec.sha, number: rec.number, url: rec.html_url });
}

function parsePr(
  data: unknown,
  op: string
): Result<{ number: number; url: string; headSha: string }, StitchError> {
  const parsed = parsePrHead(data, op);
  if (parsed.isErr()) return err(parsed.error);
  if (parsed.value === null) {
    return err(internalError(op, 'pull malformed (not open)'));
  }
  return ok({ number: parsed.value.number, url: parsed.value.url, headSha: parsed.value.sha });
}

/**
 * Open a PR for a head branch: skip when one is already open (matched
 * locally on open state + exact head), post the sandbox status, then
 * create. Duplicate races converge on ALREADY_EXISTS.
 */
export async function openPR(
  client: PrClient,
  owner: string,
  repo: string,
  spec: PrSpec,
  opts: PrOpts = {}
): Promise<Result<OpenedPr, StitchError>> {
  const op = 'openPR';
  const checked = checkClient(client, op);
  if (checked.isErr()) return err(checked.error);
  if (!isNonBlankString(owner)) {
    return invalid('owner', `${op}: owner is required`);
  }
  if (!isNonBlankString(repo)) {
    return invalid('repo', `${op}: repo is required`);
  }
  if (spec === null || typeof spec !== 'object') {
    return invalid('spec', `${op}: spec is required`);
  }
  const base = checkBranchRef(spec.base, 'base', op);
  if (base.isErr()) return err(base.error);
  const head = checkBranchRef(spec.head, 'head', op);
  if (head.isErr()) return err(head.error);
  if (!isNonBlankString(spec.title)) {
    return invalid('title', `${op}: title is required`);
  }
  if (spec.draft !== undefined && typeof spec.draft !== 'boolean') {
    return invalid('draft', `${op}: draft must be a boolean`);
  }
  if (opts.status !== undefined && (opts.status === null || typeof opts.status !== 'object')) {
    return invalid('status', `${op}: status must be an object`);
  }
  const colon = head.value.indexOf(':');
  const bareHead = colon === -1 ? head.value : head.value.slice(colon + 1);
  const filterHead = colon === -1 ? `${owner}:${head.value}` : head.value;

  const listed = await callJson(
    () =>
      checked.value.rest.pulls.list({
        owner,
        repo,
        state: 'open',
        head: filterHead,
        per_page: LIST_PER_PAGE,
      }),
    `${op} pulls.list`
  );
  if (listed.isErr()) return err(listed.error);
  if (!Array.isArray(listed.value)) {
    return err(internalError(op, 'pull list malformed (not an array)'));
  }
  for (const [index, raw] of listed.value.entries()) {
    const matched = parsePrHead(raw, `${op} list item ${index}`);
    if (matched.isErr()) return err(matched.error);
    if (matched.value !== null && matched.value.ref === bareHead) {
      return ok({
        number: matched.value.number,
        url: matched.value.url,
        headSha: matched.value.sha,
        skipped: true,
      });
    }
  }

  if (opts.status !== undefined) {
    const posted = await setStatus(client, owner, repo, opts.status.sha, {
      context: opts.status.context,
      state: opts.status.state,
      ...(opts.status.description !== undefined ? { description: opts.status.description } : {}),
      ...(opts.status.targetUrl !== undefined ? { targetUrl: opts.status.targetUrl } : {}),
    });
    if (posted.isErr()) return err(posted.error);
  }

  const body = typeof spec.body === 'string' ? spec.body : buildPrBody(spec.body ?? {});
  let response: { data: unknown; headers: unknown; status: number };
  try {
    response = await checked.value.rest.pulls.create({
      owner,
      repo,
      title: spec.title,
      head: head.value,
      base: base.value,
      body,
      draft: spec.draft ?? false,
    });
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      (error as { status?: unknown }).status === 422 &&
      /already exists/i.test(error.message)
    ) {
      return err({
        code: 'GITHUB_API_ERROR',
        status: 422,
        message: `${op}: pull request already open for "${head.value}" (${ALREADY_EXISTS})`,
      });
    }
    return err(mapCallError(`${op} pulls.create`, error));
  }
  if (response.status === 422) {
    return err({
      code: 'GITHUB_API_ERROR',
      status: 422,
      message: `${op}: pull request already open for "${head.value}" (${ALREADY_EXISTS})`,
    });
  }
  if (response.status >= 400) {
    return err(mapStatus(response.status, '', `${op} pulls.create`));
  }
  const parsed = parsePr(response.data, op);
  if (parsed.isErr()) return err(parsed.error);
  return ok({ ...parsed.value, skipped: false });
}
