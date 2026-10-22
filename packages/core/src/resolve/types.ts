// P-336/P-341 — the resolver contract. Every language resolver (P-336 TS/JS,
// P-337 Python, P-338 Go, P-339 Rust, P-340 heuristic) implements it, so the
// cross-language pipeline can ask "where does this import go?" without knowing
// the language, and P-341's registry can swap implementations at runtime.
//
// The confidence tag is the point of the contract: an edge the language server
// answered is `lsp-high`; an edge a compiler-API heuristic produced is
// `heuristic-medium`. A consumer gates on the tag instead of guessing.

import type { Result } from 'neverthrow';
import type { StitchError } from '../result/index.js';

/** How much we trust a resolved edge. */
export type ResolutionConfidence = 'lsp-high' | 'heuristic-medium';

/** One resolved import edge. */
export interface ResolvedImport {
  /** The importing file, relative to the resolver root (posix separators). */
  readonly sourceFile: string;
  /** The imported file, relative to the resolver root (posix separators). */
  readonly targetFile: string;
  /** Where the answer came from. */
  readonly confidence: ResolutionConfidence;
}

/** Whether a resolver was handed a language server to talk to. */
export type LspAvailability = 'configured' | 'absent';

/** What a resolver can do, without probing anything at runtime. */
export interface ResolverCapabilities {
  /** The language this resolver answers for. */
  readonly language: string;
  /** The confidence tags it can emit, most trusted first. */
  readonly strategies: readonly ResolutionConfidence[];
  /** Whether an LSP client was configured for it. */
  readonly lsp: LspAvailability;
}

/** The runtime state of a resolver's language server. */
export type LspHealth = 'available' | 'unavailable' | 'unknown';

/** The result of a runtime health probe. */
export interface ResolverHealth {
  /** Can this resolver answer at all (its fallback included)? */
  readonly healthy: boolean;
  /** The language server's state. */
  readonly lsp: LspHealth;
  /** Why, when there is something to say. */
  readonly detail?: string;
}

/** A language resolver. */
export interface DependencyResolver {
  /** The language this resolver answers for ('typescript', 'python', ...). */
  readonly language: string;
  /**
   * Resolve `importSpec` as imported by `filePath`.
   *
   * An unresolved import is NOT an error: it resolves to an empty list.
   * A failure of the resolver itself (no compiler API, no readable project)
   * is an error.
   */
  resolve(filePath: string, importSpec: string): Promise<Result<ResolvedImport[], StitchError>>;
  /** What this resolver can do (diagnostics; never fails). */
  getCapabilities(): ResolverCapabilities;
  /** Probe the language server at runtime; never throws. */
  healthCheck(): Promise<Result<ResolverHealth, StitchError>>;
  /** Release the language server process, when there is one; never throws. */
  shutdown(): Promise<Result<void, StitchError>>;
}
