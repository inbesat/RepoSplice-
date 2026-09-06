// P-031 tests: createLimiter caps in-flight work, maps task errors to
// Result, rejects misuse at the boundary; withLimit scopes a limiter;
// mapLimit preserves order with per-item Results (no wholesale reject).
import { describe, it, expect } from 'vitest';
import { createLimiter, withLimit, mapLimit } from '../limit.js';

const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0));

describe('P-031 limiter: caps concurrency (spec smoke test)', () => {
  it('runs at most 2 tasks at a time with concurrency 2', async () => {
    const limiter = createLimiter(2);
    if (limiter.isErr()) throw limiter.error;
    let inFlight = 0;
    let maxInFlight = 0;
    const task = async (id: number) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await tick();
      await tick();
      inFlight -= 1;
      return id;
    };
    const results = await Promise.all(
      [0, 1, 2, 3, 4, 5].map(id => limiter.value.run(() => task(id)))
    );
    expect(maxInFlight).toBeLessThanOrEqual(2);
    expect(maxInFlight).toBe(2);
    expect(results.every(r => r.isOk())).toBe(true);
  });

  it('serializes fully with concurrency 1', async () => {
    const limiter = createLimiter(1);
    if (limiter.isErr()) throw limiter.error;
    const order: number[] = [];
    const task = async (id: number) => {
      order.push(id);
      await tick();
      return id;
    };
    await Promise.all([0, 1, 2].map(id => limiter.value.run(() => task(id))));
    expect(order).toEqual([0, 1, 2]);
  });

  it('exposes live activeCount/pendingCount gauges', async () => {
    const limiter = createLimiter(1);
    if (limiter.isErr()) throw limiter.error;
    let release!: () => void;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    const first = limiter.value.run(() => gate);
    // Give the queue a macrotask to pick up the first task.
    await tick();
    expect(limiter.value.activeCount).toBe(1);
    const second = limiter.value.run(async () => 2);
    await tick();
    expect(limiter.value.pendingCount).toBe(1);
    release();
    const [r1, r2] = await Promise.all([first, second]);
    expect(r1.isOk() && r2.isOk()).toBe(true);
    expect(limiter.value.activeCount).toBe(0);
    expect(limiter.value.pendingCount).toBe(0);
  });
});

describe('P-031 limiter: maps errors (spec smoke test)', () => {
  it('a throwing task becomes err(INTERNAL), not a rejection', async () => {
    const limiter = createLimiter(2);
    if (limiter.isErr()) throw limiter.error;
    const r = await limiter.value.run(async () => {
      throw new Error('boom');
    });
    expect(r.isErr()).toBe(true);
    if (r.isErr()) {
      expect(r.error.code).toBe('INTERNAL');
      if (r.error.code === 'INTERNAL') {
        expect(r.error.message).toContain('boom');
      }
    }
  });

  it('a rejecting task becomes err(INTERNAL)', async () => {
    const limiter = createLimiter(2);
    if (limiter.isErr()) throw limiter.error;
    const r = await limiter.value.run(() => Promise.reject(new Error('nope')));
    expect(r.isErr()).toBe(true);
  });

  it('one bad task does not poison its siblings', async () => {
    const limiter = createLimiter(2);
    if (limiter.isErr()) throw limiter.error;
    const [good, bad] = await Promise.all([
      limiter.value.run(async () => 1),
      limiter.value.run(async () => {
        throw new Error('bad');
      }),
    ]);
    expect(good.isOk()).toBe(true);
    expect(bad.isErr()).toBe(true);
  });
});

describe('P-031 createLimiter: misuse rejected at the boundary', () => {
  it.each([0, -1, 1.5, Number.NaN])('concurrency %p returns err(CONFIG_ERROR)', n => {
    const r = createLimiter(n);
    expect(r.isErr()).toBe(true);
    if (r.isErr()) {
      expect(r.error.code).toBe('CONFIG_ERROR');
      if (r.error.code === 'CONFIG_ERROR') {
        expect(r.error.field).toBe('concurrency');
      }
    }
  });

  it('echoes a valid concurrency on the handle', () => {
    const r = createLimiter(4);
    if (r.isErr()) throw r.error;
    expect(r.value.concurrency).toBe(4);
  });
});

describe('P-031 withLimit: scoped execution', () => {
  it('runs the body with a working runner', async () => {
    const r = await withLimit(2, async run => {
      const a = await run(async () => 1);
      const b = await run(async () => 2);
      if (a.isErr() || b.isErr()) throw new Error('unexpected err');
      return a.value + b.value;
    });
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      expect(r.value).toBe(3);
    }
  });

  it('does not invoke the body on a bad cap', async () => {
    let invoked = false;
    const r = await withLimit(0, async () => {
      invoked = true;
      return 1;
    });
    expect(invoked).toBe(false);
    expect(r.isErr()).toBe(true);
  });

  it('a throwing body maps to err(INTERNAL)', async () => {
    const r = await withLimit(2, async () => {
      throw new Error('body boom');
    });
    expect(r.isErr()).toBe(true);
  });
});

describe('P-031 mapLimit: bounded batch with per-item Results', () => {
  it('preserves input order and caps in-flight work', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const r = await mapLimit([0, 1, 2, 3, 4], 2, async n => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await tick();
      inFlight -= 1;
      return n * 10;
    });
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      expect(r.value.map(item => (item.isOk() ? item.value : -1))).toEqual([0, 10, 20, 30, 40]);
    }
    expect(maxInFlight).toBeLessThanOrEqual(2);
  });

  it('a throwing mapper degrades that item, batch still resolves', async () => {
    const r = await mapLimit([0, 1, 2], 2, async n => {
      if (n === 1) throw new Error('bad item');
      return n;
    });
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      expect(r.value[0]?.isOk()).toBe(true);
      expect(r.value[1]?.isErr()).toBe(true);
      expect(r.value[2]?.isOk()).toBe(true);
      const mid = r.value[1];
      if (mid?.isErr()) {
        expect(mid.error.code).toBe('INTERNAL');
        if (mid.error.code === 'INTERNAL') {
          expect(mid.error.message).toContain('mapLimit item 1 failed');
        }
      }
    }
  });

  it('supports sync mappers', async () => {
    const r = await mapLimit(['a', 'bb'], 2, s => s.length);
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      expect(r.value.map(item => (item.isOk() ? item.value : -1))).toEqual([1, 2]);
    }
  });

  it('empty input resolves to an empty batch', async () => {
    const r = await mapLimit([], 2, async (n: number) => n);
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      expect(r.value).toEqual([]);
    }
  });

  it('bad concurrency returns err without running the mapper', async () => {
    let calls = 0;
    const r = await mapLimit([1, 2], 0, async n => {
      calls += 1;
      return n;
    });
    expect(calls).toBe(0);
    expect(r.isErr()).toBe(true);
  });
});
