// Performance (P-086): full suite. Bounded parallel maps (P-031) with
// order-independent results, the sha-keyed ref cache (P-303 seam) with
// ref-consistency skips, the single-writer guard, the blobless wrapper,
// and parallel shallow clones over independent roots (P-069) — including
// real file:// clones proving depth takes effect (.git/shallow).
//
// Timeout note (P-075 precedent): real-git tests carry an explicit 30s
// budget — the core project resolves vitest's 5s default (the root 30s
// does not inherit into defineProject). Scripted tests keep the strict
// default as a canary. No network is touched (file:// clones are local).

import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile, readFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { ok, err, type Result } from 'neverthrow';
import type { StitchError } from '../result/index.js';
import type { CloneGit } from './clone.js';
import type { GitFactoryOptions } from './factory.js';
import {
  mapParallel,
  runExclusive,
  createRefCache,
  fetchCached,
  withBloblessFilter,
  cloneMany,
  BLOBLESS_FILTER_ARG,
  DEFAULT_PERF_CONCURRENCY,
  type CloneSpec,
} from './perf.js';

const execFileAsync = promisify(execFile);

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Poll until cond holds (throws on timeout — test-only helper). */
async function waitFor(cond: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await delay(5);
  }
}

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', [...args], { cwd });
  return stdout.trim();
}

/** Hermetic source repo with two commits (P-072 precedent: identity + lf). */
async function makeSource(): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), 'stitch-perf-src-'));
  await git(repo, ['init', '-q', '-b', 'main']);
  await git(repo, ['config', 'user.email', 'test@stitch.dev']);
  await git(repo, ['config', 'user.name', 'stitch-test']);
  await git(repo, ['config', 'core.autocrlf', 'false']);
  await git(repo, ['config', 'core.eol', 'lf']);
  await writeFile(join(repo, 'a.txt'), 'v1\n');
  await git(repo, ['add', '-A']);
  await git(repo, ['commit', '-qm', 'one']);
  await writeFile(join(repo, 'a.txt'), 'v2\n');
  await git(repo, ['commit', '-qam', 'two']);
  return repo;
}

async function dispose(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true });
}

function toFileUrl(path: string): string {
  return 'file://' + path.replace(/\\/g, '/');
}

// ─── mapParallel ───────────────────────────────────────────────────────

describe('mapParallel', () => {
  it('caps concurrency', async () => {
    let inFlight = 0;
    let peak = 0;
    const result = await mapParallel([0, 1, 2, 3, 4, 5], 2, async n => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await delay(10);
      inFlight -= 1;
      return n * 2;
    });
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(peak).toBeLessThanOrEqual(2);
    expect(peak).toBeGreaterThan(1);
    expect(result.value.map(r => r.isOk())).toEqual([true, true, true, true, true, true]);
  });

  it('deterministic', async () => {
    // Descending delays finish out of order; results stay input-ordered.
    const result = await mapParallel([0, 1, 2, 3], 4, async n => {
      await delay((3 - n) * 10);
      return `item-${n}`;
    });
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.map(r => (r.isOk() ? r.value : null))).toEqual([
      'item-0',
      'item-1',
      'item-2',
      'item-3',
    ]);
  });

  it('isolates per-item failures', async () => {
    const result = await mapParallel([0, 1, 2], 2, async n => {
      if (n === 1) throw new Error('bad apple');
      return n;
    });
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value[0]?.isOk()).toBe(true);
    const middle = result.value[1];
    expect(middle?.isOk()).toBe(false);
    if (middle === undefined || middle.isOk()) return;
    expect(middle.error.code).toBe('INTERNAL');
    expect(result.value[2]?.isOk()).toBe(true);
  });

  it('rejects misuse at the boundary', async () => {
    const badCap = await mapParallel([1], 0, async n => n);
    expect(badCap.isErr()).toBe(true);
    if (badCap.isOk()) return;
    expect(badCap.error.code).toBe('CONFIG_ERROR');
    const badItems = await mapParallel(null as unknown as number[], 2, async n => n);
    expect(badItems.isErr()).toBe(true);
    if (badItems.isOk()) return;
    expect(badItems.error.code).toBe('CONFIG_ERROR');
    if (badItems.error.code !== 'CONFIG_ERROR') return;
    expect(badItems.error.field).toBe('items');
    const badOp = await mapParallel([1], 2, null as unknown as (n: number) => number);
    expect(badOp.isErr()).toBe(true);
    if (badOp.isOk()) return;
    expect(badOp.error.code).toBe('CONFIG_ERROR');
    if (badOp.error.code !== 'CONFIG_ERROR') return;
    expect(badOp.error.field).toBe('op');
  });

  it('maps the empty batch to ok', async () => {
    const result = await mapParallel([], 2, async (n: number) => n);
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value).toEqual([]);
  });
});

// ─── RefCache ──────────────────────────────────────────────────────────

describe('createRefCache', () => {
  it('stores and reports entries', () => {
    const cache = createRefCache<string>();
    expect(cache.size).toBe(0);
    expect(cache.get('main')).toBeUndefined();
    expect(cache.hasLive('main', 'abc')).toBe(false);
    cache.set('main', 'abc', 'tree-1');
    expect(cache.size).toBe(1);
    expect(cache.get('main')).toEqual({ sha: 'abc', value: 'tree-1' });
    expect(cache.hasLive('main', 'abc')).toBe(true);
    expect(cache.hasLive('main', 'def')).toBe(false);
    expect(cache.hasLive('other', 'abc')).toBe(false);
    // Re-set under a moved sha replaces the entry in place.
    cache.set('main', 'def', 'tree-2');
    expect(cache.size).toBe(1);
    expect(cache.get('main')).toEqual({ sha: 'def', value: 'tree-2' });
  });

  it('invalidates and clears', () => {
    const cache = createRefCache<string>();
    cache.set('a', 's1', 'v1');
    cache.set('b', 's2', 'v2');
    expect(cache.invalidate('a')).toBe(true);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.invalidate('a')).toBe(false);
    expect(cache.size).toBe(1);
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.get('b')).toBeUndefined();
  });

  it('is blank-safe without throwing', () => {
    const cache = createRefCache<string>();
    expect(cache.get('   ')).toBeUndefined();
    expect(cache.hasLive('', 'x')).toBe(false);
    cache.set('  ', 's', 'v');
    expect(cache.size).toBe(0);
    expect(cache.invalidate('')).toBe(false);
  });
});

// ─── fetchCached ───────────────────────────────────────────────────────

describe('fetchCached', () => {
  function resolveTo(sha: string, calls: string[]): () => Promise<Result<string, StitchError>> {
    return async () => {
      calls.push('resolve');
      return ok(sha);
    };
  }

  function fetchCounted(
    value: string,
    calls: string[]
  ): (sha: string) => Promise<Result<string, StitchError>> {
    return async sha => {
      calls.push(`fetch:${sha}`);
      return ok(`${value}@${sha.slice(0, 7)}`);
    };
  }

  it('caches skips', async () => {
    const cache = createRefCache<string>();
    const calls: string[] = [];
    const first = await fetchCached(
      cache,
      'main',
      resolveTo('sha-one', calls),
      fetchCounted('t', calls)
    );
    expect(first.isOk()).toBe(true);
    if (first.isErr()) return;
    expect(first.value).toEqual({ value: 't@sha-one', cached: false });
    const second = await fetchCached(
      cache,
      'main',
      resolveTo('sha-one', calls),
      fetchCounted('t', calls)
    );
    expect(second.isOk()).toBe(true);
    if (second.isErr()) return;
    expect(second.value.cached).toBe(true);
    expect(second.value.value).toBe('t@sha-one');
    expect(calls.filter(c => c.startsWith('fetch:'))).toHaveLength(1);
  });

  it('refetches when the ref moves', async () => {
    const cache = createRefCache<string>();
    const calls: string[] = [];
    await fetchCached(cache, 'main', resolveTo('sha-one', calls), fetchCounted('t', calls));
    const moved = await fetchCached(
      cache,
      'main',
      resolveTo('sha-two', calls),
      fetchCounted('t', calls)
    );
    expect(moved.isOk()).toBe(true);
    if (moved.isErr()) return;
    expect(moved.value).toEqual({ value: 't@sha-two', cached: false });
    expect(cache.get('main')).toEqual({ sha: 'sha-two', value: 't@sha-two' });
  });

  it('keys refs independently', async () => {
    const cache = createRefCache<number>();
    const calls: string[] = [];
    const resolveFixed = (sha: string) => async () => {
      calls.push(`resolve:${sha}`);
      return ok(sha);
    };
    const fetchNum = async (sha: string) => ok(sha.length);
    await fetchCached(cache, 'a', resolveFixed('s1'), fetchNum);
    await fetchCached(cache, 'b', resolveFixed('s1'), fetchNum);
    // Same sha under another ref still fetches (per-ref entries), then hits.
    expect(calls.filter(c => c === 'resolve:s1')).toHaveLength(2);
    const hit = await fetchCached(cache, 'a', resolveFixed('s1'), fetchNum);
    expect(hit.isOk() && hit.value.cached).toBe(true);
  });

  it('propagates resolver and fetch failures without caching', async () => {
    const cache = createRefCache<string>();
    const resolveFail = async (): Promise<Result<string, StitchError>> =>
      err({ code: 'GIT_ERROR', message: 'resolve failed', gitOutput: 'resolve failed' });
    const failed = await fetchCached(cache, 'main', resolveFail, async () => ok('x'));
    expect(failed.isErr()).toBe(true);
    if (failed.isOk()) return;
    expect(failed.error.code).toBe('GIT_ERROR');
    expect(cache.size).toBe(0);
    const fetchFail = async (): Promise<Result<string, StitchError>> =>
      err({ code: 'GIT_ERROR', message: 'fetch failed', gitOutput: 'fetch failed' });
    const failedFetch = await fetchCached(cache, 'main', async () => ok('s'), fetchFail);
    expect(failedFetch.isErr()).toBe(true);
    if (failedFetch.isOk()) return;
    expect(failedFetch.error.code).toBe('GIT_ERROR');
    expect(cache.size).toBe(0);
  });

  it('maps throwing seams to INTERNAL', async () => {
    const cache = createRefCache<string>();
    const throwingResolve = async (): Promise<Result<string, StitchError>> => {
      throw new Error('resolve blew up');
    };
    const r = await fetchCached(cache, 'main', throwingResolve, async () => ok('x'));
    expect(r.isErr()).toBe(true);
    if (r.isOk()) return;
    expect(r.error.code).toBe('INTERNAL');
    const throwingFetch = async (): Promise<Result<string, StitchError>> => {
      throw new Error('fetch blew up');
    };
    const f = await fetchCached(cache, 'main', async () => ok('s'), throwingFetch);
    expect(f.isErr()).toBe(true);
    if (f.isOk()) return;
    expect(f.error.code).toBe('INTERNAL');
    expect(cache.size).toBe(0);
  });

  it('rejects blank refs, blank shas and bad seams', async () => {
    const cache = createRefCache<string>();
    const blank = await fetchCached(
      cache,
      '  ',
      async () => ok('s'),
      async () => ok('x')
    );
    expect(blank.isErr()).toBe(true);
    if (blank.isOk()) return;
    expect(blank.error.code).toBe('CONFIG_ERROR');
    const blankSha = await fetchCached(
      cache,
      'main',
      async () => ok('  '),
      async () => ok('x')
    );
    expect(blankSha.isErr()).toBe(true);
    if (blankSha.isOk()) return;
    expect(blankSha.error.code).toBe('INTERNAL');
    const badCache = await fetchCached(
      null as unknown as ReturnType<typeof createRefCache<string>>,
      'main',
      async () => ok('s'),
      async () => ok('x')
    );
    expect(badCache.isErr()).toBe(true);
    if (badCache.isOk()) return;
    expect(badCache.error.code).toBe('CONFIG_ERROR');
    const badFn = await fetchCached(
      cache,
      'main',
      null as unknown as () => Promise<Result<string, StitchError>>,
      async () => ok('x')
    );
    expect(badFn.isErr()).toBe(true);
    if (badFn.isOk()) return;
    expect(badFn.error.code).toBe('CONFIG_ERROR');
    const badFetch = await fetchCached(
      cache,
      'main',
      async () => ok('s'),
      null as unknown as (sha: string) => Promise<Result<string, StitchError>>
    );
    expect(badFetch.isErr()).toBe(true);
    if (badFetch.isOk()) return;
    expect(badFetch.error.code).toBe('CONFIG_ERROR');
  });

  it('proves ref-consistency against real git', async () => {
    const repo = await makeSource();
    try {
      const cache = createRefCache<string>();
      const calls: string[] = [];
      const resolveHead = async (): Promise<Result<string, StitchError>> =>
        ok(await git(repo, ['rev-parse', 'HEAD']));
      const fetchCount = async (sha: string): Promise<Result<string, StitchError>> => {
        calls.push(sha);
        return ok(await git(repo, ['rev-list', '--count', sha]));
      };
      const first = await fetchCached(cache, 'main', resolveHead, fetchCount);
      expect(first.isOk() && first.value).toEqual({ value: '2', cached: false });
      const second = await fetchCached(cache, 'main', resolveHead, fetchCount);
      expect(second.isOk() && second.value.cached).toBe(true);
      expect(calls).toHaveLength(1);
      // Move the ref: the next read must rework exactly once.
      await writeFile(join(repo, 'a.txt'), 'v3\n');
      await git(repo, ['commit', '-qam', 'three']);
      const third = await fetchCached(cache, 'main', resolveHead, fetchCount);
      expect(third.isOk() && third.value).toEqual({ value: '3', cached: false });
      expect(calls).toHaveLength(2);
    } finally {
      await dispose(repo);
    }
  }, 30_000);
});

// ─── runExclusive ──────────────────────────────────────────────────────

describe('runExclusive', () => {
  it('single writer', async () => {
    let inFlight = 0;
    let peak = 0;
    const order: number[] = [];
    const results = await Promise.all(
      [0, 1, 2].map(i =>
        runExclusive('wt-main', async () => {
          inFlight += 1;
          peak = Math.max(peak, inFlight);
          order.push(i);
          await delay(10);
          inFlight -= 1;
          return ok(i * 10);
        })
      )
    );
    expect(peak).toBe(1);
    expect(order).toEqual([0, 1, 2]);
    expect(results.map(r => (r.isOk() ? r.value : null))).toEqual([0, 10, 20]);
  });

  it('separate keys run in parallel', async () => {
    let inFlight = 0;
    let peak = 0;
    await Promise.all(
      ['ka', 'kb'].map(k =>
        runExclusive(k, async () => {
          inFlight += 1;
          peak = Math.max(peak, inFlight);
          await delay(15);
          inFlight -= 1;
          return ok(k);
        })
      )
    );
    expect(peak).toBe(2);
  });

  it('passes op errors through and recovers the chain', async () => {
    const failing = await runExclusive('k-err', async (): Promise<Result<number, StitchError>> =>
      err({ code: 'GIT_ERROR', message: 'op failed', gitOutput: 'op failed' })
    );
    expect(failing.isErr()).toBe(true);
    if (failing.isOk()) return;
    expect(failing.error.code).toBe('GIT_ERROR');
    const after = await runExclusive('k-err', async () => ok(7));
    expect(after.isOk() && after.value).toBe(7);
  });

  it('maps throwing ops to INTERNAL without wedging', async () => {
    const thrown = await runExclusive('k-throw', async () => {
      throw new Error('op blew up');
    });
    expect(thrown.isErr()).toBe(true);
    if (thrown.isOk()) return;
    expect(thrown.error.code).toBe('INTERNAL');
    const after = await runExclusive('k-throw', async () => ok('recovered'));
    expect(after.isOk() && after.value).toBe('recovered');
  });

  it('rejects blank keys and bad ops', async () => {
    const blank = await runExclusive('  ', async () => ok(1));
    expect(blank.isErr()).toBe(true);
    if (blank.isOk()) return;
    expect(blank.error.code).toBe('CONFIG_ERROR');
    const badOp = await runExclusive(
      'k',
      null as unknown as () => Promise<Result<number, StitchError>>
    );
    expect(badOp.isErr()).toBe(true);
    if (badOp.isOk()) return;
    expect(badOp.error.code).toBe('CONFIG_ERROR');
  });

  it('grants in call order under contention', async () => {
    const order: number[] = [];
    const gates = [0, 1, 2].map(() => {
      let release!: () => void;
      const promise = new Promise<void>(resolve => {
        release = resolve;
      });
      return { promise, release };
    });
    const pending = [0, 1, 2].map(i =>
      runExclusive('k-fifo', async () => {
        order.push(i);
        const gate = gates[i];
        if (gate === undefined) throw new Error('missing gate');
        await gate.promise;
        return ok(i);
      })
    );
    await waitFor(() => order.length === 1, 'first holder');
    expect(order).toEqual([0]);
    const g0 = gates[0];
    if (g0 === undefined) throw new Error('missing gate 0');
    g0.release();
    await waitFor(() => order.length === 2, 'second holder');
    expect(order).toEqual([0, 1]);
    const g1 = gates[1];
    if (g1 === undefined) throw new Error('missing gate 1');
    g1.release();
    await waitFor(() => order.length === 3, 'third holder');
    expect(order).toEqual([0, 1, 2]);
    const g2 = gates[2];
    if (g2 === undefined) throw new Error('missing gate 2');
    g2.release();
    const results = await Promise.all(pending);
    expect(results.map(r => (r.isOk() ? r.value : null))).toEqual([0, 1, 2]);
  });
});

// ─── withBloblessFilter ────────────────────────────────────────────────

describe('withBloblessFilter', () => {
  function recordingFactory(
    calls: { repo: string; target: string; options: string[] | undefined }[]
  ): (options: GitFactoryOptions) => CloneGit {
    return () => ({
      clone: async (repo: string, target: string, options?: string[]) => {
        calls.push({ repo, target, options });
        return '';
      },
      status: async () =>
        ({ current: 'main' }) as unknown as Awaited<ReturnType<CloneGit['status']>>,
    });
  }

  it('appends the blobless flag after caller options', async () => {
    const calls: { repo: string; target: string; options: string[] | undefined }[] = [];
    const wrapped = withBloblessFilter(recordingFactory(calls));
    const git = wrapped({ baseDir: '/tmp/x' });
    await git.clone('url', '/tmp/x', ['--depth', '1']);
    expect(calls[0]?.options).toEqual(['--depth', '1', BLOBLESS_FILTER_ARG]);
    expect(BLOBLESS_FILTER_ARG).toBe('--filter=blob:none');
  });

  it('works when the caller passes no options', async () => {
    const calls: { repo: string; target: string; options: string[] | undefined }[] = [];
    const wrapped = withBloblessFilter(recordingFactory(calls));
    await wrapped({ baseDir: '/tmp/x' }).clone('url', '/tmp/x');
    expect(calls[0]?.options).toEqual([BLOBLESS_FILTER_ARG]);
  });

  it('preserves status delegation', async () => {
    const wrapped = withBloblessFilter(recordingFactory([]));
    const status = await wrapped({ baseDir: '/tmp/x' }).status();
    expect(status.current).toBe('main');
  });
});

// ─── cloneMany ─────────────────────────────────────────────────────────

describe('cloneMany (scripted)', () => {
  function fakeRuntime(
    calls: { repo: string; target: string; options: string[] | undefined }[],
    factories: GitFactoryOptions[] = []
  ): { createGit: (options: GitFactoryOptions) => CloneGit } {
    return {
      createGit: options => {
        factories.push(options);
        return {
          clone: async (repo: string, target: string, cloneOptions?: string[]) => {
            calls.push({ repo, target, options: cloneOptions });
            await delay(5);
            return '';
          },
          status: async () =>
            ({ current: 'main' }) as unknown as Awaited<ReturnType<CloneGit['status']>>,
        };
      },
    };
  }

  it('clones independent roots in parallel with shallow+blobless defaults', async () => {
    const calls: { repo: string; target: string; options: string[] | undefined }[] = [];
    const factories: GitFactoryOptions[] = [];
    const specs: CloneSpec[] = [
      { url: 'https://example.com/a.git', targetDir: '/tmp/a', branch: 'main' },
      { url: 'https://example.com/b.git', targetDir: '/tmp/b' },
    ];
    const result = await cloneMany(
      specs,
      { concurrency: 2, depth: 3, timeoutMs: 5000, jobId: 'perf-job' },
      fakeRuntime(calls, factories)
    );
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.map(r => (r.isOk() ? r.value : null))).toEqual(['/tmp/a', '/tmp/b']);
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call.options).toContain('--depth');
      expect(call.options).toContain('3');
      expect(call.options).toContain(BLOBLESS_FILTER_ARG);
    }
    // Completion order races in parallel: locate by target, not position.
    const branched = calls.find(c => c.target === '/tmp/a');
    expect(branched?.options).toContain('--branch');
    expect(branched?.options).toContain('main');
    expect(factories).toHaveLength(2);
    // Factory invocations race in parallel: compare as sets, not positions.
    const byTarget = new Map(factories.map(f => [f.baseDir, f.timeoutMs]));
    for (const spec of specs) {
      expect(byTarget.get(spec.targetDir)).toBe(5000);
    }
  });

  it('honors explicit full clones and blobless opt-out', async () => {
    const calls: { repo: string; target: string; options: string[] | undefined }[] = [];
    const result = await cloneMany(
      [{ url: 'https://example.com/a.git', targetDir: '/tmp/a' }],
      { concurrency: 1, shallow: false, blobless: false },
      fakeRuntime(calls)
    );
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value[0]?.isOk()).toBe(true);
    expect(calls[0]?.options ?? []).not.toContain('--depth');
    expect(calls[0]?.options ?? []).not.toContain(BLOBLESS_FILTER_ARG);
  });

  it('refuses duplicate targets before any spawn', async () => {
    const calls: { repo: string; target: string; options: string[] | undefined }[] = [];
    const result = await cloneMany(
      [
        { url: 'https://example.com/a.git', targetDir: '/tmp/same' },
        { url: 'https://example.com/b.git', targetDir: '/tmp/same/' },
      ],
      { concurrency: 2 },
      fakeRuntime(calls)
    );
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('CONFIG_ERROR');
    expect(calls).toHaveLength(0);
  });

  it('rejects blank urls, blank targets and bad depths', async () => {
    const calls: { repo: string; target: string; options: string[] | undefined }[] = [];
    for (const specs of [
      [{ url: '  ', targetDir: '/tmp/a' }],
      [{ url: 'https://example.com/a.git', targetDir: ' ' }],
      [{ url: 42, targetDir: '/tmp/a' }],
      [null],
      [{ url: 'https://example.com/a.git', targetDir: '/tmp/a', branch: ' ' }],
      'nope',
    ] as unknown as CloneSpec[][]) {
      const result = await cloneMany(specs, { concurrency: 1 }, fakeRuntime(calls));
      expect(result.isErr()).toBe(true);
      if (result.isOk()) continue;
      expect(result.error.code).toBe('CONFIG_ERROR');
    }
    expect(calls).toHaveLength(0);
    for (const depth of [0, 1.5, Number.NaN]) {
      const badDepth = await cloneMany(
        [{ url: 'https://example.com/a.git', targetDir: '/tmp/a' }],
        { concurrency: 1, depth },
        fakeRuntime(calls)
      );
      expect(badDepth.isErr()).toBe(true);
      if (badDepth.isOk()) continue;
      expect(badDepth.error.code).toBe('CONFIG_ERROR');
    }
    expect(calls).toHaveLength(0);
  });

  it('keeps per-target failures isolated in order', async () => {
    const runtime = {
      createGit: () => ({
        clone: async (repo: string) => {
          if (repo.includes('/bad.git')) throw new Error('trembling network');
          return '';
        },
        status: async () =>
          ({ current: 'main' }) as unknown as Awaited<ReturnType<CloneGit['status']>>,
      }),
    };
    const result = await cloneMany(
      [
        { url: 'https://example.com/good.git', targetDir: '/tmp/good' },
        { url: 'https://example.com/bad.git', targetDir: '/tmp/bad' },
      ],
      { concurrency: 2 },
      runtime
    );
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value[0]?.isOk()).toBe(true);
    expect(result.value[1]?.isErr()).toBe(true);
  });

  it('exports the default concurrency budget', () => {
    expect(DEFAULT_PERF_CONCURRENCY).toBe(4);
  });

  it('surfaces bad caps as outer misuse without spawning', async () => {
    const calls: { repo: string; target: string; options: string[] | undefined }[] = [];
    const result = await cloneMany(
      [{ url: 'https://example.com/a.git', targetDir: '/tmp/a' }],
      { concurrency: 0 },
      fakeRuntime(calls)
    );
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('CONFIG_ERROR');
    expect(calls).toHaveLength(0);
  });
});

describe('cloneMany (real git)', () => {
  it('clones shallow copies in parallel with real depth effect', async () => {
    const src = await makeSource();
    const work = await mkdtemp(join(tmpdir(), 'stitch-perf-work-'));
    try {
      const specs: CloneSpec[] = [0, 1, 2].map(i => ({
        url: toFileUrl(src),
        targetDir: join(work, `child-${i}`),
      }));
      // Bare call: every default engages (concurrency, shallow, depth,
      // blobless, timeout) — the spec's "by default" sense.
      const result = await cloneMany(specs);
      expect(result.isOk()).toBe(true);
      if (result.isErr()) return;
      expect(result.value.map(r => (r.isOk() ? r.value : null))).toEqual(
        specs.map(s => s.targetDir)
      );
      for (const spec of specs) {
        // file:// honors --depth: the shallow marker exists (probed).
        await access(join(spec.targetDir, '.git', 'shallow'));
        // The clone inherits system checkout config (not the source's
        // core.eol), so normalize line endings before comparing content.
        const content = await readFile(join(spec.targetDir, 'a.txt'), 'utf8');
        expect(content.replace(/\r\n/g, '\n')).toBe('v2\n');
      }
    } finally {
      await dispose(src);
      await dispose(work);
    }
  }, 30_000);
});

// ─── Seams ─────────────────────────────────────────────────────────────

describe('perf module', () => {
  it('rejects non-array specs without spawning', async () => {
    const result = await cloneMany(null as unknown as CloneSpec[], { concurrency: 1 });
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('CONFIG_ERROR');
  });
});
