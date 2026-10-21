// P-336 — the resolver contract. Every language resolver (P-336 TS/JS, P-337
// Python, P-338 Go, P-339 Rust) implements it, so the cross-language pipeline
// can ask "where does this import go?" without knowing the language.
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
}
