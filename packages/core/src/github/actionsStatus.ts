// GitHub Actions status (P-095): relay workflow runs as normalized
// events for the job timeline (P-241/P-224), verify webhook deliveries,
// map them to the same shape, and correlate runs back to jobs (P-239).
// Polling loops live in P-096 (this module fetches once per call);
// the webhook HTTP route lives in P-193 (this module verifies + maps);
// the bus and job store live in P-241/P-239 (this module returns events
// and matches descriptors). Nothing future is invented here.
//
// Verified behavior (probed via nock against real Octokit v22 — do not
// assume otherwise):
// - `rest.actions.getWorkflowRun` and
//   `rest.actions.listWorkflowRunsForRepo` exist with these exact names
//   (P-089 lesson: the nock suite proves the seam at compile time and
//   runtime); Octokit throws RequestError (`.status`) on non-2xx.
// - In-flight runs carry `conclusion: null`; `head_branch` may be null.
// - GitHub signs deliveries `sha256=<hex hmac>` (P-265).
//
// Safety contract:
// - Malformed runs refuse whole-call (never invent identities — P-089
//   listing precedent); truncated/ambiguous states pass through as
//   strings (forward-compatible, never enum-rejected).
// - Signature mismatches refuse BEFORE parsing (AUTH_ERROR — parse
//   nothing unauthenticated); empty secrets never verify (fail-closed);
//   comparisons are timing-safe with length pre-checks.
// - Correlation is sha-exact with branch preference, first-match-wins,
//   null when nothing matches (never throws, even on garbage inputs).
// - Rate limits map with retry guidance (P-089 pattern, never
//   AUTH_ERROR); other statuses reuse the factory taxonomy plus the
//   login hint (P-088); no new codes (P-203 owns taxonomy).
// - Throwing seams map to typed errors; tests throw only inside vitest.
//
// Seams and future phases:
// - P-096 loops relayWorkflowRun/findRunsForSha with backoff (this
//   module fails fast with retryAfter surfaced); P-241 routes the
//   returned events; P-239 supplies JobRefs; P-193 mounts
//   verify+map on its route; P-178 verdicts flow through setStatus
//   (P-093), not here.
// - Error mapping duplicates the sibling GitHub modules by codebase
//   convention (P-203 consolidates when the taxonomy lands).

import { createHmac, timingSafeEqual } from 'node:crypto';
import { ok, err, type Result } from 'neverthrow';
import type { StitchError } from '../result/index.js';
import { statusToStitchError } from './factory.js';

const SHA_RE = /^[0-9a-f]{40}$/;

const LOGIN_HINT = 'run `stitch login` or check token scopes';

const DEFAULT_PER_PAGE = 30;
const MAX_PER_PAGE = 100;

export type RunKind = 'workflow_run' | 'check_run';

/** Normalized run event (the P-241 bus shape). */
export interface WorkflowRunEvent {
  kind: RunKind;
  runId: number;
  headSha: string;
  headBranch: string | null;
  /** Raw status ('queued'|'in_progress'|'completed' — never enum-gated). */
  status: string;
  /** Null while running; raw string after (never enum-gated). */
  conclusion: string | null;
  url: string;
}

/** Job descriptor for correlation (P-239 supplies these). */
export interface JobRef {
  jobId: string;
  headSha: string;
  ref?: string;
}

export interface FindRunsOpts {
  branch?: string;
  /** Page size 1..100. Default: 30. */
  perPage?: number;
}

/** Narrow actions seam (method names mirror Octokit exactly). */
export interface ActionsRunsEndpoint {
  getWorkflowRun(args: { owner: string; repo: string; run_id: number }): Promise<{
    data: unknown;
    headers: unknown;
    status: number;
  }>;
  listWorkflowRunsForRepo(args: {
    owner: string;
    repo: string;
    branch?: string;
    per_page?: number;
  }): Promise<{ data: unknown; headers: unknown; status: number }>;
}

/** Narrow client seam (no full-Octokit fakes in tests). */
export interface ActionsClient {
  rest: { actions: ActionsRunsEndpoint };
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

function checkClient(client: ActionsClient, op: string): Result<ActionsClient, StitchError> {
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

function parseRun(data: unknown, kind: RunKind, op: string): Result<WorkflowRunEvent, StitchError> {
  if (typeof data !== 'object' || data === null) {
    return err(internalError(op, 'run malformed (not an object)'));
  }
  const rec = data as {
    id?: unknown;
    head_sha?: unknown;
    head_branch?: unknown;
    status?: unknown;
    conclusion?: unknown;
    html_url?: unknown;
  };
  if (typeof rec.id !== 'number' || !Number.isInteger(rec.id)) {
    return err(internalError(op, 'run malformed (id)'));
  }
  if (!isNonBlankString(rec.head_sha) || !SHA_RE.test(rec.head_sha)) {
    return err(internalError(op, 'run malformed (head_sha)'));
  }
  if (!isNonBlankString(rec.status)) {
    return err(internalError(op, 'run malformed (status)'));
  }
  if (!isNonBlankString(rec.html_url)) {
    return err(internalError(op, 'run malformed (html_url)'));
  }
  const branch = rec.head_branch;
  const conclusion = rec.conclusion;
  return ok({
    kind,
    runId: rec.id,
    headSha: rec.head_sha,
    headBranch: typeof branch === 'string' ? branch : null,
    status: rec.status,
    conclusion: typeof conclusion === 'string' ? conclusion : null,
    url: rec.html_url,
  });
}

/**
 * Fetch one run and normalize it (the poll primitive P-096 loops).
 */
export async function relayWorkflowRun(
  client: ActionsClient,
  owner: string,
  repo: string,
  runId: number
): Promise<Result<WorkflowRunEvent, StitchError>> {
  const op = 'relayWorkflowRun';
  const checked = checkClient(client, op);
  if (checked.isErr()) return err(checked.error);
  if (!isNonBlankString(owner)) {
    return invalid('owner', `${op}: owner is required`);
  }
  if (!isNonBlankString(repo)) {
    return invalid('repo', `${op}: repo is required`);
  }
  if (typeof runId !== 'number' || !Number.isInteger(runId) || runId < 1) {
    return invalid('runId', `${op}: runId must be a positive integer`);
  }
  const body = await callJson(
    () => checked.value.rest.actions.getWorkflowRun({ owner, repo, run_id: runId }),
    `${op} actions.getWorkflowRun`
  );
  if (body.isErr()) return err(body.error);
  return parseRun(body.value, 'workflow_run', op);
}

/**
 * List runs filtered to one head SHA (client-side match — the API has
 * no exact-sha filter — so results never depend on server filtering).
 */
export async function findRunsForSha(
  client: ActionsClient,
  owner: string,
  repo: string,
  headSha: string,
  opts: FindRunsOpts = {}
): Promise<Result<WorkflowRunEvent[], StitchError>> {
  const op = 'findRunsForSha';
  const checked = checkClient(client, op);
  if (checked.isErr()) return err(checked.error);
  if (!isNonBlankString(owner)) {
    return invalid('owner', `${op}: owner is required`);
  }
  if (!isNonBlankString(repo)) {
    return invalid('repo', `${op}: repo is required`);
  }
  if (!isNonBlankString(headSha) || !SHA_RE.test(headSha)) {
    return invalid('headSha', `${op}: headSha must be a 40-hex commit SHA`);
  }
  if (opts.branch !== undefined && !isNonBlankString(opts.branch)) {
    return invalid('branch', `${op}: branch must not be blank`);
  }
  const perPage = opts.perPage ?? DEFAULT_PER_PAGE;
  if (!Number.isInteger(perPage) || perPage < 1 || perPage > MAX_PER_PAGE) {
    return invalid('perPage', `${op}: perPage must be an integer 1..${MAX_PER_PAGE}`);
  }
  const body = await callJson(
    () =>
      checked.value.rest.actions.listWorkflowRunsForRepo({
        owner,
        repo,
        ...(opts.branch !== undefined ? { branch: opts.branch } : {}),
        per_page: perPage,
      }),
    `${op} actions.listWorkflowRunsForRepo`
  );
  if (body.isErr()) return err(body.error);
  if (typeof body.value !== 'object' || body.value === null) {
    return err(internalError(op, 'runs body malformed (not an object)'));
  }
  const runs = (body.value as { workflow_runs?: unknown }).workflow_runs;
  if (!Array.isArray(runs)) {
    return err(internalError(op, 'runs body malformed (workflow_runs)'));
  }
  const matched: WorkflowRunEvent[] = [];
  for (const [index, raw] of runs.entries()) {
    const parsed = parseRun(raw, 'workflow_run', `${op} run ${index}`);
    if (parsed.isErr()) return err(parsed.error);
    if (parsed.value.headSha === headSha) matched.push(parsed.value);
  }
  return ok(matched);
}

/**
 * HMAC-SHA256 delivery verification (P-265): exact `sha256=<hex>`
 * match under a timing-safe compare. Anything unexpected (empty
 * secrets, non-strings, length gaps) refuses WITHOUT throwing.
 */
export function verifyWebhookSignature(
  secret: unknown,
  payload: string | Buffer,
  signature: unknown
): boolean {
  if (!isNonBlankString(secret)) return false;
  if (typeof payload !== 'string' && !Buffer.isBuffer(payload)) return false;
  if (typeof signature !== 'string') return false;
  const expected = `sha256=${createHmac('sha256', secret).update(payload).digest('hex')}`;
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signature, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Map a verified delivery to the normalized shape (the P-193 route
 * calls this after reading the raw body). Spoofed or unknown
 * deliveries refuse before any parsing.
 */
export function mapWebhookEvent(
  event: string,
  payload: unknown,
  signature: string,
  secret: string,
  rawBody: string | Buffer
): Result<WorkflowRunEvent, StitchError> {
  const op = 'mapWebhookEvent';
  if (!verifyWebhookSignature(secret, rawBody, signature)) {
    return err({
      code: 'AUTH_ERROR',
      provider: 'github',
      message: `${op}: webhook signature mismatch (spoofed delivery or wrong secret)`,
    });
  }
  if (event !== 'workflow_run' && event !== 'check_run') {
    return invalid('event', `${op}: unknown webhook event ${JSON.stringify(event)}`);
  }
  if (typeof payload !== 'object' || payload === null) {
    return err(internalError(op, 'delivery malformed (not an object)'));
  }
  if (event === 'workflow_run') {
    const run = (payload as { workflow_run?: unknown }).workflow_run;
    return parseRun(run, 'workflow_run', op);
  }
  const run = (payload as { check_run?: unknown }).check_run;
  if (typeof run !== 'object' || run === null) {
    return err(internalError(op, 'delivery malformed (check_run)'));
  }
  const rec = run as {
    id?: unknown;
    head_sha?: unknown;
    status?: unknown;
    conclusion?: unknown;
    html_url?: unknown;
    check_suite?: unknown;
  };
  const suite = rec.check_suite;
  const suiteBranch =
    typeof suite === 'object' && suite !== null
      ? (suite as { head_branch?: unknown }).head_branch
      : undefined;
  return parseRun(
    {
      id: rec.id,
      head_sha: rec.head_sha,
      head_branch: suiteBranch,
      status: rec.status,
      conclusion: rec.conclusion,
      html_url: rec.html_url,
    },
    'check_run',
    op
  );
}

/**
 * Match an event back to its job (P-239 supplies the descriptors):
 * sha-exact, branch-preferred, first-match-wins, null when nothing
 * matches. Pure — never throws, even on garbage inputs.
 */
export function correlateRunToJob(event: WorkflowRunEvent, jobs: JobRef[]): string | null {
  if (event === null || typeof event !== 'object') return null;
  if (!Array.isArray(jobs)) return null;
  if (!isNonBlankString(event.headSha) || !SHA_RE.test(event.headSha)) return null;
  let fallback: string | null = null;
  for (const job of jobs) {
    if (job === null || typeof job !== 'object') continue;
    const ref = job as JobRef;
    if (ref.headSha !== event.headSha) continue;
    if (fallback === null) fallback = ref.jobId;
    if (event.headBranch !== null && ref.ref === event.headBranch) return ref.jobId;
  }
  return fallback;
}
