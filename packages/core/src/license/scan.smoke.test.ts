// P-023 smoke test: confirms scanDeclared parses a tiny fixture of
// node_modules and reports missing-dir errors as a typed INTERNAL.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { rm } from 'node:fs/promises';
import { scanDeclared, writeFixturePkg } from './scan.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..', '..');
const fixtureDir = resolve(repoRoot, 'packages', 'core', '.license-fixture');

describe('P-023 scanDeclared: fixture scan', () => {
  beforeAll(async () => {
    await rm(fixtureDir, { recursive: true, force: true });
    await writeFixturePkg(fixtureDir, 'foo-pkg', '1.0.0', 'MIT');
    await writeFixturePkg(fixtureDir, 'bar-pkg', '2.1.0', 'Apache-2.0');
  });
  afterAll(async () => {
    await rm(fixtureDir, { recursive: true, force: true });
  });

  it('returns structured entries for installed fixture packages', async () => {
    const r = await scanDeclared(fixtureDir);
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      // license-checker may also report the root package (path of the
      // fixture itself); we only assert that our two fixtures show up.
      const pkgs = r.value.map(e => `${e.package}@${e.version}`);
      expect(pkgs).toContain('foo-pkg@1.0.0');
      expect(pkgs).toContain('bar-pkg@2.1.0');
      const foo = r.value.find(e => e.package === 'foo-pkg');
      expect(foo?.licenses).toBe('MIT');
      const bar = r.value.find(e => e.package === 'bar-pkg');
      expect(bar?.licenses).toBe('Apache-2.0');
    }
  }, 60_000);
});

describe('P-023 scanDeclared: bad path', () => {
  it('returns typed INTERNAL err when depsDir is missing', async () => {
    const badPath = join(repoRoot, 'this', 'license', 'path', 'does', 'not', 'exist');
    const r = await scanDeclared(badPath);
    // license-checker throws synchronously for a missing path; the
    // promisify surfaces it as a rejection that fromInternalPromise
    // maps to INTERNAL. Either way: err with code INTERNAL.
    expect(r.isErr()).toBe(true);
    if (r.isErr()) {
      expect(r.error.code).toBe('INTERNAL');
    }
  }, 30_000);
});
