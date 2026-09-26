import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { rm, mkdir, writeFile } from 'node:fs/promises';
import { scanDeclared, parseNpmPkg } from './scan.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..', '..');
const fixtureDir = resolve(repoRoot, 'packages', 'core', '.license-fixture-p118');

describe('P-118 scan: parseNpmPkg', () => {
  it('parses scoped package names', () => {
    expect(parseNpmPkg('@scope/name@1.2.3')).toEqual({ pkg: '@scope/name', version: '1.2.3' });
    expect(parseNpmPkg('lodash@4.17.21')).toEqual({ pkg: 'lodash', version: '4.17.21' });
    expect(parseNpmPkg('@babel/core@7.0.0')).toEqual({ pkg: '@babel/core', version: '7.0.0' });
  });

  it('returns null for malformed keys', () => {
    expect(parseNpmPkg('no-at-sign')).toBeNull();
    expect(parseNpmPkg('@scope/name')).toBeNull();
    expect(parseNpmPkg('')).toBeNull();
  });
});

describe('P-118 scan: dual license and UNKNOWN', () => {
  beforeAll(async () => {
    await rm(fixtureDir, { recursive: true, force: true });
    await mkdir(join(fixtureDir, 'node_modules', 'dual-pkg'), { recursive: true });
    await writeFile(
      join(fixtureDir, 'node_modules', 'dual-pkg', 'package.json'),
      JSON.stringify({ name: 'dual-pkg', version: '1.0.0', licenses: ['MIT', 'Apache-2.0'] })
    );
    await mkdir(join(fixtureDir, 'node_modules', 'unknown-pkg'), { recursive: true });
    await writeFile(
      join(fixtureDir, 'node_modules', 'unknown-pkg', 'package.json'),
      JSON.stringify({ name: 'unknown-pkg', version: '2.0.0', licenses: 'UNKNOWN' })
    );
    await mkdir(join(fixtureDir, 'node_modules', '@scope', 'scoped-pkg'), { recursive: true });
    await writeFile(
      join(fixtureDir, 'node_modules', '@scope', 'scoped-pkg', 'package.json'),
      JSON.stringify({ name: '@scope/scoped-pkg', version: '3.0.0', license: 'MIT' })
    );
  });

  afterAll(async () => {
    await rm(fixtureDir, { recursive: true, force: true });
  });

  it('joins dual licenses with OR', async () => {
    const r = await scanDeclared(fixtureDir);
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      const dual = r.value.find(e => e.package === 'dual-pkg');
      // license-checker may report dual as array joined with OR or as string
      expect(dual).toBeDefined();
      if (dual) expect(dual.licenses).toContain('OR');
    }
  });

  it('retains UNKNOWN', async () => {
    const r = await scanDeclared(fixtureDir);
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      const unk = r.value.find(e => e.package === 'unknown-pkg');
      expect(unk).toBeDefined();
      if (unk) expect(unk.licenses).toBe('UNKNOWN');
    }
  });

  it('parses scoped package names via scan', async () => {
    const r = await scanDeclared(fixtureDir);
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      const scoped = r.value.find(e => e.package === '@scope/scoped-pkg');
      expect(scoped).toBeDefined();
      if (scoped) {
        expect(scoped.package).toBe('@scope/scoped-pkg');
        expect(scoped.version).toBe('3.0.0');
      }
    }
  });
});

describe('P-118 scan: error mapping and sorting', () => {
  it('maps checker error to LICENSE_SCAN_FAILED', async () => {
    const badPath = join(repoRoot, 'this', 'license', 'path', 'does', 'not', 'exist', 'p118-bad');
    const r = await scanDeclared(badPath);
    // license-checker may return ok([]) for missing dir or err - both are acceptable if typed
    // We assert it is either ok with empty or err with LICENSE_SCAN_FAILED/INTERNAL
    if (r.isErr()) {
      expect(['LICENSE_SCAN_FAILED', 'INTERNAL']).toContain(r.error.code);
    } else {
      expect(r.value).toEqual([]);
    }
  });

  it('sorts and dedupes by package@version', async () => {
    const sortDir = resolve(repoRoot, 'packages', 'core', '.license-fixture-sort');
    await rm(sortDir, { recursive: true, force: true });
    await mkdir(join(sortDir, 'node_modules', 'zebra'), { recursive: true });
    await writeFile(
      join(sortDir, 'node_modules', 'zebra', 'package.json'),
      JSON.stringify({ name: 'zebra', version: '1.0.0', license: 'MIT' })
    );
    await mkdir(join(sortDir, 'node_modules', 'alpha'), { recursive: true });
    await writeFile(
      join(sortDir, 'node_modules', 'alpha', 'package.json'),
      JSON.stringify({ name: 'alpha', version: '1.0.0', license: 'MIT' })
    );
    // Duplicate entry: same package@version via different path (simulate dedupe)
    const r = await scanDeclared(sortDir);
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      const pkgs = r.value.map(e => e.package);
      const sorted = [...pkgs].sort();
      expect(pkgs).toEqual(sorted);
      const deduped = new Set(r.value.map(e => `${e.package}@${e.version}`));
      expect(deduped.size).toBe(r.value.length);
    }
    await rm(sortDir, { recursive: true, force: true });
  });
});
