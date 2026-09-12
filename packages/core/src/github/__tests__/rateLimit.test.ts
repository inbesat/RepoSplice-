// GitHub rate-limit backoff (P-096): jittered exponential waits honoring
// server retry guidance, budget-capped exhaustion, and telemetry for the
// analytics panel — over injected fakes (deterministic clocks) plus
// composition proofs wrapping the real list/tree/content/actions calls.

import { describe, it, expect } from 'vitest';
import { ok, err, type Result } from 'neverthrow';
import type { StitchError } from '../../result/index.js';
import {
  withRateLimit,
  parseRateHeaders,
  type RateState,
  type RateLimitOpts,
} from '../rateLimit.js';
import { listRepos } from '../list.js';
import { getRepoTree } from '../tree.js';
import { getFileContent } from '../content.js';
import { relayWorkflowRun } from '../actionsStatus.js';

function rateError(retryAfter: string | null, status = 429): StitchError {
  return {
    code: 'GITHUB_API_ERROR',
    status,
    message:
      retryAfter === null
        ? 'op: rate limited by GitHub (retry delay unknown)'
        : `op: rate limited by GitHub (retry after ${retryAfter}s)`,
  };
}

function authError(): StitchError {
  return { code: 'AUTH_ERROR', provider: 'github', message: 'denied (run `stitch login`)' };
}

/** Deterministic clock + sleep recorder (no real timers). */
function fakeClock() {
  let now = 1_000_000;
  const sleeps: number[] = [];
  return {
    now: () => now,
    sleep: async (ms: number): Promise<void> => {
      sleeps.push(ms);
      now += ms;
    },
    sleeps,
  };
}

// ─── backoff ───────────────────────────────────────────────────────────

describe('backoff', () => {
  it('backs off exponentially without jitter', async () => {
    const clock = fakeClock();
    const result = await withRateLimit(async () => err(rateError(null)), {
      maxAttempts: 4,
      baseDelayMs: 1000,
      maxDelayMs: 30_000,
      maxWaitMs: 1_000_000,
      jitter: false,
      sleep: clock.sleep,
      now: clock.now,
      random: () => 0.5,
    });
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GITHUB_API_ERROR');
    expect(clock.sleeps).toEqual([1000, 2000, 4000]);
  });

  it('bounds jitter deterministically', async () => {
    for (const [random, expected] of [
      [() => 0, [500, 1000]],
      [() => 0.999, [999, 1999]],
    ] as const) {
      const clock = fakeClock();
      const result = await withRateLimit(async () => err(rateError(null)), {
        maxAttempts: 3,
        baseDelayMs: 1000,
        jitter: true,
        sleep: clock.sleep,
        now: clock.now,
        random,
      });
      expect(result.isErr()).toBe(true);
      expect(clock.sleeps).toEqual([...expected]);
    }
  });

  it('caps exponential growth at maxDelayMs', async () => {
    const clock = fakeClock();
    await withRateLimit(async () => err(rateError(null)), {
      maxAttempts: 4,
      baseDelayMs: 10_000,
      maxDelayMs: 15_000,
      jitter: false,
      sleep: clock.sleep,
      now: clock.now,
    });
    expect(clock.sleeps).toEqual([10_000, 15_000, 15_000]);
  });

  it('works on real timers by default', async () => {
    let calls = 0;
    const result = await withRateLimit(
      async (): Promise<Result<string, StitchError>> => {
        calls += 1;
        if (calls === 1) return err(rateError(null));
        return ok('recovered');
      },
      { maxAttempts: 3, baseDelayMs: 10, jitter: false }
    );
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value).toBe('recovered');
    expect(calls).toBe(2);
  });
});

// ─── retries ───────────────────────────────────────────────────────────

describe('retries', () => {
  it('retries rate failures then returns success', async () => {
    const clock = fakeClock();
    const retries: Array<{ attempt: number; waitMs: number }> = [];
    let calls = 0;
    const result = await withRateLimit(
      async (): Promise<Result<string, StitchError>> => {
        calls += 1;
        if (calls <= 2) return err(rateError(null));
        return ok('late success');
      },
      {
        baseDelayMs: 1000,
        jitter: false,
        sleep: clock.sleep,
        now: clock.now,
        onRetry: info => {
          retries.push({ attempt: info.attempt, waitMs: info.waitMs });
        },
      }
    );
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value).toBe('late success');
    expect(calls).toBe(3);
    expect(clock.sleeps).toEqual([1000, 2000]);
    expect(retries).toEqual([
      { attempt: 1, waitMs: 1000 },
      { attempt: 2, waitMs: 2000 },
    ]);
  });

  it('passes first-try successes through untouched', async () => {
    const clock = fakeClock();
    let retries = 0;
    const result = await withRateLimit(async () => ok('instant'), {
      sleep: clock.sleep,
      now: clock.now,
      onRetry: () => {
        retries += 1;
      },
    });
    expect(result.isOk() && result.value).toBe('instant');
    expect(clock.sleeps).toEqual([]);
    expect(retries).toBe(0);
    const bare = await withRateLimit(async () => ok('bare'));
    expect(bare.isOk() && bare.value).toBe('bare');
  });

  it('returns non-rate errors immediately without sleeping', async () => {
    for (const error of [
      authError(),
      { code: 'CONFIG_ERROR', field: 'x', message: 'bad' },
      { code: 'INTERNAL', message: 'boom' },
      { code: 'GITHUB_API_ERROR', status: 404, message: 'missing' },
      { code: 'GITHUB_API_ERROR', status: 403, message: 'Forbidden' },
    ] as StitchError[]) {
      const clock = fakeClock();
      let calls = 0;
      const result = await withRateLimit(
        async (): Promise<Result<string, StitchError>> => {
          calls += 1;
          return err(error);
        },
        { sleep: clock.sleep, now: clock.now }
      );
      expect(result.isErr()).toBe(true);
      if (result.isOk()) continue;
      expect(result.error).toEqual(error);
      expect(calls).toBe(1);
      expect(clock.sleeps).toEqual([]);
    }
  });

  it('maps throwing ops to INTERNAL without retrying', async () => {
    const clock = fakeClock();
    const result = await withRateLimit(
      async (): Promise<Result<string, StitchError>> => {
        throw new Error('op blew up');
      },
      { sleep: clock.sleep, now: clock.now }
    );
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('INTERNAL');
    expect(clock.sleeps).toEqual([]);
    const bare: Promise<Result<string, StitchError>> = Promise.reject();
    const rejected = await withRateLimit(async () => bare, {
      sleep: clock.sleep,
      now: clock.now,
    });
    expect(rejected.isErr()).toBe(true);
    if (rejected.isOk()) return;
    expect(rejected.error.code).toBe('INTERNAL');
  });

  it('rejects misuse at the boundary', async () => {
    const clock = fakeClock();
    const good = async (): Promise<Result<string, StitchError>> => ok('x');
    const bad = [
      await withRateLimit(null as unknown as () => Promise<Result<string, StitchError>>, {}),
      await withRateLimit(good, { maxAttempts: 0 }),
      await withRateLimit(good, { maxAttempts: 1.5 }),
      await withRateLimit(good, { baseDelayMs: 0 }),
      await withRateLimit(good, { baseDelayMs: Number.NaN }),
      await withRateLimit(good, { maxDelayMs: -1 }),
      await withRateLimit(good, { maxWaitMs: Number.POSITIVE_INFINITY }),
      await withRateLimit(good, { sleep: 42 as unknown as (ms: number) => Promise<void> }),
      await withRateLimit(good, { now: 42 as unknown as () => number }),
      await withRateLimit(good, { random: 42 as unknown as () => number }),
      await withRateLimit(good, { onRetry: 42 } as unknown as RateLimitOpts),
      await withRateLimit(good, null as unknown as Parameters<typeof withRateLimit>[1]),
    ];
    for (const resolved of bad) {
      expect(resolved.isErr()).toBe(true);
      if (resolved.isOk()) continue;
      expect(resolved.error.code).toBe('CONFIG_ERROR');
    }
    // maxAttempts: 1 tries once and exhausts without sleeping.
    const once = await withRateLimit(async () => err(rateError(null)), {
      maxAttempts: 1,
      sleep: clock.sleep,
      now: clock.now,
    });
    expect(once.isErr()).toBe(true);
    expect(clock.sleeps).toEqual([]);
  });

  it('surfaces sleeper, clock, and observer failures honestly', async () => {
    const throwingSleep = await withRateLimit(async () => err(rateError(null)), {
      maxAttempts: 3,
      baseDelayMs: 10,
      jitter: false,
      sleep: async () => {
        throw new Error('sleeper broke');
      },
    });
    expect(throwingSleep.isErr()).toBe(true);
    if (throwingSleep.isOk()) return;
    expect(throwingSleep.error.code).toBe('INTERNAL');
    const bareSleep = await withRateLimit(async () => err(rateError(null)), {
      maxAttempts: 3,
      baseDelayMs: 10,
      jitter: false,
      sleep: () => Promise.reject(),
    });
    expect(bareSleep.isErr()).toBe(true);
    if (bareSleep.isOk()) return;
    expect(bareSleep.error.code).toBe('INTERNAL');
    const throwingClock = await withRateLimit(async () => err(rateError(null)), {
      maxAttempts: 3,
      baseDelayMs: 10,
      jitter: false,
      sleep: async () => undefined,
      now: () => {
        throw new Error('clock broke');
      },
    });
    expect(throwingClock.isErr()).toBe(true);
    if (throwingClock.isOk()) return;
    expect(throwingClock.error.code).toBe('INTERNAL');
    let ticks = 0;
    const lateClock = await withRateLimit(async () => err(rateError(null)), {
      maxAttempts: 3,
      baseDelayMs: 10,
      jitter: false,
      sleep: async () => undefined,
      now: () => {
        ticks += 1;
        if (ticks > 1) throw new Error('clock broke late');
        return 0;
      },
    });
    expect(lateClock.isErr()).toBe(true);
    if (lateClock.isOk()) return;
    expect(lateClock.error.code).toBe('INTERNAL');
    const throwingObserver = await withRateLimit(
      async (): Promise<Result<string, StitchError>> => ok('fine'),
      {
        onRetry: () => {
          throw new Error('observer broke');
        },
      }
    );
    expect(throwingObserver.isOk()).toBe(true);
  });
});

// ─── waits reset ───────────────────────────────────────────────────────

describe('waits reset', () => {
  it('honors server retry guidance over the curve', async () => {
    const clock = fakeClock();
    const result = await withRateLimit(async () => err(rateError('5')), {
      maxAttempts: 2,
      baseDelayMs: 1000,
      jitter: false,
      sleep: clock.sleep,
      now: clock.now,
    });
    expect(result.isErr()).toBe(true);
    // Server asked 5s; the 1s curve yields.
    expect(clock.sleeps).toEqual([5000]);
  });

  it('waits server hints exactly', async () => {
    const clock = fakeClock();
    const result = await withRateLimit(
      async (): Promise<Result<string, StitchError>> =>
        err({
          code: 'GITHUB_API_ERROR',
          status: 429,
          message: 'op: rate limited by GitHub (retry after 60s)',
        }),
      { maxAttempts: 2, baseDelayMs: 1000, jitter: false, sleep: clock.sleep, now: clock.now }
    );
    expect(result.isErr()).toBe(true);
    // Server asked 60s; the 1s curve yields entirely.
    expect(clock.sleeps).toEqual([60_000]);
    const jittered = fakeClock();
    const jitteredResult = await withRateLimit(
      async (): Promise<Result<string, StitchError>> =>
        err({
          code: 'GITHUB_API_ERROR',
          status: 429,
          message: 'op: rate limited by GitHub (retry after 5s)',
        }),
      {
        maxAttempts: 2,
        baseDelayMs: 1000,
        jitter: true,
        sleep: jittered.sleep,
        now: jittered.now,
        random: () => 0,
      }
    );
    expect(jitteredResult.isErr()).toBe(true);
    // Server ask plus the zero-random spread.
    expect(jittered.sleeps).toEqual([5500]);
  });
});

// ─── exhausts cheap ────────────────────────────────────────────────────

describe('exhausts cheap', () => {
  it('stops at the attempt cap', async () => {
    const clock = fakeClock();
    let calls = 0;
    const result = await withRateLimit(
      async (): Promise<Result<string, StitchError>> => {
        calls += 1;
        return err(rateError(null));
      },
      { maxAttempts: 2, baseDelayMs: 100, jitter: false, sleep: clock.sleep, now: clock.now }
    );
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GITHUB_API_ERROR');
    if (result.error.code !== 'GITHUB_API_ERROR') return;
    expect(result.error.message).toContain('2 attempts');
    expect(calls).toBe(2);
    expect(clock.sleeps).toEqual([100]);
  });

  it('stops at the budget cap before sleeping past it', async () => {
    const clock = fakeClock();
    let calls = 0;
    const result = await withRateLimit(
      async (): Promise<Result<string, StitchError>> => {
        calls += 1;
        return err(rateError(null));
      },
      {
        maxAttempts: 10,
        baseDelayMs: 1000,
        maxWaitMs: 2500,
        jitter: false,
        sleep: clock.sleep,
        now: clock.now,
      }
    );
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GITHUB_API_ERROR');
    if (result.error.code !== 'GITHUB_API_ERROR') return;
    expect(result.error.message).toContain('2 attempts');
    expect(calls).toBe(2);
    // Second wait (2000ms) would breach the 2500ms budget: never slept.
    expect(clock.sleeps).toEqual([1000]);
  });
});

// ─── parseRateHeaders ──────────────────────────────────────────────────

describe('parseRateHeaders', () => {
  it('reads every header shape', () => {
    expect(
      parseRateHeaders({
        'x-ratelimit-remaining': '58',
        'x-ratelimit-reset': '1700000060',
        'retry-after': '12',
      })
    ).toEqual({ remaining: 58, resetEpoch: 1700000060, retryAfterSecs: 12 } satisfies RateState);
    expect(parseRateHeaders(new Headers({ 'retry-after': '7' }))).toMatchObject({
      retryAfterSecs: 7,
    });
    expect(parseRateHeaders({})).toEqual({
      remaining: null,
      resetEpoch: null,
      retryAfterSecs: null,
    });
    expect(parseRateHeaders(null)).toEqual({
      remaining: null,
      resetEpoch: null,
      retryAfterSecs: null,
    });
    expect(parseRateHeaders(new Headers())).toEqual({
      remaining: null,
      resetEpoch: null,
      retryAfterSecs: null,
    });
    expect(parseRateHeaders({ 'x-ratelimit-remaining': 'soon' })).toMatchObject({
      remaining: null,
    });
  });
});

// ─── threading ─────────────────────────────────────────────────────────

describe('threads through list/tree/content/actions', () => {
  it('wraps real module calls with retry', async () => {
    let lists = 0;
    const listed = await withRateLimit(
      () =>
        listRepos(
          {
            rest: {
              repos: {
                listForAuthenticatedUser: async () => {
                  lists += 1;
                  if (lists === 1) {
                    const error = new Error('slow down') as Error & { status: number };
                    error.status = 429;
                    throw error;
                  }
                  return { data: [], headers: {}, status: 200 };
                },
              },
              search: {
                repos: async () => ({ data: {}, headers: {}, status: 200 }),
              },
            },
          },
          {}
        ),
      { sleep: async () => undefined }
    );
    expect(listed.isOk()).toBe(true);
    expect(lists).toBe(2);

    const SHA = 'a'.repeat(40);
    let trees = 0;
    const treed = await withRateLimit(
      () =>
        getRepoTree(
          {
            rest: {
              repos: {
                get: async () => ({ data: {}, headers: {}, status: 200 }),
                getCommit: async () => ({ data: {}, headers: {}, status: 200 }),
              },
              git: {
                getTree: async () => {
                  trees += 1;
                  if (trees === 1) {
                    const error = new Error('slow down') as Error & { status: number };
                    error.status = 429;
                    throw error;
                  }
                  return {
                    data: { sha: SHA, tree: [], truncated: false },
                    headers: {},
                    status: 200,
                  };
                },
              },
            },
          },
          'o',
          'r',
          { ref: SHA }
        ),
      { sleep: async () => undefined }
    );
    expect(treed.isOk()).toBe(true);
    expect(trees).toBe(2);

    let blobs = 0;
    const blobbed = await withRateLimit(
      () =>
        getFileContent(
          {
            rest: {
              repos: {
                get: async () => ({ data: {}, headers: {}, status: 200 }),
                getCommit: async () => ({ data: {}, headers: {}, status: 200 }),
                getContent: async () => {
                  blobs += 1;
                  if (blobs === 1) {
                    const error = new Error('slow down') as Error & { status: number };
                    error.status = 429;
                    throw error;
                  }
                  return {
                    data: {
                      type: 'file',
                      path: 'a.txt',
                      sha: SHA,
                      size: 1,
                      content: Buffer.from('x').toString('base64'),
                      encoding: 'base64',
                    },
                    headers: {},
                    status: 200,
                  };
                },
              },
            },
          },
          'o',
          'r',
          'a.txt',
          { ref: SHA }
        ),
      { sleep: async () => undefined }
    );
    expect(blobbed.isOk()).toBe(true);
    expect(blobs).toBe(2);

    let runs = 0;
    const run = await withRateLimit(
      () =>
        relayWorkflowRun(
          {
            rest: {
              actions: {
                getWorkflowRun: async () => {
                  runs += 1;
                  if (runs === 1) {
                    const error = new Error('slow down') as Error & { status: number };
                    error.status = 429;
                    throw error;
                  }
                  return {
                    data: {
                      id: 3,
                      head_sha: SHA,
                      head_branch: null,
                      status: 'completed',
                      conclusion: 'success',
                      html_url: 'u',
                    },
                    headers: {},
                    status: 200,
                  };
                },
                listWorkflowRunsForRepo: async () => ({ data: {}, headers: {}, status: 200 }),
              },
            },
          },
          'o',
          'r',
          3
        ),
      { sleep: async () => undefined }
    );
    expect(run.isOk()).toBe(true);
    expect(runs).toBe(2);
  });
});
