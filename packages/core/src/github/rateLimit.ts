// GitHub rate-limit backoff (P-096): jittered exponential waits honoring
// server retry guidance, so batch operations (P-091/290) and polls
// (P-095) neither 429-spam nor fail spuriously. `withRateLimit` wraps
// any Result-returning op — including the P-089–095 module calls, which
// it composes WITHOUT modifying (read ops retry safely; the threading
// is proven by the composition suite, and P-238/P-290 wrap at call
// sites). Telemetry flows to `onRetry` (and `parseRateHeaders` reads
// raw headers) for the analytics panel (P-295).
//
// Verified behavior (probed, do not assume otherwise):
// - Sibling modules surface rate limits as GITHUB_API_ERROR carrying
//   `(retry after Ns)` (retry-after header or reset-epoch derived) or
//   `(retry delay unknown)` — that message contract is the ONLY retry
//   signal (no new StitchError codes until P-203).
// - Equal jitter (P-139 parity): sleep = floor + rand * curve, so waits
//   stay within [floor, floor + curve] and always honor server asks.
//
// Safety contract:
// - Only rate signals retry (GITHUB_API_ERROR with a rate marker);
//   auth/config/internal/transport errors return immediately, unwrapped
//   and unmodified — never spin on a bad token.
// - Two caps, whichever hits first: attempt count and total wait budget;
//   exhaustion fails loud with attempts + last status (never silent,
//   never partial sleeps past the budget).
// - Throwing ops, sleepers, clocks, and observers all map to INTERNAL
//   or are contained (observers must not fail ops) — nothing escapes as
//   a rejection; no new StitchError codes (P-203 owns taxonomy).
// - Fake clocks/randoms make every wait deterministic in tests; the one
//   real-timer test uses ~10ms waits (no flake surface).
//
// Seams and future phases:
// - P-203 owns the RATE_LIMIT code (this module emits GITHUB_API_ERROR
//   with the stable retry contract until then); P-290 loops batches
//   through this wrapper; P-295 consumes onRetry + parseRateHeaders.
// - Error mapping duplicates the sibling GitHub modules by codebase
//   convention (P-203 consolidates when the taxonomy lands).

import { ok, err, type Result } from 'neverthrow';
import type { StitchError } from '../result/index.js';

const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_BASE_DELAY_MS = 1000;
const DEFAULT_MAX_DELAY_MS = 30_000;
const DEFAULT_MAX_WAIT_MS = 120_000;

export interface RetryInfo {
  /** 1-based consecutive rate-failure count that triggered the wait. */
  attempt: number;
  waitMs: number;
  error: StitchError;
}

export interface RateLimitOpts {
  /** Total tries (first try + retries). Default: 5. */
  maxAttempts?: number;
  /** Curve base ms. Default: 1000. */
  baseDelayMs?: number;
  /** Curve ceiling ms. Default: 30_000. */
  maxDelayMs?: number;
  /** Total wait budget ms (hard stop). Default: 120_000. */
  maxWaitMs?: number;
  /** Equal-jitter the curve (P-139 parity). Default: true. */
  jitter?: boolean;
  /** Clock (inject fakes in tests). Default: real timers. */
  sleep?: (ms: number) => Promise<void>;
  /** Time source for budget accounting. Default: Date.now. */
  now?: () => number;
  /** Random source for jitter. Default: Math.random. */
  random?: () => number;
  /** Observer (must not fail ops; throwing observers are contained). */
  onRetry?: (info: RetryInfo) => void;
}

/** Raw rate-limit headers for the analytics panel (P-295). */
export interface RateState {
  remaining: number | null;
  resetEpoch: number | null;
  retryAfterSecs: number | null;
}

function invalid(field: string, message: string): Result<never, StitchError> {
  return err({ code: 'CONFIG_ERROR', field, message });
}

function internalError(op: string, message: string): StitchError {
  return { code: 'INTERNAL', message: `${op}: ${message}` };
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function defaultNow(): number {
  return Date.now();
}

function defaultRandom(): number {
  return Math.random();
}

interface NormalizedOpts {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  maxWaitMs: number;
  jitter: boolean;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  random: () => number;
  onRetry?: ((info: RetryInfo) => void) | undefined;
}

function normalizeOpts(opts: RateLimitOpts, op: string): Result<NormalizedOpts, StitchError> {
  if (opts === null || typeof opts !== 'object') {
    return invalid('opts', `${op}: opts must be an object`);
  }
  const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    return invalid('maxAttempts', `${op}: maxAttempts must be an integer >= 1`);
  }
  const baseDelayMs = opts.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  if (typeof baseDelayMs !== 'number' || !Number.isFinite(baseDelayMs) || baseDelayMs <= 0) {
    return invalid('baseDelayMs', `${op}: baseDelayMs must be a finite number > 0`);
  }
  const maxDelayMs = opts.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  if (typeof maxDelayMs !== 'number' || !Number.isFinite(maxDelayMs) || maxDelayMs <= 0) {
    return invalid('maxDelayMs', `${op}: maxDelayMs must be a finite number > 0`);
  }
  const maxWaitMs = opts.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
  if (typeof maxWaitMs !== 'number' || !Number.isFinite(maxWaitMs) || maxWaitMs <= 0) {
    return invalid('maxWaitMs', `${op}: maxWaitMs must be a finite number > 0`);
  }
  if (opts.sleep !== undefined && typeof opts.sleep !== 'function') {
    return invalid('sleep', `${op}: sleep must be a function`);
  }
  if (opts.now !== undefined && typeof opts.now !== 'function') {
    return invalid('now', `${op}: now must be a function`);
  }
  if (opts.random !== undefined && typeof opts.random !== 'function') {
    return invalid('random', `${op}: random must be a function`);
  }
  if (opts.onRetry !== undefined && typeof opts.onRetry !== 'function') {
    return invalid('onRetry', `${op}: onRetry must be a function`);
  }
  return ok({
    maxAttempts,
    baseDelayMs,
    maxDelayMs,
    maxWaitMs,
    jitter: opts.jitter ?? true,
    sleep: opts.sleep ?? defaultSleep,
    now: opts.now ?? defaultNow,
    random: opts.random ?? defaultRandom,
    ...(opts.onRetry !== undefined ? { onRetry: opts.onRetry } : {}),
  });
}

interface RetrySignal {
  retryable: boolean;
  /** Server ask in ms (0 when the contract carries none). */
  serverWaitMs: number;
  status: number;
}

/** Rate signals only (GITHUB_API_ERROR + retry marker); all else passes. */
function retrySignal(error: StitchError): RetrySignal {
  if (error.code !== 'GITHUB_API_ERROR') {
    return { retryable: false, serverWaitMs: 0, status: 0 };
  }
  const match = /retry after (\d+)s/.exec(error.message);
  const hinted = match === null ? Number.NaN : Number(match[1]);
  if (Number.isFinite(hinted)) {
    return { retryable: true, serverWaitMs: hinted * 1000, status: error.status };
  }
  if (/retry delay unknown/i.test(error.message) || /rate limit/i.test(error.message)) {
    return { retryable: true, serverWaitMs: 0, status: error.status };
  }
  return { retryable: false, serverWaitMs: 0, status: 0 };
}

function readNow(now: () => number, where: string): Result<number, StitchError> {
  try {
    return ok(now());
  } catch {
    return err(internalError(where, 'clock failed'));
  }
}

/**
 * Retry any Result-returning op on rate signals: equal-jittered
 * exponential waits floored by server asks, bounded by attempts and
 * total budget. Non-rate errors return immediately, untouched.
 */
export async function withRateLimit<T>(
  op: () => Promise<Result<T, StitchError>>,
  opts: RateLimitOpts = {}
): Promise<Result<T, StitchError>> {
  const where = 'withRateLimit';
  if (typeof op !== 'function') {
    return invalid('op', `${where}: op must be a function`);
  }
  const normalized = normalizeOpts(opts, where);
  if (normalized.isErr()) return err(normalized.error);
  const options = normalized.value;
  const started = readNow(options.now, where);
  if (started.isErr()) return err(started.error);
  const startedAt = started.value;
  let failures = 0;
  for (;;) {
    let result: Result<T, StitchError>;
    try {
      result = await op();
    } catch (cause: unknown) {
      return err(internalError(where, cause instanceof Error ? cause.message : String(cause)));
    }
    if (result.isOk()) return ok(result.value);
    const signal = retrySignal(result.error);
    if (!signal.retryable) return err(result.error);
    failures += 1;
    const failed = (count: number): StitchError => ({
      code: 'GITHUB_API_ERROR',
      status: signal.status,
      message:
        `${where}: budget exhausted after ${count} attempt${count === 1 ? '' : 's'} ` +
        `(last status ${signal.status})`,
    });
    if (failures >= options.maxAttempts) {
      return err(failed(failures));
    }
    const curve = Math.min(options.maxDelayMs, options.baseDelayMs * 2 ** (failures - 1));
    // Equal jitter (P-139 parity): waits stay within [curve/2, curve],
    // so retries never hammer. A server ask replaces the curve (exact
    // when deterministic), with the jittered spread added on top.
    const spread = (ceiling: number): number =>
      options.jitter ? Math.floor(ceiling / 2 + options.random() * (ceiling / 2)) : ceiling;
    const waitMs =
      signal.serverWaitMs > 0
        ? signal.serverWaitMs + (options.jitter ? spread(curve) : 0)
        : spread(curve);
    const elapsed = readNow(options.now, where);
    if (elapsed.isErr()) return err(elapsed.error);
    if (elapsed.value - startedAt + waitMs > options.maxWaitMs) {
      return err(failed(failures));
    }
    try {
      await options.sleep(waitMs);
    } catch (cause: unknown) {
      return err(internalError(where, cause instanceof Error ? cause.message : String(cause)));
    }
    if (options.onRetry !== undefined) {
      try {
        options.onRetry({ attempt: failures, waitMs, error: result.error });
      } catch {
        // Observers must not fail ops (documented, covered).
      }
    }
  }
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

function headerNumber(headers: unknown, name: string): number | null {
  const raw = headerValue(headers, name);
  if (raw === undefined) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/**
 * Read raw rate-limit headers (analytics panel P-295): remaining quota,
 * reset epoch, and retry-after seconds (null when absent/unparseable).
 */
export function parseRateHeaders(headers: unknown): RateState {
  return {
    remaining: headerNumber(headers, 'x-ratelimit-remaining'),
    resetEpoch: headerNumber(headers, 'x-ratelimit-reset'),
    retryAfterSecs: headerNumber(headers, 'retry-after'),
  };
}
