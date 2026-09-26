import { describe, it, expect, vi } from 'vitest';
import { backoffDelay, withRetry, retryProviderCall, isProviderErrorRetryable } from './retry.js';
import type { ProviderError } from './types.js';

describe('P-138 retry: backoffDelay', () => {
  it('grows exponentially with jitter:false', () => {
    expect(backoffDelay(0, 1000, 30000, false)).toBe(1000);
    expect(backoffDelay(1, 1000, 30000, false)).toBe(2000);
    expect(backoffDelay(2, 1000, 30000, false)).toBe(4000);
    expect(backoffDelay(3, 1000, 30000, false)).toBe(8000);
    expect(backoffDelay(4, 1000, 30000, false)).toBe(16000);
    expect(backoffDelay(5, 1000, 30000, false)).toBe(30000); // capped
    expect(backoffDelay(10, 1000, 30000, false)).toBe(30000); // stays capped
  });

  it('is deterministic with jitter:false', () => {
    for (let i = 0; i < 5; i++) {
      expect(backoffDelay(2, 1000, 30000, false)).toBe(4000);
    }
  });

  it('with jitter:true is >= capped exponential', () => {
    for (let i = 0; i < 20; i++) {
      const d = backoffDelay(2, 1000, 30000, true);
      expect(d).toBeGreaterThanOrEqual(4000);
      expect(d).toBeLessThanOrEqual(30000 + 250); // cap + max jitter
    }
  });
});

describe('P-138 retry: withRetry', () => {
  it('succeeds on first attempt', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await withRetry(fn, {
      attempts: 3,
      retryable: () => true,
      jitter: false,
    });
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('succeeds after N retries', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('fail 1'))
      .mockRejectedValueOnce(new Error('fail 2'))
      .mockResolvedValue('ok');
    const result = await withRetry(fn, {
      attempts: 3,
      retryable: () => true,
      jitter: false,
    });
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('does not retry non-retryable', async () => {
    const fn = vi.fn().mockRejectedValue({ code: 'INVALID_REQUEST', message: 'bad' });
    const retryable = (e: unknown) => {
      if (!e || typeof e !== 'object') return false;
      const err = e as { code: string };
      return err.code !== 'INVALID_REQUEST';
    };
    const result = await withRetry(fn, {
      attempts: 3,
      retryable,
      jitter: false,
    });
    expect(result.isErr()).toBe(true);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('exhausts attempts then errors', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('always fails'));
    const result = await withRetry(fn, {
      attempts: 3,
      retryable: () => true,
      jitter: false,
    });
    expect(result.isErr()).toBe(true);
    expect(fn).toHaveBeenCalledTimes(3);
    expect(result._unsafeUnwrapErr().code).toBe('RETRY_EXHAUSTED');
  });

  it('reports attempt info via onAttempt', async () => {
    const attempts: { attempt: number; delayMs: number }[] = [];
    const fn = vi.fn().mockRejectedValueOnce(new Error('fail 1')).mockResolvedValue('ok');
    await withRetry(fn, {
      attempts: 3,
      retryable: () => true,
      jitter: false,
      baseMs: 1000,
      onAttempt: info => attempts.push({ attempt: info.attempt, delayMs: info.delayMs }),
    });
    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.attempt).toBe(0);
    expect(attempts[0]?.delayMs).toBe(1000); // backoffDelay(0) = 1000
  });

  it('honors abort signal during sleep', async () => {
    const controller = new AbortController();
    const fn = vi.fn().mockRejectedValue(new Error('fail'));

    // Trigger abort immediately after first attempt
    const promise = withRetry(fn, {
      attempts: 3,
      retryable: () => true,
      jitter: false,
      baseMs: 100, // small delay to allow abort
      signal: controller.signal,
    });

    // Wait a tick then abort
    await new Promise(r => setTimeout(r, 50));
    controller.abort();

    const result = await promise;
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe('ABORTED');
  });

  it('honors abort signal before first attempt', async () => {
    const controller = new AbortController();
    controller.abort();
    const fn = vi.fn().mockResolvedValue('ok');

    const result = await withRetry(fn, {
      attempts: 3,
      retryable: () => true,
      signal: controller.signal,
    });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe('ABORTED');
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('P-138 retry: isProviderErrorRetryable', () => {
  it('retries rate_limit', () => {
    const err: ProviderError = {
      kind: 'rate_limit',
      message: '429',
      providerName: 'test',
      retryable: true,
    };
    expect(isProviderErrorRetryable(err)).toBe(true);
  });

  it('retries timeout', () => {
    const err: ProviderError = {
      kind: 'timeout',
      message: 'timeout',
      providerName: 'test',
      retryable: true,
    };
    expect(isProviderErrorRetryable(err)).toBe(true);
  });

  it('retries network', () => {
    const err: ProviderError = {
      kind: 'network',
      message: 'ENOTFOUND',
      providerName: 'test',
      retryable: true,
    };
    expect(isProviderErrorRetryable(err)).toBe(true);
  });

  it('retries unknown when retryable=true', () => {
    const err: ProviderError = {
      kind: 'unknown',
      message: 'unknown',
      providerName: 'test',
      retryable: true,
    };
    expect(isProviderErrorRetryable(err)).toBe(true);
  });

  it('does not retry auth', () => {
    const err: ProviderError = {
      kind: 'auth',
      message: '401',
      providerName: 'test',
      retryable: false,
    };
    expect(isProviderErrorRetryable(err)).toBe(false);
  });

  it('does not retry invalid_request', () => {
    const err: ProviderError = {
      kind: 'invalid_request',
      message: 'bad',
      providerName: 'test',
      retryable: false,
    };
    expect(isProviderErrorRetryable(err)).toBe(false);
  });

  it('returns false for non-ProviderError', () => {
    expect(isProviderErrorRetryable(new Error('generic'))).toBe(false);
    expect(isProviderErrorRetryable(null)).toBe(false);
    expect(isProviderErrorRetryable(undefined)).toBe(false);
    expect(isProviderErrorRetryable({})).toBe(false);
    expect(isProviderErrorRetryable('string')).toBe(false);
  });
});

describe('P-138 retry: retryProviderCall', () => {
  it('uses default retryable predicate and config', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce({
        kind: 'rate_limit',
        message: '429',
        providerName: 'test',
        retryable: true,
      })
      .mockResolvedValue('ok');
    const result = await retryProviderCall(fn);
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('allows override of attempts', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce({
        kind: 'rate_limit',
        message: '429',
        providerName: 'test',
        retryable: true,
      })
      .mockRejectedValueOnce({
        kind: 'rate_limit',
        message: '429',
        providerName: 'test',
        retryable: true,
      })
      .mockResolvedValue('ok');
    const result = await retryProviderCall(fn, { attempts: 5 });
    expect(result.isOk()).toBe(true);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('does not retry auth errors', async () => {
    const fn = vi
      .fn()
      .mockRejectedValue({ kind: 'auth', message: '401', providerName: 'test', retryable: false });
    const result = await retryProviderCall(fn);
    expect(result.isErr()).toBe(true);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
