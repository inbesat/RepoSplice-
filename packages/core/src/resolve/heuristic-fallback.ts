// P-340 — the heuristic fallback: resolve imports with no language server.
//
// The per-language resolvers (P-336–P-339) each carry a deterministic
// fallback, but a caller still has to know which one to build. This module is
// the single front door for that job:
//
//   - `HeuristicResolver` dispatches on the file extension to the matching
//     resolver built WITHOUT a language server, so it is heuristic-only by
//     construction, and every edge it returns is tagged `heuristic-medium`.
//   - `extractSpecifiers` uses the P-020 tree-sitter parser to FIND the import
//     statements (the AST, not a regex) and normalizes each one to the
//     specifier the resolvers take.
//   - `resolveFile` is the convenience: every import of a file, resolved.
//   - `withHeuristicFallback` integrates the fallback into an LSP-first
//     resolver: when the server is unavailable, times out, or answers with
//     nothing, the heuristic answers instead — never a throw, never a crash
//     when the LSP binary is missing.
//   - `lspEnabled(mode)` is the configuration flag that forces heuristic-only
//     mode (`'never'`) for CI and containers without LSP binaries.
//
// An import that resolves to nothing is NOT an error: it resolves to an empty
// edge list.

import { readFileSync } from 'node:fs';
import { extname, isAbsolute, relative, resolve as resolvePath, sep } from 'node:path';
import { err, ok, type Result } from 'neverthrow';
import { parse, type SupportedLanguage } from '../analysis/treeSitter.js';
import type { StitchError } from '../result/index.js';
import { createGoResolver } from './go-resolver.js';
import { createPythonResolver } from './python-resolver.js';
import { createRustResolver } from './rust-resolver.js';
import { createTsResolver } from './ts-resolver.js';
import type { DependencyResolver, ResolvedImport } from './types.js';

/** Whether language servers may be used at all. */
export type LspMode = 'auto' | 'never';

/** `'never'` forces heuristic-only mode (CI, containers without LSP). */
export function lspEnabled(mode: LspMode): boolean {
  return mode !== 'never';
}

/** The languages the heuristic fallback answers for. */
export type HeuristicLanguage = 'typescript' | 'javascript' | 'python' | 'go' | 'rust';

export interface HeuristicResolverOptions {
  /** The workspace root — every reported path is relative to it. */
  readonly rootDir: string;
  /** The compiler API of the TS/JS fallback (absent = imported lazily). */
  readonly tsModule?: Parameters<typeof createTsResolver>[0]['tsModule'];
  /** The jedi bridge of the Python fallback (absent = the real bridge). */
  readonly jediRunner?: Parameters<typeof createPythonResolver>[0]['jediRunner'];
  /** The python interpreter of the Python fallback. */
  readonly pythonPath?: string;
  /** The Jedi bridge script of the Python fallback. */
  readonly jediHelperPath?: string;
  /** Extra sys.path roots of the Python fallback. */
  readonly sysPaths?: readonly string[];
  /** The build context of the Rust fallback's cfg evaluation. */
  readonly buildContext?: Parameters<typeof createRustResolver>[0]['buildContext'];
  /** `'never'` keeps the resolver heuristic-only (the default is heuristic-only anyway). */
  readonly lspMode?: LspMode;
}

/** The slice of a web-tree-sitter node this module walks. */
interface SyntaxNode {
  readonly type: string;
  readonly text: string;
  readonly namedChildren: readonly SyntaxNode[];
}

const EXTENSION_LANGUAGE: Readonly<Record<string, HeuristicLanguage>> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.py': 'python',
  '.go': 'go',
  '.rs': 'rust',
};

/** The heuristic language of a file, from its extension. */
export function languageForFile(filePath: string): HeuristicLanguage | undefined {
  return EXTENSION_LANGUAGE[extname(filePath).toLowerCase()];
}

/** The tree-sitter grammar that parses a heuristic language. */
function grammarOf(language: HeuristicLanguage): SupportedLanguage {
  if (language === 'typescript') return 'typescript';
  if (language === 'javascript') return 'javascript';
  return language;
}

function walk(node: SyntaxNode, visit: (node: SyntaxNode) => void): void {
  visit(node);
  for (const child of node.namedChildren) walk(child, visit);
}

function firstStringDescendant(node: SyntaxNode): string | undefined {
  let found: string | undefined;
  walk(node, current => {
    if (found === undefined && current.type === 'string') found = current.text;
  });
  return found;
}

function unquote(text: string): string {
  return text.replace(/^['"`]/, '').replace(/['"`]$/, '');
}

/** The specifier a TypeScript/JavaScript import statement carries. */
function specifierFromJs(node: SyntaxNode): string | undefined {
  if (node.type === 'import_statement' || node.type === 'export_statement') {
    const quoted = firstStringDescendant(node);
    return quoted === undefined ? undefined : unquote(quoted);
  }
  if (node.type === 'call_expression') {
    const text = node.text.trimStart();
    if (!text.startsWith('require(') && !text.startsWith('import(')) return undefined;
    const quoted = firstStringDescendant(node);
    return quoted === undefined ? undefined : unquote(quoted);
  }
  return undefined;
}

/** The specifiers a Python import statement carries. */
function specifiersFromPython(node: SyntaxNode): readonly string[] {
  if (node.type === 'import_statement') {
    const body = node.text.replace(/^\s*import\s+/, '');
    return body
      .split(',')
      .map(
        part =>
          part
            .trim()
            .split(/\s+as\s+/)[0]
            ?.trim() ?? ''
      )
      .filter(part => part !== '');
  }
  if (node.type === 'import_from_statement') {
    const match = /^\s*from\s+([\w.]+)\s+import\b/.exec(node.text);
    return match?.[1] === undefined ? [] : [match[1]];
  }
  return [];
}

/** The specifier a Go import spec carries (quoted, optionally aliased). */
function specifierFromGo(node: SyntaxNode): string | undefined {
  if (node.type !== 'import_spec') return undefined;
  const match = /"([^"]+)"/.exec(node.text);
  return match?.[1];
}

/** The module path a Rust `use` declaration carries. */
function specifierFromRust(node: SyntaxNode): string | undefined {
  if (node.type !== 'use_declaration') return undefined;
  const body = node.text.replace(/^\s*use\s+/, '').replace(/;\s*$/, '');
  const head = body.split(/\s+as\s+/)[0] ?? body;
  const path = head.split('::{')[0] ?? head;
  const trimmed = path.replace(/::\*$/, '').trim();
  return trimmed === '' ? undefined : trimmed;
}

/**
 * The import specifiers of a source file, found with the P-020 tree-sitter
 * parse and normalized to the form the resolvers take.
 *
 * A language the parser does not support, or a parse that fails, is reported
 * as an error — the caller decides whether to fall back to the lexical
 * extractors of P-149.
 */
export async function extractSpecifiers(
  source: string,
  language: HeuristicLanguage
): Promise<Result<readonly string[], StitchError>> {
  const parsed = await parse(source, grammarOf(language));
  if (parsed.isErr()) return err(parsed.error);
  const root = parsed.value.rootNode as unknown as SyntaxNode;
  const found: string[] = [];
  walk(root, node => {
    if (language === 'typescript' || language === 'javascript') {
      const specifier = specifierFromJs(node);
      if (specifier !== undefined) found.push(specifier);
      return;
    }
    if (language === 'python') {
      found.push(...specifiersFromPython(node));
      return;
    }
    if (language === 'go') {
      const specifier = specifierFromGo(node);
      if (specifier !== undefined) found.push(specifier);
      return;
    }
    const specifier = specifierFromRust(node);
    if (specifier !== undefined) found.push(specifier);
  });
  return ok([...new Set(found.filter(specifier => specifier !== ''))]);
}

/** A resolver for one workspace that never uses a language server. */
export class HeuristicResolver implements DependencyResolver {
  readonly language = 'heuristic';

  private readonly rootDir: string;
  private readonly options: HeuristicResolverOptions;

  constructor(options: HeuristicResolverOptions) {
    this.rootDir = resolvePath(options.rootDir);
    this.options = options;
  }

  /** The language this workspace's file resolves with, or undefined. */
  languageOf(filePath: string): HeuristicLanguage | undefined {
    return languageForFile(filePath);
  }

  async resolve(
    filePath: string,
    importSpec: string
  ): Promise<Result<ResolvedImport[], StitchError>> {
    const language = languageForFile(filePath);
    if (language === undefined) return ok([]);
    const delegated = await this.delegate(language).resolve(filePath, importSpec);
    if (delegated.isErr()) return err(delegated.error);
    return ok(delegated.value.map(edge => ({ ...edge, confidence: 'heuristic-medium' })));
  }

  /** Every import of a file, extracted then resolved. */
  async resolveFile(filePath: string): Promise<Result<ResolvedImport[], StitchError>> {
    const language = languageForFile(filePath);
    if (language === undefined) return ok([]);
    const absolute = isAbsolute(filePath) ? filePath : resolvePath(this.rootDir, filePath);
    let source: string;
    try {
      source = readFileSync(absolute, 'utf8');
    } catch {
      return err({
        code: 'CONFIG_ERROR',
        field: 'resolve.heuristic',
        message: `the file could not be read: ${absolute}`,
      });
    }
    const specifiers = await extractSpecifiers(source, language);
    if (specifiers.isErr()) return err(specifiers.error);
    const edges: ResolvedImport[] = [];
    for (const specifier of specifiers.value) {
      const resolved = await this.resolve(filePath, specifier);
      if (resolved.isErr()) return err(resolved.error);
      edges.push(...resolved.value);
    }
    return ok(edges);
  }

  /** A path relative to the workspace root, with posix separators. */
  relative(filePath: string): string {
    return relative(this.rootDir, filePath).split(sep).join('/');
  }

  /** The language-specific resolver, built with no language server. */
  private delegate(language: HeuristicLanguage): DependencyResolver {
    if (language === 'python') {
      return createPythonResolver({
        rootDir: this.rootDir,
        ...(this.options.jediRunner !== undefined ? { jediRunner: this.options.jediRunner } : {}),
        ...(this.options.pythonPath !== undefined ? { pythonPath: this.options.pythonPath } : {}),
        ...(this.options.jediHelperPath !== undefined
          ? { jediHelperPath: this.options.jediHelperPath }
          : {}),
        ...(this.options.sysPaths !== undefined ? { sysPaths: this.options.sysPaths } : {}),
      });
    }
    if (language === 'go') {
      return createGoResolver({ rootDir: this.rootDir });
    }
    if (language === 'rust') {
      return createRustResolver({
        rootDir: this.rootDir,
        ...(this.options.buildContext !== undefined
          ? { buildContext: this.options.buildContext }
          : {}),
      });
    }
    return createTsResolver({
      rootDir: this.rootDir,
      ...(this.options.tsModule !== undefined ? { tsModule: this.options.tsModule } : {}),
    });
  }
}

/** Build a heuristic-only resolver for a workspace. */
export function createHeuristicResolver(options: HeuristicResolverOptions): HeuristicResolver {
  return new HeuristicResolver(options);
}

/**
 * Wrap an LSP-first resolver so the heuristic answers when the server cannot.
 *
 * The fallback fires when the primary ERRORS (the server is missing, the
 * request timed out, the server refused) or answers with an EMPTY edge list
 * (nothing resolved). The returned edges always carry `heuristic-medium`.
 */
export function withHeuristicFallback(
  primary: DependencyResolver,
  heuristic: DependencyResolver
): DependencyResolver {
  return {
    language: primary.language,
    async resolve(filePath, importSpec) {
      const attempted = await primary.resolve(filePath, importSpec);
      if (attempted.isOk() && attempted.value.length > 0) return attempted;
      const fallback = await heuristic.resolve(filePath, importSpec);
      if (fallback.isErr()) return attempted.isErr() ? err(attempted.error) : ok([]);
      return ok(fallback.value);
    },
  };
}

/** The confidence values this resolver emits. */
export const HEURISTIC_CONFIDENCES = ['heuristic-medium'] as const;
