// P-168 — Sandbox Docker client tests.
//
// A fake dockerode instance is injected in every test: no daemon, no Docker,
// no network. The fake records the calls it receives so the "disables network"
// and "always cleans up" properties are asserted against what the client
// ACTUALLY asked the daemon to do, not against a spy's return value.
//
// The seven required scenarios from the phase spec:
//
//   it('detects availability')   it('pulls image')      it('runs and collects')
//   it('enforces timeout')       it('aborts via signal') it('disables network')
//   it('always cleans up')

import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  SandboxClient,
  demuxDockerLogs,
  MAX_CONTAINER_LOG_LINES,
  type ContainerCreateOptionsLike,
  type ContainerLike,
  type DockerLike,
} from './client.js';

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

/** A pull stream a test can drive (emits on the next macrotask). */
class FakeStream extends EventEmitter {
  constructor(chunks: string[], errorAfter?: string) {
    super();
    setImmediate(() => {
      for (const chunk of chunks) this.emit('data', Buffer.from(chunk, 'utf8'));
      if (errorAfter !== undefined) this.emit('error', new Error(errorAfter));
      else this.emit('end');
    });
  }
}

/** Docker multiplex frame: `[stream, 0, 0, 0, size(4BE)]` + payload. */
function frame(stream: 1 | 2, text: string): Buffer {
  const payload = Buffer.from(text, 'utf8');
  const header = Buffer.alloc(8);
  header[0] = stream;
  header.writeUInt32BE(payload.length, 4);
  return Buffer.concat([header, payload]);
}

interface FakeCalls {
  created: ContainerCreateOptionsLike[];
  started: number;
  waited: number;
  removed: { id?: string; force?: boolean; v?: boolean }[];
  statsRequested: string[];
  builds: string[];
}

interface FakeContainerConfig {
  id?: string;
  wait?: () => Promise<unknown>;
  startRejects?: boolean;
  logs?: () => Promise<Buffer | string>;
  logsReject?: boolean;
  removeRejects?: boolean;
  stats?: unknown;
  statsRejects?: boolean;
}

function makeFakeContainer(calls: FakeCalls, config: FakeContainerConfig = {}): ContainerLike {
  const container: ContainerLike = {
    async start() {
      calls.started += 1;
      if (config.startRejects === true) throw new Error('start exploded');
    },
    async wait() {
      calls.waited += 1;
      return config.wait === undefined ? { StatusCode: 0 } : config.wait();
    },
    async logs() {
      if (config.logsReject === true) throw new Error('logs exploded');
      return config.logs === undefined ? Buffer.from('') : config.logs();
    },
    async remove(options) {
      if (config.removeRejects === true) throw new Error('remove exploded');
      calls.removed.push({
        ...(config.id !== undefined ? { id: config.id } : {}),
        ...(options?.force !== undefined ? { force: options.force } : {}),
        ...(options?.v !== undefined ? { v: options.v } : {}),
      });
      return undefined;
    },
    async stats() {
      if (config.statsRejects === true) throw new Error('stats exploded');
      return config.stats ?? {};
    },
    async inspect() {
      return {};
    },
    async getArchive() {
      return Readable.from([Buffer.from('tar-bytes')]);
    },
  };
  if (config.id !== undefined) (container as { id?: string }).id = config.id;
  return container;
}

interface FakeDockerConfig {
  pingRejects?: boolean;
  pull?: () => Promise<unknown>;
  buildImage?: () => Promise<unknown>;
  container?: FakeContainerConfig;
  containersById?: Record<string, FakeContainerConfig>;
}

function makeFakeDocker(config: FakeDockerConfig = {}): { docker: DockerLike; calls: FakeCalls } {
  const calls: FakeCalls = {
    created: [],
    started: 0,
    waited: 0,
    removed: [],
    statsRequested: [],
    builds: [],
  };
  const docker: DockerLike = {
    async ping() {
      if (config.pingRejects === true) throw new Error('daemon down');
      return 'OK';
    },
    async pull() {
      if (config.pull !== undefined) return config.pull();
      return new FakeStream(['{"status":"pulling"}\n']);
    },
    async buildImage(_file, options) {
      calls.builds.push(options.t ?? '');
      if (config.buildImage !== undefined) return config.buildImage();
      return new FakeStream(['{"stream":"Successfully built"}\n']);
    },
    async createContainer(options) {
      calls.created.push(options);
      return makeFakeContainer(calls, config.container ?? {});
    },
    getContainer(id: string) {
      calls.statsRequested.push(id);
      return makeFakeContainer(calls, config.containersById?.[id] ?? { id });
    },
  };
  return { docker, calls };
}

const SPEC = { image: 'stitch/node:20', workingDir: '/work' };

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('P-168 SandboxClient', () => {
  it('detects availability', async () => {
    const up = makeFakeDocker();
    await expect(new SandboxClient({ docker: up.docker }).isAvailable()).resolves.toBe(true);

    const down = makeFakeDocker({ pingRejects: true });
    // Unavailable is an expected state, not an error: false, never a throw.
    await expect(new SandboxClient({ docker: down.docker }).isAvailable()).resolves.toBe(false);
  });

  it('pulls image', async () => {
    const okDocker = makeFakeDocker({ pull: async () => new FakeStream(['layer 1', 'layer 2']) });
    const client = new SandboxClient({ docker: okDocker.docker });
    const progress: string[] = [];
    const pulled = await client.pull('node:20', { onProgress: chunk => progress.push(chunk) });
    expect(pulled.isOk()).toBe(true);
    // Streaming progress was surfaced as it arrived.
    expect(progress.join('')).toContain('layer 1');
    expect(progress.join('')).toContain('layer 2');

    // A `{"error": ...}` line inside a resolved stream IS a failed pull.
    const badStream = makeFakeDocker({
      pull: async () => new FakeStream(['{"status":"x"}\n', '{"error":"pull access denied"}\n']),
    });
    const bad = await new SandboxClient({ docker: badStream.docker }).pull('private:latest');
    expect(bad.isErr()).toBe(true);
    if (bad.isErr() && bad.error.code === 'DOCKER_PULL_FAILED') {
      expect(bad.error.message).toContain('pull access denied');
      expect(bad.error.image).toBe('private:latest');
    }

    // A rejection is mapped the same way.
    const rejected = makeFakeDocker({
      pull: async () => Promise.reject(new Error('no such host')),
    });
    const direct = await new SandboxClient({ docker: rejected.docker }).pull('gone:1');
    expect(direct.isErr()).toBe(true);
    if (direct.isErr()) expect(direct.error.code).toBe('DOCKER_PULL_FAILED');

    // An empty image is a caller bug, not a pull.
    const empty = await new SandboxClient({ docker: okDocker.docker }).pull('   ');
    expect(empty.isErr()).toBe(true);
    if (empty.isErr()) expect(empty.error.code).toBe('CONFIG_ERROR');
  });

  it('runs and collects', async () => {
    const { docker, calls } = makeFakeDocker({
      container: {
        wait: async () => ({ StatusCode: 0 }),
        logs: async () => Buffer.concat([frame(1, 'hello\nworld\n'), frame(2, 'oops\n')]),
      },
    });
    const client = new SandboxClient({ docker });

    const result = await client.run(SPEC, { timeoutMs: 5_000 });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.exitCode).toBe(0);
      expect(result.value.stdout).toEqual(['hello', 'world']);
      expect(result.value.stderr).toEqual(['oops']);
      expect(result.value.durationMs).toBeGreaterThanOrEqual(0);
    }
    expect(calls.started).toBe(1);
    expect(calls.waited).toBe(1);
    expect(calls.removed).toHaveLength(1);
    // The spec made it onto the create request faithfully.
    expect(calls.created[0]).toMatchObject({ Image: 'stitch/node:20', WorkingDir: '/work' });
  });

  it('enforces timeout', async () => {
    const { docker, calls } = makeFakeDocker({
      container: { id: 'c-timeout', wait: () => new Promise(() => {}) },
    });
    const client = new SandboxClient({ docker });

    const result = await client.run(SPEC, { timeoutMs: 25 });
    expect(result.isErr()).toBe(true);
    if (result.isErr() && result.error.code === 'DOCKER_ERROR') {
      expect(result.error.message).toContain('timeoutMs=25');
    }
    // Cleanup is guaranteed on the timeout path too.
    expect(calls.removed).toHaveLength(1);
  });

  it('aborts via signal', async () => {
    const { docker, calls } = makeFakeDocker({ container: { wait: () => new Promise(() => {}) } });
    const client = new SandboxClient({ docker });
    const controller = new AbortController();

    const running = client.run(SPEC, { timeoutMs: 60_000, signal: controller.signal });
    setTimeout(() => controller.abort(), 15);
    const result = await running;

    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.code).toBe('ABORTED');
    expect(calls.removed).toHaveLength(1);

    // An already-aborted signal never touches the daemon.
    const pre = makeFakeDocker();
    const aborted = new AbortController();
    aborted.abort();
    const early = await new SandboxClient({ docker: pre.docker }).run(SPEC, {
      signal: aborted.signal,
    });
    expect(early.isErr()).toBe(true);
    if (early.isErr()) expect(early.error.code).toBe('ABORTED');
    expect(pre.calls.created).toHaveLength(0);
  });

  it('disables network', async () => {
    // Default: the network is allowed (no NetworkMode override).
    const allowed = makeFakeDocker();
    await new SandboxClient({ docker: allowed.docker }).run(SPEC, { timeoutMs: 5_000 });
    expect(allowed.calls.created[0]?.HostConfig?.NetworkMode).toBeUndefined();

    // networkAllowed:false forces NetworkMode:'none' (config sandbox.networkAllow).
    const offline = makeFakeDocker();
    await new SandboxClient({ docker: offline.docker, networkAllowed: false }).run(SPEC, {
      timeoutMs: 5_000,
    });
    expect(offline.calls.created[0]?.HostConfig?.NetworkMode).toBe('none');

    // A per-spec opt-out does the same even when the client allows network.
    const perSpec = makeFakeDocker();
    await new SandboxClient({ docker: perSpec.docker }).run(
      { ...SPEC, networkDisabled: true },
      { timeoutMs: 5_000 }
    );
    expect(perSpec.calls.created[0]?.HostConfig?.NetworkMode).toBe('none');
  });

  it('always cleans up', async () => {
    // A start failure still removes the container.
    const startFail = makeFakeDocker({ container: { startRejects: true } });
    const failed = await new SandboxClient({ docker: startFail.docker }).run(SPEC, {
      timeoutMs: 5_000,
    });
    expect(failed.isErr()).toBe(true);
    if (failed.isErr()) expect(failed.error.code).toBe('DOCKER_ERROR');
    expect(startFail.calls.removed).toHaveLength(1);

    // A rejected wait still removes the container.
    const waitFail = makeFakeDocker({
      container: { wait: async () => Promise.reject(new Error('wait exploded')) },
    });
    const waited = await new SandboxClient({ docker: waitFail.docker }).run(SPEC, {
      timeoutMs: 5_000,
    });
    expect(waited.isErr()).toBe(true);
    expect(waitFail.calls.removed).toHaveLength(1);

    // A failing remove is swallowed (cleanup must never fail a job).
    const removeFail = makeFakeDocker({ container: { removeRejects: true } });
    const client = new SandboxClient({ docker: removeFail.docker });
    await expect(client.rm('c1')).resolves.toBeUndefined();
    expect(removeFail.calls.statsRequested).toContain('c1');
  });

  it('builds an image', async () => {
    const { docker, calls } = makeFakeDocker();
    const client = new SandboxClient({ docker });

    const built = await client.buildImage({
      context: '/tmp/ctx.tar',
      tag: 'stitch-node:eph-1',
      dockerfile: '/ctx/Dockerfile.node',
      buildArgs: { CI: '1' },
    });
    expect(built.isOk() && built.value).toBe('stitch-node:eph-1');
    expect(calls.builds).toEqual(['stitch-node:eph-1']);

    // A `{"error": ...}` line inside a resolved build stream IS a failed build.
    const bad = makeFakeDocker({
      buildImage: async () => new FakeStream(['{"error":"no such file"}\n']),
    });
    const failed = await new SandboxClient({ docker: bad.docker }).buildImage({
      context: '/tmp/ctx.tar',
      tag: 'stitch-node:eph-2',
    });
    expect(failed.isErr()).toBe(true);
    if (failed.isErr() && failed.error.code === 'DOCKER_BUILD_FAILED') {
      expect(failed.error.message).toContain('no such file');
    }

    // A rejection maps the same way.
    const rejected = makeFakeDocker({
      buildImage: async () => Promise.reject(new Error('daemon refused')),
    });
    const direct = await new SandboxClient({ docker: rejected.docker }).buildImage({
      context: '/tmp/ctx.tar',
      tag: 'stitch-node:eph-3',
    });
    expect(direct.isErr()).toBe(true);
    if (direct.isErr()) expect(direct.error.code).toBe('DOCKER_BUILD_FAILED');

    // An empty tag is a caller bug, not a build.
    const empty = await client.buildImage({ context: '/tmp/ctx.tar', tag: '  ' });
    expect(empty.isErr()).toBe(true);
    if (empty.isErr()) expect(empty.error.code).toBe('CONFIG_ERROR');
  });

  it('copies a container path out as an archive', async () => {
    const { docker } = makeFakeDocker();
    const client = new SandboxClient({ docker });
    const hostDir = await mkdtemp(join(tmpdir(), 'stitch-copyout-'));
    try {
      const copied = await client.copyFrom('c1', '/workspace/dist', hostDir);
      expect(copied.isOk()).toBe(true);
      if (copied.isOk()) {
        expect(copied.value).toBe(join(hostDir, 'dist.tar'));
        expect(await readFile(copied.value, 'utf8')).toBe('tar-bytes');
      }
      // A blank path is a caller bug, not a copy.
      const blank = await client.copyFrom('c1', '  ', hostDir);
      expect(blank.isErr()).toBe(true);
      if (blank.isErr()) expect(blank.error.code).toBe('CONFIG_ERROR');
    } finally {
      await rm(hostDir, { recursive: true, force: true });
    }
  });

  it('captures artifacts inside the run, before cleanup', async () => {
    const { docker, calls } = makeFakeDocker({
      container: { wait: async () => ({ StatusCode: 0 }) },
    });
    const client = new SandboxClient({ docker });
    const hostDir = await mkdtemp(join(tmpdir(), 'stitch-capture-'));
    try {
      const result = await client.run(SPEC, {
        timeoutMs: 5_000,
        capture: { containerPath: '/workspace/dist', hostDir },
      });
      expect(result.isOk()).toBe(true);
      if (result.isOk()) expect(result.value.capturedArchive).toBe(join(hostDir, 'dist.tar'));
      // The container was still removed afterwards.
      expect(calls.removed).toHaveLength(1);
    } finally {
      await rm(hostDir, { recursive: true, force: true });
    }
  });

  it('rejects an invalid spec without touching the daemon', async () => {
    const { docker, calls } = makeFakeDocker();
    const client = new SandboxClient({ docker });
    const noImage = await client.run({ image: '  ', workingDir: '/w' });
    expect(noImage.isErr()).toBe(true);
    if (noImage.isErr()) expect(noImage.error.code).toBe('CONFIG_ERROR');
    const noDir = await client.run({ image: 'x', workingDir: '' });
    expect(noDir.isErr()).toBe(true);
    expect(calls.created).toHaveLength(0);
  });

  it('samples stats', async () => {
    const { docker } = makeFakeDocker({
      containersById: {
        c1: {
          id: 'c1',
          stats: {
            cpu_stats: { cpu_usage: { total_usage: 300 }, system_cpu_usage: 1_000, online_cpus: 2 },
            precpu_stats: { cpu_usage: { total_usage: 100 }, system_cpu_usage: 600 },
            memory_stats: { usage: 1024, limit: 4096 },
          },
        },
      },
    });
    const client = new SandboxClient({ docker });
    const stats = await client.stats('c1');
    expect(stats.isOk()).toBe(true);
    if (stats.isOk()) {
      // (300-100)/(1000-600) * 2 cpus * 100 = 100%
      expect(stats.value.cpuPercent).toBe(100);
      expect(stats.value.memoryUsage).toBe(1024);
      expect(stats.value.memoryLimit).toBe(4096);
    }

    const blank = await client.stats('  ');
    expect(blank.isErr()).toBe(true);

    const broken = makeFakeDocker({ containersById: { c2: { id: 'c2', statsRejects: true } } });
    const err = await new SandboxClient({ docker: broken.docker }).stats('c2');
    expect(err.isErr()).toBe(true);
    if (err.isErr()) expect(err.error.code).toBe('DOCKER_ERROR');
  });

  it('maps the spec onto the create request', async () => {
    const { docker, calls } = makeFakeDocker();
    await new SandboxClient({ docker }).run({
      image: 'img:1',
      workingDir: '/work',
      cmd: ['sh', '-c', 'bun test'],
      env: { CI: '1', NODE_ENV: 'test' },
      bindMounts: [{ host: '/host/a', container: '/c/a' }],
      memory: 512 * 1024 * 1024,
      cpus: 2,
    });
    expect(calls.created[0]).toEqual({
      Image: 'img:1',
      Cmd: ['sh', '-c', 'bun test'],
      WorkingDir: '/work',
      Env: ['CI=1', 'NODE_ENV=test'],
      HostConfig: {
        Binds: ['/host/a:/c/a'],
        Memory: 512 * 1024 * 1024,
        NanoCpus: 2_000_000_000,
      },
    });
  });

  it('demultiplexes and bounds logs', () => {
    const framed = demuxDockerLogs(
      Buffer.concat([frame(1, 'out1\n'), frame(2, 'err1\n'), frame(1, 'out2\n')])
    );
    expect(framed).toEqual({ stdout: ['out1', 'out2'], stderr: ['err1'] });

    // A raw / TTY stream (no frames) is all stdout, never dropped.
    expect(demuxDockerLogs(Buffer.from('raw line\n'))).toEqual({
      stdout: ['raw line'],
      stderr: [],
    });

    // The newest lines survive the cap.
    const many = Buffer.concat(Array.from({ length: 5 }, (_, i) => frame(1, `line${i}\n`)));
    expect(demuxDockerLogs(many, 2)).toEqual({ stdout: ['line3', 'line4'], stderr: [] });
  });

  it('creates a real client without contacting the daemon', () => {
    const created = SandboxClient.create({ socketPath: '/var/run/docker.sock' });
    expect(created.isOk()).toBe(true);
    expect(MAX_CONTAINER_LOG_LINES).toBeGreaterThan(0);
  });
});
