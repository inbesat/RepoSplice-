// P-034 tests: listFiles over a real tmp fixture tree — match,
// ignore, dotfiles, empty results, posix normalization, determinism,
// and abort mapping. No network; fully hermetic.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listFiles } from '../glob.js';

let root: string;

function touch(rel: string): void {
  const full = join(root, rel);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, 'x');
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'stitch-glob-test-'));
  touch(join('a.ts'));
  touch(join('b.js'));
  touch(join('sub', 'c.ts'));
  touch(join('sub', 'skip.md'));
  touch(join('sub', 'node_modules', 'dep', 'index.js'));
  touch(join('.hidden', 'secret.ts'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('P-034 listFiles: lists files (spec smoke test)', () => {
  it('matches a fixture tree and returns sorted absolute posix paths', async () => {
    const r = await listFiles(root, ['**/*.ts']);
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      expect(r.value).toHaveLength(2);
      expect(r.value[0]?.endsWith('/a.ts')).toBe(true);
      expect(r.value[1]?.endsWith('/sub/c.ts')).toBe(true);
      // Sorted + absolute + posix (no backslashes even on Windows).
      expect([...r.value].sort()).toEqual(r.value);
      for (const p of r.value) {
        expect(p.includes('\\')).toBe(false);
      }
    }
  });

  it('accepts a single pattern string', async () => {
    const r = await listFiles(root, '**/*.md');
    if (r.isErr()) throw r.error;
    expect(r.value).toHaveLength(1);
    expect(r.value[0]?.endsWith('/sub/skip.md')).toBe(true);
  });

  it('excludes directories by default (files only)', async () => {
    const r = await listFiles(root, ['sub/**']);
    if (r.isErr()) throw r.error;
    expect(r.value.length).toBeGreaterThan(0);
    for (const p of r.value) {
      expect(p.endsWith('/sub')).toBe(false);
    }
  });
});

describe('P-034 listFiles: respects ignore (spec smoke test)', () => {
  it('ignore pattern skips the node_modules subtree', async () => {
    const r = await listFiles(root, ['**/*.js'], { ignore: ['**/node_modules/**'] });
    if (r.isErr()) throw r.error;
    // b.js (top level) still matches; only the subtree is excluded.
    expect(r.value).toHaveLength(1);
    expect(r.value[0]?.endsWith('/b.js')).toBe(true);
  });

  it('without ignore, node_modules files match', async () => {
    const r = await listFiles(root, ['**/node_modules/**/*.js']);
    if (r.isErr()) throw r.error;
    expect(r.value).toHaveLength(1);
    expect(r.value[0]?.endsWith('/sub/node_modules/dep/index.js')).toBe(true);
  });

  it('accepts multiple ignore patterns', async () => {
    const r = await listFiles(root, ['sub/**/*'], { ignore: ['**/*.md', '**/node_modules/**'] });
    if (r.isErr()) throw r.error;
    expect(r.value).toHaveLength(1);
    expect(r.value[0]?.endsWith('/sub/c.ts')).toBe(true);
  });
});

describe('P-034 listFiles: dotfiles + empty results', () => {
  it('excludes dotfiles by default', async () => {
    const r = await listFiles(root, ['**/*.ts']);
    if (r.isErr()) throw r.error;
    expect(r.value.some(p => p.includes('.hidden'))).toBe(false);
  });

  it('dot:true includes dotfiles', async () => {
    const r = await listFiles(root, ['**/*.ts'], { dot: true });
    if (r.isErr()) throw r.error;
    expect(r.value.some(p => p.endsWith('/.hidden/secret.ts'))).toBe(true);
  });

  it('no match resolves to ok([]), not err', async () => {
    const r = await listFiles(root, ['**/*.zzz-nope']);
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      expect(r.value).toEqual([]);
    }
  });

  it('missing dir resolves to ok([]), not err', async () => {
    const r = await listFiles(join(root, 'nope-missing'), ['**/*.ts']);
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      expect(r.value).toEqual([]);
    }
  });

  it('empty patterns resolve to ok([]), not err', async () => {
    const r = await listFiles(root, []);
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      expect(r.value).toEqual([]);
    }
  });
});

describe('P-034 listFiles: abort maps to err', () => {
  it('an aborted signal returns err(INTERNAL)', async () => {
    const r = await listFiles(root, ['**/*.ts'], { signal: AbortSignal.abort() });
    expect(r.isErr()).toBe(true);
    if (r.isErr()) {
      expect(r.error.code).toBe('INTERNAL');
    }
  });
});
