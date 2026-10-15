// P-175 - the verification dispatcher tests.
//
// The whole point of `runVerification` is that a caller cannot tell which
// backend ran, so these tests assert exactly that: the same result shape from
// the Docker path and the GitHub path, and a typed `SANDBOX_UNAVAILABLE` when
// neither is usable.
//
// The required scenarios that live here:
//
//   it('errors when unavailable')   it('same shape both paths')

import { describe, it, expect } from 'vitest';
import { ok, type Result } from 'neverthrow';
import { type StitchError } from '../result/index.js';
import type { ContainerRun, ContainerSpec } from './client.js';
import type { SandboxTriggerClient } from '../github/sandboxTrigger.js';
import { runVerification } from './runner.js';
import type { BuildClient } from './build.js';
import type { TestClient } from './test.js';
import type { GitHubFallbackOptions } from './fallback.js';

const SHA = 'b'.repeat(40);
const REPO = '/staged/c';

/** A fake Docker client that always exits 0 with one line of output. */
function makeFakeDockerClient(): {
  client: BuildClient & TestClient;
  calls: ContainerSpec[];
} {
  const calls: ContainerSpec[] = [];
  const client: BuildClient & TestClient = {
    async run(spec: ContainerSpec): Promise<Result<ContainerRun, StitchError>> {
      calls.push(spec);
      return ok({ exitCode: 0, stdout: ['ok'], stderr: [], durationMs: 3 });
    },
  };
  return { client, calls };
}

function makeFakeGithub(): GitHubFallbackOptions {
  const run = {
    id: 7,
    head_sha: SHA,
    head_branch: 'main',
    status: 'completed',
    conclusion: 'success',
    html_url: 'https://example.test/run/7',
  };
  const client: SandboxTriggerClient = {
    rest: {
      repos: { createDispatchEvent: async () => ({ data: {}, headers: {}, status: 204 }) },
      actions: {
        createWorkflowDispatch: async () => ({ data: {}, headers: {}, status: 204 }),
        getWorkflowRun: async () => ({ data: run, headers: {}, status: 200 }),
        listWorkflowRunsForRepo: async () => ({
          data: { workflow_runs: [run] },
          headers: {},
          status: 200,
        }),
      },
    },
  };
  return {
    client,
    owner: 'acme',
    repo: 'child-c',
    sha: SHA,
    ref: 'main',
    jobId: 'job-7',
    fetchLogs: async () => ok('all good'),
  };
}

describe('P-175 runVerification', () => {
  it('errors when unavailable', async () => {
    // Nothing configured: no Docker, no GH path.
    const none = await runVerification('build', 'node', REPO, { selection: {} });
    expect(none.isErr()).toBe(true);
    if (none.isErr()) expect(none.error.code).toBe('SANDBOX_UNAVAILABLE');

    // A backend was selected but its wiring is missing: a caller bug, not an
    // environment problem - and it must not be reported as "unavailable".
    const noClient = await runVerification('build', 'node', REPO, {
      selection: { mode: 'docker', dockerAvailable: true },
    });
    expect(noClient.isErr()).toBe(true);
    if (noClient.isErr()) expect(noClient.error.code).toBe('CONFIG_ERROR');

    const noGithub = await runVerification('build', 'node', REPO, {
      selection: { mode: 'github', hasAuth: true, ciConfigured: true },
    });
    expect(noGithub.isErr()).toBe(true);
    if (noGithub.isErr()) expect(noGithub.error.code).toBe('CONFIG_ERROR');
  });

  it('same shape both paths', async () => {
    const docker = makeFakeDockerClient();
    const viaDocker = await runVerification('build', 'node', REPO, {
      selection: { mode: 'docker', dockerAvailable: true },
      dockerClient: docker.client,
    });
    const viaGithub = await runVerification('build', 'node', REPO, {
      selection: { mode: 'github', hasAuth: true, ciConfigured: true },
      github: makeFakeGithub(),
    });

    expect(viaDocker.isOk() && viaGithub.isOk()).toBe(true);
    if (!viaDocker.isOk() || !viaGithub.isOk()) return;
    const a = viaDocker.value as unknown as Record<string, unknown>;
    const b = viaGithub.value as unknown as Record<string, unknown>;
    // The contract fields are identical in shape...
    for (const key of ['pass', 'command', 'exitCode', 'durationMs', 'logs']) {
      expect(Object.hasOwn(a, key)).toBe(true);
      expect(Object.hasOwn(b, key)).toBe(true);
      expect(typeof a[key]).toBe(typeof b[key]);
    }
    expect(a['pass']).toBe(true);
    expect(b['pass']).toBe(true);
    expect(a['command']).toBe(b['command']);

    // ...and the test path matches too, counts included (the GH side reuses
    // P-172's parser, so the fields line up without a second implementation).
    const testsDocker = await runVerification('test', 'node', REPO, {
      selection: { mode: 'docker', dockerAvailable: true },
      dockerClient: docker.client,
    });
    const testsGithub = await runVerification('test', 'node', REPO, {
      selection: { mode: 'github', hasAuth: true, ciConfigured: true },
      github: makeFakeGithub(),
    });
    expect(testsDocker.isOk() && testsGithub.isOk()).toBe(true);
    if (!testsDocker.isOk() || !testsGithub.isOk()) return;
    const c = testsDocker.value as unknown as Record<string, unknown>;
    const d = testsGithub.value as unknown as Record<string, unknown>;
    for (const key of [
      'pass',
      'command',
      'exitCode',
      'durationMs',
      'passed',
      'failed',
      'skipped',
      'failures',
      'logs',
    ]) {
      expect(Object.hasOwn(c, key)).toBe(true);
      expect(Object.hasOwn(d, key)).toBe(true);
    }
    // The Docker path ran the container; the GH path did not.
    expect(docker.calls.length).toBe(2);
    expect(docker.calls[0]?.cmd).toEqual(['bun', 'run', 'build']);
    expect(docker.calls[1]?.cmd).toEqual(['bun', 'test']);
    expect(docker.calls[0]?.image).toBe('oven/bun:1.1');
  });
});
