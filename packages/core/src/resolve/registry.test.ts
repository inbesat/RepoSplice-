// P-341 — the registry: selection per ecosystem, the LSP -> Heuristic -> None
// chain, and the interface compliance of all five resolvers.

import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ok, type Result } from 'neverthrow';
import { createResolverRegistry } from './registry.js';
import type { DependencyResolver } from './types.js';
import type { LspClient, LspInitializeResult } from './lsp-client.js';
import type { StitchError } from '../result/index.js';

// The fixture lives OUTSIDE src (the root typecheck only covers packages/*/src/**/*).
const ROOT = join(import.meta.dirname, '..', '..', 'test-fixtures', 'ts-resolver-repo');

/** A language server that answers nothing and records its shutdown. */
class FakeClient implements LspClient {
  stopped = false;

  async initialize(): Promise<Result<LspInitializeResult, StitchError>> {
    return ok({ capabilities: {} });
  }

  async request<T>(): Promise<Result<T, StitchError>> {
    return ok(undefined as T);
  }

  notify(): Result<void, StitchError> {
    return ok(undefined);
  }

  onNotification(): () => void {
    return () => undefined;
  }

  isAlive(): boolean {
    return !this.stopped;
  }

  async shutdown(): Promise<Result<void, StitchError>> {
    this.stopped = true;
    return ok(undefined);
  }

  dispose(): void {
    this.stopped = true;
  }
}

/** The five resolvers the registry can hand out (lsp on, then lsp off). */
function allResolvers(rootDir: string): readonly DependencyResolver[] {
  const withLsp = createResolverRegistry({ rootDir, lspClients: {} });
  const withoutLsp = createResolverRegistry({ rootDir, lspMode: 'never' });
  return [
    withLsp.getResolver('node'),
    withLsp.getResolver('python'),
    withLsp.getResolver('go'),
    withLsp.getResolver('rust'),
    withoutLsp.getResolver('node'),
  ].filter((resolver): resolver is DependencyResolver => resolver !== undefined);
}

describe('ResolverRegistry (P-341)', () => {
  it("selects each ecosystem's own resolver while LSP is enabled", () => {
    const registry = createResolverRegistry({ rootDir: ROOT });
    expect(registry.getResolver('node')?.language).toBe('typescript');
    expect(registry.getResolver('python')?.language).toBe('python');
    expect(registry.getResolver('go')?.language).toBe('go');
    expect(registry.getResolver('rust')?.language).toBe('rust');
  });

  it('falls back to the heuristic when LSP is switched off', () => {
    const registry = createResolverRegistry({ rootDir: ROOT, lspMode: 'never' });
    expect(registry.getResolver('node')?.language).toBe('heuristic');
    expect(registry.getResolver('rust')?.language).toBe('heuristic');
  });

  it('resolves nothing for an ecosystem it does not know', () => {
    const registry = createResolverRegistry({ rootDir: ROOT });
    expect(registry.getResolver('cobol' as never)).toBeUndefined();
    expect(registry.getFallbackChain('cobol' as never)).toHaveLength(0);
  });

  it('exposes the LSP -> heuristic chain', () => {
    const enabled = createResolverRegistry({ rootDir: ROOT });
    expect(enabled.getFallbackChain('node').map(item => item.language)).toEqual([
      'typescript',
      'heuristic',
    ]);
    const disabled = createResolverRegistry({ rootDir: ROOT, lspMode: 'never' });
    expect(disabled.getFallbackChain('node').map(item => item.language)).toEqual(['heuristic']);
  });

  it("reports every ecosystem's capabilities", () => {
    const client = new FakeClient();
    const registry = createResolverRegistry({ rootDir: ROOT, lspClients: { node: client } });
    const capabilities = registry.getCapabilities();
    expect(capabilities.map(item => item.ecosystem)).toEqual(['node', 'python', 'go', 'rust']);
    const node = capabilities.find(item => item.ecosystem === 'node');
    expect(node?.language).toBe('typescript');
    expect(node?.lsp).toBe('configured');
    expect(node?.strategies).toEqual(['lsp-high', 'heuristic-medium']);
    const python = capabilities.find(item => item.ecosystem === 'python');
    expect(python?.lsp).toBe('absent');
  });

  it('hands out resolvers that implement the whole interface', async () => {
    const resolvers = allResolvers(ROOT);
    expect(resolvers).toHaveLength(5);
    for (const resolver of resolvers) {
      expect(resolver.language.length).toBeGreaterThan(0);
      const capabilities = resolver.getCapabilities();
      expect(capabilities.language).toBe(resolver.language);
      expect(capabilities.strategies.length).toBeGreaterThan(0);
      const health = await resolver.healthCheck();
      expect(health.isOk()).toBe(true);
      if (health.isOk()) expect(health.value.healthy).toBe(true);
      const stopped = await resolver.shutdown();
      expect(stopped.isOk()).toBe(true);
    }
  });

  it('resolves through the chosen chain', async () => {
    const registry = createResolverRegistry({ rootDir: ROOT });
    const resolver = registry.getResolver('node');
    expect(resolver).toBeDefined();
    const result = await resolver!.resolve('src/index.ts', './helper');
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value[0]?.targetFile).toBe('src/helper.ts');
      expect(result.value[0]?.confidence).toBe('heuristic-medium');
    }
  });

  it('shuts every language server down', async () => {
    const client = new FakeClient();
    const registry = createResolverRegistry({ rootDir: ROOT, lspClients: { node: client } });
    const stopped = await registry.shutdown();
    expect(stopped.isOk()).toBe(true);
    expect(client.stopped).toBe(true);
  });
});
