// P-336 — the resolver contract, end to end.
//
// The fixture repo (a copy under a temp workspace, with a fake node_modules
// package) carries the ground truth: a relative import, an alias import
// through the tsconfig `paths`, a node_modules import and a re-export. The
// compiler-API path must answer all four; the language-server path is
// exercised with an injected client, because a real server is not something a
// unit test may depend on (the P-335 harness covers the real one).

import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ok, type Result } from 'neverthrow';
import type { StitchError } from '../result/index.js';
import type { LspClient } from './lsp-client.js';
import { createTsResolver, TSResolver } from './ts-resolver.js';
import type { DependencyResolver } from './types.js';

// The fixture repo lives OUTSIDE src (packages/core/test-fixtures) so the
// root typecheck never compiles it - it imports a fake node_modules package
// that only exists inside the temp workspace.
const FIXTURE_ROOT = join(import.meta.dirname, '..', '..', 'test-fixtures', 'ts-resolver-repo');

function fakeClient(targetUri: string, alive = true): LspClient {
  return {
    initialize: async () => ok({ capabilities: {} }),
    request: async <T>(_method: string, _params?: unknown) =>
      ok([{ uri: targetUri }] as unknown as T) as Result<T, StitchError>,
    notify: () => ok(undefined),
    onNotification: () => () => undefined,
    isAlive: () => alive,
    shutdown: async () => ok(undefined),
    dispose: () => undefined,
  };
}

describe('TSResolver (P-336)', () => {
  let workspace = '';

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'stitch-ts-resolver-'));
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

  it('implements the resolver contract', () => {
    const resolver: DependencyResolver = createTsResolver({ rootDir: workspace });
    expect(resolver).toBeInstanceOf(TSResolver);
    expect(resolver.language).toBe('typescript');
  });

  it('resolves a relative import', async () => {
    const resolver = createTsResolver({ rootDir: workspace });
    const answer = await resolver.resolve('src/index.ts', './helper');
    expect(answer.isOk()).toBe(true);
    if (answer.isErr()) return;
    expect(answer.value[0]?.targetFile).toBe('src/helper.ts');
    expect(answer.value[0]?.sourceFile).toBe('src/index.ts');
    expect(answer.value[0]?.confidence).toBe('heuristic-medium');
  });

  it('resolves an alias import through the tsconfig paths', async () => {
    const resolver = createTsResolver({ rootDir: workspace });
    const answer = await resolver.resolve('src/index.ts', '@app/aliased');
    expect(answer.isOk()).toBe(true);
    if (answer.isErr()) return;
    expect(answer.value[0]?.targetFile).toBe('src/aliased.ts');
  });

  it('resolves a node_modules import', async () => {
    const resolver = createTsResolver({ rootDir: workspace });
    const answer = await resolver.resolve('src/index.ts', 'fake-pkg');
    expect(answer.isOk()).toBe(true);
    if (answer.isErr()) return;
    expect(answer.value[0]?.targetFile).toBe('node_modules/fake-pkg/index.d.ts');
  });

  it('resolves a re-export', async () => {
    const resolver = createTsResolver({ rootDir: workspace });
    const answer = await resolver.resolve('src/reexport.ts', './helper');
    expect(answer.isOk()).toBe(true);
    if (answer.isErr()) return;
    expect(answer.value[0]?.targetFile).toBe('src/helper.ts');
  });

  it('falls back to the compiler API when the server is not there', async () => {
    const resolver = createTsResolver({
      rootDir: workspace,
      lspClient: fakeClient('file:///unused', false),
    });
    const answer = await resolver.resolve('src/index.ts', './helper');
    expect(answer.isOk()).toBe(true);
    if (answer.isErr()) return;
    expect(answer.value[0]?.confidence).toBe('heuristic-medium');
    expect(answer.value[0]?.targetFile).toBe('src/helper.ts');
  });

  it('tags a language-server answer as lsp-high', async () => {
    const target = pathToFileURL(join(workspace, 'src', 'helper.ts')).toString();
    const resolver = createTsResolver({
      rootDir: workspace,
      lspClient: fakeClient(target),
    });
    const answer = await resolver.resolve('src/index.ts', './helper');
    expect(answer.isOk()).toBe(true);
    if (answer.isErr()) return;
    expect(answer.value[0]?.confidence).toBe('lsp-high');
    expect(answer.value[0]?.targetFile).toBe('src/helper.ts');
  });

  it('reports an unresolved import as no edges', async () => {
    const resolver = createTsResolver({ rootDir: workspace });
    const answer = await resolver.resolve('src/index.ts', './does-not-exist');
    expect(answer.isOk()).toBe(true);
    if (answer.isErr()) return;
    expect(answer.value).toEqual([]);
  });
});
