// P-174 — sandbox limits tests.
//
// Pure mapping and clock behaviour, plus one end-to-end case that drives the
// REAL `SandboxClient` over a fake docker, so "kills + removes on timeout" is
// evidenced by the container lifecycle rather than asserted by construction.
//
// The six required scenarios from the phase spec:
//
//   it('applies memory/cpu/network')  it('kills on timeout')
//   it('aborts on signal')            it('strict limits')
//   it('defaults read config')        it('bounds output')

import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { ok } from 'neverthrow';
import { CaptureManager, DEFAULT_LOG_CAPACITY, DEFAULT_MAX_ARTIFACT_BYTES } from './capture.js';
import { SandboxClient, type ContainerLike, type DockerLike, type RunOptions } from './client.js';
import {
  DEFAULT_LIMITS,
  STRICT_LIMITS,
  applyLimits,
  defaultLimits,
  enforceTimeout,
  limitsToCaptureOptions,
  parseCpuCount,
  parseMemoryToMb,
} from './limits.js';

const SPEC = { image: 'img:1', workingDir: '/workspace' };

/** A fake docker whose container never exits (for the timeout case). */
function slowDocker(): { docker: DockerLike; removed: string[] } {
  const removed: string[] = [];
  const container: ContainerLike = {
    start: async () => undefined,
    wait: () => new Promise(() => {}),
    logs: async () => Buffer.from(''),
    remove: async () => {
      removed.push('t1');
      return undefined;
    },
    stats: async () => ({}),
    inspect: async () => ({}),
    getArchive: async () => Readable.from([]),
    followLogs: async () => new EventEmitter() as unknown as NodeJS.ReadableStream,
  };
  return {
    removed,
    docker: {
      ping: async () => 'OK',
      pull: async () => new EventEmitter(),
      buildImage: async () => new EventEmitter(),
      createContainer: async () => container,
      getContainer: () => container,
      getImage: () => ({ remove: async () => undefined }),
      getVolume: () => ({ remove: async () => undefined }),
      getNetwork: () => ({ remove: async () => undefined }),
      pruneImages: async () => ({}),
    },
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('P-174 limits', () => {
  it('applies memory/cpu/network', () => {
    const spec = applyLimits(SPEC, DEFAULT_LIMITS);
    expect(spec.memory).toBe(1536 * 1024 * 1024);
    expect(spec.cpus).toBe(2);
    expect(spec.networkDisabled).toBe(false);

    const offline = applyLimits(SPEC, STRICT_LIMITS);
    expect(offline.memory).toBe(512 * 1024 * 1024);
    expect(offline.cpus).toBe(1);
    expect(offline.networkDisabled).toBe(true);

    // Pure: the caller's spec is untouched, and other fields survive.
    expect(SPEC).toEqual({ image: 'img:1', workingDir: '/workspace' });
    expect(spec.image).toBe('img:1');
    expect(spec.workingDir).toBe('/workspace');

    // OomKillDisable is deliberately never set (a disabled OOM killer could
    // starve the host — the failure this phase exists to prevent).
    expect(Object.hasOwn(spec, 'oomKillDisable')).toBe(false);
  });

  it('kills on timeout', async () => {
    // The wrapper owns a clock and returns the distinct timeout code.
    const wrapped = await enforceTimeout(() => new Promise<never>(() => {}), 20);
    expect(wrapped.isErr()).toBe(true);
    if (wrapped.isErr() && wrapped.error.code === 'SANDBOX_TIMEOUT') {
      expect(wrapped.error.timeoutMs).toBe(20);
      expect(wrapped.error.message).toContain('20ms');
    }

    // With the REAL client the container is killed and removed by the run's
    // own `finally`, and the code is the same one the wrapper reports.
    const { docker, removed } = slowDocker();
    const client = new SandboxClient({ docker });
    const ran = await enforceTimeout(
      () => client.run(applyLimits(SPEC, { ...DEFAULT_LIMITS, timeoutMs: 20 }), { timeoutMs: 20 }),
      5_000
    );
    expect(ran.isErr()).toBe(true);
    if (ran.isErr()) expect(ran.error.code).toBe('SANDBOX_TIMEOUT');
    expect(removed).toEqual(['t1']);

    // A settled operation passes its own result through untouched.
    const passed = await enforceTimeout(async () => ok('fine'), 1_000);
    expect(passed.isOk() && passed.value).toBe('fine');
  });

  it('aborts on signal', async () => {
    const pre = new AbortController();
    pre.abort();
    const early = await enforceTimeout(async () => ok('never'), 1_000, pre.signal);
    expect(early.isErr()).toBe(true);
    if (early.isErr()) expect(early.error.code).toBe('SANDBOX_ABORTED');

    const mid = new AbortController();
    const running = enforceTimeout(() => new Promise<never>(() => {}), 60_000, mid.signal);
    setTimeout(() => mid.abort(), 10);
    const aborted = await running;
    expect(aborted.isErr()).toBe(true);
    if (aborted.isErr()) expect(aborted.error.code).toBe('SANDBOX_ABORTED');

    // A throwing / rejecting operation is a typed INTERNAL, never a rejection.
    const threw = await enforceTimeout(async () => {
      throw new Error('boom');
    }, 1_000);
    expect(threw.isErr() && threw.error.code).toBe('INTERNAL');
    const rejected = await enforceTimeout(() => Promise.reject(new Error('nope')), 1_000);
    expect(rejected.isErr() && rejected.error.code).toBe('INTERNAL');
  });

  it('strict limits', () => {
    expect(STRICT_LIMITS.networkAllowed).toBe(false);
    expect(STRICT_LIMITS.timeoutMs).toBeLessThan(DEFAULT_LIMITS.timeoutMs);
    expect(STRICT_LIMITS.memMb).toBeLessThan(DEFAULT_LIMITS.memMb);
    expect(STRICT_LIMITS.cpuCount).toBeLessThanOrEqual(DEFAULT_LIMITS.cpuCount);
    // The log + artifact bounds are NOT tightened: they protect host memory
    // rather than constrain the code under test.
    expect(STRICT_LIMITS.outputLines).toBe(DEFAULT_LOG_CAPACITY);
    expect(STRICT_LIMITS.maxArtifactBytes).toBe(DEFAULT_MAX_ARTIFACT_BYTES);
  });

  it('defaults read config', () => {
    // config.sandbox speaks Docker notation: memory '2g', cpu '1', timeout in
    // SECONDS.
    const fromConfig = defaultLimits({
      limits: { memory: '2g', cpu: '1', timeout: 600 },
      networkAllow: false,
      maxArtifactBytes: 4096,
    });
    expect(fromConfig.isOk()).toBe(true);
    if (fromConfig.isOk()) {
      expect(fromConfig.value.memMb).toBe(2048);
      expect(fromConfig.value.cpuCount).toBe(1);
      expect(fromConfig.value.timeoutMs).toBe(600_000);
      expect(fromConfig.value.networkAllowed).toBe(false);
      expect(fromConfig.value.maxArtifactBytes).toBe(4096);
    }

    // No config → the phase's fallback profile.
    const fallback = defaultLimits();
    expect(fallback.isOk() && fallback.value).toEqual(DEFAULT_LIMITS);

    // Unparseable values are typed errors, never a silent 0 (which would
    // remove the very limit that protects the host).
    expect(defaultLimits({ limits: { memory: 'lots' } }).isErr()).toBe(true);
    expect(defaultLimits({ limits: { cpu: 'many' } }).isErr()).toBe(true);
    expect(defaultLimits({ limits: { cpu: '0' } }).isErr()).toBe(true);
    expect(defaultLimits({ limits: { timeout: 0 } }).isErr()).toBe(true);
    expect(parseMemoryToMb('512m')._unsafeUnwrap()).toBe(512);
    expect(parseMemoryToMb('1.5g')._unsafeUnwrap()).toBe(1536);
    expect(parseMemoryToMb('1024k')._unsafeUnwrap()).toBe(1);
    expect(parseMemoryToMb('1536')._unsafeUnwrap()).toBe(1536);
    expect(parseMemoryToMb('-1g').isErr()).toBe(true);
    expect(parseMemoryToMb('2 gigs').isErr()).toBe(true);
    expect(parseCpuCount('0.5')._unsafeUnwrap()).toBe(0.5);
    expect(parseCpuCount('x').isErr()).toBe(true);
  });

  it('bounds output', () => {
    // The log bound is P-173's constant, so there is ONE home for it.
    expect(DEFAULT_LIMITS.outputLines).toBe(DEFAULT_LOG_CAPACITY);
    const cfg = { ...DEFAULT_LIMITS, outputLines: 2, maxArtifactBytes: 1234 };
    expect(limitsToCaptureOptions(cfg)).toEqual({ logCapacity: 2, maxArtifactBytes: 1234 });

    // …and it really bounds a capture manager built from the profile.
    const manager = new CaptureManager(limitsToCaptureOptions(cfg));
    const sink = manager.bindRun('run-limits');
    for (const line of ['a', 'b', 'c', 'd']) sink.stream(line);
    expect(manager.logs('run-limits')).toEqual(['c', 'd']);
    expect(manager.dropped('run-limits')).toBe(2);
  });

  it('maps a limits profile onto the container the client creates', async () => {
    const created: Record<string, unknown>[] = [];
    const container: ContainerLike = {
      start: async () => undefined,
      wait: async () => ({ StatusCode: 0 }),
      logs: async () => Buffer.from('ok'),
      remove: async () => undefined,
      stats: async () => ({}),
      inspect: async () => ({}),
      getArchive: async () => Readable.from([]),
      followLogs: async () => new EventEmitter() as unknown as NodeJS.ReadableStream,
    };
    const docker: DockerLike = {
      ping: async () => 'OK',
      pull: async () => new EventEmitter(),
      buildImage: async () => new EventEmitter(),
      createContainer: async options => {
        created.push(options as unknown as Record<string, unknown>);
        return container;
      },
      getContainer: () => container,
      getImage: () => ({ remove: async () => undefined }),
      getVolume: () => ({ remove: async () => undefined }),
      getNetwork: () => ({ remove: async () => undefined }),
      pruneImages: async () => ({}),
    };
    const client = new SandboxClient({ docker });
    const spec = applyLimits(SPEC, STRICT_LIMITS);
    const ran = await client.run(spec, { timeoutMs: 5_000 } as RunOptions);
    expect(ran.isOk()).toBe(true);
    expect(created[0]?.['HostConfig']).toMatchObject({
      Memory: 512 * 1024 * 1024,
      NanoCpus: 1_000_000_000,
      NetworkMode: 'none',
    });
  });
});
