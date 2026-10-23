// P-343 — the registry-backed entry to `resolve_dependency_closure`.
//
// P-149's walk lives in `agent/tools/resolve_deps.ts`; this module is the
// public seam the cross-language epic adds on top of it: it builds the P-341
// resolver stack over the tool's working directory and hands it to the walk, so
// every internal edge comes back carrying its P-342 confidence tag.
//
// The stack is built in HEURISTIC-ONLY mode by default: an agent turn must not
// pay for spawning a language server per call (P-344 brings warm-server
// caching). An injected registry — one holding live LSP clients, say — is used
// as-is, which is how the tests and any future warm-server path drive it.

import type { Result } from 'neverthrow';
import type { ToolContext } from '../ai/types.js';
import type { Ecosystem } from '../deps/ecosystem.js';
import { createResolverRegistry, type ResolverRegistry } from '../resolve/registry.js';
import { resolveDependenciesForFiles } from '../agent/tools/resolve_deps.js';
import type { DepClosure, SelectedFile } from '../agent/types.js';
import type { StitchError } from '../result/index.js';

export interface ResolveClosureOptions {
  /** The resolver stack. Absent = a heuristic-only one built from ctx.cwd. */
  readonly registry?: ResolverRegistry;
  /** Force one ecosystem instead of detecting it per file. */
  readonly ecosystem?: Ecosystem;
}

/**
 * The registry the tool uses when the caller does not inject one.
 *
 * Heuristic-only on purpose: it resolves every supported language through the
 * deterministic fallbacks, with no language server process to start or stop.
 */
export function defaultResolverRegistry(rootDir: string): ResolverRegistry {
  return createResolverRegistry({ rootDir, lspMode: 'never' });
}

/**
 * Compute the dependency closure of `selection` through the resolver stack.
 *
 * Same contract as the P-149 walk (read-only, deterministic, a `Result`), plus
 * the `resolvedEdges` the P-342 tagging adds.
 */
export async function resolveDependencyClosure(
  selection: readonly SelectedFile[],
  ctx: ToolContext,
  options?: ResolveClosureOptions
): Promise<Result<DepClosure, StitchError>> {
  const registry = options?.registry ?? defaultResolverRegistry(ctx.cwd);
  return resolveDependenciesForFiles(selection, ctx, {
    registry,
    ...(options?.ecosystem !== undefined ? { ecosystem: options.ecosystem } : {}),
  });
}
