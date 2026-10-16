// P-249 — concurrency tests.
//
// The claims worth defending are about OBSERVED PARALLELISM, not about the pool's
// internals: a peak in-flight count measured by the tasks themselves, the order two
// queued tasks actually ran in, and the fact that a cancelled waiter left the queue
// immediately. Real (short) timers are used deliberately — a fake clock would prove
// the arithmetic but not that the semaphore actually serialises.
//
// The five required scenarios from the phase spec:
//
//   it('bounds concurrency')  it('prioritizes')  it('timeouts')
//   it('global cap')          it('cancel drains')

import { describe, it, expect } from 'vitest';
import { Limits, Pool, resolveLimit } from './pool.js';

/** Wait `ms` for real. */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** A tracker that records the peak number of simultaneously-running tasks. */
function tracker(): { enter: () => void; exit: () => void; peak: () => number } {
  let inFlight = 0;
  let peak = 0;
  return {
    enter: () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
    },
    exit: () => {
      inFlight -= 1;
    },
    peak: () => peak,
  };
}

describe('P-249 concurrency', () => {
  it('bounds concurrency', async () => {
    const pool = new Pool({ limit: 2, name: 'builds' });
    const seen = tracker();

    await Promise.all(
      Array.from({ length: 6 }, () =>
        pool.run(async () => {
          seen.enter();
          await sleep(10);
          seen.exit();
        })
      )
    );

    // Six tasks, never more than two at once.
    expect(seen.peak()).toBe(2);
    expect(pool.active).toBe(0);
    expect(pool.queued).toBe(0);
    expect(pool.name).toBe('builds');

    // A limit of 0 or a fraction is clamped rather than deadlocking the pool.
    const clamped = new Pool({ limit: 0 });
    expect(clamped.limit).toBe(1);

    // `tryAcquire` is the preflight: true while a slot is free, false when full.
    const guarded = new Pool({ limit: 1 });
    expect(guarded.tryAcquire()).toBe(true);
    expect(guarded.tryAcquire()).toBe(false);
    guarded.release();
    expect(guarded.tryAcquire()).toBe(true);
  });

  it('prioritizes', async () => {
    const pool = new Pool({ limit: 1 });
    const order: string[] = [];

    // Occupy the only slot so the next two must queue.
    const holder = pool.run(async () => {
      await sleep(15);
      order.push('holder');
    });
    // Let the holder actually acquire before the others arrive.
    await sleep(1);

    const low = pool.run(
      async () => {
        order.push('low');
      },
      { priority: 0 }
    );
    const high = pool.run(
      async () => {
        order.push('high');
      },
      { priority: 10 }
    );

    await Promise.all([holder, low, high]);
    // The approval jumped a build that was queued before it.
    expect(order).toEqual(['holder', 'high', 'low']);

    // Equal priorities stay FIFO.
    const fifo = new Pool({ limit: 1 });
    const fifoOrder: string[] = [];
    const hold2 = fifo.run(async () => {
      await sleep(10);
    });
    await sleep(1);
    const first = fifo.run(async () => {
      fifoOrder.push('first');
    });
    const second = fifo.run(async () => {
      fifoOrder.push('second');
    });
    await Promise.all([hold2, first, second]);
    expect(fifoOrder).toEqual(['first', 'second']);
  });

  it('timeouts', async () => {
    const pool = new Pool({ limit: 1 });

    // A task over its own deadline is a typed error, not a hang. The deadline is
    // carried in the message because a dedicated code is recorded as follow-up debt
    // (see the module header) — this asserts the timeout is REPORTED, not swallowed.
    const slow = await pool.run(
      async () => {
        await sleep(60);
        return 'too late';
      },
      { timeoutMs: 5 }
    );
    expect(slow.isErr()).toBe(true);
    if (slow.isErr()) {
      expect(slow.error.code).toBe('INTERNAL');
      expect(slow.error.code === 'INTERNAL' ? slow.error.message : '').toContain(
        'exceeded its 5ms deadline'
      );
    }

    // The slot is released on timeout, so the pool is not wedged.
    expect(pool.active).toBe(0);

    // A task that throws is an INTERNAL, never an escaping exception.
    const boom = await pool.run(() => {
      throw new Error('kaboom');
    });
    expect(boom.isErr()).toBe(true);
    if (boom.isErr()) expect(boom.error.code).toBe('INTERNAL');

    // Inside the deadline the value comes back untouched.
    const quick = await pool.run(async () => 'done', { timeoutMs: 100 });
    expect(quick._unsafeUnwrap()).toBe('done');
  });

  it('global cap', async () => {
    // The effective budget is min(configured, host cpu, sandbox host cap).
    expect(resolveLimit({ configured: 16, hostCpus: 4, sandboxHostCap: 8 })).toBe(4);
    expect(resolveLimit({ configured: 2, hostCpus: 8, sandboxHostCap: 1 })).toBe(1);
    expect(resolveLimit({ configured: 3, hostCpus: 8, sandboxHostCap: 4 })).toBe(3);
    // A single core, or no inputs at all, still yields at least one slot.
    expect(resolveLimit({ configured: 0, hostCpus: 1 })).toBe(1);
    expect(resolveLimit({})).toBeGreaterThanOrEqual(1);

    // Two named pools SHARE one budget: their combined parallelism is capped.
    const limits = new Limits({ configured: 3, hostCpus: 8, sandboxHostCap: 4 });
    expect(limits.limit).toBe(3);
    const sandbox = limits.pool('sandbox');
    const ai = limits.pool('ai');
    const seen = tracker();

    const work = (pool: Pool): Promise<unknown> =>
      pool.run(async () => {
        seen.enter();
        await sleep(10);
        seen.exit();
      });

    await Promise.all([
      work(sandbox),
      work(sandbox),
      work(sandbox),
      work(ai),
      work(ai),
      work(ai),
      work(ai),
    ]);

    // Seven tasks across two pools sized 3 each must never reach 6 in flight.
    expect(seen.peak()).toBeLessThanOrEqual(3);
    expect(limits.global.active).toBe(0);
  });

  it('cancel drains', async () => {
    const pool = new Pool({ limit: 1 });
    const controller = new AbortController();

    const running = pool.run(async () => {
      await sleep(25);
      return 'ran';
    });
    await sleep(1);

    // Two waiters, one of which is cancelled while it is still QUEUED.
    const queued = pool.run(async () => 'never', { signal: controller.signal });
    const other = pool.run(async () => 'after');
    expect(pool.queued).toBe(2);

    controller.abort();

    // The cancelled waiter leaves the queue promptly rather than when a slot frees.
    const cancelled = await queued;
    expect(cancelled.isErr()).toBe(true);
    if (cancelled.isErr()) expect(cancelled.error.code).toBe('ABORTED');
    expect(pool.queued).toBe(1);

    // Already-aborted signals are refused without queueing at all.
    const dead = new AbortController();
    dead.abort();
    const pre = await pool.run(async () => 'x', { signal: dead.signal });
    expect(pre.isErr()).toBe(true);

    // The running task and the remaining waiter still complete.
    expect((await running)._unsafeUnwrap()).toBe('ran');
    expect((await other)._unsafeUnwrap()).toBe('after');

    await pool.drain();
    expect(pool.active).toBe(0);
    expect(pool.queued).toBe(0);
  });
});
