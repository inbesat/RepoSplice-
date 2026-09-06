// P-029 tests: createDockerClient covers transport resolution, and
// pingDocker covers reachable + every unreachable mode (all mocked —
// no daemon, no network, deterministic on any machine).
import { describe, it, expect } from 'vitest';
import {
  createDockerClient,
  pingDocker,
  defaultDockerSocket,
  type DockerPingable,
} from './docker.js';

describe('P-029 createDockerClient: transport resolution', () => {
  it('defaults to the platform socket when no options given', () => {
    const r = createDockerClient();
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      expect(r.value.transport).toEqual({ socketPath: defaultDockerSocket() });
    }
  });

  it('uses an explicit socketPath when given', () => {
    const r = createDockerClient({ socketPath: '/custom/docker.sock' });
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      expect(r.value.transport).toEqual({ socketPath: '/custom/docker.sock' });
    }
  });

  it('uses host/port transport when host is given (default port 2375)', () => {
    const r = createDockerClient({ host: 'tcp-proxy.example' });
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      expect(r.value.transport).toEqual({ host: 'tcp-proxy.example', port: 2375 });
    }
  });

  it('honours an explicit port with host', () => {
    const r = createDockerClient({ host: 'tcp-proxy.example', port: 2376 });
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      expect(r.value.transport).toEqual({ host: 'tcp-proxy.example', port: 2376 });
    }
  });

  it('exposes a real dockerode Docker instance (no I/O at construction)', () => {
    const r = createDockerClient();
    if (r.isErr()) throw r.error;
    // dockerode exposes `ping` as a function on the instance.
    expect(typeof (r.value.docker as DockerPingable).ping).toBe('function');
  });
});

describe('P-029 pingDocker: docker available (spec smoke test)', () => {
  it('returns reachable:true when ping resolves', async () => {
    const stub: DockerPingable = { ping: () => Promise.resolve('OK') };
    const r = await pingDocker(stub);
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      expect(r.value).toEqual({ reachable: true });
    }
  });
});

describe('P-029 pingDocker: docker unavailable fallback (spec smoke test)', () => {
  it('returns reachable:false with reason on ECONNREFUSED (daemon down)', async () => {
    const refused = new Error('connect ECONNREFUSED /var/run/docker.sock');
    const stub: DockerPingable = { ping: () => Promise.reject(refused) };
    const r = await pingDocker(stub);
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      expect(r.value.reachable).toBe(false);
      if (!r.value.reachable) {
        expect(r.value.reason).toContain('ECONNREFUSED');
      }
    }
  });

  it('returns reachable:false with reason on ENOENT (missing socket)', async () => {
    const missing = new Error('connect ENOENT /var/run/docker.sock');
    const stub: DockerPingable = { ping: () => Promise.reject(missing) };
    const r = await pingDocker(stub);
    if (r.isErr()) throw r.error;
    expect(r.value.reachable).toBe(false);
    if (!r.value.reachable) {
      expect(r.value.reason).toContain('ENOENT');
    }
  });

  it('returns reachable:false with reason on timeout', async () => {
    const timedOut = new Error('ETIMEDOUT after 5000ms');
    const stub: DockerPingable = { ping: () => Promise.reject(timedOut) };
    const r = await pingDocker(stub);
    if (r.isErr()) throw r.error;
    expect(r.value.reachable).toBe(false);
    if (!r.value.reachable) {
      expect(r.value.reason).toContain('ETIMEDOUT');
    }
  });

  it('never returns err for daemon failures (fallback path, not error path)', async () => {
    const stub: DockerPingable = { ping: () => Promise.reject(new Error('boom')) };
    const r = await pingDocker(stub);
    expect(r.isErr()).toBe(false);
  });
});

describe('P-029 defaultDockerSocket', () => {
  it('returns a non-empty socket path for this platform', () => {
    const s = defaultDockerSocket();
    expect(typeof s).toBe('string');
    expect(s.length).toBeGreaterThan(0);
  });
});
