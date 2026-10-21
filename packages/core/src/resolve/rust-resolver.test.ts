// P-339 — the Rust resolver's contract (best-effort).
//
// The module graph is the fallback: crate::/self::/super:: paths, a flat file
// versus `mod.rs`, and the `#[cfg(...)]` attributes. The language-server path
// is covered with a fake client, because rust-analyzer is not installed in
// every environment (a missing measurement is never a zero).

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ok, type Result } from 'neverthrow';
import { createRustResolver } from './rust-resolver.js';
import type { LspClient, LspInitializeResult } from './lsp-client.js';
import type { StitchError } from '../result/index.js';

// The ground-truth fixture lives OUTSIDE src (the root typecheck only covers
// packages/*/src/**/*).
const FIXTURE_ROOT = join(import.meta.dirname, '..', '..', 'test-fixtures', 'rust-resolver-repo');

/** A language server that answers every definition with the same target. */
class FakeClient implements LspClient {
  private readonly answer: unknown;

  constructor(answer: unknown) {
    this.answer = answer;
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
    return true;
  }

  async shutdown(): Promise<Result<void, StitchError>> {
    return ok(undefined);
  }

  dispose(): void {
    // nothing to clean up
  }
}

describe('RustResolver (P-339)', () => {
  it('implements the resolver contract', () => {
    const resolver = createRustResolver({ rootDir: FIXTURE_ROOT });
    expect(resolver.language).toBe('rust');
  });

  it('resolves a crate module import', async () => {
    const resolver = createRustResolver({ rootDir: FIXTURE_ROOT });
    const result = await resolver.resolve('src/main.rs', 'crate::a');
    expect(result.isOk()).toBe(true);
    const edges = result.isOk() ? result.value : [];
    expect(edges[0]?.targetFile).toBe('src/a.rs');
    expect(edges[0]?.sourceFile).toBe('src/main.rs');
    expect(edges[0]?.confidence).toBe('heuristic-medium');
  });

  it('resolves a module tree through mod.rs', async () => {
    const resolver = createRustResolver({ rootDir: FIXTURE_ROOT });
    const result = await resolver.resolve('src/main.rs', 'crate::b::child');
    expect(result.isOk()).toBe(true);
    const edges = result.isOk() ? result.value : [];
    expect(edges[0]?.targetFile).toBe('src/b/child.rs');
  });

  it('resolves a self:: path from a mod.rs', async () => {
    const resolver = createRustResolver({ rootDir: FIXTURE_ROOT });
    const result = await resolver.resolve('src/b/mod.rs', 'self::child');
    expect(result.isOk()).toBe(true);
    const edges = result.isOk() ? result.value : [];
    expect(edges[0]?.targetFile).toBe('src/b/child.rs');
  });

  it('leaves a cfg-gated module unresolved', async () => {
    const resolver = createRustResolver({ rootDir: FIXTURE_ROOT });
    const result = await resolver.resolve('src/main.rs', 'crate::win');
    expect(result.isOk()).toBe(true);
    const edges = result.isOk() ? result.value : [];
    expect(edges).toHaveLength(0);
  });

  it('tags a language-server answer lsp-high', async () => {
    const target = pathToFileURL(join(FIXTURE_ROOT, 'src', 'a.rs')).toString();
    const resolver = createRustResolver({
      rootDir: FIXTURE_ROOT,
      lspClient: new FakeClient({ uri: target }),
    });
    const result = await resolver.resolve('src/main.rs', 'crate::a');
    expect(result.isOk()).toBe(true);
    const edges = result.isOk() ? result.value : [];
    expect(edges[0]?.targetFile).toBe('src/a.rs');
    expect(edges[0]?.confidence).toBe('lsp-high');
  });

  it('returns no edges for an unresolved import', async () => {
    const resolver = createRustResolver({ rootDir: FIXTURE_ROOT });
    const result = await resolver.resolve('src/main.rs', 'serde::Serialize');
    expect(result.isOk()).toBe(true);
    const edges = result.isOk() ? result.value : [];
    expect(edges).toHaveLength(0);
  });

  it('reports a Cargo.toml without a package name', async () => {
    const broken = mkdtempSync(join(tmpdir(), 'stitch-rust-broken-'));
    writeFileSync(join(broken, 'Cargo.toml'), '[workspace]\n', 'utf8');
    const resolver = createRustResolver({ rootDir: broken });
    const result = await resolver.resolve('src/main.rs', 'crate::a');
    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.code).toBe('CONFIG_ERROR');
  });
});
