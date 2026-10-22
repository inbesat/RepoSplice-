// P-340 — the heuristic fallback's contract, exercised against the real
// TypeScript fixture (the python/go/rust paths are measured by the python
// test through the harness, because this mirror must stay fast).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { err, ok } from 'neverthrow';
import {
  createHeuristicResolver,
  extractSpecifiers,
  languageForFile,
  lspEnabled,
  withHeuristicFallback,
} from './heuristic-fallback.js';
import type { DependencyResolver, ResolvedImport } from './types.js';
import type { StitchError } from '../result/index.js';

const TS_ROOT = join(import.meta.dirname, '..', '..', 'test-fixtures', 'ts-resolver-repo');

/** A primary resolver that behaves like a language server that exited. */
const dead: DependencyResolver = {
  language: 'typescript',
  resolve: async () =>
    err<ResolvedImport[], StitchError>({ code: 'INTERNAL', message: 'the language server exited' }),
  getCapabilities: () => ({ language: 'typescript', strategies: ['lsp-high'], lsp: 'configured' }),
  healthCheck: async () => ok({ healthy: true, lsp: 'available' }),
  shutdown: async () => ok(undefined),
};

describe('heuristic fallback (P-340)', () => {
  it('dispatches by file extension', () => {
    expect(languageForFile('a.ts')).toBe('typescript');
    expect(languageForFile('a.tsx')).toBe('typescript');
    expect(languageForFile('a.js')).toBe('javascript');
    expect(languageForFile('a.py')).toBe('python');
    expect(languageForFile('a.go')).toBe('go');
    expect(languageForFile('a.rs')).toBe('rust');
    expect(languageForFile('README.md')).toBeUndefined();
  });

  it('forces heuristic-only mode through the config flag', () => {
    expect(lspEnabled('auto')).toBe(true);
    expect(lspEnabled('never')).toBe(false);
  });

  it('extracts the specifiers of a TypeScript file with tree-sitter', async () => {
    const source = readFileSync(join(TS_ROOT, 'src', 'index.ts'), 'utf8');
    const extracted = await extractSpecifiers(source, 'typescript');
    expect(extracted.isOk()).toBe(true);
    if (extracted.isErr()) return;
    expect(extracted.value).toContain('./helper');
    expect(extracted.value).toContain('@app/aliased');
    expect(extracted.value).toContain('fake-pkg');
    expect(extracted.value).toContain('./reexport');
  });

  it('tags every fallback edge heuristic-medium', async () => {
    const resolver = createHeuristicResolver({ rootDir: TS_ROOT });
    const result = await resolver.resolve('src/index.ts', './helper');
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value[0]?.targetFile).toBe('src/helper.ts');
    expect(result.value[0]?.confidence).toBe('heuristic-medium');
  });

  it('resolves every import of a file', async () => {
    const resolver = createHeuristicResolver({ rootDir: TS_ROOT });
    const result = await resolver.resolveFile('src/index.ts');
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.length).toBeGreaterThanOrEqual(3);
    for (const edge of result.value) {
      expect(edge.confidence).toBe('heuristic-medium');
    }
  });

  it('falls back when the language server fails', async () => {
    const heuristic = createHeuristicResolver({ rootDir: TS_ROOT });
    const combined = withHeuristicFallback(dead, heuristic);
    const result = await combined.resolve('src/index.ts', './helper');
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value[0]?.targetFile).toBe('src/helper.ts');
    expect(result.value[0]?.confidence).toBe('heuristic-medium');
  });

  it('keeps a primary answer that already resolved', async () => {
    const primary: DependencyResolver = {
      language: 'typescript',
      resolve: async () =>
        ok<ResolvedImport[], StitchError>([
          { sourceFile: 'src/index.ts', targetFile: 'src/helper.ts', confidence: 'lsp-high' },
        ]),
      getCapabilities: () => ({
        language: 'typescript',
        strategies: ['lsp-high'],
        lsp: 'configured',
      }),
      healthCheck: async () => ok({ healthy: true, lsp: 'available' }),
      shutdown: async () => ok(undefined),
    };
    const combined = withHeuristicFallback(primary, createHeuristicResolver({ rootDir: TS_ROOT }));
    const result = await combined.resolve('src/index.ts', './helper');
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value[0]?.confidence).toBe('lsp-high');
  });

  it('returns no edges for a file it has no heuristic for', async () => {
    const resolver = createHeuristicResolver({ rootDir: TS_ROOT });
    const result = await resolver.resolve('README.md', './x');
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value).toEqual([]);
  });
});
