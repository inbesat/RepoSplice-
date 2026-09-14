// Central GitHub/Octokit error mapping (P-102). Every P-088–P-100 module
// routes its thrown-call and resolved-status failures through here instead
// of carrying a local copy of the taxonomy, so the CLI (P-203), the web UI,
// and the REST surface (P-297) see one stable code space:
//
//   401                  → AUTH_FAILED (+ login hint)
//   429, rate-limited 403 → RATE_LIMIT (+ P-096 retry guidance)
//   other 403            → FORBIDDEN (+ login hint, scope-shaped)
//   404                  → NOT_FOUND (+ repo/ref hint)
//   409                  → GITHUB_API_ERROR + conflict hint (409 keeps its
//                         transport code; the hint carries the meaning)
//   transport/abort
//   (no HTTP status)   → NETWORK (+ connectivity hint)
//   anything else        → the factory taxonomy untouched (422 stays
//                         CONFIG_ERROR, 5xx stay GITHUB_API_ERROR)
//
// The mapper never throws (P-011 Result contract): unknown shapes,
// hostile header bags, and non-Error rejections all map to a value.
// Pure functions only — no network, no logging, no secrets.
import { statusToStitchError } from './factory.js';
import type { StitchError } from '../result/index.js';

/** Canonical hint: credentials are missing, revoked, or under-scoped. */
export const GITHUB_LOGIN_HINT = 'run `stitch login` or check token scopes';

/** Canonical hint: the resource collided with a concurrent change. */
export const GITHUB_CONFLICT_HINT = 'refresh and retry — another actor changed the resource';

/** Canonical hint: the request never reached GitHub. */
export const GITHUB_NETWORK_HINT = 'check network connectivity and retry';

/** Canonical hint: the address is wrong or the ref does not exist. */
export const GITHUB_NOT_FOUND_HINT = 'check the owner, repo name, and ref';

/** Canonical hint: GitHub asked us to slow down with no usable timer. */
export const GITHUB_BACKOFF_HINT = 'back off and retry later';

/**
 * UI context for a mapped error (P-102 step 2): which operation failed
 * plus the offending repo/scope when the call site knows them. All fields
 * besides `operation` are optional; callers attach them with conditional
 * spreads under exactOptionalPropertyTypes.
 */
export interface GitHubErrorContext {
  operation: string;
  repo?: string;
  scope?: string;
}

/** Copy the UI context onto a mapped error (conditional, never undefined). */
function withContext<T extends StitchError>(error: T, ctx: GitHubErrorContext): T {
  return {
    ...error,
    ...(ctx.repo !== undefined ? { repo: ctx.repo } : {}),
    ...(ctx.scope !== undefined ? { scope: ctx.scope } : {}),
  } as T;
}

/** Case-tolerant single-header read (plain bags and Headers instances). */
function headerValue(headers: unknown, name: string): string | undefined {
  try {
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
  } catch {
    // Hostile header bags (throwing getters, revoked proxies) must not
    // break the no-throw mapping contract; treat as headerless.
    return undefined;
  }
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

/** 429 outright; 403 only with the rate-limit signature (else forbidden). */
function isRateLimited(status: number, message: string, headers: unknown): boolean {
  if (status !== 403 && status !== 429) return false;
  if (status === 429) return true;
  const remaining = headerValue(headers, 'x-ratelimit-remaining');
  if (remaining !== undefined && remaining.trim() === '0') return true;
  return /rate limit/i.test(message);
}

/**
 * Seconds to wait: `retry-after` first, else the reset epoch, else null.
 * The `(retry after Ns)` message format is the P-096 parse contract —
 * withRateLimit reads it back, so this spelling is load-bearing.
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

function rateLimitError(
  op: string,
  status: number,
  headers: unknown,
  ctx: GitHubErrorContext
): StitchError {
  const after = retryAfterSecs(headers);
  const when = after === null ? 'retry delay unknown' : `retry after ${after}s`;
  const hint = after === null ? GITHUB_BACKOFF_HINT : `wait ${after}s then retry`;
  return withContext(
    {
      code: 'RATE_LIMIT',
      status,
      message: `${op}: rate limited by GitHub (${when})`,
      hint,
    },
    ctx
  );
}

/**
 * Numeric HTTP status of a thrown failure (RequestError `.status`), or null
 * when the throw carries no transport status (network/abort/odd shapes).
 */
function thrownStatus(error: object): number | null {
  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' ? status : null;
}

const NETWORK_NAMES = new Set(['AbortError', 'TimeoutError']);
const NETWORK_CODES = new Set([
  'ABORT_ERR',
  'ECONNREFUSED',
  'ECONNRESET',
  'EAI_AGAIN',
  'ENOTFOUND',
  'ETIMEDOUT',
  'EPIPE',
  'EHOSTUNREACH',
  'EHOSTDOWN',
  'ENETUNREACH',
  'ENETDOWN',
]);
const NETWORK_MESSAGE_RE =
  /fetch failed|failed to fetch|socket hang up|hang up|aborted|abort|timed out|timeout|econn|enotfound|etimedout|enet|eai_again|epipe|ehost/i;

/**
 * Transport failure without an HTTP status: fetch TypeErrors, socket
 * errors, DNS errors, timeouts, and aborts (including DOMException
 * AbortErrors, which are not `instanceof Error` in some runtimes).
 * Anything from the transport layer with no status qualifies — only an
 * Octokit call failure reaches this mapper, so a status-less throw here
 * means the request never completed.
 */
function isNetworkLike(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const rec = error as { name?: unknown; code?: unknown; message?: unknown };
  if (typeof rec.name === 'string' && NETWORK_NAMES.has(rec.name)) return true;
  if (typeof rec.code === 'string' && NETWORK_CODES.has(rec.code)) return true;
  return typeof rec.message === 'string' && NETWORK_MESSAGE_RE.test(rec.message);
}

function networkError(op: string, error: unknown, ctx: GitHubErrorContext): StitchError {
  const detail = error instanceof Error ? error.message : String(error);
  return withContext(
    {
      code: 'NETWORK',
      message: `${op} failed: ${detail}`,
      hint: GITHUB_NETWORK_HINT,
    },
    ctx
  );
}

/** 409 keeps its transport code; the conflict hint rides along typed. */
function conflictError(op: string, statusText: string, ctx: GitHubErrorContext): StitchError {
  return withContext(
    {
      code: 'GITHUB_API_ERROR',
      status: 409,
      message: `${op}: 409 ${statusText} (${GITHUB_CONFLICT_HINT})`,
      hint: GITHUB_CONFLICT_HINT,
    },
    ctx
  );
}

/**
 * Map a thrown Octokit-call failure to a stable StitchError (never throws).
 * Rate limits first, then the status taxonomy with P-102 codes, then the
 * network probe, then the generic fallback.
 */
export function mapGitHubError(err: unknown, ctx: GitHubErrorContext): StitchError {
  const op = ctx.operation;
  if (typeof err === 'object' && err !== null) {
    const status = thrownStatus(err);
    if (status !== null) {
      const headers = thrownHeaders(err);
      const message = err instanceof Error ? err.message : String(err);
      if (isRateLimited(status, message, headers)) {
        return rateLimitError(op, status, headers, ctx);
      }
      return mapGitHubStatus(status, message, ctx);
    }
    if (isNetworkLike(err)) {
      return networkError(op, err, ctx);
    }
    if (err instanceof Error) {
      return {
        code: 'GITHUB_API_ERROR',
        status: 0,
        message: `${op} failed: ${err.message}`,
      };
    }
  }
  return {
    code: 'GITHUB_API_ERROR',
    status: 0,
    message: `${op} failed: ${String(err)}`,
  };
}

/**
 * Map a resolved non-2xx HTTP status to a stable StitchError (never throws).
 * Pure status taxonomy with P-102 codes; no header sniffing here — resolved
 * responses carry no throw context, and the throw path owns rate parsing.
 */
export function mapGitHubStatus(
  status: number,
  statusText: string,
  ctx: GitHubErrorContext
): StitchError {
  const op = ctx.operation;
  if (status === 401) {
    return withContext(
      {
        code: 'AUTH_FAILED',
        provider: 'github',
        message: `${op}: ${status} ${statusText} (${GITHUB_LOGIN_HINT})`,
        hint: GITHUB_LOGIN_HINT,
      },
      ctx
    );
  }
  if (status === 403) {
    return withContext(
      {
        code: 'FORBIDDEN',
        provider: 'github',
        message: `${op}: ${status} ${statusText} (${GITHUB_LOGIN_HINT})`,
        hint: GITHUB_LOGIN_HINT,
      },
      ctx
    );
  }
  if (status === 404) {
    return withContext(
      {
        code: 'NOT_FOUND',
        status,
        message: `${op}: ${status} ${statusText}`,
        hint: GITHUB_NOT_FOUND_HINT,
      },
      ctx
    );
  }
  if (status === 409) {
    return conflictError(op, statusText, ctx);
  }
  return statusToStitchError(status, statusText, op);
}

/**
 * Terminal P-096 exhaustion error: the retry budget ran out on rate
 * signals. Carries the stable RATE_LIMIT code (not the generic transport
 * code) so the UI can tell "slow down" apart from "broken".
 */
export function rateLimitExhausted(
  op: string,
  status: number,
  attempts: number
): Extract<StitchError, { code: 'RATE_LIMIT' }> {
  return {
    code: 'RATE_LIMIT',
    status,
    message:
      `${op}: budget exhausted after ${attempts} attempt${attempts === 1 ? '' : 's'} ` +
      `(last status ${status})`,
    hint: 'reduce request rate or raise the retry budget',
  };
}
