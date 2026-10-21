// P-338 — the Go resolver's contract.
//
// The module graph is the fallback: go.mod + go.work + the vendor tree + the
// build tags. The language-server path is covered with a fake client, because
// gopls is not installed in every environment (a missing measurement is never
// a zero).

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ok, type Result } from 'neverthrow';
import { createGoResolver } from './go-resolver.js';
import type { LspClient, LspInitializeResult } from './lsp-client.js';
import type { StitchError } from '../result/index.js';

// The ground-truth fixture lives OUTSIDE src (the root typecheck only covers
// packages/*/src/**/*).
const FIXTURE_ROOT = join(import.meta.dirname, '..', '..', 'test-fixtures', 'go-resolver-repo');

/** A language server that answers every definition with the same target. */
class FakeClient implements LspClient {
  private readonly answer: unknown;
  private readonly alive: boolean;

  constructor(answer: unknown, alive = true) {
    this.answer = answer;
    this.alive = alive;
  }

  async initialize(): Promise<Result<LspInitializeResult, StitchError>> {
    return ok({ capabilities: {} });
  }

  async request<T>(): Promise<Result<T, StitchError>> {
    return ok(this.answer as T);
  }

  notify(): Result<void, StitchError> {
    return ok(undefined);
  }

  onNotification(): () => void {
    return () => undefined;
  }

  isAlive(): boolean {
    return this.alive;
  }

  async shutdown(): Promise<Result<void, StitchError>> {
    return ok(undefined);
  }

  dispose(): void {
    // nothing to clean up
  }
}

describe('GoResolver (P-338)', () => {
  it('implements the resolver contract', () => {
    const resolver = createGoResolver({ rootDir: FIXTURE_ROOT });
    expect(resolver.language).toBe('go');
  });

  it('resolves a module import', async () => {
    const resolver = createGoResolver({ rootDir: FIXTURE_ROOT });
    const result = await resolver.resolve('cmd/app/main.go', 'example.com/fixture/pkg');
    expect(result.isOk()).toBe(true);
    const edges = result.isOk() ? result.value : [];
    expect(edges).toHaveLength(1);
    expect(edges[0]?.targetFile).toBe('pkg/pkg.go');
    expect(edges[0]?.sourceFile).toBe('cmd/app/main.go');
    expect(edges[0]?.confidence).toBe('heuristic-medium');
  });

  it('resolves a vendored import', async () => {
    const resolver = createGoResolver({ rootDir: FIXTURE_ROOT });
    const result = await resolver.resolve('cmd/app/main.go', 'example.com/dep/thing');
    expect(result.isOk()).toBe(true);
    const edges = result.isOk() ? result.value : [];
    expect(edges[0]?.targetFile).toBe('vendor/example.com/dep/thing/thing.go');
    expect(edges[0]?.confidence).toBe('heuristic-medium');
  });

  it('resolves a workspace module import', async () => {
    const resolver = createGoResolver({ rootDir: FIXTURE_ROOT });
    const result = await resolver.resolve('cmd/app/main.go', 'example.com/other/pkg');
    expect(result.isOk()).toBe(true);
    const edges = result.isOk() ? result.value : [];
    expect(edges[0]?.targetFile).toBe('other/pkg/pkg.go');
  });

  it('skips a file the build context excludes', async () => {
    const resolver = createGoResolver({ rootDir: FIXTURE_ROOT });
    const result = await resolver.resolve('cmd/app/main.go', 'example.com/fixture/tagged');
    expect(result.isOk()).toBe(true);
    const edges = result.isOk() ? result.value : [];
    expect(edges[0]?.targetFile).toBe('tagged/plain.go');
  });

  it('tags a language-server answer lsp-high', async () => {
    const target = pathToFileURL(join(FIXTURE_ROOT, 'pkg', 'pkg.go')).toString();
    const resolver = createGoResolver({
      rootDir: FIXTURE_ROOT,
      lspClient: new FakeClient({ uri: target }),
    });
    const result = await resolver.resolve('cmd/app/main.go', 'example.com/fixture/pkg');
    expect(result.isOk()).toBe(true);
    const edges = result.isOk() ? result.value : [];
    expect(edges[0]?.targetFile).toBe('pkg/pkg.go');
    expect(edges[0]?.confidence).toBe('lsp-high');
  });

  it('returns no edges for an unresolved import', async () => {
    const resolver = createGoResolver({ rootDir: FIXTURE_ROOT });
    const result = await resolver.resolve('cmd/app/main.go', 'example.com/nope/nothing');
    expect(result.isOk()).toBe(true);
    const edges = result.isOk() ? result.value : [];
    expect(edges).toHaveLength(0);
  });

  it('reports a go.mod it cannot parse', async () => {
    const broken = mkdtempSync(join(tmpdir(), 'stitch-go-broken-'));
    writeFileSync(join(broken, 'go.mod'), 'not a module file\n', 'utf8');
    const resolver = createGoResolver({ rootDir: broken });
    const result = await resolver.resolve('cmd/app/main.go', 'example.com/fixture/pkg');
    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.code).toBe('CONFIG_ERROR');
  });
});
