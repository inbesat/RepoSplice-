// P-200 — project config: discovery, validation, defaults, env overlay, path
// resolution, and the write round-trip. Real TOML files in temp dirs, real
// Bun.TOML, real zod — the loaders are headless by design, so nothing here
// needs a mock beyond an injected env.
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultConfig } from '@repo-stitcher/core';
import {
  configPaths,
  emitConfig,
  loadConfig,
  PROJECT_CONFIG_FILE,
  resetConfigCache,
  writeConfig,
} from './config.js';

const roots: string[] = [];

async function tmpRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'stitch-cfg-'));
  roots.push(dir);
  return dir;
}

async function writeToml(dir: string, body: string): Promise<string> {
  const file = join(dir, PROJECT_CONFIG_FILE);
  await writeFile(file, body, 'utf8');
  return file;
}

beforeEach(() => {
  resetConfigCache();
});

afterEach(() => {
  resetConfigCache();
});

describe('P-200 project config', () => {
  it('discovers upward', async () => {
    const root = await tmpRoot();
    const file = await writeToml(root, '[paths]\ncacheDir = "c"\nworktreeDir = "w"\n');
    const nested = join(root, 'a', 'b');
    await mkdir(nested, { recursive: true });
    const found = configPaths({ cwd: nested });
    expect(found.isOk()).toBe(true);
    if (found.isOk()) expect(found.value).toBe(file);
  });

  it('stops at a .git boundary', async () => {
    const outer = await tmpRoot();
    await writeToml(outer, '[paths]\ncacheDir = "c"\nworktreeDir = "w"\n');
    const inner = join(outer, 'repo');
    await mkdir(join(inner, '.git'), { recursive: true });
    expect(configPaths({ cwd: inner }).isOk()).toBe(true);
    const found = configPaths({ cwd: inner });
    if (found.isOk()) expect(found.value).toBe(null);
  });

  it('fails invalid', async () => {
    const dir = await tmpRoot();
    await writeToml(dir, '[sandbox]\nbackend = 3\n');
    const result = loadConfig({ cwd: dir, env: {} });
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.code).toBe('CONFIG_INVALID');
      if (result.error.code === 'CONFIG_INVALID') {
        expect(result.error.issues.length).toBeGreaterThan(0);
        expect(result.error.issues.some(issue => issue.path === 'sandbox.backend')).toBe(true);
      }
    }
  });

  it('fails when --config names a missing file', async () => {
    const dir = await tmpRoot();
    const result = loadConfig({ config: join(dir, 'nope.toml'), env: {} });
    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.code).toBe('CONFIG_ERROR');
  });

  it('merges defaults', async () => {
    const dir = await tmpRoot();
    await writeToml(dir, '[sandbox]\nbackend = "github-actions"\n');
    const result = loadConfig({ cwd: dir, env: {} });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.sandbox.backend).toBe('github-actions');
      // untouched sections come from the defaults, whole and intact
      expect(result.value.agent).toEqual(defaultConfig.agent);
      expect(result.value.licensePolicy).toEqual(defaultConfig.licensePolicy);
    }
  });

  it('merges defaults with no project file at all', async () => {
    const dir = await tmpRoot();
    await mkdir(join(dir, 'bare'), { recursive: true });
    // mkdir the config dir as the walk root: nothing above bare/ in THIS tree
    // has a stitch.toml or .git, so bare/ resolves to defaults + env only.
    const result = loadConfig({ cwd: join(dir, 'bare'), env: {} });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) expect(result.value.agent).toEqual(defaultConfig.agent);
  });

  it('overlays env', async () => {
    const dir = await tmpRoot();
    const result = loadConfig({
      cwd: dir,
      env: {
        OPENROUTER_API_KEY: 'k-open',
        ANTHROPIC_API_KEY: 'k-anthropic',
        STITCH_AGENT_MAXITERATIONS: '7',
        STITCH_SANDBOX_BACKEND: 'github-actions',
      },
    });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.openrouter).toEqual({ apiKey: 'k-open' });
      expect(result.value.anthropic).toEqual({ apiKey: 'k-anthropic' });
      // number coercion via the template leaf's type
      expect(result.value.agent.maxIterations).toBe(7);
      expect(result.value.sandbox.backend).toBe('github-actions');
    }
  });

  it('fails invalid on a bad env value', async () => {
    const dir = await tmpRoot();
    const result = loadConfig({ cwd: dir, env: { STITCH_SANDBOX_BACKEND: 'vibes' } });
    expect(result.isErr()).toBe(true);
    if (result.isErr() && result.error.code === 'CONFIG_INVALID') {
      expect(result.error.issues.some(issue => issue.path === 'sandbox.backend')).toBe(true);
    }
  });

  it('resolves paths', async () => {
    const dir = await tmpRoot();
    await writeToml(dir, '[paths]\ncacheDir = "out/cache"\nworktreeDir = "out/wt"\n');
    const result = loadConfig({ cwd: dir, env: {} });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.paths.cacheDir).toBe(resolve(dir, 'out/cache'));
      expect(result.value.paths.worktreeDir).toBe(resolve(dir, 'out/wt'));
    }
  });

  it('round trips write', async () => {
    const dir = await tmpRoot();
    const cfg = loadConfig({ cwd: dir, env: {} });
    expect(cfg.isOk()).toBe(true);
    const written = writeConfig(dir, {
      ...(cfg.isOk() ? cfg.value : defaultConfig),
      sandbox: { backend: 'docker', limits: { memory: '4g', cpu: '2', timeout: 120 } },
    });
    expect(written.isOk()).toBe(true);
    const text = await readFile(join(dir, PROJECT_CONFIG_FILE), 'utf8');
    expect(text).toContain('backend = "docker"');
    expect(text).toContain('[sandbox.limits]');
    resetConfigCache();
    const reparsed = loadConfig({ cwd: dir, env: {} });
    expect(reparsed.isOk()).toBe(true);
    if (reparsed.isOk() && cfg.isOk()) {
      // the written relative paths come back RESOLVED against the config dir
      expect(reparsed.value).toEqual({
        ...cfg.value,
        paths: {
          cacheDir: resolve(dir, cfg.value.paths.cacheDir),
          worktreeDir: resolve(dir, cfg.value.paths.worktreeDir),
        },
        sandbox: { backend: 'docker', limits: { memory: '4g', cpu: '2', timeout: 120 } },
      });
    }
  });

  it('emits effective JSON', async () => {
    const dir = await tmpRoot();
    await writeToml(dir, '[paths]\ncacheDir = "cc"\nworktreeDir = "ww"\n');
    const result = emitConfig({ cwd: dir, env: {} });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const parsed = JSON.parse(result.value) as typeof defaultConfig;
      expect(parsed.paths.cacheDir).toBe(resolve(dir, 'cc'));
    }
  });

  it('caches per-process until reset', async () => {
    const dir = await tmpRoot();
    const file = await writeToml(dir, '[sandbox]\nbackend = "docker"\n');
    const first = loadConfig({ config: file, env: {} });
    expect(first.isOk()).toBe(true);
    await writeFile(file, '[sandbox]\nbackend = "github-actions"\n', 'utf8');
    // same opts → served from cache, file change invisible
    const cached = loadConfig({ config: file, env: {} });
    if (first.isOk() && cached.isOk()) expect(cached.value.sandbox.backend).toBe('docker');
    resetConfigCache();
    const fresh = loadConfig({ config: file, env: {} });
    if (fresh.isOk()) expect(fresh.value.sandbox.backend).toBe('github-actions');
  });
});
