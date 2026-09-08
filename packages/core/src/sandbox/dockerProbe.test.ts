import { describe, it, expect } from 'vitest';
import {
  parseDockerEngineVersion,
  checkDockerDaemon,
  type DockerDaemonStatus,
} from './dockerProbe.js';
import type { DockerReachability } from './docker.js';

function okStatus(status: DockerDaemonStatus): void {
  expect(status.reachable).toBe(true);
}

describe('docker daemon probe (P-067)', () => {
  it('daemon ok', async () => {
    const ping = async (): Promise<DockerReachability> => ({ reachable: true });
    const status = await checkDockerDaemon(ping, async () => '26.1.4\n');
    expect(status.isOk()).toBe(true);
    if (!status.isOk()) return;
    okStatus(status.value);
    expect(status.value.engineVersion).toBe('26.1.4');
    expect(status.value.fix).toBeUndefined();
  });

  it('daemon down hints', async () => {
    const refused: () => Promise<DockerReachability> = async () => ({
      reachable: false,
      reason: 'connect ECONNREFUSED //./pipe/docker_engine',
    });
    const down = await checkDockerDaemon(refused, async () => '');
    expect(down.isOk()).toBe(true);
    if (!down.isOk()) return;
    expect(down.value.reachable).toBe(false);
    expect(down.value.engineVersion).toBeNull();
    expect(down.value.fix).toContain('Docker Desktop');

    // A throwing ping (binary missing) is data too, never a throw.
    const missing = await checkDockerDaemon(
      async () => {
        throw new Error('spawn docker ENOENT');
      },
      async () => ''
    );
    expect(missing.isOk()).toBe(true);
    if (!missing.isOk()) return;
    expect(missing.value.fix).toContain('install');

    const denied: () => Promise<DockerReachability> = async () => ({
      reachable: false,
      reason: 'connect EACCES /var/run/docker.sock',
    });
    const perms = await checkDockerDaemon(denied, async () => '');
    expect(perms.isOk()).toBe(true);
    if (!perms.isOk()) return;
    expect(perms.value.fix).toContain('permission');

    // Unreachable with command-not-found text (the real Windows absence
    // message) takes the install arm of the hint picker.
    const absent: () => Promise<DockerReachability> = async () => ({
      reachable: false,
      reason: "The term 'docker' is not recognized as the name of a cmdlet",
    });
    const gone = await checkDockerDaemon(absent, async () => '');
    expect(gone.isOk()).toBe(true);
    if (!gone.isOk()) return;
    expect(gone.value.fix).toContain('not installed');
  });

  it('engine version', async () => {
    expect(parseDockerEngineVersion('26.1.4\n')).toBe('26.1.4');
    expect(parseDockerEngineVersion('v25.0.3')).toBe('25.0.3');
    expect(parseDockerEngineVersion('Server Version: 24.0.7-ce')).toBe('24.0.7');
    expect(parseDockerEngineVersion('')).toBeNull();
    expect(parseDockerEngineVersion('no version here')).toBeNull();

    // Reachable daemon, unreadable version: still reachable, version null.
    const ping = async (): Promise<DockerReachability> => ({ reachable: true });
    const status = await checkDockerDaemon(ping, async () => '???');
    expect(status.isOk()).toBe(true);
    if (!status.isOk()) return;
    okStatus(status.value);
    expect(status.value.engineVersion).toBeNull();

    // Reachable daemon, version probe itself throws: same outcome, no throw.
    const throwing = await checkDockerDaemon(ping, async () => {
      throw new Error('version probe failed');
    });
    expect(throwing.isOk()).toBe(true);
    if (!throwing.isOk()) return;
    okStatus(throwing.value);
    expect(throwing.value.engineVersion).toBeNull();
  });
});
