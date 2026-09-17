// P-108 tests: unionManifests + recordMerge across all four ecosystems.
// Every manifest below is built through its real P-104–P-107 parser
// (round-trip proof: the union consumes actual parser output, never
// hand-shaped fixtures), except the two direct `recordMerge`/`sourceLabel`
// unit probes. Covers the five spec-required cases plus the acceptance
// criteria (peer warnings, suggestedResolution absent, union of
// non-conflicting keys) and the documented edges (scripts prefixing,
// engines/pythonVersion picks, cargo string-vs-table equivalence,
// go replace/indirect/module rules, mismatch/empty/single/ordering).
import { describe, expect, it } from 'vitest';
import { parseCargoToml } from './parse/cargo.js';
import { parseGoMod } from './parse/go.js';
import { recordMerge, sourceLabel, unionManifests } from './merge.js';
import { parsePackageJson } from './parse/npm.js';
import { parsePythonManifest } from './parse/python.js';
import type { NpmManifest, ParsedManifest, UnifiedManifest } from './types.js';

function mustNpm(content: string, path: string): ParsedManifest {
  const r = parsePackageJson(content, path);
  expect(r.isOk()).toBe(true);
  if (r.isErr()) throw new Error(`npm fixture failed to parse: ${path}`);
  return r.value;
}

function mustPython(content: string, path: string): ParsedManifest {
  const r = parsePythonManifest(path, content);
  expect(r.isOk()).toBe(true);
  if (r.isErr()) throw new Error(`python fixture failed to parse: ${path}`);
  return r.value;
}

function mustCargo(content: string, path: string): ParsedManifest {
  const r = parseCargoToml(content, path);
  expect(r.isOk()).toBe(true);
  if (r.isErr()) throw new Error(`cargo fixture failed to parse: ${path}`);
  return r.value;
}

function mustGo(content: string, path: string): ParsedManifest {
  const r = parseGoMod(content, path);
  expect(r.isOk()).toBe(true);
  if (r.isErr()) throw new Error(`go fixture failed to parse: ${path}`);
  return r.value;
}

/** Narrow a merged manifest to its npm shape (npm has no required key). */
function asNpm(merged: UnifiedManifest): NpmManifest {
  if ('source' in merged || 'package' in merged || 'module' in merged) {
    throw new Error('expected an npm manifest');
  }
  return merged;
}

const NPM_A = JSON.stringify({
  dependencies: { lodash: '~4.17.21', react: '^18.0.0' },
  devDependencies: { vitest: '^5.0.0' },
});

const NPM_B = JSON.stringify({
  dependencies: { axios: '^1.6.0', react: '^18.0.0' },
  devDependencies: { vitest: '^5.0.0' },
});

describe('P-108 merge: merges non-conflicting npm deps', () => {
  it('unions keys from both sides with zero conflicts', () => {
    const r = unionManifests([
      mustNpm(NPM_A, 'repo-a/package.json'),
      mustNpm(NPM_B, 'repo-b/package.json'),
    ]);
    expect(r.isOk()).toBe(true);
    if (r.isErr()) return;
    expect(r.value.conflicts).toEqual([]);
    const merged = asNpm(r.value.merged);
    expect(merged['dependencies']).toEqual({
      lodash: '~4.17.21',
      react: '^18.0.0',
      axios: '^1.6.0',
    });
  });
});

describe('P-108 merge: detects version conflict', () => {
  it('reports react ^18 vs ^17 with both sides and no suggestion yet', () => {
    const a = mustNpm(
      JSON.stringify({ dependencies: { react: '^18.0.0' } }),
      'repo-a/package.json'
    );
    const b = mustNpm(
      JSON.stringify({ dependencies: { react: '^17.0.0' } }),
      'repo-b/package.json'
    );
    const r = unionManifests([a, b]);
    expect(r.isOk()).toBe(true);
    if (r.isErr()) return;
    expect(r.value.conflicts).toHaveLength(1);
    const conflict = r.value.conflicts[0];
    expect(conflict).toBeDefined();
    if (conflict === undefined) return;
    expect(conflict.type).toBe('version');
    expect(conflict.package).toBe('react');
    expect(conflict.values).toEqual({ 'repo-a': '^18.0.0', 'repo-b': '^17.0.0' });
    expect(conflict.severity).toBe('error');
    expect(conflict.suggestedResolution).toBeUndefined();
    const merged = asNpm(r.value.merged);
    expect(merged['dependencies']).toEqual({ react: '^18.0.0' });
  });
});

describe('P-108 merge: peer collisions are warnings', () => {
  it('marks peer range drift as type peer with warning severity', () => {
    const a = mustNpm(
      JSON.stringify({ peerDependencies: { react: '^18.0.0' } }),
      'repo-a/package.json'
    );
    const b = mustNpm(
      JSON.stringify({ peerDependencies: { react: '^17.0.0' } }),
      'repo-b/package.json'
    );
    const r = unionManifests([a, b]);
    expect(r.isOk()).toBe(true);
    if (r.isErr()) return;
    expect(r.value.conflicts).toHaveLength(1);
    const conflict = r.value.conflicts[0];
    expect(conflict).toBeDefined();
    if (conflict === undefined) return;
    expect(conflict.type).toBe('peer');
    expect(conflict.severity).toBe('warning');
    expect(conflict.values).toEqual({ 'repo-a': '^18.0.0', 'repo-b': '^17.0.0' });
  });

  it('flags peerDependenciesMeta flag drift as a peer warning', () => {
    const a = mustNpm(
      JSON.stringify({ peerDependenciesMeta: { typescript: { optional: true } } }),
      'repo-a/package.json'
    );
    const b = mustNpm(
      JSON.stringify({ peerDependenciesMeta: { typescript: {} } }),
      'repo-b/package.json'
    );
    const r = unionManifests([a, b]);
    expect(r.isOk()).toBe(true);
    if (r.isErr()) return;
    expect(r.value.conflicts).toHaveLength(1);
    const conflict = r.value.conflicts[0];
    expect(conflict).toBeDefined();
    if (conflict === undefined) return;
    expect(conflict.type).toBe('peer');
    expect(conflict.severity).toBe('warning');
  });
});

describe('P-108 merge: npm scripts', () => {
  it('keeps identical scripts, prefixes collisions, preserves unique ones', () => {
    const a = mustNpm(
      JSON.stringify({ scripts: { build: 'tsc', test: 'vitest run' } }),
      'repo-a/package.json'
    );
    const b = mustNpm(
      JSON.stringify({ scripts: { build: 'vite build', lint: 'eslint .' } }),
      'repo-b/package.json'
    );
    const r = unionManifests([a, b]);
    expect(r.isOk()).toBe(true);
    if (r.isErr()) return;
    const merged = asNpm(r.value.merged);
    expect(merged['scripts']).toEqual({
      test: 'vitest run',
      lint: 'eslint .',
      'repo-a:build': 'tsc',
      'repo-b:build': 'vite build',
    });
    expect(r.value.conflicts).toHaveLength(1);
    const conflict = r.value.conflicts[0];
    expect(conflict).toBeDefined();
    if (conflict === undefined) return;
    expect(conflict.type).toBe('script');
    expect(conflict.package).toBe('build');
    expect(conflict.severity).toBe('warning');
    expect(conflict.values).toEqual({ 'repo-a': 'tsc', 'repo-b': 'vite build' });
  });

  it('warns when a prefixed key is already taken by a real script', () => {
    const a = mustNpm(
      JSON.stringify({ scripts: { 'repo-a:build': 'custom', build: 'tsc' } }),
      'repo-a/package.json'
    );
    const b = mustNpm(JSON.stringify({ scripts: { build: 'vite build' } }), 'repo-b/package.json');
    const r = unionManifests([a, b]);
    expect(r.isOk()).toBe(true);
    if (r.isErr()) return;
    expect(r.value.conflicts).toHaveLength(1);
    expect(r.value.warnings.length).toBeGreaterThan(0);
  });
});

describe('P-108 merge: npm engines', () => {
  it('picks the higher semver value without a conflict', () => {
    const a = mustNpm(JSON.stringify({ engines: { node: '>=20.0.0' } }), 'repo-a/package.json');
    const b = mustNpm(JSON.stringify({ engines: { node: '>=18.0.0' } }), 'repo-b/package.json');
    const r = unionManifests([a, b]);
    expect(r.isOk()).toBe(true);
    if (r.isErr()) return;
    expect(r.value.conflicts).toEqual([]);
    const merged = asNpm(r.value.merged);
    expect(merged['engines']).toEqual({ node: '>=20.0.0' });
  });

  it('keeps the first value when both name the same version', () => {
    const a = mustNpm(JSON.stringify({ engines: { node: '>=20.0.0' } }), 'repo-a/package.json');
    const b = mustNpm(JSON.stringify({ engines: { node: '^20.0.0' } }), 'repo-b/package.json');
    const r = unionManifests([a, b]);
    expect(r.isOk()).toBe(true);
    if (r.isErr()) return;
    expect(r.value.conflicts).toEqual([]);
    const merged = asNpm(r.value.merged);
    expect(merged['engines']).toEqual({ node: '>=20.0.0' });
  });

  it('keeps first plus a warning when values are not comparable', () => {
    const a = mustNpm(JSON.stringify({ engines: { node: 'lts' } }), 'repo-a/package.json');
    const b = mustNpm(JSON.stringify({ engines: { node: 'ancient' } }), 'repo-b/package.json');
    const r = unionManifests([a, b]);
    expect(r.isOk()).toBe(true);
    if (r.isErr()) return;
    expect(r.value.conflicts).toEqual([]);
    const merged = asNpm(r.value.merged);
    expect(merged['engines']).toEqual({ node: 'lts' });
    expect(r.value.warnings.length).toBeGreaterThan(0);
  });
});

describe('P-108 merge: three manifests fold with origin labels', () => {
  it('names the two labels that set each colliding value', () => {
    const a = mustNpm(
      JSON.stringify({ dependencies: { react: '^18.0.0' } }),
      'repo-a/package.json'
    );
    const b = mustNpm(
      JSON.stringify({ dependencies: { react: '^17.0.0' } }),
      'repo-b/package.json'
    );
    const c = mustNpm(JSON.stringify({ dependencies: { axios: '^1.0.0' } }), 'repo-c/package.json');
    const r = unionManifests([a, b, c]);
    expect(r.isOk()).toBe(true);
    if (r.isErr()) return;
    expect(r.value.conflicts).toHaveLength(1);
    expect(r.value.conflicts[0]?.values).toEqual({ 'repo-a': '^18.0.0', 'repo-b': '^17.0.0' });
    const merged = asNpm(r.value.merged);
    expect(merged['dependencies']).toEqual({ react: '^18.0.0', axios: '^1.0.0' });
  });
});

describe('P-108 merge: single manifest and ordering', () => {
  it('merges a lone manifest with zero conflicts', () => {
    const r = unionManifests([mustNpm(NPM_A, 'repo-a/package.json')]);
    expect(r.isOk()).toBe(true);
    if (r.isErr()) return;
    expect(r.value.conflicts).toEqual([]);
    expect(r.value.warnings).toEqual([]);
  });

  it('sorts conflicts deterministically by package', () => {
    const a = mustNpm(
      JSON.stringify({ dependencies: { zlib: '1.0.0', axios: '1.0.0' } }),
      'a/package.json'
    );
    const b = mustNpm(
      JSON.stringify({ dependencies: { zlib: '2.0.0', axios: '2.0.0' } }),
      'b/package.json'
    );
    const r = unionManifests([a, b]);
    expect(r.isOk()).toBe(true);
    if (r.isErr()) return;
    expect(r.value.conflicts.map(c => c.package)).toEqual(['axios', 'zlib']);
  });
});

describe('P-108 merge: recordMerge helper', () => {
  it('unions disjoint keys without conflicts', () => {
    const out = recordMerge({ a: '1' }, { b: '2' }, 'repo-a', 'repo-b');
    expect(out).toEqual({ merged: { a: '1', b: '2' }, conflicts: [] });
  });

  it('keeps equal values once and conflicts on drift', () => {
    const out = recordMerge({ a: '1', c: '1' }, { a: '1', c: '2' }, 'repo-a', 'repo-b');
    expect(out.merged).toEqual({ a: '1', c: '1' });
    expect(out.conflicts).toEqual([
      {
        type: 'version',
        package: 'c',
        values: { 'repo-a': '1', 'repo-b': '2' },
        severity: 'error',
      },
    ]);
  });
});

const PY_A = [
  '[project]',
  'name = "a"',
  'version = "0.1.0"',
  'requires-python = ">=3.11"',
  'dependencies = [',
  '  "requests>=2.28.1",',
  '  "django[argon2]==4.2",',
  ']',
  '',
  '[project.optional-dependencies]',
  'test = ["pytest>=7.0"]',
].join('\n');

const PY_B = [
  '[project]',
  'name = "b"',
  'version = "0.2.0"',
  'requires-python = ">=3.12"',
  'dependencies = [',
  '  "django==4.2",',
  '  "httpx>=0.27.0",',
  ']',
].join('\n');

describe('P-108 merge: merges python extras', () => {
  it('unions extras, keeps equal specs, picks the higher pythonVersion', () => {
    const r = unionManifests([
      mustPython(PY_A, 'repo-a/pyproject.toml'),
      mustPython(PY_B, 'repo-b/pyproject.toml'),
    ]);
    expect(r.isOk()).toBe(true);
    if (r.isErr()) return;
    expect(r.value.conflicts).toEqual([]);
    const merged = r.value.merged;
    expect('source' in merged).toBe(true);
    if (!('source' in merged)) return;
    expect(merged.dependencies).toEqual({
      requests: '>=2.28.1',
      django: '==4.2',
      pytest: '>=7.0',
      httpx: '>=0.27.0',
    });
    expect(merged.extras).toEqual({ django: ['argon2'], test: ['pytest>=7.0'] });
    expect(merged.pythonVersion).toBe('>=3.12');
  });

  it('conflicts on divergent specs and warns on mixed sources', () => {
    const req = 'requests>=2.28.1\ndjango==4.2\n';
    const reqParsed = mustPython(req, 'repo-a/requirements.txt');
    const r = unionManifests([
      reqParsed,
      mustPython(PY_B.replace('"django==4.2",', '"django==5.0",'), 'repo-b/pyproject.toml'),
    ]);
    expect(r.isOk()).toBe(true);
    if (r.isErr()) return;
    const django = r.value.conflicts.find(c => c.package === 'django');
    expect(django).toBeDefined();
    expect(django?.severity).toBe('error');
    expect(r.value.warnings.some(w => w.includes('mixed python sources'))).toBe(true);
  });
});

const CARGO_A = [
  '[package]',
  'name = "crate-a"',
  'version = "0.1.0"',
  'edition = "2021"',
  '',
  '[dependencies]',
  'serde = "1.0"',
  'tokio = { version = "1.0", features = ["full"] }',
  '',
  '[features]',
  'default = ["serde"]',
].join('\n');

const CARGO_B = [
  '[package]',
  'name = "crate-b"',
  'version = "0.2.0"',
  '',
  '[dependencies]',
  'serde = { version = "1.0", features = ["derive"] }',
  'tokio = { version = "1.0", features = ["full"] }',
  'anyhow = "1.0"',
  '',
  '[features]',
  'extra = ["anyhow"]',
].join('\n');

describe('P-108 merge: cargo', () => {
  it('treats string and same-version table forms as equal and unions features', () => {
    const r = unionManifests([
      mustCargo(CARGO_A, 'repo-a/Cargo.toml'),
      mustCargo(CARGO_B, 'repo-b/Cargo.toml'),
    ]);
    expect(r.isOk()).toBe(true);
    if (r.isErr()) return;
    expect(r.value.conflicts).toEqual([]);
    const merged = r.value.merged;
    expect('package' in merged).toBe(true);
    if (!('package' in merged)) return;
    expect(merged.dependencies['serde']).toEqual({ version: '1.0', features: ['derive'] });
    expect(merged.dependencies['anyhow']).toBe('1.0');
    expect(merged.features).toEqual({ default: ['serde'], extra: ['anyhow'] });
    expect(r.value.warnings.some(w => w.includes('cargo package identity differs'))).toBe(true);
  });

  it('conflicts when versions differ, displaying both sides', () => {
    const c = mustCargo(
      [
        '[package]',
        'name = "crate-c"',
        'version = "0.3.0"',
        '',
        '[dependencies]',
        'serde = "2.0"',
      ].join('\n'),
      'repo-c/Cargo.toml'
    );
    const r = unionManifests([mustCargo(CARGO_A, 'repo-a/Cargo.toml'), c]);
    expect(r.isOk()).toBe(true);
    if (r.isErr()) return;
    const conflict = r.value.conflicts.find(cc => cc.package === 'serde');
    expect(conflict).toBeDefined();
    expect(conflict?.type).toBe('version');
    expect(conflict?.severity).toBe('error');
    expect(conflict?.values).toEqual({ 'repo-a': '1.0', 'repo-b': '2.0' });
  });
});

const GO_A = [
  'module example.com/a',
  '',
  'go 1.21',
  '',
  'require (',
  '\tgithub.com/spf13/cobra v1.8.0',
  '\tgithub.com/inconshreveable/mousetrap v1.1.0 // indirect',
  ')',
].join('\n');

const GO_B = [
  'module example.com/a',
  '',
  'go 1.22',
  '',
  'require (',
  '\tgithub.com/spf13/cobra v1.8.0',
  '\tgithub.com/spf13/pflag v1.0.5 // indirect',
  ')',
].join('\n');

describe('P-108 merge: merges go require with indirect preserved', () => {
  it('unions require maps and indirect sets, picks the higher goVersion', () => {
    const r = unionManifests([mustGo(GO_A, 'repo-a/go.mod'), mustGo(GO_B, 'repo-b/go.mod')]);
    expect(r.isOk()).toBe(true);
    if (r.isErr()) return;
    expect(r.value.conflicts).toEqual([]);
    const merged = r.value.merged;
    expect('module' in merged).toBe(true);
    if (!('module' in merged)) return;
    expect(merged.require).toEqual({
      'github.com/spf13/cobra': 'v1.8.0',
      'github.com/inconshreveable/mousetrap': 'v1.1.0',
      'github.com/spf13/pflag': 'v1.0.5',
    });
    expect(merged.indirect).toEqual(
      new Set(['github.com/inconshreveable/mousetrap', 'github.com/spf13/pflag'])
    );
    expect(merged.goVersion).toBe('1.22');
  });

  it('conflicts on same-old/different-new replace targets', () => {
    const a = mustGo(
      [
        'module example.com/a',
        '',
        'go 1.21',
        '',
        'replace example.com/old => example.com/new v1.0.0',
      ].join('\n'),
      'repo-a/go.mod'
    );
    const b = mustGo(
      [
        'module example.com/a',
        '',
        'go 1.21',
        '',
        'replace example.com/old => example.com/other v2.0.0',
      ].join('\n'),
      'repo-b/go.mod'
    );
    const r = unionManifests([a, b]);
    expect(r.isOk()).toBe(true);
    if (r.isErr()) return;
    expect(r.value.conflicts).toHaveLength(1);
    const conflict = r.value.conflicts[0];
    expect(conflict).toBeDefined();
    if (conflict === undefined) return;
    expect(conflict.severity).toBe('error');
    expect(conflict.values).toEqual({
      'repo-a': 'example.com/new v1.0.0',
      'repo-b': 'example.com/other v2.0.0',
    });
  });

  it('warns when module paths differ and keeps the first', () => {
    const b = mustGo(GO_B.replace('module example.com/a', 'module example.com/b'), 'repo-b/go.mod');
    const r = unionManifests([mustGo(GO_A, 'repo-a/go.mod'), b]);
    expect(r.isOk()).toBe(true);
    if (r.isErr()) return;
    const merged = r.value.merged;
    expect('module' in merged).toBe(true);
    if (!('module' in merged)) return;
    expect(merged.module).toBe('example.com/a');
    expect(r.value.warnings.some(w => w.includes('go module differs'))).toBe(true);
  });
});

describe('P-108 merge: errors on ecosystem mismatch', () => {
  it('returns ECOSYSTEM_MISMATCH with the sorted ecosystem list', () => {
    const r = unionManifests([
      mustNpm(NPM_A, 'repo-a/package.json'),
      mustPython(PY_A, 'repo-b/pyproject.toml'),
    ]);
    expect(r.isErr()).toBe(true);
    if (r.isOk()) return;
    expect(r.error.code).toBe('ECOSYSTEM_MISMATCH');
    if (r.error.code === 'ECOSYSTEM_MISMATCH') {
      expect(r.error.ecosystems).toEqual(['npm', 'python']);
    }
  });

  it('rejects an empty input with CONFIG_ERROR', () => {
    const r = unionManifests([]);
    expect(r.isErr()).toBe(true);
    if (r.isOk()) return;
    expect(r.error.code).toBe('CONFIG_ERROR');
  });
});

describe('P-108 merge: sourceLabel', () => {
  it('labels positionally with spreadsheet rollover past z', () => {
    expect(sourceLabel(0)).toBe('repo-a');
    expect(sourceLabel(1)).toBe('repo-b');
    expect(sourceLabel(25)).toBe('repo-z');
    expect(sourceLabel(26)).toBe('repo-aa');
  });
});
