// P-341 — the resolver registry. One place that knows which resolver answers
// for which ecosystem, so the agent tools (Epic 7) never name a resolver class
// and can swap implementations at runtime.
//
// The chain is LSP -> Heuristic -> None: an ecosystem's own resolver (which
// already falls back to its deterministic path: the compiler API, jedi, the Go
// or Rust module graph) while the language server path is enabled, the
// tree-sitter heuristic (P-340) when LSP is switched off for the session, and
// nothing at all for an ecosystem nobody can resolve.

import { err, ok, type Result } from 'neverthrow';
import type { Ecosystem } from '../deps/ecosystem.js';
import type { StitchError } from '../result/index.js';
import { createGoResolver, type GoBuildContext } from './go-resolver.js';
import { createHeuristicResolver, lspEnabled, type LspMode } from './heuristic-fallback.js';
import type { LspClient } from './lsp-client.js';
import { createPythonResolver, type JediRunner } from './python-resolver.js';
import { createRustResolver, type RustBuildContext } from './rust-resolver.js';
import { createTsResolver, type TsModule } from './ts-resolver.js';
import type { DependencyResolver, ResolutionConfidence } from './types.js';

/** Every ecosystem the registry can answer for. */
export const REGISTRY_ECOSYSTEMS: readonly Ecosystem[] = ['node', 'python', 'go', 'rust'];

export interface ResolverRegistryOptions {
  /** The workspace root every resolver reads. */
  readonly rootDir: string;
  /** `never` forces heuristic-only mode (CI and containers without LSP). */
  readonly lspMode?: LspMode;
  /** One language server per ecosystem; absent = that ecosystem has none. */
  readonly lspClients?: Partial<Record<Ecosystem, LspClient>>;
  /** Passed through to the TypeScript resolver. */
  readonly tsModule?: TsModule;
  /** Passed through to the Python resolver. */
  readonly jediRunner?: JediRunner;
  readonly pythonPath?: string;
  readonly jediHelperPath?: string;
  /** Passed through to the Go resolver. */
  readonly goBuildContext?: GoBuildContext;
  /** Passed through to the Rust resolver. */
  readonly rustBuildContext?: RustBuildContext;
}

/** One ecosystem's answer, for diagnostics. */
export interface RegistryCapabilities {
  readonly ecosystem: Ecosystem;
  readonly language: string;
  readonly lsp: 'configured' | 'absent';
  readonly strategies: readonly ResolutionConfidence[];
}

export class ResolverRegistry {
  private readonly primary = new Map<Ecosystem, DependencyResolver>();
  private readonly heuristic: DependencyResolver;
  private readonly mode: LspMode;

  constructor(options: ResolverRegistryOptions) {
    this.mode = options.lspMode ?? 'auto';
    const clients = options.lspClients ?? {};
    const rootDir = options.rootDir;
    this.primary.set(
      'node',
      createTsResolver({
        rootDir,
        ...(clients.node !== undefined ? { lspClient: clients.node } : {}),
        ...(options.tsModule !== undefined ? { tsModule: options.tsModule } : {}),
      })
    );
    this.primary.set(
      'python',
      createPythonResolver({
        rootDir,
        ...(clients.python !== undefined ? { lspClient: clients.python } : {}),
        ...(options.jediRunner !== undefined ? { jediRunner: options.jediRunner } : {}),
        ...(options.pythonPath !== undefined ? { pythonPath: options.pythonPath } : {}),
        ...(options.jediHelperPath !== undefined ? { jediHelperPath: options.jediHelperPath } : {}),
      })
    );
    this.primary.set(
      'go',
      createGoResolver({
        rootDir,
        ...(clients.go !== undefined ? { lspClient: clients.go } : {}),
        ...(options.goBuildContext !== undefined ? { buildContext: options.goBuildContext } : {}),
      })
    );
    this.primary.set(
      'rust',
      createRustResolver({
        rootDir,
        ...(clients.rust !== undefined ? { lspClient: clients.rust } : {}),
        ...(options.rustBuildContext !== undefined
          ? { buildContext: options.rustBuildContext }
          : {}),
      })
    );
    this.heuristic = createHeuristicResolver({ rootDir, lspMode: this.mode });
  }

  /** The fallback chain for an ecosystem: LSP -> Heuristic -> None. */
  getFallbackChain(ecosystem: Ecosystem): readonly DependencyResolver[] {
    const primary = this.primary.get(ecosystem);
    if (primary === undefined) return [];
    if (lspEnabled(this.mode)) return [primary, this.heuristic];
    return [this.heuristic];
  }

  /** The resolver to use; undefined when nothing can resolve the ecosystem. */
  getResolver(ecosystem: Ecosystem): DependencyResolver | undefined {
    return this.getFallbackChain(ecosystem)[0];
  }

  /** Every ecosystem's answer, for diagnostics (which LSPs are available). */
  getCapabilities(): readonly RegistryCapabilities[] {
    return REGISTRY_ECOSYSTEMS.map(ecosystem => {
      const capabilities = this.getResolver(ecosystem)?.getCapabilities();
      return {
        ecosystem,
        language: capabilities?.language ?? 'none',
        lsp: capabilities?.lsp ?? 'absent',
        strategies: capabilities?.strategies ?? [],
      };
    });
  }

  /** Stop every language server the registry owns. */
  async shutdown(): Promise<Result<void, StitchError>> {
    const failures: StitchError[] = [];
    const seen = new Set<DependencyResolver>();
    for (const resolver of [...this.primary.values(), this.heuristic]) {
      if (seen.has(resolver)) continue;
      seen.add(resolver);
      const stopped = await resolver.shutdown();
      if (stopped.isErr()) failures.push(stopped.error);
    }
    const first = failures[0];
    if (first !== undefined) return err(first);
    return ok(undefined);
  }
}

/** Build the session's registry. */
export function createResolverRegistry(options: ResolverRegistryOptions): ResolverRegistry {
  return new ResolverRegistry(options);
}
