// P-104 tests: npm package.json parse + serialize. Covers the five
// spec-required cases (all dep fields, missing fields, invalid JSON,
// stable-order snapshot, both workspace shapes) plus edge cases: empty
// content (FILE_NOT_FOUND), non-object roots, zod type violations,
// full-line comment stripping, peerDependenciesMeta flags, and the
// parse -> serialize -> parse fixed point.
import { describe, expect, it } from 'vitest';
import { parsePackageJson, serializePackageJson } from './npm.js';

const FULL_FIXTURE = JSON.stringify({
  name: 'fixture',
  version: '1.2.3',
  private: true,
  dependencies: { react: '^18.0.0', lodash: '~4.17.21' },
  devDependencies: { vitest: '^5.0.0' },
  peerDependencies: { typescript: '>=5.0.0' },
  peerDependenciesMeta: { typescript: { optional: true } },
  optionalDependencies: { fsevents: '^2.3.3' },
  scripts: { build: 'tsup', test: 'vitest run' },
  engines: { node: '>=20.0.0' },
  overrides: { semver: '^7.8.5' },
  workspaces: ['packages/*'],
});

describe('P-104 npm: parses all dep fields', () => {
  it('returns ok with a typed manifest for a full package.json', () => {
    const r = parsePackageJson(FULL_FIXTURE, 'package.json');
    expect(r.isOk()).toBe(true);
    if (r.isOk() && r.value.ecosystem === 'npm') {
      expect(r.value.ecosystem).toBe('npm');
      expect(r.value.path).toBe('package.json');
      expect(r.value.manifest.dependencies).toEqual({
        react: '^18.0.0',
        lodash: '~4.17.21',
      });
      expect(r.value.manifest.devDependencies).toEqual({ vitest: '^5.0.0' });
      expect(r.value.manifest.peerDependencies).toEqual({ typescript: '>=5.0.0' });
      expect(r.value.manifest.peerDependenciesMeta).toEqual({
        typescript: { optional: true },
      });
      expect(r.value.manifest.optionalDependencies).toEqual({ fsevents: '^2.3.3' });
      expect(r.value.manifest.scripts).toEqual({ build: 'tsup', test: 'vitest run' });
      expect(r.value.manifest.engines).toEqual({ node: '>=20.0.0' });
      expect(r.value.manifest.overrides).toEqual({ semver: '^7.8.5' });
      expect(r.value.manifest.workspaces).toEqual(['packages/*']);
    }
  });

  it('accepts the minimal acceptance example', () => {
    const r = parsePackageJson('{"dependencies":{"react":"^18.0.0"}}', 'package.json');
    expect(r.isOk()).toBe(true);
    if (r.isOk() && r.value.ecosystem === 'npm') {
      expect(r.value.manifest.dependencies).toEqual({ react: '^18.0.0' });
    }
  });
});

describe('P-104 npm: handles missing fields', () => {
  it('empty manifest yields normalized defaults without error', () => {
    const r = parsePackageJson('{}', 'package.json');
    expect(r.isOk()).toBe(true);
    if (r.isOk() && r.value.ecosystem === 'npm') {
      expect(r.value.manifest.dependencies).toEqual({});
      expect(r.value.manifest.devDependencies).toBeUndefined();
      expect(r.value.manifest.scripts).toBeUndefined();
      expect(r.value.manifest.workspaces).toBeUndefined();
    }
  });

  it('explicit empty dependencies normalize to {}', () => {
    const r = parsePackageJson('{"dependencies":{}}', 'package.json');
    expect(r.isOk()).toBe(true);
    if (r.isOk() && r.value.ecosystem === 'npm') expect(r.value.manifest.dependencies).toEqual({});
  });
});

describe('P-104 npm: returns error on invalid JSON', () => {
  it('malformed JSON maps to DEPS_PARSE_ERROR', () => {
    const r = parsePackageJson('{"dependencies": {oops', 'package.json');
    expect(r.isErr()).toBe(true);
    if (r.isErr()) {
      expect(r.error.code).toBe('DEPS_PARSE_ERROR');
      if (r.error.code === 'DEPS_PARSE_ERROR') {
        expect(r.error.file).toBe('package.json');
        expect(r.error.message).toContain('package.json');
      }
    }
  });

  it('non-object roots map to DEPS_PARSE_ERROR', () => {
    for (const content of ['[1, 2]', '"just a string"', '42', 'null']) {
      const r = parsePackageJson(content, 'package.json');
      expect(r.isErr()).toBe(true);
      if (r.isErr()) expect(r.error.code).toBe('DEPS_PARSE_ERROR');
    }
  });

  it('wrong field types map to DEPS_PARSE_ERROR with the field path', () => {
    const badName = parsePackageJson('{"name": 42}', 'package.json');
    expect(badName.isErr()).toBe(true);
    if (badName.isErr()) {
      expect(badName.error.code).toBe('DEPS_PARSE_ERROR');
      if (badName.error.code === 'DEPS_PARSE_ERROR') {
        expect(badName.error.message).toContain('name');
      }
    }
    const badDeps = parsePackageJson('{"dependencies": {"react": 18}}', 'package.json');
    expect(badDeps.isErr()).toBe(true);
    if (badDeps.isErr()) expect(badDeps.error.code).toBe('DEPS_PARSE_ERROR');
  });

  it('empty or whitespace-only content maps to FILE_NOT_FOUND', () => {
    for (const content of ['', '   \n  ']) {
      const r = parsePackageJson(content, 'missing/package.json');
      expect(r.isErr()).toBe(true);
      if (r.isErr()) {
        expect(r.error.code).toBe('FILE_NOT_FOUND');
        if (r.error.code === 'FILE_NOT_FOUND') {
          expect(r.error.path).toBe('missing/package.json');
        }
      }
    }
  });
});

describe('P-104 npm: serializes stable order', () => {
  it('snapshot', () => {
    const r = parsePackageJson(FULL_FIXTURE, 'package.json');
    expect(r.isOk()).toBe(true);
    if (r.isOk() && r.value.ecosystem === 'npm')
      expect(serializePackageJson(r.value.manifest)).toMatchSnapshot();
  });

  it('emits sections in canonical order with 2-space indent + trailing newline', () => {
    const r = parsePackageJson(FULL_FIXTURE, 'package.json');
    expect(r.isOk()).toBe(true);
    if (r.isOk() && r.value.ecosystem === 'npm') {
      const out = serializePackageJson(r.value.manifest);
      expect(out.endsWith('\n')).toBe(true);
      const keys = Object.keys(JSON.parse(out) as Record<string, unknown>);
      expect(keys).toEqual([
        'dependencies',
        'devDependencies',
        'peerDependencies',
        'optionalDependencies',
        'peerDependenciesMeta',
        'scripts',
        'engines',
        'overrides',
        'workspaces',
      ]);
    }
  });

  it('round-trips without data loss (parse -> serialize -> parse fixed point)', () => {
    const first = parsePackageJson(FULL_FIXTURE, 'package.json');
    expect(first.isOk()).toBe(true);
    if (first.isOk() && first.value.ecosystem === 'npm') {
      const second = parsePackageJson(serializePackageJson(first.value.manifest), 'package.json');
      expect(second.isOk()).toBe(true);
      if (second.isOk() && second.value.ecosystem === 'npm') {
        expect(second.value.manifest).toEqual(first.value.manifest);
      }
    }
  });
});

describe('P-104 npm: normalizes workspaces', () => {
  it('array shape passes through as a copy', () => {
    const r = parsePackageJson('{"workspaces": ["packages/*", "apps/*"]}', 'package.json');
    expect(r.isOk()).toBe(true);
    if (r.isOk() && r.value.ecosystem === 'npm')
      expect(r.value.manifest.workspaces).toEqual(['packages/*', 'apps/*']);
  });

  it('object shape unwraps { packages }', () => {
    const r = parsePackageJson('{"workspaces": {"packages": ["packages/*"]}}', 'package.json');
    expect(r.isOk()).toBe(true);
    if (r.isOk() && r.value.ecosystem === 'npm')
      expect(r.value.manifest.workspaces).toEqual(['packages/*']);
  });

  it('malformed workspaces fail validation', () => {
    const r = parsePackageJson('{"workspaces": {"globs": []}}', 'package.json');
    expect(r.isErr()).toBe(true);
    if (r.isErr()) expect(r.error.code).toBe('DEPS_PARSE_ERROR');
  });
});

describe('P-104 npm: defensive comment stripping', () => {
  it('full-line // comments are ignored', () => {
    const content = [
      '// leading comment',
      '{',
      '  // section comment',
      '  "dependencies": { "react": "^18.0.0" }',
      '}',
      '// trailing comment',
    ].join('\n');
    const r = parsePackageJson(content, 'package.json');
    expect(r.isOk()).toBe(true);
    if (r.isOk() && r.value.ecosystem === 'npm')
      expect(r.value.manifest.dependencies).toEqual({ react: '^18.0.0' });
  });

  it('a // inside a string value is preserved, not stripped', () => {
    const r = parsePackageJson('{"scripts": {"dl": "curl https://x/y"}}', 'package.json');
    expect(r.isOk()).toBe(true);
    if (r.isOk() && r.value.ecosystem === 'npm') {
      expect(r.value.manifest.scripts).toEqual({ dl: 'curl https://x/y' });
    }
  });
});

describe('P-104 npm: peerDependenciesMeta flags', () => {
  it('optional true survives; absent flag normalizes to {}', () => {
    const r = parsePackageJson(
      '{"peerDependenciesMeta": {"a": {"optional": true}, "b": {}}}',
      'package.json'
    );
    expect(r.isOk()).toBe(true);
    if (r.isOk() && r.value.ecosystem === 'npm') {
      expect(r.value.manifest.peerDependenciesMeta).toEqual({
        a: { optional: true },
        b: {},
      });
    }
  });
});
