// P-106 tests: Cargo.toml parsing. Covers the three spec fixtures
// (Cargo.simple, Cargo.features, Cargo.workspace) plus the spec edges
// (string-vs-table normalization, git-dep '*'+warning, patch-warning-no-error,
// invalid TOML line/col, missing package field path, empty -> FILE_NOT_FOUND).
import { describe, expect, it } from 'vitest';
import { parseCargoToml } from './cargo.js';

const CARGO_SIMPLE = [
  '[package]',
  'name = "cli-tool"',
  'version = "0.1.0"',
  'edition = "2021"',
  '',
  '[dependencies]',
  'serde = "1.0"',
  'clap = { version = "4.0", features = ["derive"] }',
  'tokio = { version = "1.0", features = ["full"] }',
  '',
  '[dev-dependencies]',
  'tempfile = "3.0"',
].join('\n');

const CARGO_FEATURES = [
  '[package]',
  'name = "async-lib"',
  'version = "0.2.0"',
  '',
  '[dependencies]',
  'tokio = { version = "1.0", features = ["rt-multi-thread", "macros"] }',
  '',
  '[features]',
  'default = ["tokio/rt-multi-thread"]',
  'async-std = ["tokio/rt"]',
].join('\n');

const CARGO_WORKSPACE = [
  '[workspace]',
  'members = ["crate-a", "crate-b", "crate-c"]',
  '',
  '[package]',
  'name = "monorepo-root"',
  'version = "1.0.0"',
  '',
  '[dependencies]',
  'anyhow = "1.0"',
].join('\n');

const CARGO_GIT_DEP = [
  '[package]',
  'name = "with-git"',
  'version = "0.0.1"',
  '',
  '[dependencies]',
  'my-crate = { git = "https://github.com/user/repo.git", branch = "main" }',
].join('\n');

const CARGO_PATCH = [
  '[package]',
  'name = "with-patch"',
  'version = "0.0.1"',
  '',
  '[patch.crates-io]',
  'serde = { git = "https://github.com/serde-rs/serde.git", branch = "fix" }',
].join('\n');

describe('P-106 cargo: Cargo.simple.toml', () => {
  it('parses package, deps, dev-deps, preserves string and table forms', () => {
    const r = parseCargoToml(CARGO_SIMPLE, 'Cargo.toml');
    expect(r.isOk()).toBe(true);
    if (r.isOk() && r.value.ecosystem === 'cargo') {
      expect(r.value.ecosystem).toBe('cargo');
      expect(r.value.path).toBe('Cargo.toml');
      expect(r.value.manifest.package).toEqual({
        name: 'cli-tool',
        version: '0.1.0',
        edition: '2021',
      });
      expect(r.value.manifest.dependencies).toEqual({
        serde: '1.0',
        clap: { version: '4.0', features: ['derive'] },
        tokio: { version: '1.0', features: ['full'] },
      });
      expect(r.value.manifest.devDependencies).toEqual({
        tempfile: '3.0',
      });
      expect(r.value.manifest.buildDependencies).toBeUndefined();
      expect(r.value.manifest.features).toBeUndefined();
      expect(r.value.manifest.workspace).toBeUndefined();
    }
  });
});

describe('P-106 cargo: Cargo.features.toml', () => {
  it('preserves features map as string arrays', () => {
    const r = parseCargoToml(CARGO_FEATURES, 'Cargo.toml');
    expect(r.isOk()).toBe(true);
    if (r.isOk() && r.value.ecosystem === 'cargo') {
      expect(r.value.manifest.package).toEqual({
        name: 'async-lib',
        version: '0.2.0',
      });
      expect(r.value.manifest.dependencies).toEqual({
        tokio: { version: '1.0', features: ['rt-multi-thread', 'macros'] },
      });
      expect(r.value.manifest.features).toEqual({
        default: ['tokio/rt-multi-thread'],
        'async-std': ['tokio/rt'],
      });
    }
  });
});

describe('P-106 cargo: Cargo.workspace.toml', () => {
  it('preserves workspace.members', () => {
    const r = parseCargoToml(CARGO_WORKSPACE, 'Cargo.toml');
    expect(r.isOk()).toBe(true);
    if (r.isOk() && r.value.ecosystem === 'cargo') {
      expect(r.value.manifest.package).toEqual({
        name: 'monorepo-root',
        version: '1.0.0',
      });
      expect(r.value.manifest.workspace).toEqual({
        members: ['crate-a', 'crate-b', 'crate-c'],
      });
    }
  });
});

describe('P-106 cargo: edge cases', () => {
  it('empty or whitespace content maps to FILE_NOT_FOUND', () => {
    for (const content of ['', '  \n  ']) {
      const r = parseCargoToml(content, 'Cargo.toml');
      expect(r.isErr()).toBe(true);
      if (r.isErr()) expect(r.error.code).toBe('FILE_NOT_FOUND');
    }
  });

  it('invalid TOML maps to DEPS_PARSE_ERROR with line/col', () => {
    const r = parseCargoToml('[package\nname = "broken"\n', 'Cargo.toml');
    expect(r.isErr()).toBe(true);
    if (r.isErr()) {
      expect(r.error.code).toBe('DEPS_PARSE_ERROR');
      if (r.error.code === 'DEPS_PARSE_ERROR') {
        expect(r.error.file).toBe('Cargo.toml');
        expect(r.error.message).toMatch(/line \d+/);
      }
    }
  });

  it('missing package table maps to DEPS_PARSE_ERROR with field path', () => {
    const r = parseCargoToml('[dependencies]\nserde = "1.0"\n', 'Cargo.toml');
    expect(r.isErr()).toBe(true);
    if (r.isErr()) {
      expect(r.error.code).toBe('DEPS_PARSE_ERROR');
      if (r.error.code === 'DEPS_PARSE_ERROR') {
        expect(r.error.message).toContain('[package]');
      }
    }
  });

  it('missing package.name/version maps to DEPS_PARSE_ERROR with field path', () => {
    const r = parseCargoToml('[package]\nname = "ok"\n', 'Cargo.toml');
    expect(r.isErr()).toBe(true);
    if (r.isErr()) {
      expect(r.error.code).toBe('DEPS_PARSE_ERROR');
      if (r.error.code === 'DEPS_PARSE_ERROR') {
        expect(r.error.message).toContain('[package] requires');
      }
    }
  });

  it('non-table dependencies maps to DEPS_PARSE_ERROR with field path', () => {
    // Valid TOML with inline package table + root-level string dependencies
    const r = parseCargoToml(
      'package = { name = "t", version = "1" }\ndependencies = "not-a-table"\n',
      'Cargo.toml'
    );
    expect(r.isErr()).toBe(true);
    if (r.isErr()) {
      expect(r.error.code).toBe('DEPS_PARSE_ERROR');
      if (r.error.code === 'DEPS_PARSE_ERROR') {
        expect(r.error.message).toContain('[dependencies]');
      }
    }
  });

  it('non-table dev-dependencies maps to DEPS_PARSE_ERROR with field path', () => {
    const r = parseCargoToml(
      'package = { name = "t", version = "1" }\ndev-dependencies = "not-a-table"\n',
      'Cargo.toml'
    );
    expect(r.isErr()).toBe(true);
    if (r.isErr()) {
      expect(r.error.code).toBe('DEPS_PARSE_ERROR');
      if (r.error.code === 'DEPS_PARSE_ERROR') {
        expect(r.error.message).toContain('[dev-dependencies]');
      }
    }
  });

  it('non-table build-dependencies maps to DEPS_PARSE_ERROR with field path', () => {
    const r = parseCargoToml(
      'package = { name = "t", version = "1" }\nbuild-dependencies = "not-a-table"\n',
      'Cargo.toml'
    );
    expect(r.isErr()).toBe(true);
    if (r.isErr()) {
      expect(r.error.code).toBe('DEPS_PARSE_ERROR');
      if (r.error.code === 'DEPS_PARSE_ERROR') {
        expect(r.error.message).toContain('[build-dependencies]');
      }
    }
  });

  it('non-table features maps to DEPS_PARSE_ERROR with field path', () => {
    const r = parseCargoToml(
      'package = { name = "t", version = "1" }\nfeatures = "not-a-table"\n',
      'Cargo.toml'
    );
    expect(r.isErr()).toBe(true);
    if (r.isErr()) {
      expect(r.error.code).toBe('DEPS_PARSE_ERROR');
      if (r.error.code === 'DEPS_PARSE_ERROR') {
        expect(r.error.message).toContain('[features]');
      }
    }
  });

  it('feature with non-string array maps to DEPS_PARSE_ERROR with field path', () => {
    const r = parseCargoToml(
      '[package]\nname = "t"\nversion = "1"\n[features]\ndefault = [123]\n',
      'Cargo.toml'
    );
    expect(r.isErr()).toBe(true);
    if (r.isErr()) {
      expect(r.error.code).toBe('DEPS_PARSE_ERROR');
      if (r.error.code === 'DEPS_PARSE_ERROR') {
        expect(r.error.message).toContain("feature 'default'");
      }
    }
  });

  it('non-table workspace maps to DEPS_PARSE_ERROR with field path', () => {
    const r = parseCargoToml(
      'package = { name = "t", version = "1" }\nworkspace = "not-a-table"\n',
      'Cargo.toml'
    );
    expect(r.isErr()).toBe(true);
    if (r.isErr()) {
      expect(r.error.code).toBe('DEPS_PARSE_ERROR');
      if (r.error.code === 'DEPS_PARSE_ERROR') {
        expect(r.error.message).toContain('[workspace]');
      }
    }
  });

  it('workspace.members with non-string array maps to DEPS_PARSE_ERROR', () => {
    const r = parseCargoToml(
      '[package]\nname = "t"\nversion = "1"\n[workspace]\nmembers = [123]\n',
      'Cargo.toml'
    );
    expect(r.isErr()).toBe(true);
    if (r.isErr()) {
      expect(r.error.code).toBe('DEPS_PARSE_ERROR');
      if (r.error.code === 'DEPS_PARSE_ERROR') {
        expect(r.error.message).toContain('[workspace].members');
      }
    }
  });

  it('git dependency without version stores * with warning', () => {
    // This test ensures no throw; we can't easily capture the logger.warn here,
    // but we verify the manifest is ok and the dep has version "*".
    const r = parseCargoToml(CARGO_GIT_DEP, 'Cargo.toml');
    expect(r.isOk()).toBe(true);
    if (r.isOk() && r.value.ecosystem === 'cargo') {
      const dep = r.value.manifest.dependencies['my-crate'];
      expect(typeof dep === 'object' && dep !== null).toBe(true);
      if (typeof dep === 'object' && dep !== null) {
        expect(dep.version).toBe('*');
      }
    }
  });

  it('patch section is ignored with warning (no error)', () => {
    const r = parseCargoToml(CARGO_PATCH, 'Cargo.toml');
    expect(r.isOk()).toBe(true);
    if (r.isOk() && r.value.ecosystem === 'cargo') {
      expect(r.value.manifest.package.name).toBe('with-patch');
    }
  });

  it('absent dependencies normalizes to empty object', () => {
    const r = parseCargoToml('[package]\nname = "empty-deps"\nversion = "1.0.0"\n', 'Cargo.toml');
    expect(r.isOk()).toBe(true);
    if (r.isOk() && r.value.ecosystem === 'cargo') {
      expect(r.value.manifest.dependencies).toEqual({});
    }
  });

  it('dev-dependencies table normalized to narrow { version } shape', () => {
    const content = [
      '[package]',
      'name = "dev-deps-table"',
      'version = "0.1.0"',
      '',
      '[dev-dependencies]',
      'tempfile = { version = "3.0" }',
    ].join('\n');
    const r = parseCargoToml(content, 'Cargo.toml');
    expect(r.isOk()).toBe(true);
    if (r.isOk() && r.value.ecosystem === 'cargo') {
      const dev = r.value.manifest.devDependencies;
      expect(dev).toBeDefined();
      if (dev !== undefined) {
        // Table entry normalized to narrow { version } shape
        expect(Object.keys(dev).length).toBe(1);
        expect(dev['tempfile']).toEqual({ version: '3.0' });
      }
    }
  });

  it('build-dependencies table coerced to plain string specs', () => {
    const content = [
      '[package]',
      'name = "build-deps"',
      'version = "0.1.0"',
      '',
      '[build-dependencies]',
      'cc = "1.0"',
      'pkg-config = { version = "0.3" }',
      'cmake = { path = "../cmake-wrapper" }',
    ].join('\n');
    const r = parseCargoToml(content, 'Cargo.toml');
    expect(r.isOk()).toBe(true);
    if (r.isOk() && r.value.ecosystem === 'cargo') {
      expect(r.value.manifest.buildDependencies).toEqual({
        cc: '1.0',
        'pkg-config': '0.3',
        cmake: '*',
      });
    }
  });

  it('unexpected dep value (number) warns and stores *', () => {
    const content = [
      '[package]',
      'name = "bad-dep"',
      'version = "0.1.0"',
      '',
      '[dependencies]',
      'weird = 123',
    ].join('\n');
    const r = parseCargoToml(content, 'Cargo.toml');
    expect(r.isOk()).toBe(true);
    if (r.isOk() && r.value.ecosystem === 'cargo') {
      expect(r.value.manifest.dependencies['weird']).toBe('*');
    }
  });

  it('dependency table with features but no version stores * + features + warning', () => {
    const content = [
      '[package]',
      'name = "feat-no-ver"',
      'version = "0.1.0"',
      '',
      '[dependencies]',
      'some-crate = { features = ["foo"] }',
    ].join('\n');
    const r = parseCargoToml(content, 'Cargo.toml');
    expect(r.isOk()).toBe(true);
    if (r.isOk() && r.value.ecosystem === 'cargo') {
      const dep = r.value.manifest.dependencies['some-crate'];
      expect(typeof dep === 'object' && dep !== null).toBe(true);
      if (typeof dep === 'object' && dep !== null) {
        expect(dep.version).toBe('*');
        expect(dep.features).toEqual(['foo']);
      }
    }
  });
});
