// P-112 tests: scripts merge collisions are prefixed, identical
// values are kept once, unique scripts are preserved, and pre/post
// hooks follow the same prefix logic as their base script.
import { describe, expect, it } from 'vitest';
import { mergeScripts } from './scripts.js';
import { parsePackageJson } from './parse/npm.js';
import { unionManifests } from './merge.js';
import type { ParsedManifest } from './types.js';

function mustNpm(content: string, path: string): ParsedManifest {
  const r = parsePackageJson(content, path);
  expect(r.isOk()).toBe(true);
  if (r.isErr()) throw new Error(`npm fixture failed to parse: ${path}`);
  return r.value;
}

describe('P-112 scripts: mergeScripts pure helper', () => {
  it('prefixes colliding scripts', () => {
    const result = mergeScripts(
      { build: 'tsc' },
      { build: 'vite build' },
      { prefixA: 'repo-a', prefixB: 'repo-b' }
    );
    expect(result.merged).toEqual({ 'repo-a:build': 'tsc', 'repo-b:build': 'vite build' });
    expect(result.conflicts).toHaveLength(1);
    const c = result.conflicts[0];
    expect(c).toBeDefined();
    if (c === undefined) return;
    expect(c.type).toBe('script');
    expect(c.package).toBe('build');
    expect(c.values).toEqual({ 'repo-a': 'tsc', 'repo-b': 'vite build' });
    expect(c.severity).toBe('warning');
  });

  it('keeps identical scripts', () => {
    const result = mergeScripts(
      { test: 'vitest' },
      { test: 'vitest' },
      { prefixA: 'repo-a', prefixB: 'repo-b' }
    );
    expect(result.merged).toEqual({ test: 'vitest' });
    expect(result.conflicts).toEqual([]);
  });

  it('preserves unique scripts', () => {
    const result = mergeScripts(
      { prepare: 'husky' },
      { dev: 'vite' },
      { prefixA: 'repo-a', prefixB: 'repo-b' }
    );
    expect(result.merged).toEqual({ prepare: 'husky', dev: 'vite' });
    expect(result.conflicts).toEqual([]);

    // Unique on one side only
    const onlyA = mergeScripts({ build: 'tsc' }, undefined, {
      prefixA: 'repo-a',
      prefixB: 'repo-b',
    });
    expect(onlyA.merged).toEqual({ build: 'tsc' });
    expect(onlyA.conflicts).toEqual([]);

    const onlyB = mergeScripts(
      undefined,
      { build: 'tsc' },
      { prefixA: 'repo-a', prefixB: 'repo-b' }
    );
    expect(onlyB.merged).toEqual({ build: 'tsc' });
    expect(onlyB.conflicts).toEqual([]);
  });

  it('handles pre/post hooks', () => {
    // Base build collides, hooks also collide with differing bodies
    const a = { build: 'tsc', prebuild: 'clean', postbuild: 'echo done', test: 'vitest' };
    const b = {
      build: 'vite build',
      prebuild: 'rimraf dist',
      postbuild: 'echo done',
      lint: 'eslint',
    };
    const result = mergeScripts(a, b, { prefixA: 'repo-a', prefixB: 'repo-b' });
    expect(result.merged).toEqual({
      test: 'vitest',
      lint: 'eslint',
      'repo-a:build': 'tsc',
      'repo-b:build': 'vite build',
      'repo-a:prebuild': 'clean',
      'repo-b:prebuild': 'rimraf dist',
      // postbuild identical -> kept once
      postbuild: 'echo done',
    });
    // Two collisions: build and prebuild (postbuild identical => no conflict)
    expect(result.conflicts).toHaveLength(2);
    const pkgs = result.conflicts.map(c => c.package).sort();
    expect(pkgs).toEqual(['build', 'prebuild']);

    // All hooks identical -> no conflict
    const identicalHooks = mergeScripts(
      { prebuild: 'clean', build: 'tsc', postbuild: 'done' },
      { prebuild: 'clean', build: 'tsc', postbuild: 'done' },
      { prefixA: 'repo-a', prefixB: 'repo-b' }
    );
    expect(identicalHooks.merged).toEqual({ prebuild: 'clean', build: 'tsc', postbuild: 'done' });
    expect(identicalHooks.conflicts).toEqual([]);
  });

  it('preserves insertion order: unique first, prefixed after', () => {
    const a = { test: 'vitest', build: 'tsc' };
    const b = { build: 'vite build', dev: 'vite' };
    const result = mergeScripts(a, b, { prefixA: 'repo-a', prefixB: 'repo-b' });
    const keys = Object.keys(result.merged);
    // Unique 'test' and 'dev' should appear before prefixed collisions
    expect(keys).toEqual(['test', 'repo-a:build', 'repo-b:build', 'dev']);
  });

  it('does not mutate inputs', () => {
    const a = { build: 'tsc' };
    const b = { build: 'vite build' };
    const copyA = { ...a };
    const copyB = { ...b };
    mergeScripts(a, b, { prefixA: 'repo-a', prefixB: 'repo-b' });
    expect(a).toEqual(copyA);
    expect(b).toEqual(copyB);
  });
});

describe('P-112 scripts: end-to-end via merge', () => {
  it('prefixes colliding build scripts end-to-end', () => {
    const a = mustNpm(JSON.stringify({ scripts: { build: 'tsc' } }), 'repo-a/package.json');
    const b = mustNpm(JSON.stringify({ scripts: { build: 'vite build' } }), 'repo-b/package.json');
    const r = unionManifests([a, b]);
    expect(r.isOk()).toBe(true);
    if (r.isErr()) return;
    const merged = r.value.merged;
    expect('scripts' in merged).toBe(true);
    if (!('scripts' in merged)) return;
    expect(merged.scripts).toEqual({ 'repo-a:build': 'tsc', 'repo-b:build': 'vite build' });
    expect(r.value.conflicts).toHaveLength(1);
    const c = r.value.conflicts[0];
    expect(c).toBeDefined();
    if (c === undefined) return;
    expect(c.type).toBe('script');
    expect(c.severity).toBe('warning');
    expect(c.values).toEqual({ 'repo-a': 'tsc', 'repo-b': 'vite build' });
  });

  it('keeps identical scripts without conflict end-to-end', () => {
    const a = mustNpm(JSON.stringify({ scripts: { test: 'vitest' } }), 'repo-a/package.json');
    const b = mustNpm(JSON.stringify({ scripts: { test: 'vitest' } }), 'repo-b/package.json');
    const r = unionManifests([a, b]);
    expect(r.isOk()).toBe(true);
    if (r.isErr()) return;
    const merged = r.value.merged;
    expect('scripts' in merged).toBe(true);
    if (!('scripts' in merged)) return;
    expect(merged.scripts).toEqual({ test: 'vitest' });
    expect(r.value.conflicts).toEqual([]);
  });

  it('preserves unique scripts without prefix end-to-end', () => {
    const a = mustNpm(JSON.stringify({ scripts: { prepare: 'husky' } }), 'repo-a/package.json');
    const b = mustNpm(JSON.stringify({ scripts: { dev: 'vite' } }), 'repo-b/package.json');
    const r = unionManifests([a, b]);
    expect(r.isOk()).toBe(true);
    if (r.isErr()) return;
    const merged = r.value.merged;
    expect('scripts' in merged).toBe(true);
    if (!('scripts' in merged)) return;
    expect(merged.scripts).toEqual({ prepare: 'husky', dev: 'vite' });
    expect(r.value.conflicts).toEqual([]);
  });

  it('handles pre/post hooks end-to-end', () => {
    const a = mustNpm(
      JSON.stringify({ scripts: { build: 'tsc', prebuild: 'clean', postbuild: 'done' } }),
      'repo-a/package.json'
    );
    const b = mustNpm(
      JSON.stringify({ scripts: { build: 'vite build', prebuild: 'rimraf', postbuild: 'done' } }),
      'repo-b/package.json'
    );
    const r = unionManifests([a, b]);
    expect(r.isOk()).toBe(true);
    if (r.isErr()) return;
    const merged = r.value.merged;
    expect('scripts' in merged).toBe(true);
    if (!('scripts' in merged)) return;
    expect(merged.scripts).toEqual({
      'repo-a:build': 'tsc',
      'repo-b:build': 'vite build',
      'repo-a:prebuild': 'clean',
      'repo-b:prebuild': 'rimraf',
      postbuild: 'done',
    });
    expect(r.value.conflicts).toHaveLength(2);
  });
});
