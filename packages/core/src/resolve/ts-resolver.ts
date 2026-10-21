// P-336 — the TypeScript/JavaScript import resolver.
//
// Two paths, one contract: the language server answers when it is available (a
// real `textDocument/definition` — confidence `lsp-high`), the TypeScript
// compiler API answers when it is not (`ts.resolveModuleName` over the
// project's tsconfig — confidence `heuristic-medium`). The caller never has to
// know which path produced an edge; it reads the confidence tag.
//
// An import that resolves to nothing is NOT an error: the resolver returns an
// empty edge list, because "this import is unresolved" is a finding, not a
// failure of the resolver. Only a failure of the resolver itself (no compiler
// API, no readable project) is an error.

import { readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve as resolvePath, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { err, ok, type Result } from 'neverthrow';
import type { StitchError } from '../result/index.js';
import type { LspClient } from './lsp-client.js';
import type { DependencyResolver, ResolvedImport, ResolutionConfidence } from './types.js';

/** The slice of the file-system host the compiler API needs. */
export interface TsHost {
  fileExists(path: string): boolean;
  readFile(path: string): string | undefined;
}

/**
 * The slice of the TypeScript compiler API this resolver uses.
 *
 * The real `typescript` module is loaded lazily (and can be injected), so a
 * consumer that only speaks LSP never pays for the compiler API.
 */
export interface TsModule {
  resolveModuleName(
    moduleName: string,
    containingFile: string,
    compilerOptions: Readonly<Record<string, unknown>>,
    host: TsHost
  ): { readonly resolvedModule?: { readonly resolvedFileName: string } };
  findConfigFile(directory: string, fileExists: (path: string) => boolean): string | undefined;
  parseJsonConfigFileContent(
    json: unknown,
    host: unknown,
    basePath: string
  ): { readonly options: Readonly<Record<string, unknown>> };
  readonly sys: TsHost;
}

export interface TsResolverOptions {
  /** The workspace root — every reported path is relative to it. */
  readonly rootDir: string;
  /** The language server (P-335). Absent = the compiler path only. */
  readonly lspClient?: LspClient;
  /** The compiler API. Absent = it is imported lazily on the first use. */
  readonly tsModule?: TsModule;
  /** Extra compiler options merged over the tsconfig ones. */
  readonly compilerOptions?: Readonly<Record<string, unknown>>;
}

interface Position {
  readonly line: number;
  readonly character: number;
}

function messageOf(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  if (cause !== null && typeof cause === 'object' && 'message' in cause) {
    const message = (cause as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return String(cause);
}

/** The `uri` values a `textDocument/definition` answer carries. */
function definitionUris(value: unknown): readonly string[] {
  if (value === null || value === undefined) return [];
  const items = Array.isArray(value) ? value : [value];
  const uris: string[] = [];
  for (const item of items) {
    if (item === null || typeof item !== 'object') continue;
    const record = item as { targetUri?: unknown; uri?: unknown };
    const uri = record.targetUri ?? record.uri;
    if (typeof uri === 'string') uris.push(uri);
  }
  return uris;
}

/** The position of an import specifier inside a source file. */
function positionOfSpecifier(text: string, importSpec: string): Position | undefined {
  const index = text.indexOf(importSpec);
  if (index === -1) return undefined;
  // Inside the string literal: skip the opening quote when there is one.
  const before = text[index - 1];
  const offset = before === "'" || before === '"' ? 1 : 0;
  const at = index + offset;
  const upTo = text.slice(0, at);
  const line = upTo.split('\n').length - 1;
  const lastBreak = upTo.lastIndexOf('\n');
  const character = lastBreak === -1 ? at : at - lastBreak - 1;
  return { line, character };
}

export class TSResolver implements DependencyResolver {
  readonly language = 'typescript';

  private readonly rootDir: string;
  private readonly lspClient: LspClient | undefined;
  private readonly injectedTs: TsModule | undefined;
  private readonly extraOptions: Readonly<Record<string, unknown>>;
  private loadedTs: Result<TsModule, StitchError> | undefined;

  constructor(options: TsResolverOptions) {
    this.rootDir = resolvePath(options.rootDir);
    this.lspClient = options.lspClient;
    this.injectedTs = options.tsModule;
    this.extraOptions = options.compilerOptions ?? {};
  }

  async resolve(
    filePath: string,
    importSpec: string
  ): Promise<Result<ResolvedImport[], StitchError>> {
    const source = this.absolute(filePath);
    const viaLsp = await this.resolveViaLsp(source, importSpec);
    if (viaLsp !== undefined) {
      return ok(viaLsp);
    }
    return this.resolveViaCompiler(source, importSpec);
  }

  /** The language-server path; undefined when the server could not answer. */
  private async resolveViaLsp(
    source: string,
    importSpec: string
  ): Promise<ResolvedImport[] | undefined> {
    const client = this.lspClient;
    if (client === undefined || !client.isAlive()) return undefined;
    const text = this.readText(source);
    if (text === undefined) return undefined;
    const position = positionOfSpecifier(text, importSpec);
    if (position === undefined) return undefined;
    const uri = pathToFileURL(source).toString();
    const opened = client.notify('textDocument/didOpen', {
      textDocument: { uri, languageId: 'typescript', version: 1, text },
    });
    if (opened.isErr()) return undefined;
    const answer = await client.request<unknown>('textDocument/definition', {
      textDocument: { uri },
      position,
    });
    if (answer.isErr()) return undefined;
    const edges: ResolvedImport[] = [];
    for (const target of definitionUris(answer.value)) {
      const targetPath = fileURLToPath(target);
      if (targetPath === '') continue;
      edges.push({
        sourceFile: this.relative(source),
        targetFile: this.relative(targetPath),
        confidence: 'lsp-high',
      });
    }
    return edges;
  }

  /** The compiler-API path — the fallback when the server is not there. */
  private async resolveViaCompiler(
    source: string,
    importSpec: string
  ): Promise<Result<ResolvedImport[], StitchError>> {
    const ts = await this.loadTs();
    if (ts.isErr()) return err(ts.error);
    const api = ts.value;
    const options = this.compilerOptions(api);
    if (options === undefined) {
      return err({
        code: 'CONFIG_ERROR',
        field: 'resolve.tsconfig',
        message: `the tsconfig of ${this.rootDir} could not be read`,
      });
    }
    const resolved = api.resolveModuleName(importSpec, source, options, api.sys);
    const fileName = resolved.resolvedModule?.resolvedFileName;
    if (fileName === undefined) {
      // Unresolved is a finding, not a failure.
      return ok([]);
    }
    const edge: ResolvedImport = {
      sourceFile: this.relative(source),
      targetFile: this.relative(fileName),
      confidence: 'heuristic-medium',
    };
    return ok([edge]);
  }

  /** The compiler options: the tsconfig of the workspace, plus the extras. */
  private compilerOptions(api: TsModule): Readonly<Record<string, unknown>> | undefined {
    const configPath = api.findConfigFile(this.rootDir, path => api.sys.fileExists(path));
    if (configPath === undefined) {
      // No tsconfig: the default node resolution still handles relative and
      // node_modules imports.
      return { ...this.extraOptions };
    }
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(configPath, 'utf8')) as unknown;
    } catch {
      return undefined;
    }
    try {
      const parsed = api.parseJsonConfigFileContent(raw, api.sys, this.rootDir);
      return { ...parsed.options, ...this.extraOptions };
    } catch {
      return undefined;
    }
  }

  /** The compiler API, injected or imported lazily. */
  private async loadTs(): Promise<Result<TsModule, StitchError>> {
    if (this.injectedTs !== undefined) return ok(this.injectedTs);
    if (this.loadedTs !== undefined) return this.loadedTs;
    try {
      const loaded = (await import('typescript')) as unknown as Record<string, unknown>;
      // The compiler API arrives as a CommonJS namespace: the interop shape
      // differs between runtimes (the namespace itself, a `default` wrapper,
      // or a `default.default` one), so unwrap until the API is there.
      let api: Record<string, unknown> = loaded;
      for (let depth = 0; depth < 3; depth += 1) {
        if (typeof api['findConfigFile'] === 'function') break;
        const next = api['default'];
        if (next === null || typeof next !== 'object') break;
        api = next as Record<string, unknown>;
      }
      if (typeof api['findConfigFile'] !== 'function') {
        this.loadedTs = err({
          code: 'CONFIG_ERROR',
          field: 'resolve.typescript',
          message: 'the typescript compiler API does not expose findConfigFile',
        });
        return this.loadedTs;
      }
      this.loadedTs = ok(api as unknown as TsModule);
    } catch (cause) {
      this.loadedTs = err({
        code: 'CONFIG_ERROR',
        field: 'resolve.typescript',
        message: `the typescript compiler API is not available: ${messageOf(cause)}`,
      });
    }
    return this.loadedTs;
  }

  private absolute(filePath: string): string {
    return isAbsolute(filePath) ? filePath : resolvePath(this.rootDir, filePath);
  }

  /** A path relative to the workspace root, with posix separators. */
  private relative(filePath: string): string {
    return relative(this.rootDir, filePath).split(sep).join('/');
  }

  private readText(filePath: string): string | undefined {
    try {
      return readFileSync(filePath, 'utf8');
    } catch {
      return undefined;
    }
  }
}

/** Build a resolver for a workspace. */
export function createTsResolver(options: TsResolverOptions): TSResolver {
  return new TSResolver(options);
}

/** The confidence values this resolver emits. */
export const RESOLUTION_CONFIDENCES: readonly ResolutionConfidence[] = [
  'lsp-high',
  'heuristic-medium',
];
