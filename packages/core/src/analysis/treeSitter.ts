// Tree-sitter parser loader and parse helpers.
//
// One Parser per process (Parser.init is process-wide). Languages are
// lazy-loaded on first use of each language and cached. The exported
// `parse(source, language)` returns a Result<Tree, StitchError> per the
// P-011 contract; the `STANDARD_GRAMMARS` map lists the languages
// available out of the box and is the canonical list P-148/P-152 should
// gate against (P-020 acceptance criterion).

import { Parser, Language, type Tree as TreeType } from 'web-tree-sitter';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ok, err, type Result } from 'neverthrow';
import { fromInternalPromise, type StitchError } from '../result/index.js';

export type SupportedLanguage = 'typescript' | 'tsx' | 'javascript' | 'python' | 'go' | 'rust';

/** Map from `SupportedLanguage` to the package that ships the .wasm. */
const STANDARD_GRAMMARS: Record<SupportedLanguage, string> = {
  typescript: 'tree-sitter-typescript/tree-sitter-typescript.wasm',
  tsx: 'tree-sitter-typescript/tree-sitter-tsx.wasm',
  javascript: 'tree-sitter-javascript/tree-sitter-javascript.wasm',
  python: 'tree-sitter-python/tree-sitter-python.wasm',
  go: 'tree-sitter-go/tree-sitter-go.wasm',
  rust: 'tree-sitter-rust/tree-sitter-rust.wasm',
};

export function isSupportedLanguage(lang: string): lang is SupportedLanguage {
  return Object.prototype.hasOwnProperty.call(STANDARD_GRAMMARS, lang);
}

// Process-wide state. `init()` and the language cache live at module
// scope so the cost is paid once per process.
let initPromise: Promise<void> | null = null;
const languageCache: Partial<Record<SupportedLanguage, Language>> = {};

/** Resolve the absolute path to a grammar .wasm inside `node_modules`. */
function resolveWasmPath(packageRelativePath: string): string {
  // The grammar packages are direct dependencies of `@repo-stitcher/core`,
  // installed at `packages/core/node_modules/<grammar>/...`. This file
  // lives at `packages/core/src/analysis/treeSitter.ts`, so `../..`
  // gets us to `packages/core/`. Bun and Node both resolve symlinks
  // transparently, so this works for both `node_modules` and bun's
  // `.bun` cache (which symlinks to real paths).
  const here = dirname(fileURLToPath(import.meta.url));
  const coreRoot = join(here, '..', '..');
  return join(coreRoot, 'node_modules', packageRelativePath);
}

/** Initialize web-tree-sitter once per process. Safe to call repeatedly. */
export function initTreeSitter(): Promise<void> {
  if (initPromise === null) {
    initPromise = Parser.init();
  }
  return initPromise;
}

/** Load a language grammar, loading the .wasm bytes from disk. */
export async function loadLanguage(
  lang: SupportedLanguage
): Promise<Result<Language, StitchError>> {
  if (languageCache[lang]) {
    return ok(languageCache[lang]);
  }
  const initResult = await fromInternalPromise(initTreeSitter(), 'web-tree-sitter.init');
  if (initResult.isErr()) {
    const detail =
      initResult.error.code === 'INTERNAL' ? initResult.error.message : initResult.error.code;
    return err<Language, StitchError>({
      code: 'INTERNAL',
      message: `web-tree-sitter.init() failed: ${detail}`,
    });
  }
  const wasmPath = resolveWasmPath(STANDARD_GRAMMARS[lang]);
  const bytesResult = await fromInternalPromise(readFile(wasmPath), `readFile(${wasmPath})`);
  if (bytesResult.isErr()) {
    const detail =
      bytesResult.error.code === 'INTERNAL' ? bytesResult.error.message : bytesResult.error.code;
    return err<Language, StitchError>({
      code: 'INTERNAL',
      message: `cannot read grammar .wasm at ${wasmPath}: ${detail}`,
    });
  }
  const loadResult = await fromInternalPromise(
    Language.load(bytesResult.value),
    `Language.load(${lang})`
  );
  if (loadResult.isErr()) {
    const detail =
      loadResult.error.code === 'INTERNAL' ? loadResult.error.message : loadResult.error.code;
    return err<Language, StitchError>({
      code: 'INTERNAL',
      message: `Language.load(${lang}) failed: ${detail}`,
    });
  }
  languageCache[lang] = loadResult.value;
  return ok(loadResult.value);
}

/**
 * Parse `source` as the given language. Returns a Result carrying the
 * Tree on success or a typed StitchError on failure (unsupported
 * language, init failure, or load failure).
 *
 * The Tree's `rootNode` exposes `type`, `text`, `children`,
 * `firstChild`, `nextSibling`, `namedChildren`, etc. — use these in
 * later phases (P-148/P-152 for structure-aware file selection; P-104
 * for import-edge extraction).
 */
export async function parse(
  source: string,
  lang: SupportedLanguage
): Promise<Result<TreeType, StitchError>> {
  if (!isSupportedLanguage(lang)) {
    return err({
      code: 'CONFIG_ERROR',
      field: 'language',
      message: `unsupported language: ${JSON.stringify(lang)} (supported: ${Object.keys(STANDARD_GRAMMARS).join(', ')})`,
    });
  }
  const langResult = await loadLanguage(lang);
  if (langResult.isErr()) {
    return err<TreeType, StitchError>(langResult.error);
  }
  const parser = new Parser();
  parser.setLanguage(langResult.value);
  const tree = parser.parse(source);
  if (tree === null) {
    return err<TreeType, StitchError>({
      code: 'INTERNAL',
      message: `parser.parse() returned null for language ${lang} (unexpected)`,
    });
  }
  return ok(tree);
}

// Re-export Tree for downstream consumers.
export type { Language, TreeType as Tree };
