// P-343 tests: the public resolver-entry drives the P-149 closure walk.
//
// The walk still lives in `agent/tools/resolve_deps.ts`; this module is the
// thin public entry that owns the P-341 registry wiring. The fixture workspace
// is the real TS ground-truth repo (copied to a temp dir with its fake
// node_modules package), so the registry answers with real edges.

import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ok } from 'neverthrow';
import { createResolverRegistry } from '../resolve/registry.js';
import { defaultResolverRegistry, resolveDependencyClosure } from './resolve-dependency-closure.js';
import { resolveDependenciesForFiles } from '../agent/tools/resolve_deps.js';
import type { SelectedFile, SourceRepo } from '../agent/index.js';
import type { ToolContext } from '../ai/types.js';
import type { Result } from 'neverthrow';
import type { StitchError } from '../result/index.js';

const FIXTURE_ROOT = join(import.meta.dirname, '..', '..', 'test-fixtures', 'ts-resolver-repo');

/**
 * Every TRACKED file under `root`, as posix relative paths.
 * `node_modules` is skipped, the way a real `git ls-files` would ignore it —
 * an internal edge must point at a file the repo actually tracks.
 */
function listAll(root: string): string[] {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else files.push(relative(root, full).split(sep).join('/'));
    }
  };
  walk(root);
  return files;
}

/** A ToolContext whose git facade reads a real directory. */
function ctxFor(root: string, manifest: Record<string, string> = {}): ToolContext {
  const inert = {
    diff: async (): Promise<string> => '',
    status: async (): Promise<string> => '',
    commit: async (): Promise<void> => {},
    add: async (): Promise<void> => {},
    analyze: async (): Promise<Record<string, string>> => manifest,
    install: async (): Promise<void> => {},
    scan: async (): Promise<string[]> => [],
    check: async (): Promise<boolean> => true,
  };
  return {
    cwd: root,
    config: {},
    logger: { ...inert, info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    costTracker: { ...inert, add: () => {}, totalTokens: { input: 0, output: 0, total: 0 } },
    git: {
      ...inert,
      listFiles: async (_cwd: string, _repo: 'A' | 'B'): Promise<Result<string[], StitchError>> =>
        ok(listAll(root)),
      readFile: async (
        _cwd: string,
        _repo: 'A' | 'B',
        path: string
      ): Promise<Result<string, StitchError>> => {
        try {
          return ok(readFileSync(join(root, path), 'utf8'));
        } catch {
          return ok('');
        }
      },
    },
    deps: inert,
    license: inert,
  } as unknown as ToolContext;
}

function sel(path: string, repo: SourceRepo = 'A'): SelectedFile {
  return { repo, path };
}

describe('P-343 resolve_dependency_closure integration', () => {
  let workspace = '';

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'stitch-resolve-tool-'));
    cpSync(join(FIXTURE_ROOT, 'src'), join(workspace, 'src'), { recursive: true });
    cpSync(join(FIXTURE_ROOT, 'tsconfig.json'), join(workspace, 'tsconfig.json'));
    mkdirSync(join(workspace, 'node_modules'), { recursive: true });
    cpSync(join(FIXTURE_ROOT, 'fake-pkg'), join(workspace, 'node_modules', 'fake-pkg'), {
      recursive: true,
    });
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  it('resolves internal edges through the registry with confidence tags', async () => {
    const registry = createResolverRegistry({ rootDir: workspace, lspMode: 'never' });
    const result = await resolveDependencyClosure([sel('src/index.ts')], ctxFor(workspace), {
      registry,
    });
    expect(result.isOk()).toBe(true);
    const closure = result.isOk() ? result.value : undefined;
    expect(closure).toBeDefined();
    const edges = closure?.resolvedEdges ?? [];
    expect(edges.length).toBeGreaterThan(0);
    const helper = edges.find(edge => edge.targetFile === 'src/helper.ts');
    expect(helper).toBeDefined();
    expect(helper?.confidence).toBe('heuristic-medium');
    // Every recorded edge carries one of the three tags.
    for (const edge of edges) {
      expect(['lsp-high', 'heuristic-medium', 'unresolved']).toContain(edge.confidence);
    }
  });

  it('never records a package target as an internal edge', async () => {
    const registry = createResolverRegistry({ rootDir: workspace, lspMode: 'never' });
    const result = await resolveDependencyClosure([sel('src/index.ts')], ctxFor(workspace), {
      registry,
    });
    const closure = result.isOk() ? result.value : undefined;
    const edges = closure?.resolvedEdges ?? [];
    for (const edge of edges) {
      expect(edge.targetFile.startsWith('node_modules/')).toBe(false);
      expect(edge.targetFile.startsWith('../')).toBe(false);
      // An unresolved marker is never recorded as a resolved edge.
      expect(edge.confidence).not.toBe('unresolved');
    }
    // The node_modules import is still reported as a package requirement.
    expect(closure?.required).toContain('fake-pkg');
  });

  it('defaults to a heuristic-only registry', async () => {
    const result = await resolveDependencyClosure([sel('src/index.ts')], ctxFor(workspace));
    expect(result.isOk()).toBe(true);
    const closure = result.isOk() ? result.value : undefined;
    // The public entry always wires a registry; with no LSP client configured
    // every edge it records is a heuristic one.
    const edges = closure?.resolvedEdges ?? [];
    expect(edges.length).toBeGreaterThan(0);
    for (const edge of edges) expect(edge.confidence).toBe('heuristic-medium');
    expect(closure?.required).toContain('fake-pkg');
  });

  it('leaves the P-149 walk unchanged when it is called directly', async () => {
    const result = await resolveDependenciesForFiles([sel('src/index.ts')], ctxFor(workspace));
    expect(result.isOk()).toBe(true);
    const closure = result.isOk() ? result.value : undefined;
    // No registry -> the legacy lexical rules only -> no registry edges.
    expect(closure?.resolvedEdges).toEqual([]);
    expect(closure?.required).toContain('fake-pkg');
  });

  it('an empty selection is an empty closure', async () => {
    const result = await resolveDependencyClosure([], ctxFor(workspace));
    expect(result.isOk()).toBe(true);
    const closure = result.isOk() ? result.value : undefined;
    expect(closure?.required).toEqual([]);
    expect(closure?.resolvedEdges).toEqual([]);
  });

  it('builds a heuristic-only registry by default', () => {
    const registry = defaultResolverRegistry(workspace);
    expect(registry.getCapabilities().every(capability => capability.lsp === 'absent')).toBe(true);
  });
});
