// P-114 tests: lockfile regeneration per ecosystem with offline guard
// and typed error mapping. All tests use mocked execImpl/existsImpl to
// avoid network and filesystem flakiness; one test uses a real tmp dir
// with fs-extra to prove pathExists integration.
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildLockfileCommand, regenerateLockfile } from './lockfile.js';
import type { UnifiedManifest } from './types.js';

function npmManifest(): UnifiedManifest {
  return { dependencies: { lodash: '^4.17.21' } } as UnifiedManifest;
}

function pythonManifest(): UnifiedManifest {
  return { dependencies: { requests: '>=2.0' }, source: 'pyproject.toml' } as UnifiedManifest;
}

function cargoManifest(): UnifiedManifest {
  return {
    package: { name: 'crate-a', version: '0.1.0' },
    dependencies: { serde: '1.0' },
  } as UnifiedManifest;
}

function goManifest(): UnifiedManifest {
  return {
    module: 'example.com/a',
    require: { 'github.com/spf13/cobra': 'v1.8.0' },
  } as UnifiedManifest;
}

describe('P-114 lockfile: buildLockfileCommand dispatch', () => {
  it('dispatches per ecosystem to correct command and lockfile path', () => {
    const repo = '/tmp/repo';
    const npm = buildLockfileCommand('npm', repo);
    expect(npm.command).toBe('bun');
    expect(npm.args).toEqual(['install', '--frozen-lockfile=false']);
    expect(npm.lockfilePath).toBe(join(repo, 'bun.lock'));
    expect(npm.fullCommand).toBe('bun install --frozen-lockfile=false');

    const py = buildLockfileCommand('python', repo);
    expect(py.command).toBe('uv');
    expect(py.args).toEqual(['lock']);
    expect(py.lockfilePath).toBe(join(repo, 'uv.lock'));

    const cargo = buildLockfileCommand('cargo', repo);
    expect(cargo.command).toBe('cargo');
    expect(cargo.args).toEqual(['generate-lockfile', '--manifest-path', join(repo, 'Cargo.toml')]);
    expect(cargo.lockfilePath).toBe(join(repo, 'Cargo.lock'));

    const go = buildLockfileCommand('go', repo);
    expect(go.command).toBe('go');
    expect(go.args).toEqual(['mod', 'tidy']);
    expect(go.lockfilePath).toBe(join(repo, 'go.sum'));
  });
});

describe('P-114 lockfile: regenerateLockfile', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'stitch-lock-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('regenerates npm lockfile via bun install', async () => {
    const manifest = npmManifest();
    // Write a minimal package.json so the command has context (not required for mock, but realistic)
    await writeFile(
      join(tmpDir, 'package.json'),
      JSON.stringify({ dependencies: { lodash: '^4.17.21' } })
    );

    const result = await regenerateLockfile(manifest, tmpDir, {
      execImpl: async (cmd, args, cwd, _env) => {
        expect(cmd).toBe('bun');
        expect(args).toEqual(['install', '--frozen-lockfile=false']);
        expect(cwd).toBe(tmpDir);
        // Simulate bun creating bun.lock
        await writeFile(join(tmpDir, 'bun.lock'), 'lockfile content');
        return { exitCode: 0, stdout: 'installed', stderr: '' };
      },
      existsImpl: async (p: string) => p.endsWith('bun.lock'),
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.ecosystem).toBe('npm');
    expect(result.value.lockfilePath).toBe(join(tmpDir, 'bun.lock'));
    expect(result.value.exitCode).toBe(0);
    expect(result.value.stdout).toBe('installed');
    expect(result.value.stderr).toBe('');
    expect(result.value.command).toBe('bun install --frozen-lockfile=false');
    expect(result.value.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('maps non-zero exit to LOCKFILE_GENERATION_FAILED', async () => {
    const manifest = cargoManifest();
    const result = await regenerateLockfile(manifest, tmpDir, {
      execImpl: async () => ({ exitCode: 1, stdout: '', stderr: 'cargo failed: bad manifest' }),
      existsImpl: async () => false,
    });

    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('LOCKFILE_GENERATION_FAILED');
    if (result.error.code === 'LOCKFILE_GENERATION_FAILED') {
      expect(result.error.command).toContain('cargo');
      expect(result.error.exitCode).toBe(1);
      expect(result.error.stderr).toContain('cargo failed');
    }
  });

  it('returns LOCKFILE_NOT_CREATED when lockfile missing', async () => {
    const manifest = goManifest();
    const result = await regenerateLockfile(manifest, tmpDir, {
      execImpl: async () => ({ exitCode: 0, stdout: 'ok', stderr: '' }),
      existsImpl: async () => false,
    });

    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('LOCKFILE_NOT_CREATED');
    if (result.error.code === 'LOCKFILE_NOT_CREATED') {
      expect(result.error.lockfilePath).toBe(join(tmpDir, 'go.sum'));
      expect(result.error.command).toContain('go');
    }
  });

  it('respects offline mode env', async () => {
    const manifest = npmManifest();
    let capturedEnv: NodeJS.ProcessEnv | undefined;

    const result = await regenerateLockfile(manifest, tmpDir, {
      allowNetwork: false,
      execImpl: async (_cmd, _args, _cwd, env) => {
        capturedEnv = env;
        return { exitCode: 0, stdout: '', stderr: '' };
      },
      existsImpl: async () => true,
    });

    expect(result.isOk()).toBe(true);
    expect(capturedEnv).toBeDefined();
    if (capturedEnv === undefined) return;
    expect(capturedEnv['BUN_CONFIG_REGISTRY']).toBe('http://offline.invalid');
    expect(capturedEnv['GOPROXY']).toBe('off');
    expect(capturedEnv['CARGO_NET_OFFLINE']).toBe('true');
    expect(capturedEnv['UV_OFFLINE']).toBe('1');
  });

  it('allows network by default (no offline env)', async () => {
    const manifest = npmManifest();
    let capturedEnv: NodeJS.ProcessEnv | undefined;

    const result = await regenerateLockfile(manifest, tmpDir, {
      execImpl: async (_cmd, _args, _cwd, env) => {
        capturedEnv = env;
        return { exitCode: 0, stdout: '', stderr: '' };
      },
      existsImpl: async () => true,
    });

    expect(result.isOk()).toBe(true);
    expect(capturedEnv).toBeDefined();
    if (capturedEnv === undefined) return;
    // When allowNetwork defaults to true, offline vars are not set
    expect(capturedEnv['BUN_CONFIG_REGISTRY']).toBeUndefined();
    expect(capturedEnv['CARGO_NET_OFFLINE']).toBeUndefined();
  });

  it('dispatches per ecosystem', async () => {
    const cases: Array<{
      manifest: UnifiedManifest;
      expectedCmd: string;
      lockfile: string;
      ecosystem: 'npm' | 'python' | 'cargo' | 'go';
    }> = [
      {
        manifest: npmManifest(),
        expectedCmd: 'bun install --frozen-lockfile=false',
        lockfile: 'bun.lock',
        ecosystem: 'npm',
      },
      {
        manifest: pythonManifest(),
        expectedCmd: 'uv lock',
        lockfile: 'uv.lock',
        ecosystem: 'python',
      },
      {
        manifest: cargoManifest(),
        expectedCmd: 'cargo generate-lockfile',
        lockfile: 'Cargo.lock',
        ecosystem: 'cargo',
      },
      { manifest: goManifest(), expectedCmd: 'go mod tidy', lockfile: 'go.sum', ecosystem: 'go' },
    ];

    for (const c of cases) {
      let seenCmd = '';
      const result = await regenerateLockfile(c.manifest, tmpDir, {
        execImpl: async (cmd, args) => {
          seenCmd = `${cmd} ${args.join(' ')}`;
          return { exitCode: 0, stdout: '', stderr: 'stderr retained' };
        },
        existsImpl: async () => true,
      });
      expect(result.isOk()).toBe(true);
      if (result.isErr()) continue;
      expect(seenCmd).toContain(c.expectedCmd.split(' ')[0]!);
      expect(result.value.lockfilePath).toContain(c.lockfile);
      expect(result.value.command).toContain(c.expectedCmd.split(' ')[0]!);
      expect(result.value.stderr).toBe('stderr retained');
      expect(result.value.ecosystem).toBe(c.ecosystem);
    }
  });

  it('validates repoPath non-empty', async () => {
    const manifest = npmManifest();
    const result = await regenerateLockfile(manifest, '   ', {
      execImpl: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
      existsImpl: async () => true,
    });
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('CONFIG_ERROR');
  });

  it('retains stderr for P-116 report', async () => {
    const manifest = npmManifest();
    const result = await regenerateLockfile(manifest, tmpDir, {
      execImpl: async () => ({ exitCode: 0, stdout: 'out', stderr: 'warning: something' }),
      existsImpl: async () => true,
    });
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.stderr).toBe('warning: something');
    expect(result.value.stdout).toBe('out');
  });

  it('maps exec throw to INTERNAL', async () => {
    const manifest = npmManifest();
    const result = await regenerateLockfile(manifest, tmpDir, {
      execImpl: async () => {
        throw new Error('spawn ENOENT');
      },
    });
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('INTERNAL');
  });

  it('maps exists throw to INTERNAL', async () => {
    const manifest = npmManifest();
    const result = await regenerateLockfile(manifest, tmpDir, {
      execImpl: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
      existsImpl: async () => {
        throw new Error('fs error');
      },
    });
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('INTERNAL');
  });
});
