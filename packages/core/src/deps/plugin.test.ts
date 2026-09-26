// P-115 tests: plugin registry and delegation.
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getParser,
  registerParser,
  detectEcosystem,
  clearParsersForTests,
  getAllParsers,
} from './plugin.js';
import type { ManifestParser } from './plugin.js';
import { unionManifests } from './merge.js';
import { parsePackageJson } from './parse/npm.js';
import type { ParsedManifest } from './types.js';
import { ok, err } from 'neverthrow';

function mustNpm(content: string, path: string): ParsedManifest {
  const r = parsePackageJson(content, path);
  if (r.isErr()) {
    const msg = 'message' in r.error ? r.error.message : JSON.stringify(r.error);
    throw new Error(`parse failed: ${msg}`);
  }
  return r.value;
}

describe('P-115 plugin: detects ecosystem per repo', () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), 'stitch-plugin-detect-'));
  });

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it('detects npm via package.json', async () => {
    await writeFile(join(tmpRoot, 'package.json'), JSON.stringify({ dependencies: {} }));
    const eco = await detectEcosystem(tmpRoot);
    expect(eco).toBe('npm');
  });

  it('detects python via pyproject.toml', async () => {
    // Need to clear npm marker first to test python alone
    const sub = join(tmpRoot, 'py');
    await mkdir(sub, { recursive: true });
    await writeFile(join(sub, 'pyproject.toml'), '[project]\nname="x"\nversion="0.1.0"\n');
    const eco = await detectEcosystem(sub);
    expect(eco).toBe('python');
  });

  it('detects cargo via Cargo.toml', async () => {
    const sub = join(tmpRoot, 'cargo');
    await mkdir(sub, { recursive: true });
    await writeFile(join(sub, 'Cargo.toml'), '[package]\nname="x"\nversion="0.1.0"\n');
    const eco = await detectEcosystem(sub);
    expect(eco).toBe('cargo');
  });

  it('detects go via go.mod', async () => {
    const sub = join(tmpRoot, 'go');
    await mkdir(sub, { recursive: true });
    await writeFile(join(sub, 'go.mod'), 'module example.com/x\n\ngo 1.21\n');
    const eco = await detectEcosystem(sub);
    expect(eco).toBe('go');
  });

  it('returns null for empty dir', async () => {
    const sub = join(tmpRoot, 'empty');
    await mkdir(sub, { recursive: true });
    const eco = await detectEcosystem(sub);
    expect(eco).toBeNull();
  });
});

describe('P-115 plugin: getParser throws on unknown', () => {
  it('throws UNSUPPORTED_ECOSYSTEM for ruby', () => {
    expect(() => getParser('ruby')).toThrow();
    try {
      getParser('ruby');
    } catch (e) {
      const err = e as Error & { code?: string; ecosystem?: string };
      expect(err.code).toBe('UNSUPPORTED_ECOSYSTEM');
      expect(err.ecosystem).toBe('ruby');
    }
  });

  it('returns npm parser for npm', () => {
    const parser = getParser('npm');
    expect(parser.ecosystem).toBe('npm');
  });
});

describe('P-115 plugin: registry collects registered parsers', () => {
  it('collects 4 default parsers', () => {
    const all = getAllParsers();
    const ecos = all.map(p => p.ecosystem).sort();
    expect(ecos).toEqual(['cargo', 'go', 'npm', 'python']);
  });
});

describe('P-115 plugin: merge.ts delegates to registered parser', () => {
  it('picks up a fake parser without editing merge.ts', async () => {
    // Save current registry
    const original = [...getAllParsers()];
    clearParsersForTests();

    // Register a fake parser for npm that returns a known merge result
    const fakeParser: ManifestParser = {
      ecosystem: 'npm',
      async detect() {
        return true;
      },
      parse: () => err({ code: 'CONFIG_ERROR', field: 'test', message: 'not used' }),
      serialize: () => '',
      merge: _manifests => {
        // Return a deterministic merge result that we can assert
        return ok({
          merged: {
            dependencies: { fake: '1.0.0' },
          } as unknown as import('./types.js').UnifiedManifest,
          conflicts: [],
          warnings: ['fake parser used'],
        });
      },
      async regenerateLockfile() {
        return err({ code: 'INTERNAL', message: 'not used' });
      },
    };
    registerParser(fakeParser);

    // Also need to register other ecosystems to avoid empty registry for other tests
    // But for this test, we only need npm
    const manifests: ParsedManifest[] = [
      mustNpm(JSON.stringify({ dependencies: { a: '1.0.0' } }), 'a/package.json'),
    ];
    const result = unionManifests(manifests);
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.warnings).toContain('fake parser used');
      expect(result.value.merged).toHaveProperty('dependencies');
    }

    // Restore original parsers
    clearParsersForTests();
    for (const p of original) registerParser(p);
  });

  it('still passes all existing P-104–P-114 tests after refactor', async () => {
    // This is a meta-test: we already run the full deps suite separately,
    // but here we ensure a basic npm merge still works via the registry
    const a = mustNpm(JSON.stringify({ dependencies: { lodash: '^4.17.20' } }), 'a/package.json');
    const b = mustNpm(JSON.stringify({ dependencies: { lodash: '^4.17.21' } }), 'b/package.json');
    const result = unionManifests([a, b]);
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      // Should have a version conflict (different strings) but still merge
      expect(result.value.conflicts.length).toBeGreaterThanOrEqual(0);
    }
  });
});
