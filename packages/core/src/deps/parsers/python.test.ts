// P-115 tests: python parser plugin wrapper (detect/parse/serialize/merge/
// regenerateLockfile). Delegation targets are covered in parse/python.test.ts;
// here we only assert the plugin surface and the ecosystem guards.
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { pythonParser } from './python.js';
import type { ParsedManifest } from '../types.js';

const PYPROJECT_TOML = [
  '[project]',
  'name = "plugin-fixture"',
  'version = "0.1.0"',
  'dependencies = ["requests>=2.28.1"]',
  '',
].join('\n');

const NPM_MANIFEST: ParsedManifest = {
  ecosystem: 'npm',
  manifest: { dependencies: {} },
  path: 'package.json',
};

function mustParse(content: string, filePath: string): ParsedManifest {
  const r = pythonParser.parse(content, filePath);
  if (r.isErr()) throw new Error(`parse failed: ${r.error.code}`);
  return r.value;
}

describe('P-115 python parser: detect', () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), 'stitch-python-'));
  });

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it('detects a repo containing pyproject.toml', async () => {
    await writeFile(join(tmpRoot, 'pyproject.toml'), PYPROJECT_TOML);
    await expect(pythonParser.detect(tmpRoot)).resolves.toBe(true);
  });

  it('detects a repo containing requirements.txt', async () => {
    await writeFile(join(tmpRoot, 'requirements.txt'), 'requests>=2.28.1\n');
    await expect(pythonParser.detect(tmpRoot)).resolves.toBe(true);
  });

  it('detects a repo containing requirements-dev.txt', async () => {
    await writeFile(join(tmpRoot, 'requirements-dev.txt'), 'pytest>=7.0\n');
    await expect(pythonParser.detect(tmpRoot)).resolves.toBe(true);
  });

  it('returns false when no python manifest is present', async () => {
    await expect(pythonParser.detect(tmpRoot)).resolves.toBe(false);
  });

  it('returns false when the path is invalid', async () => {
    await expect(pythonParser.detect(null as unknown as string)).resolves.toBe(false);
  });
});

describe('P-115 python parser: parse', () => {
  it('parses valid pyproject.toml content', () => {
    const r = pythonParser.parse(PYPROJECT_TOML, 'pyproject.toml');
    expect(r.isOk()).toBe(true);
    if (r.isOk()) expect(r.value.ecosystem).toBe('python');
  });

  it('returns err for malformed TOML content', () => {
    const r = pythonParser.parse('[project\nname = "broken"\n', 'pyproject.toml');
    expect(r.isErr()).toBe(true);
    if (r.isErr()) expect(r.error.code).toBe('DEPS_PARSE_ERROR');
  });
});

describe('P-115 python parser: serialize', () => {
  it('serializes a matching manifest to a string', () => {
    const out = pythonParser.serialize(mustParse(PYPROJECT_TOML, 'pyproject.toml'));
    expect(typeof out).toBe('string');
    expect(out.length).toBeGreaterThan(0);
  });

  it('throws on a mismatched-ecosystem manifest', () => {
    expect(() => pythonParser.serialize(NPM_MANIFEST)).toThrow();
  });
});

describe('P-115 python parser: merge', () => {
  it('merges at least one python manifest', () => {
    const r = pythonParser.merge([mustParse(PYPROJECT_TOML, 'pyproject.toml')]);
    expect(r.isOk()).toBe(true);
    if (r.isOk()) expect(r.value.merged).toHaveProperty('dependencies');
  });

  it('errors CONFIG_ERROR on an empty manifest list', () => {
    const r = pythonParser.merge([]);
    expect(r.isErr()).toBe(true);
    if (r.isErr()) expect(r.error.code).toBe('CONFIG_ERROR');
  });

  it('errors CONFIG_ERROR when only mismatched manifests are given', () => {
    const r = pythonParser.merge([NPM_MANIFEST]);
    expect(r.isErr()).toBe(true);
    if (r.isErr()) expect(r.error.code).toBe('CONFIG_ERROR');
  });
});

describe('P-115 python parser: regenerateLockfile', () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), 'stitch-python-lock-'));
  });

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it('errors CONFIG_ERROR for a mismatched ecosystem', async () => {
    const r = await pythonParser.regenerateLockfile(NPM_MANIFEST, tmpRoot);
    expect(r.isErr()).toBe(true);
    if (r.isErr()) expect(r.error.code).toBe('CONFIG_ERROR');
  });

  it('returns a Result for a matching manifest', async () => {
    await writeFile(join(tmpRoot, 'pyproject.toml'), PYPROJECT_TOML);
    const r = await pythonParser.regenerateLockfile(
      mustParse(PYPROJECT_TOML, 'pyproject.toml'),
      tmpRoot
    );
    if (r.isErr()) {
      expect(['LOCKFILE_GENERATION_FAILED', 'LOCKFILE_NOT_CREATED', 'INTERNAL']).toContain(
        r.error.code
      );
    } else {
      expect(r.value.ecosystem).toBe('python');
    }
  });
});
