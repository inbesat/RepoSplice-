// P-115 tests: npm parser plugin wrapper (detect/parse/serialize/merge/
// regenerateLockfile). Delegation targets are covered in parse/npm.test.ts;
// here we only assert the plugin surface and the ecosystem guards.
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { npmParser } from './npm.js';
import type { ParsedManifest } from '../types.js';

const PACKAGE_JSON = JSON.stringify({ dependencies: { react: '^18.0.0' } });

const CARGO_MANIFEST: ParsedManifest = {
  ecosystem: 'cargo',
  manifest: { package: { name: 'x', version: '1.0.0' }, dependencies: {} },
  path: 'Cargo.toml',
};

function mustParse(content: string, filePath: string): ParsedManifest {
  const r = npmParser.parse(content, filePath);
  if (r.isErr()) throw new Error(`parse failed: ${r.error.code}`);
  return r.value;
}

describe('P-115 npm parser: detect', () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), 'stitch-npm-'));
  });

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it('detects a repo containing package.json', async () => {
    await writeFile(join(tmpRoot, 'package.json'), PACKAGE_JSON);
    await expect(npmParser.detect(tmpRoot)).resolves.toBe(true);
  });

  it('returns false when package.json is absent', async () => {
    await expect(npmParser.detect(tmpRoot)).resolves.toBe(false);
  });

  it('returns false when the path is invalid', async () => {
    await expect(npmParser.detect(null as unknown as string)).resolves.toBe(false);
  });
});

describe('P-115 npm parser: parse', () => {
  it('parses valid package.json content', () => {
    const r = npmParser.parse(PACKAGE_JSON, 'package.json');
    expect(r.isOk()).toBe(true);
    if (r.isOk()) expect(r.value.ecosystem).toBe('npm');
  });

  it('returns err for malformed JSON', () => {
    const r = npmParser.parse('{ "dependencies": }', 'package.json');
    expect(r.isErr()).toBe(true);
    if (r.isErr()) expect(r.error.code).toBe('DEPS_PARSE_ERROR');
  });
});

describe('P-115 npm parser: serialize', () => {
  it('serializes a matching manifest to a string', () => {
    const out = npmParser.serialize(mustParse(PACKAGE_JSON, 'package.json'));
    expect(typeof out).toBe('string');
    expect(out.length).toBeGreaterThan(0);
  });

  it('throws on a mismatched-ecosystem manifest', () => {
    expect(() => npmParser.serialize(CARGO_MANIFEST)).toThrow();
  });
});

describe('P-115 npm parser: merge', () => {
  it('merges at least one npm manifest', () => {
    const r = npmParser.merge([mustParse(PACKAGE_JSON, 'package.json')]);
    expect(r.isOk()).toBe(true);
    if (r.isOk()) expect(r.value.merged).toHaveProperty('dependencies');
  });

  it('errors CONFIG_ERROR on an empty manifest list', () => {
    const r = npmParser.merge([]);
    expect(r.isErr()).toBe(true);
    if (r.isErr()) expect(r.error.code).toBe('CONFIG_ERROR');
  });

  it('errors CONFIG_ERROR when only mismatched manifests are given', () => {
    const r = npmParser.merge([CARGO_MANIFEST]);
    expect(r.isErr()).toBe(true);
    if (r.isErr()) expect(r.error.code).toBe('CONFIG_ERROR');
  });
});

describe('P-115 npm parser: regenerateLockfile', () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), 'stitch-npm-lock-'));
  });

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it('errors CONFIG_ERROR for a mismatched ecosystem', async () => {
    const r = await npmParser.regenerateLockfile(CARGO_MANIFEST, tmpRoot);
    expect(r.isErr()).toBe(true);
    if (r.isErr()) expect(r.error.code).toBe('CONFIG_ERROR');
  });

  it('returns a Result for a matching manifest', async () => {
    await writeFile(
      join(tmpRoot, 'package.json'),
      JSON.stringify({ name: 'plugin-fixture', version: '1.0.0' })
    );
    const r = await npmParser.regenerateLockfile(mustParse(PACKAGE_JSON, 'package.json'), tmpRoot);
    if (r.isErr()) {
      expect(['LOCKFILE_GENERATION_FAILED', 'LOCKFILE_NOT_CREATED', 'INTERNAL']).toContain(
        r.error.code
      );
    } else {
      expect(r.value.ecosystem).toBe('npm');
    }
  });
});
