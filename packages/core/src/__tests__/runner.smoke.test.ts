import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Repo root from packages/core/src/__tests__/. */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

interface PackageJson {
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
}

function readJson(path: string): PackageJson {
  return JSON.parse(readFileSync(path, 'utf8')) as PackageJson;
}

function stripRange(version: string): string {
  return version.replace(/^[~^>=< ]+/, '');
}

function majorMinor(version: string): string {
  const [major = '', minor = ''] = stripRange(version).split('.');
  return `${major}.${minor}`;
}

/** Recursively collect *.test.ts(x) under dir, skipping build output. */
function collectTests(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...collectTests(full));
    else if (/\.test\.tsx?$/.test(entry.name)) found.push(full);
  }
  return found;
}

describe('workspace runner (P-060 vitest + ui)', () => {
  it('runs all packages', () => {
    // 1. Runner + UI installed at root, versions aligned (ui must match vitest).
    const rootPkg = readJson(join(ROOT, 'package.json'));
    const devDeps = rootPkg.devDependencies ?? {};
    expect(devDeps['vitest']).toBeDefined();
    expect(devDeps['@vitest/ui']).toBeDefined();
    expect(devDeps['@vitest/coverage-v8']).toBeDefined();
    expect(majorMinor(devDeps['vitest'] ?? '')).toBe(majorMinor(devDeps['@vitest/ui'] ?? ''));
    expect(majorMinor(devDeps['vitest'] ?? '')).toBe(
      majorMinor(devDeps['@vitest/coverage-v8'] ?? '')
    );

    // 2. One-command scripts: run, watch, interactive UI, coverage.
    const scripts = rootPkg.scripts ?? {};
    expect(scripts['test']).toContain('vitest run');
    expect(scripts['test:ui']).toContain('vitest --ui');
    expect(scripts['test:coverage']).toContain('--coverage');

    // 3. Root config merges the package suites as projects (P-004 wiring).
    const config = readFileSync(join(ROOT, 'vitest.config.ts'), 'utf8');
    expect(config).toContain('projects');
    expect(config).toContain('packages/*');

    // 4. Every package project is wired with its name and at least one suite,
    //    so `bun test` executes core + cli + web from one place.
    for (const pkg of ['core', 'cli', 'web']) {
      const dir = join(ROOT, 'packages', pkg);
      expect(existsSync(join(dir, 'package.json'))).toBe(true);
      const projectConfig = join(dir, 'vitest.config.ts');
      expect(existsSync(projectConfig)).toBe(true);
      expect(readFileSync(projectConfig, 'utf8')).toContain(`@repo-stitcher/${pkg}`);
      expect(collectTests(join(dir, 'src')).length).toBeGreaterThan(0);
    }
  });
});
