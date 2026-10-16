// P-115 tests: go parser plugin wrapper (detect/parse/serialize/merge/
// regenerateLockfile). Delegation targets are covered in parse/go.test.ts;
// here we only assert the plugin surface and the ecosystem guards.
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { goParser } from './go.js';
import type { ParsedManifest } from '../types.js';

const GO_MOD = ['module example.com/plugin-fixture', '', 'go 1.21', ''].join('\n');

const NPM_MANIFEST: ParsedManifest = {
  ecosystem: 'npm',
  manifest: { dependencies: {} },
  path: 'package.json',
};

function mustParse(content: string, filePath: string): ParsedManifest {
  const r = goParser.parse(content, filePath);
  if (r.isErr()) throw new Error(`parse failed: ${r.error.code}`);
  return r.value;
}

describe('P-115 go parser: detect', () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), 'stitch-go-'));
  });

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it('detects a repo containing go.mod', async () => {
    await writeFile(join(tmpRoot, 'go.mod'), GO_MOD);
    await expect(goParser.detect(tmpRoot)).resolves.toBe(true);
  });

  it('returns false when go.mod is absent', async () => {
    await expect(goParser.detect(tmpRoot)).resolves.toBe(false);
  });

  it('returns false when the path is invalid', async () => {
    await expect(goParser.detect(null as unknown as string)).resolves.toBe(false);
  });
});

describe('P-115 go parser: parse', () => {
  it('parses valid go.mod content', () => {
    const r = goParser.parse(GO_MOD, 'go.mod');
    expect(r.isOk()).toBe(true);
    if (r.isOk()) expect(r.value.ecosystem).toBe('go');
  });

  it('returns err when the module directive is missing', () => {
    const r = goParser.parse('go 1.21\n', 'go.mod');
    expect(r.isErr()).toBe(true);
    if (r.isErr()) expect(r.error.code).toBe('DEPS_PARSE_ERROR');
  });
});

describe('P-115 go parser: serialize', () => {
  it('serializes a matching manifest to a string', () => {
    const out = goParser.serialize(mustParse(GO_MOD, 'go.mod'));
    expect(typeof out).toBe('string');
    expect(out).toContain('module example.com/plugin-fixture');
  });

  it('throws on a mismatched-ecosystem manifest', () => {
    expect(() => goParser.serialize(NPM_MANIFEST)).toThrow();
  });
});

describe('P-115 go parser: merge', () => {
  it('merges at least one go manifest', () => {
    const r = goParser.merge([mustParse(GO_MOD, 'go.mod')]);
    expect(r.isOk()).toBe(true);
    if (r.isOk()) expect(r.value.merged).toHaveProperty('require');
  });

  it('errors CONFIG_ERROR on an empty manifest list', () => {
    const r = goParser.merge([]);
    expect(r.isErr()).toBe(true);
    if (r.isErr()) expect(r.error.code).toBe('CONFIG_ERROR');
  });

  it('errors CONFIG_ERROR when only mismatched manifests are given', () => {
    const r = goParser.merge([NPM_MANIFEST]);
    expect(r.isErr()).toBe(true);
    if (r.isErr()) expect(r.error.code).toBe('CONFIG_ERROR');
  });
});

describe('P-115 go parser: regenerateLockfile', () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), 'stitch-go-lock-'));
  });

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it('errors CONFIG_ERROR for a mismatched ecosystem', async () => {
    const r = await goParser.regenerateLockfile(NPM_MANIFEST, tmpRoot);
    expect(r.isErr()).toBe(true);
    if (r.isErr()) expect(r.error.code).toBe('CONFIG_ERROR');
  });

  it('returns a Result for a matching manifest', async () => {
    await writeFile(join(tmpRoot, 'go.mod'), GO_MOD);
    const r = await goParser.regenerateLockfile(mustParse(GO_MOD, 'go.mod'), tmpRoot);
    if (r.isErr()) {
      expect(['LOCKFILE_GENERATION_FAILED', 'LOCKFILE_NOT_CREATED', 'INTERNAL']).toContain(
        r.error.code
      );
    } else {
      expect(r.value.ecosystem).toBe('go');
    }
  });
});
