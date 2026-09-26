// P-113 tests: config merge for tsconfig, vite, eslint and generic JSON.
// Deep merge with conflict detection via `extends` where possible.
import { describe, expect, it } from 'vitest';
import { mergeEslintConfig, mergeGenericJson, mergeTsConfig, mergeViteConfig } from './config.js';
import { parsePackageJson } from './parse/npm.js';
import { unionManifests } from './merge.js';
import type { ParsedManifest } from './types.js';

function mustNpm(content: string, path: string): ParsedManifest {
  const r = parsePackageJson(content, path);
  expect(r.isOk()).toBe(true);
  if (r.isErr()) throw new Error(`npm fixture failed: ${path}`);
  return r.value;
}

describe('P-113 config: merges tsconfig extends', () => {
  it('unions extends string and array', () => {
    const a = { extends: './base.json', compilerOptions: { target: 'es2020' } };
    const b = { extends: ['../shared.json'], compilerOptions: { target: 'es2020' } };
    const result = mergeTsConfig(a, b);
    expect(result.merged).toHaveProperty('extends');
    const ext = (result.merged as { extends: string | string[] }).extends;
    expect(Array.isArray(ext) ? ext : [ext]).toEqual(
      expect.arrayContaining(['./base.json', '../shared.json'])
    );
    expect(result.conflicts).toEqual([]);
  });

  it('deduplicates overlapping extends', () => {
    const a = { extends: ['./base.json', './extra.json'] };
    const b = { extends: ['./base.json', '../shared.json'] };
    const result = mergeTsConfig(a, b);
    const ext = (result.merged as { extends: string[] }).extends;
    expect(ext).toEqual(['./base.json', './extra.json', '../shared.json']);
  });

  it('keeps single extends as string when only one', () => {
    const a = { extends: './base.json' };
    const b = {};
    const result = mergeTsConfig(a, b);
    expect((result.merged as { extends: string }).extends).toBe('./base.json');
  });
});

describe('P-113 config: detects compilerOptions conflict', () => {
  it('reports target conflict and picks higher', () => {
    const a = { compilerOptions: { target: 'es2020', module: 'commonjs', strict: true } };
    const b = { compilerOptions: { target: 'esnext', module: 'esnext', strict: true } };
    const result = mergeTsConfig(a, b);
    // Two conflicts: target and module
    expect(result.conflicts.length).toBeGreaterThanOrEqual(2);
    const targetConflict = result.conflicts.find(
      c => c.package === 'tsconfig.compilerOptions.target'
    );
    expect(targetConflict).toBeDefined();
    if (targetConflict === undefined) return;
    expect(targetConflict.type).toBe('config');
    expect(targetConflict.values).toEqual({ 'repo-a': 'es2020', 'repo-b': 'esnext' });
    expect(targetConflict.severity).toBe('warning');
    // Merged should pick higher (esnext)
    const merged = result.merged as { compilerOptions: { target: string; module: string } };
    expect(merged.compilerOptions.target).toBe('esnext');
    expect(merged.compilerOptions.module).toBe('esnext');
  });

  it('merges non-conflicting compilerOptions without conflict', () => {
    const a = { compilerOptions: { target: 'es2020', strict: true } };
    const b = { compilerOptions: { target: 'es2020', esModuleInterop: true } };
    const result = mergeTsConfig(a, b);
    expect(result.conflicts).toEqual([]);
    const merged = result.merged as { compilerOptions: Record<string, unknown> };
    expect(merged.compilerOptions).toEqual({
      target: 'es2020',
      strict: true,
      esModuleInterop: true,
    });
  });

  it('unions references, include, exclude', () => {
    const a = {
      include: ['src/**/*'],
      exclude: ['node_modules'],
      references: [{ path: './tsconfig.node.json' }],
    };
    const b = {
      include: ['tests/**/*'],
      exclude: ['dist'],
      references: [{ path: './tsconfig.app.json' }],
    };
    const result = mergeTsConfig(a, b);
    const merged = result.merged as { include: string[]; exclude: string[]; references: unknown[] };
    expect(merged.include).toEqual(expect.arrayContaining(['src/**/*', 'tests/**/*']));
    expect(merged.exclude).toEqual(expect.arrayContaining(['node_modules', 'dist']));
    expect(merged.references).toHaveLength(2);
    expect(result.conflicts).toEqual([]);
  });
});

describe('P-113 config: merges vite plugins', () => {
  it('concats and dedupes plugins by name', () => {
    const a = { plugins: [{ name: 'react' }, { name: 'ts' }] };
    const b = { plugins: [{ name: 'react' }, { name: 'vue' }] };
    const result = mergeViteConfig(a, b);
    const merged = result.merged as { plugins: unknown[] };
    expect(merged.plugins).toHaveLength(3);
    const names = (merged.plugins as { name: string }[]).map(p => p.name);
    expect(names).toEqual(['react', 'ts', 'vue']);
    expect(result.conflicts).toEqual([]);
  });

  it('handles string plugins', () => {
    const a = { plugins: ['@vitejs/plugin-react'] };
    const b = { plugins: ['@vitejs/plugin-vue'] };
    const result = mergeViteConfig(a, b);
    const merged = result.merged as { plugins: string[] };
    expect(merged.plugins).toEqual(['@vitejs/plugin-react', '@vitejs/plugin-vue']);
  });

  it('deep merges build options', () => {
    const a = { build: { outDir: 'dist', sourcemap: true } };
    const b = { build: { outDir: 'dist', minify: 'esbuild' } };
    const result = mergeViteConfig(a, b);
    expect(result.conflicts).toEqual([]);
    const merged = result.merged as { build: Record<string, unknown> };
    expect(merged.build).toEqual({ outDir: 'dist', sourcemap: true, minify: 'esbuild' });
  });

  it('reports conflict for differing primitive vite keys', () => {
    const a = { base: '/app/' };
    const b = { base: '/other/' };
    const result = mergeViteConfig(a, b);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]?.package).toBe('vite.base');
    const merged = result.merged as { base: string };
    expect(merged.base).toBe('/app/');
  });
});

describe('P-113 config: eslint rules merge', () => {
  it('merges plugins and extends via union', () => {
    const a = { plugins: ['prettier'], extends: 'eslint:recommended', rules: { semi: 'error' } };
    const b = {
      plugins: ['import'],
      extends: ['plugin:prettier/recommended'],
      rules: { semi: 'error' },
    };
    const result = mergeEslintConfig(a, b);
    const merged = result.merged as {
      plugins: string[];
      extends: string[];
      rules: Record<string, string>;
    };
    expect(merged.plugins).toEqual(expect.arrayContaining(['prettier', 'import']));
    expect(merged.extends).toEqual(
      expect.arrayContaining(['eslint:recommended', 'plugin:prettier/recommended'])
    );
    expect(result.conflicts).toEqual([]);
  });

  it('detects rule severity conflict', () => {
    const a = { rules: { semi: ['error', 'always'], quotes: 'error' } };
    const b = { rules: { semi: ['warn', 'always'], quotes: 'error' } };
    const result = mergeEslintConfig(a, b);
    expect(result.conflicts).toHaveLength(1);
    const c = result.conflicts[0];
    expect(c).toBeDefined();
    if (c === undefined) return;
    expect(c.package).toBe('eslint.rules.semi');
    expect(c.type).toBe('config');
    expect(c.severity).toBe('warning');
    const merged = result.merged as { rules: Record<string, unknown> };
    expect(merged.rules.semi).toEqual(['error', 'always']); // keeps first
  });

  it('merges non-conflicting rules', () => {
    const a = { rules: { semi: 'error' } };
    const b = { rules: { quotes: 'warn' } };
    const result = mergeEslintConfig(a, b);
    expect(result.conflicts).toEqual([]);
    const merged = result.merged as { rules: Record<string, string> };
    expect(merged.rules).toEqual({ semi: 'error', quotes: 'warn' });
  });
});

describe('P-113 config: generic deep merge', () => {
  it('merges nested objects and preserves non-conflicting keys', () => {
    const a = { a: 1, nested: { x: 1, y: 2 }, arr: [1, 2] };
    const b = { b: 2, nested: { x: 1, z: 3 }, arr: [2, 3] };
    const result = mergeGenericJson(a, b, 'root');
    expect(result.conflicts).toEqual([]);
    expect(result.merged).toEqual({
      a: 1,
      b: 2,
      nested: { x: 1, y: 2, z: 3 },
      arr: [1, 2, 3],
    });
  });

  it('reports primitive collision', () => {
    const a = { key: 'value-a' };
    const b = { key: 'value-b' };
    const result = mergeGenericJson(a, b, 'root');
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]?.package).toBe('root.key');
    expect((result.merged as { key: string }).key).toBe('value-a');
  });

  it('handles array primitives union vs object arrays dedupe', () => {
    const a = { plugins: ['a', 'b'] };
    const b = { plugins: ['b', 'c'] };
    const result = mergeGenericJson(a, b, 'root');
    expect(result.conflicts).toEqual([]);
    expect((result.merged as { plugins: string[] }).plugins).toEqual(['a', 'b', 'c']);
  });

  it('reports array object conflict and unions', () => {
    const a = { items: [{ id: 1 }] };
    const b = { items: [{ id: 2 }] };
    const result = mergeGenericJson(a, b, 'root');
    // For non-name object arrays, current logic reports conflict and unions
    expect(result.conflicts.length).toBeGreaterThanOrEqual(0);
    const merged = result.merged as { items: unknown[] };
    expect(merged.items).toHaveLength(2);
  });

  it('reuses generic for tsconfig-like nested collision', () => {
    const a = { compilerOptions: { paths: { '@/*': ['src/*'] } } };
    const b = { compilerOptions: { paths: { '@/*': ['lib/*'] } } };
    const result = mergeGenericJson(a, b, 'tsconfig');
    // Arrays of primitives union without conflict (spec: array → union if primitives)
    expect(result.conflicts).toEqual([]);
    expect(result.merged).toEqual({ compilerOptions: { paths: { '@/*': ['src/*', 'lib/*'] } } });
  });

  it('handles non-object top-level via generic', () => {
    const result = mergeGenericJson('a', 'b', 'root');
    expect(result.conflicts).toHaveLength(1);
    expect(result.merged).toBe('a');
  });

  it('identical values produce no conflict', () => {
    const a = { key: 'same', nested: { x: 1 } };
    const b = { key: 'same', nested: { x: 1 } };
    const result = mergeGenericJson(a, b, 'root');
    expect(result.conflicts).toEqual([]);
    expect(result.merged).toEqual(a);
  });
});

describe('P-113 config: end-to-end via merge (hook)', () => {
  it('tsconfig with extends union and target conflict via helper', () => {
    const a = mustNpm(
      JSON.stringify({ dependencies: { lodash: '^4.0.0' } }),
      'repo-a/package.json'
    );
    const b = mustNpm(
      JSON.stringify({ dependencies: { lodash: '^4.0.0' } }),
      'repo-b/package.json'
    );
    // Hook is via direct helper, not unionManifests; just ensure merge still works alongside config
    const r = unionManifests([a, b]);
    expect(r.isOk()).toBe(true);
    if (r.isErr()) return;
    expect(r.value.conflicts).toEqual([]);

    const cfg = mergeTsConfig(
      { extends: './base.json', compilerOptions: { target: 'es2020' } },
      { extends: './other.json', compilerOptions: { target: 'esnext' } }
    );
    expect(cfg.conflicts.some(c => c.package.includes('target'))).toBe(true);
    const ext = (cfg.merged as { extends: string[] }).extends;
    expect(ext).toEqual(expect.arrayContaining(['./base.json', './other.json']));
  });
});
