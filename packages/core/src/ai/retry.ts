// Retry/Backoff (P-138).
//
// Generic configurable retry wrapper with exponential backoff + jitter,
// respecting ProviderError.retryable, AbortSignal, and audit callbacks.

import { ok, err, type Result } from 'neverthrow';
import type { ProviderError } from './types.js';
import { type StitchError } from '../result/index.js';

/**
 * Calculate exponential backoff delay with optional jitter.
 * @param attempt - Zero-based attempt index (0 = first retry)
 * @param baseMs - Base delay in ms (default 1000)
 * @param capMs - Maximum delay cap in ms (default 30000)
 * @param jitter - Add random jitter in [0, baseMs*0.25) (default true)
 * @returns Delay in milliseconds
 */
export function backoffDelay(
  attempt: number,
  baseMs: number = 1000,
  capMs: number = 30000,
  jitter: boolean = true
): number {
  const exponential = baseMs * Math.pow(2, attempt);
  const capped = Math.min(exponential, capMs);
  if (!jitter) return capped;
  const jitterAmount = Math.random() * (baseMs * 0.25);
  return Math.floor(capped + jitterAmount);
}

/** Sleep utility that respects AbortSignal. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new AbortError('Aborted'));
      return;
    }
    const timeout = setTimeout(resolve, ms);
    const handler = () => {
      clearTimeout(timeout);
      reject(new AbortError('Aborted'));
    };
    signal?.addEventListener('abort', handler, { once: true });
  });
}

class AbortError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AbortError';
  }
}

/** Configuration for retry behavior. */
export interface RetryOpts {
  /** Maximum number of attempts (including the first). */
  attempts: number;
  /** Base delay in ms (default 1000). */
  baseMs?: number;
  /** Maximum delay cap in ms (default 30000). */
  capMs?: number;
  /** Function to determine if an error is retryable. */
  retryable: (e: unknown) => boolean;
  /** Add random jitter (default true). */
  jitter?: boolean;
  /** Callback fired on each retry attempt. */
  onAttempt?: (info: RetryInfo) => void;
  /** Abort signal to cancel retries. */
  signal?: AbortSignal;
}

/** Information about a retry attempt. */
export interface RetryInfo {
  /** Zero-based attempt index (0 = first retry after initial failure). */
  attempt: number;
  /** The error that triggered the retry. */
  error: unknown;
  /** Delay in ms before this retry. */
  delayMs: number;
}

/**
 * Execute an async function with retry logic.
 * @param fn - Async function to execute
 * @param opts - Retry configuration
 * @returns Result with value on success, StitchError on final failure
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOpts
): Promise<Result<T, StitchError>> {
  const {
    attempts,
    baseMs = 1000,
    capMs = 30000,
    retryable,
    jitter = true,
    onAttempt,
    signal,
  } = opts;

  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt++) {
    // Check for abort before each attempt
    if (signal?.aborted) {
      return err({
        code: 'ABORTED',
        message: 'Operation aborted by signal',
      });
    }

    try {
      const result = await fn();
      return ok(result);
    } catch (e) {
      lastError = e;

      // If not retryable or this was the last attempt, fail
      if (!retryable(e) || attempt === attempts - 1) {
        return err({
          code: 'RETRY_EXHAUSTED',
          message: e instanceof Error ? e.message : String(e),
        });
      }

      // Compute delay and sleep
      const delayMs = backoffDelay(attempt, baseMs, capMs, jitter);

      // Notify about retry attempt
      if (onAttempt) {
        onAttempt({ attempt, error: e, delayMs });
      }

      try {
        await sleep(delayMs, signal);
      } catch {
        return err({
          code: 'ABORTED',
          message: 'Operation aborted during backoff',
        });
      }
    }
  }

  // Should not reach here, but TypeScript needs it
  return err({
    code: 'RETRY_EXHAUSTED',
    message: lastError instanceof Error ? lastError.message : String(lastError),
  });
}

/**
 * Default retryable predicate for ProviderError.
 * Retries on: rate_limit, timeout, network, unknown (when retryable=true).
 * Does NOT retry on: auth, invalid_request.
 */
export function isProviderErrorRetryable(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const pe = error as ProviderError;
  if (pe.kind === undefined) return false;
  return pe.retryable === true;
}

/**
 * Convenience wrapper for AI provider calls.
 * Uses isProviderErrorRetryable as the retryable predicate.
 */
export async function retryProviderCall<T>(
  fn: () => Promise<T>,
  opts?: Partial<RetryOpts>
): Promise<Result<T, StitchError>> {
  return withRetry(fn, {
    attempts: 3,
    baseMs: 1000,
    capMs: 30000,
    jitter: true,
    retryable: isProviderErrorRetryable,
    ...opts,
  });
}
