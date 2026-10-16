// P-115 tests: cargo parser plugin wrapper (detect/parse/serialize/merge/
// regenerateLockfile). Delegation targets are covered in parse/cargo.test.ts;
// here we only assert the plugin surface and the ecosystem guards.
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cargoParser } from './cargo.js';
import type { ParsedManifest } from '../types.js';

const CARGO_TOML = ['[package]', 'name = "plugin-fixture"', 'version = "1.0.0"', ''].join('\n');

const NPM_MANIFEST: ParsedManifest = {
  ecosystem: 'npm',
  manifest: { dependencies: {} },
  path: 'package.json',
};

function mustParse(content: string, filePath: string): ParsedManifest {
  const r = cargoParser.parse(content, filePath);
  if (r.isErr()) throw new Error(`parse failed: ${r.error.code}`);
  return r.value;
}

describe('P-115 cargo parser: detect', () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), 'stitch-cargo-'));
  });

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it('detects a repo containing Cargo.toml', async () => {
    await writeFile(join(tmpRoot, 'Cargo.toml'), CARGO_TOML);
    await expect(cargoParser.detect(tmpRoot)).resolves.toBe(true);
  });

  it('returns false when Cargo.toml is absent', async () => {
    await expect(cargoParser.detect(tmpRoot)).resolves.toBe(false);
  });

  it('returns false when the path is invalid', async () => {
    await expect(cargoParser.detect(null as unknown as string)).resolves.toBe(false);
  });
});

describe('P-115 cargo parser: parse', () => {
  it('parses valid Cargo.toml content', () => {
    const r = cargoParser.parse(CARGO_TOML, 'Cargo.toml');
    expect(r.isOk()).toBe(true);
    if (r.isOk()) expect(r.value.ecosystem).toBe('cargo');
  });

  it('returns err for malformed content', () => {
    const r = cargoParser.parse('[package\nname = "broken"\n', 'Cargo.toml');
    expect(r.isErr()).toBe(true);
    if (r.isErr()) expect(r.error.code).toBe('DEPS_PARSE_ERROR');
  });
});

describe('P-115 cargo parser: serialize', () => {
  it('serializes a matching manifest to a string', () => {
    const out = cargoParser.serialize(mustParse(CARGO_TOML, 'Cargo.toml'));
    expect(typeof out).toBe('string');
    expect(out.length).toBeGreaterThan(0);
  });

  it('throws on a mismatched-ecosystem manifest', () => {
    expect(() => cargoParser.serialize(NPM_MANIFEST)).toThrow();
  });
});

describe('P-115 cargo parser: merge', () => {
  it('merges at least one cargo manifest', () => {
    const r = cargoParser.merge([mustParse(CARGO_TOML, 'Cargo.toml')]);
    expect(r.isOk()).toBe(true);
    if (r.isOk()) expect(r.value.merged).toHaveProperty('dependencies');
  });

  it('errors CONFIG_ERROR on an empty manifest list', () => {
    const r = cargoParser.merge([]);
    expect(r.isErr()).toBe(true);
    if (r.isErr()) expect(r.error.code).toBe('CONFIG_ERROR');
  });

  it('errors CONFIG_ERROR when only mismatched manifests are given', () => {
    const r = cargoParser.merge([NPM_MANIFEST]);
    expect(r.isErr()).toBe(true);
    if (r.isErr()) expect(r.error.code).toBe('CONFIG_ERROR');
  });
});

describe('P-115 cargo parser: regenerateLockfile', () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), 'stitch-cargo-lock-'));
  });

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it('errors CONFIG_ERROR for a mismatched ecosystem', async () => {
    const r = await cargoParser.regenerateLockfile(NPM_MANIFEST, tmpRoot);
    expect(r.isErr()).toBe(true);
    if (r.isErr()) expect(r.error.code).toBe('CONFIG_ERROR');
  });

  it('returns a Result for a matching manifest', async () => {
    await writeFile(join(tmpRoot, 'Cargo.toml'), CARGO_TOML);
    const r = await cargoParser.regenerateLockfile(mustParse(CARGO_TOML, 'Cargo.toml'), tmpRoot);
    if (r.isErr()) {
      expect(['LOCKFILE_GENERATION_FAILED', 'LOCKFILE_NOT_CREATED', 'INTERNAL']).toContain(
        r.error.code
      );
    } else {
      expect(r.value.ecosystem).toBe('cargo');
    }
  });
});
