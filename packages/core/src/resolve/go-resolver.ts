// P-338 — the Go import resolver.
//
// Two paths, one contract: gopls answers when it is available (a real
// `textDocument/definition` — confidence `lsp-high`), the module graph answers
// when it is not (go.mod + go.work + vendor + the build tags — confidence
// `heuristic-medium`). The caller never has to know which path produced an
// edge; it reads the confidence tag.
//
// An import that resolves to nothing is NOT an error: the resolver returns an
// empty edge list, because "this import is unresolved" is a finding, not a
// failure of the resolver. Only a failure of the resolver itself is an error.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { isAbsolute, join, relative, resolve as resolvePath, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { err, ok, type Result } from 'neverthrow';
import type { StitchError } from '../result/index.js';
import type { LspClient } from './lsp-client.js';
import type {
  DependencyResolver,
  ResolvedImport,
  ResolutionConfidence,
  ResolverCapabilities,
  ResolverHealth,
} from './types.js';

/** The build context the `//go:build` constraints are evaluated against. */
export interface GoBuildContext {
  readonly goos: string;
  readonly goarch: string;
  readonly tags: readonly string[];
}

export interface GoResolverOptions {
  /** The workspace root — every reported path is relative to it. */
  readonly rootDir: string;
  /** The language server (P-335). Absent = the module graph only. */
  readonly lspClient?: LspClient;
  /** Extra module roots (a multi-module workspace the caller knows about). */
  readonly moduleRoots?: readonly string[];
  /** The build context; the defaults come from the environment. */
  readonly buildContext?: GoBuildContext;
}

interface Position {
  readonly line: number;
  readonly character: number;
}

/** A module: its import path and the directory that holds it. */
interface GoModule {
  readonly path: string;
  readonly root: string;
}

function defaultBuildContext(): GoBuildContext {
  return {
    goos: process.env['GOOS'] ?? 'linux',
    goarch: process.env['GOARCH'] ?? 'amd64',
    tags: [],
  };
}

/** The import path of a module, read from its go.mod. */
function readModulePath(moduleRoot: string): string | undefined {
  const modFile = join(moduleRoot, 'go.mod');
  if (!existsSync(modFile)) return undefined;
  try {
    const text = readFileSync(modFile, 'utf8');
    const match = /^\s*module\s+(\S+)\s*$/m.exec(text);
    return match?.[1];
  } catch {
    return undefined;
  }
}

/** The modules of a go.work workspace (`use ./` or a `use ( ... )` block). */
function readWorkspaceModules(rootDir: string): GoModule[] {
  const workFile = join(rootDir, 'go.work');
  if (!existsSync(workFile)) return [];
  const modules: GoModule[] = [];
  try {
    const text = readFileSync(workFile, 'utf8');
    const targets: string[] = [];
    // The single-line form: `use ./other`.
    for (const match of text.matchAll(/^\s*use\s+(\S+)\s*$/gm)) {
      const target = match[1];
      if (target === undefined || target === '(') continue;
      targets.push(target);
    }
    // The block form: `use ( ./ ./other )`.
    const block = /use\s*\(([^)]*)\)/gs.exec(text);
    for (const line of (block?.[1] ?? '').split('\n')) {
      const target = line.trim();
      if (target === '') continue;
      targets.push(target);
    }
    for (const target of targets) {
      const root = resolvePath(rootDir, target);
      const path = readModulePath(root);
      if (path === undefined) continue;
      if (modules.some(known => known.path === path)) continue;
      modules.push({ path, root });
    }
  } catch {
    return modules;
  }
  return modules;
}

/** The relative part of an import path inside a module, or undefined. */
function relativeImport(importPath: string, modulePath: string): string | undefined {
  if (importPath === modulePath) return '';
  if (importPath.startsWith(`${modulePath}/`)) return importPath.slice(modulePath.length + 1);
  return undefined;
}

/** Does a `//go:build` term hold in the build context? */
function factorHolds(factor: string, context: GoBuildContext): boolean {
  const negated = factor.startsWith('!');
  const name = negated ? factor.slice(1) : factor;
  const known = new Set<string>([
    ...context.tags,
    'goos',
    'goarch',
    context.goos,
    context.goarch,
    `${context.goos}_${context.goarch}`,
  ]);
  const holds = known.has(name);
  return negated ? !holds : holds;
}

/** Does a `//go:build` expression hold? (terms are OR, factors are AND). */
export function buildConstraintHolds(expression: string, context: GoBuildContext): boolean {
  const terms = expression.split(/\s+/).filter(term => term !== '');
  if (terms.length === 0) return true;
  return terms.some(term => term.split(',').every(factor => factorHolds(factor, context)));
}

/** The position of an import path inside a source file. */
function positionOfSpecifier(text: string, importPath: string): Position | undefined {
  const index = text.indexOf(importPath);
  if (index === -1) return undefined;
  const at = index + (text[index - 1] === '"' || text[index - 1] === "'" ? 1 : 0);
  const upTo = text.slice(0, at);
  const line = upTo.split('\n').length - 1;
  const lastBreak = upTo.lastIndexOf('\n');
  const character = lastBreak === -1 ? at : at - lastBreak - 1;
  return { line, character };
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

export class GoResolver implements DependencyResolver {
  readonly language = 'go';

  /** What this resolver can do (P-341). */
  getCapabilities(): ResolverCapabilities {
    return {
      language: this.language,
      strategies: ['lsp-high', 'heuristic-medium'],
      lsp: this.lspClient === undefined ? 'absent' : 'configured',
    };
  }

  /** Probe the language server; the module graph needs no server (P-341). */
  async healthCheck(): Promise<Result<ResolverHealth, StitchError>> {
    if (this.lspClient === undefined) {
      return ok({ healthy: true, lsp: 'unavailable', detail: 'no language server was configured' });
    }
    if (!this.lspClient.isAlive()) {
      return ok({
        healthy: true,
        lsp: 'unavailable',
        detail: 'the language server is not running',
      });
    }
    return ok({ healthy: true, lsp: 'available' });
  }

  /** Release the language server process, when there is one (P-341). */
  async shutdown(): Promise<Result<void, StitchError>> {
    if (this.lspClient === undefined) return ok(undefined);
    return this.lspClient.shutdown();
  }

  private readonly rootDir: string;
  private readonly lspClient: LspClient | undefined;
  private readonly extraRoots: readonly string[];
  private readonly context: GoBuildContext;

  constructor(options: GoResolverOptions) {
    this.rootDir = resolvePath(options.rootDir);
    this.lspClient = options.lspClient;
    this.extraRoots = options.moduleRoots ?? [];
    this.context = options.buildContext ?? defaultBuildContext();
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
    return this.resolveViaModules(source, importSpec);
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
      textDocument: { uri, languageId: 'go', version: 1, text },
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

  /** The module-graph path — the fallback when the server is not there. */
  private resolveViaModules(
    source: string,
    importPath: string
  ): Result<ResolvedImport[], StitchError> {
    const known = this.modules();
    if (known.isErr()) return err(known.error);
    for (const module of known.value) {
      const inside = relativeImport(importPath, module.path);
      if (inside === undefined) continue;
      const dir = inside === '' ? module.root : join(module.root, inside);
      const file = this.packageFile(dir);
      if (file === undefined) continue;
      return ok([this.edge(source, file)]);
    }
    // The vendor tree mirrors the import path exactly.
    for (const module of known.value) {
      const file = this.packageFile(join(module.root, 'vendor', importPath));
      if (file === undefined) continue;
      return ok([this.edge(source, file)]);
    }
    // Unresolved is a finding, not a failure.
    return ok([]);
  }

  /** The candidate modules: the workspace's own, the go.work ones, the extras. */
  private modules(): Result<GoModule[], StitchError> {
    const modules: GoModule[] = [];
    const own = this.ownModule();
    if (own.isErr()) return err(own.error);
    if (own.value !== undefined) modules.push(own.value);
    for (const module of readWorkspaceModules(this.rootDir)) {
      if (!modules.some(known => known.path === module.path)) modules.push(module);
    }
    for (const root of this.extraRoots) {
      const path = readModulePath(root);
      if (path === undefined) continue;
      if (!modules.some(known => known.path === path)) modules.push({ path, root });
    }
    return ok(modules);
  }

  /** The workspace's own module; a go.mod that will not parse is an error. */
  private ownModule(): Result<GoModule | undefined, StitchError> {
    const modFile = join(this.rootDir, 'go.mod');
    if (!existsSync(modFile)) return ok(undefined);
    const path = readModulePath(this.rootDir);
    if (path === undefined) {
      return err({
        code: 'CONFIG_ERROR',
        field: 'resolve.gomod',
        message: `the go.mod of ${this.rootDir} could not be parsed`,
      });
    }
    return ok({ path, root: this.rootDir });
  }

  /** The package's .go file — the first one the build context accepts. */
  private packageFile(dir: string): string | undefined {
    if (!existsSync(dir)) return undefined;
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return undefined;
    }
    const files = names.filter(name => name.endsWith('.go')).sort();
    for (const name of files) {
      const file = join(dir, name);
      if (!this.excludedByBuildTags(file)) return file;
    }
    return undefined;
  }

  /** Is the file excluded by a `//go:build` constraint the context fails? */
  private excludedByBuildTags(file: string): boolean {
    const text = this.readText(file);
    if (text === undefined) return false;
    const head = text.split('\n').slice(0, 20).join('\n');
    const match = /^\s*\/\/go:build\s+(.+)$/m.exec(head);
    if (match === null || match[1] === undefined) return false;
    return !buildConstraintHolds(match[1], this.context);
  }

  private edge(source: string, target: string): ResolvedImport {
    return {
      sourceFile: this.relative(source),
      targetFile: this.relative(target),
      confidence: 'heuristic-medium',
    };
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
export function createGoResolver(options: GoResolverOptions): GoResolver {
  return new GoResolver(options);
}

/** The confidence values this resolver emits. */
export const GO_RESOLUTION_CONFIDENCES: readonly ResolutionConfidence[] = [
  'lsp-high',
  'heuristic-medium',
];
