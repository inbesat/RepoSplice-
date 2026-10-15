// P-171 — sandbox build tests.
//
// The container client is a fake (`BuildClient`), so no daemon is touched: the
// tests assert the command chosen per ecosystem, the mount/workingDir, the
// VERDICT semantics (a red build is `ok(pass:false)`, never `err`), the
// infrastructure `err`, the artifact capture request, and the log bound.
//
// The six required scenarios from the phase spec:
//
//   it('passes on zero exit')      it('fails verdict on non-zero')
//   it('errors on infra failure')  it('copies artifacts')
//   it('selects command per eco')  it('bounds logs')

import { describe, it, expect } from 'vitest';
import { ok, err } from 'neverthrow';
import { type StitchError } from '../result/index.js';
import type { ContainerRun, ContainerSpec, RunOptions } from './client.js';
import {
  BUILD_COMMANDS,
  DEFAULT_OUTPUT_DIRS,
  MAX_BUILD_LOG_LINES,
  WORKSPACE_MOUNT,
  boundLogLines,
  runBuild,
  type BuildClient,
} from './build.js';

interface FakeOutcome {
  exitCode?: number;
  stdout?: string[];
  stderr?: string[];
  durationMs?: number;
  capturedArchive?: string;
  error?: StitchError;
}

function makeFakeClient(outcome: FakeOutcome = {}): {
  client: BuildClient;
  calls: { specs: ContainerSpec[]; options: (RunOptions | undefined)[] };
} {
  const calls = { specs: [] as ContainerSpec[], options: [] as (RunOptions | undefined)[] };
  const client: BuildClient = {
    async run(spec: ContainerSpec, opts?: RunOptions) {
      calls.specs.push(spec);
      calls.options.push(opts);
      if (outcome.error !== undefined) return err(outcome.error);
      const ran: ContainerRun = {
        exitCode: outcome.exitCode ?? 0,
        stdout: outcome.stdout ?? [],
        stderr: outcome.stderr ?? [],
        durationMs: outcome.durationMs ?? 11,
        ...(outcome.capturedArchive !== undefined
          ? { capturedArchive: outcome.capturedArchive }
          : {}),
      };
      return ok(ran);
    },
  };
  return { client, calls };
}

const REPO = '/staged/c';

describe('P-171 runBuild', () => {
  it('passes on zero exit', async () => {
    const { client, calls } = makeFakeClient({ exitCode: 0, stdout: ['built!'] });
    const result = await runBuild('node', REPO, {}, client);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.pass).toBe(true);
      expect(result.value.exitCode).toBe(0);
      expect(result.value.command).toBe('bun run build');
      expect(result.value.logs.stdout).toEqual(['built!']);
      expect(result.value.durationMs).toBe(11);
    }
    // Reads the staged repo from /workspace, runs there, on the pinned image.
    expect(calls.specs[0]).toMatchObject({
      image: 'oven/bun:1.1',
      workingDir: WORKSPACE_MOUNT,
      bindMounts: [{ host: REPO, container: WORKSPACE_MOUNT }],
      cmd: ['bun', 'run', 'build'],
    });
  });

  it('fails verdict on non-zero', async () => {
    const { client } = makeFakeClient({ exitCode: 1, stderr: ['TS2304: cannot find name'] });
    const result = await runBuild('node', REPO, {}, client);

    // A red build is a RESULT the loop iterates on, not an error.
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.pass).toBe(false);
      expect(result.value.exitCode).toBe(1);
      expect(result.value.logs.stderr).toEqual(['TS2304: cannot find name']);
      expect(result.value.outputDir).toBeUndefined();
    }
  });

  it('errors on infra failure', async () => {
    const { client } = makeFakeClient({
      error: { code: 'SANDBOX_UNAVAILABLE', message: 'no docker' },
    });
    const failed = await runBuild('go', REPO, {}, client);
    expect(failed.isErr()).toBe(true);
    if (failed.isErr()) expect(failed.error.code).toBe('SANDBOX_UNAVAILABLE');

    // A blank repoPath is a caller bug, not a verdict.
    const blank = await runBuild('go', '  ', {}, client);
    expect(blank.isErr()).toBe(true);
    if (blank.isErr()) expect(blank.error.code).toBe('CONFIG_ERROR');
  });

  it('copies artifacts', async () => {
    const { client, calls } = makeFakeClient({
      exitCode: 0,
      capturedArchive: '/staging/dist.tar',
    });
    const result = await runBuild('rust', REPO, { artifactTarget: '/staging' }, client);

    expect(result.isOk() && result.value.outputDir).toBe('/staging/dist.tar');
    // The capture rode with the run (P-168 removes the container afterwards)
    // and used the ecosystem's default output dir.
    expect(calls.options[0]?.capture).toEqual({
      containerPath: `${WORKSPACE_MOUNT}/${DEFAULT_OUTPUT_DIRS.rust}`,
      hostDir: '/staging',
    });

    // No artifact target → no capture requested at all.
    const bare = await runBuild('rust', REPO, {}, client);
    expect(bare.isOk() && bare.value.outputDir).toBeUndefined();
    expect(calls.options[1]?.capture).toBeUndefined();

    // An explicit outputDir overrides the default.
    await runBuild('node', REPO, { artifactTarget: '/staging', outputDir: 'out' }, client);
    expect(calls.options[2]?.capture?.containerPath).toBe(`${WORKSPACE_MOUNT}/out`);

    // A captured archive on a FAILING build is not reported.
    const failing = makeFakeClient({ exitCode: 2, capturedArchive: '/staging/dist.tar' });
    const red = await runBuild('node', REPO, { artifactTarget: '/staging' }, failing.client);
    expect(red.isOk() && red.value.outputDir).toBeUndefined();
  });

  it('selects command per eco', async () => {
    const { client } = makeFakeClient({ exitCode: 0 });
    const node = await runBuild('node', REPO, {}, client);
    const python = await runBuild('python', REPO, {}, client);
    const rust = await runBuild('rust', REPO, {}, client);
    const go = await runBuild('go', REPO, {}, client);
    expect(node.isOk() && node.value.command).toBe('bun run build');
    expect(python.isOk() && python.value.command).toBe('python -m build');
    expect(rust.isOk() && rust.value.command).toBe('cargo build --release');
    expect(go.isOk() && go.value.command).toBe('go build ./...');
    expect(BUILD_COMMANDS.rust).toEqual(['cargo', 'build', '--release']);
    expect(DEFAULT_OUTPUT_DIRS.go).toBeUndefined();
  });

  it('bounds logs', async () => {
    const many = Array.from({ length: 900 }, (_, i) => `line ${i}`);
    const { client } = makeFakeClient({ exitCode: 0, stdout: many });
    const result = await runBuild('python', REPO, {}, client);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.logs.stdout).toHaveLength(MAX_BUILD_LOG_LINES);
      // The NEWEST lines survive.
      expect(result.value.logs.stdout.at(-1)).toBe('line 899');
      expect(result.value.logs.stdout[0]).toBe(`line ${900 - MAX_BUILD_LOG_LINES}`);
    }

    // The pure helper, directly.
    expect(boundLogLines(['a', 'b'], 1)).toEqual(['b']);
    expect(boundLogLines(['a'], 0)).toEqual([]);
    expect(boundLogLines([])).toEqual([]);
  });

  it('mounts /buildout only when asked, and forwards timeout/env', async () => {
    const { client, calls } = makeFakeClient({ exitCode: 0 });
    await runBuild(
      'rust',
      REPO,
      { buildoutDir: '/out', timeoutMs: 1234, env: { CARGO_TARGET_DIR: '/buildout' } },
      client
    );
    const spec = calls.specs[0];
    expect(spec?.bindMounts).toEqual([
      { host: REPO, container: WORKSPACE_MOUNT },
      { host: '/out', container: '/buildout' },
    ]);
    expect(spec?.env).toEqual({ CARGO_TARGET_DIR: '/buildout' });
    expect(calls.options[0]?.timeoutMs).toBe(1234);
  });
});
