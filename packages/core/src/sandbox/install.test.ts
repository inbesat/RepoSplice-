// P-170 — in-sandbox dependency install tests.
//
// The container client is a fake (`InstallClient`), so no daemon is touched and
// no package manager ever runs: the tests assert the COMMAND chosen per
// ecosystem, the container spec the workspace is mounted with, the offline
// gate, and the typed failure mapping.
//
// The five required scenarios from the phase spec:
//
//   it('installs npm deps')          it('installs go modules')
//   it('fails on non-zero exit')     it('blocks when offline and needed')
//   it('selects command per eco')

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ok, err } from 'neverthrow';
import { type StitchError } from '../result/index.js';
import type { ContainerRun, ContainerSpec, RunOptions } from './client.js';
import {
  DEFAULT_INSTALL_TIMEOUT_MS,
  NODE_LOCKFILES,
  WORKSPACE_MOUNT,
  countInstalled,
  installDeps,
  type InstallClient,
} from './install.js';

interface FakeOutcome {
  exitCode?: number;
  stdout?: string[];
  stderr?: string[];
  error?: StitchError;
}

function makeFakeClient(outcome: FakeOutcome = {}): {
  client: InstallClient;
  calls: { specs: ContainerSpec[]; options: (RunOptions | undefined)[] };
} {
  const calls = { specs: [] as ContainerSpec[], options: [] as (RunOptions | undefined)[] };
  const client: InstallClient = {
    async run(spec: ContainerSpec, opts?: RunOptions) {
      calls.specs.push(spec);
      calls.options.push(opts);
      if (outcome.error !== undefined) return err(outcome.error);
      const ran: ContainerRun = {
        exitCode: outcome.exitCode ?? 0,
        stdout: outcome.stdout ?? [],
        stderr: outcome.stderr ?? [],
        durationMs: 7,
      };
      return ok(ran);
    },
  };
  return { client, calls };
}

let root: string;
let plainDir: string; // no lockfile / no pyproject

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'stitch-install-'));
  plainDir = join(root, 'plain');
  await mkdir(plainDir, { recursive: true });
  await writeFile(join(plainDir, 'package.json'), '{"name":"x"}\n', 'utf8');
}, 30_000);

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

/** A workspace dir named after the test, with optional marker files. */
async function makeWorkspace(name: string, files: string[] = []): Promise<string> {
  const dir = join(root, name);
  await mkdir(dir, { recursive: true });
  for (const file of files) await writeFile(join(dir, file), '{}\n', 'utf8');
  return dir;
}

describe('P-170 installDeps', () => {
  it('installs npm deps', async () => {
    const { client, calls } = makeFakeClient({
      exitCode: 0,
      stdout: ['Resolving dependencies', '12 packages installed'],
    });
    const result = await installDeps('node', plainDir, {}, client);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.installed).toBe(true);
      expect(result.value.dirty).toBe(false);
      expect(result.value.command).toBe('bun install');
      expect(result.value.packageCount).toBe(12);
      expect(result.value.exitCode).toBe(0);
    }
    // Mounted read-write at /workspace, running there, on the pinned image.
    expect(calls.specs[0]).toMatchObject({
      image: 'oven/bun:1.1',
      workingDir: WORKSPACE_MOUNT,
      bindMounts: [{ host: plainDir, container: WORKSPACE_MOUNT }],
      cmd: ['bun', 'install'],
    });
    expect(calls.options[0]?.timeoutMs).toBe(DEFAULT_INSTALL_TIMEOUT_MS);
  });

  it('installs go modules', async () => {
    const { client, calls } = makeFakeClient({ exitCode: 0, stdout: ['Downloaded 5 modules'] });
    const result = await installDeps('go', plainDir, {}, client);

    expect(result.isOk() && result.value.command).toBe('go mod download');
    expect(result.isOk() && result.value.packageCount).toBe(5);
    expect(calls.specs[0]?.image).toBe('golang:1.23-alpine');
    expect(calls.specs[0]?.networkDisabled).toBe(false);
  });

  it('fails on non-zero exit', async () => {
    const { client } = makeFakeClient({
      exitCode: 1,
      stdout: ['resolving'],
      stderr: ['error: package not found'],
    });
    const failed = await installDeps('python', plainDir, {}, client);
    expect(failed.isErr()).toBe(true);
    if (failed.isErr() && failed.error.code === 'DEP_INSTALL_FAILED') {
      expect(failed.error.exitCode).toBe(1);
      expect(failed.error.stderr).toContain('package not found');
    }
  });

  it('blocks when offline and needed', async () => {
    const { client, calls } = makeFakeClient();
    const blocked = await installDeps('node', plainDir, { networkAllowed: false }, client);
    expect(blocked.isErr()).toBe(true);
    if (blocked.isErr() && blocked.error.code === 'DEP_INSTALL_OFFLINE_BLOCKED') {
      expect(blocked.error.ecosystem).toBe('node');
      expect(blocked.error.message).toContain('network');
    }
    // Nothing ran: no container was created for a doomed install.
    expect(calls.specs).toHaveLength(0);
  });

  it('selects command per eco', async () => {
    const withLock = await makeWorkspace('node-lock', ['bun.lock']);
    const withNpmLock = await makeWorkspace('node-npmlock', ['package-lock.json']);
    const pyproject = await makeWorkspace('py-uv', ['pyproject.toml']);
    const noPyproject = await makeWorkspace('py-pip');

    const { client } = makeFakeClient({ exitCode: 0 });
    const node = await installDeps('node', withLock, {}, client);
    expect(node.isOk() && node.value.command).toBe('bun install --frozen-lockfile');
    const npmLock = await installDeps('node', withNpmLock, {}, client);
    expect(npmLock.isOk() && npmLock.value.command).toBe('bun install --frozen-lockfile');
    const uv = await installDeps('python', pyproject, {}, client);
    expect(uv.isOk() && uv.value.command).toBe('uv sync');
    const pip = await installDeps('python', noPyproject, {}, client);
    expect(pip.isOk() && pip.value.command).toBe('pip install -r requirements.txt');
    const cargo = await installDeps('rust', plainDir, {}, client);
    expect(cargo.isOk() && cargo.value.command).toBe('cargo fetch');
  });

  it('runs offline when the workspace is declared ready', async () => {
    const { client, calls } = makeFakeClient({ exitCode: 0 });
    const result = await installDeps(
      'node',
      plainDir,
      { networkAllowed: false, offlineReady: true },
      client
    );
    expect(result.isOk()).toBe(true);
    // The container really has no network, and the install still ran.
    expect(calls.specs[0]?.networkDisabled).toBe(true);
    expect(calls.specs).toHaveLength(1);
  });

  it('honours an explicit image and a specific lockfile name', async () => {
    const dir = await makeWorkspace('node-explicit', ['custom.lock']);
    const { client, calls } = makeFakeClient({ exitCode: 0 });
    const result = await installDeps(
      'node',
      dir,
      { image: 'acme/node:9', lockfileName: 'custom.lock' },
      client
    );
    expect(result.isOk() && result.value.command).toBe('bun install --frozen-lockfile');
    expect(calls.specs[0]?.image).toBe('acme/node:9');

    // A named lockfile that is absent falls back to a plain install.
    const absent = await installDeps('node', plainDir, { lockfileName: 'nope.lock' }, client);
    expect(absent.isOk() && absent.value.command).toBe('bun install');
  });

  it('propagates a container failure and rejects a blank repoPath', async () => {
    const { client } = makeFakeClient({
      error: { code: 'DOCKER_ERROR', message: 'daemon down' },
    });
    const failed = await installDeps('rust', plainDir, {}, client);
    expect(failed.isErr()).toBe(true);
    if (failed.isErr()) expect(failed.error.code).toBe('DOCKER_ERROR');

    const blank = await installDeps('go', '   ', {}, client);
    expect(blank.isErr()).toBe(true);
    if (blank.isErr()) expect(blank.error.code).toBe('CONFIG_ERROR');
  });

  it('parses an installed count best-effort', () => {
    expect(countInstalled('node', ['12 packages installed'])).toBe(12);
    expect(countInstalled('node', ['nothing here'])).toBeUndefined();
    expect(countInstalled('python', ['Successfully installed a b c'])).toBe(3);
    expect(countInstalled('python', ['ok'])).toBeUndefined();
    expect(countInstalled('rust', ['Downloaded 7 crates'])).toBe(7);
    expect(countInstalled('go', ['Downloaded 2 modules'])).toBe(2);
    expect(NODE_LOCKFILES).toContain('bun.lock');
  });
});
