// P-339 — the Rust import resolver (BEST-EFFORT).
//
// Rust's module graph is the most complex of the four languages: `crate::`,
// `self::` and `super::` paths, `mod.rs` versus inline modules, cfg attributes
// and macros all bend the shape of what a "module" is. This resolver is
// therefore documented as best-effort (ARCHITECTURE.md, Extension Points): the
// language server (rust-analyzer) answers when it is available (confidence
// `lsp-high`), the deterministic module-graph fallback answers when it is not
// (confidence `heuristic-medium`) — but for complex module graphs the
// tree-sitter heuristic (P-020) is the primary tool, not this one.
//
// An import that resolves to nothing is NOT an error: the resolver returns an
// empty edge list, because "this import is unresolved" is a finding, not a
// failure of the resolver. Only a failure of the resolver itself is an error.

import { existsSync, readFileSync } from 'node:fs';
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve as resolvePath,
  sep,
} from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { err, ok, type Result } from 'neverthrow';
import type { StitchError } from '../result/index.js';
import type { LspClient } from './lsp-client.js';
import type { DependencyResolver, ResolvedImport, ResolutionConfidence } from './types.js';

/** The compilation context the `#[cfg(...)]` attributes are evaluated against. */
export interface RustBuildContext {
  readonly features: readonly string[];
  readonly targetOs: string;
  readonly targetArch: string;
}

export interface RustResolverOptions {
  /** The workspace root — every reported path is relative to it. */
  readonly rootDir: string;
  /** The language server (P-335). Absent = the module graph only. */
  readonly lspClient?: LspClient;
  /** The compilation context; the defaults target linux/x86_64, no features. */
  readonly buildContext?: RustBuildContext;
}

interface Position {
  readonly line: number;
  readonly character: number;
}

function defaultBuildContext(): RustBuildContext {
  return {
    features: [],
    targetOs: process.env['CARGO_CFG_TARGET_OS'] ?? 'linux',
    targetArch: process.env['CARGO_CFG_TARGET_ARCH'] ?? 'x86_64',
  };
}

/** The crate name of a Cargo.toml, or undefined when it has no `[package]`. */
function readCrateName(crateRoot: string): string | undefined {
  const manifest = join(crateRoot, 'Cargo.toml');
  if (!existsSync(manifest)) return undefined;
  try {
    const text = readFileSync(manifest, 'utf8');
    const match = /^\s*name\s*=\s*"([^"]+)"\s*$/m.exec(text);
    return match?.[1];
  } catch {
    return undefined;
  }
}

/** Does a single cfg predicate hold in the compilation context? */
function predicateHolds(predicate: string, context: RustBuildContext): boolean {
  const trimmed = predicate.trim();
  if (trimmed === '') return true;
  const all = /^all\(([\s\S]*)\)$/.exec(trimmed);
  if (all?.[1] !== undefined) {
    return splitArguments(all[1]).every(part => predicateHolds(part, context));
  }
  const any = /^any\(([\s\S]*)\)$/.exec(trimmed);
  if (any?.[1] !== undefined) {
    return splitArguments(any[1]).some(part => predicateHolds(part, context));
  }
  const not = /^not\(([\s\S]*)\)$/.exec(trimmed);
  if (not?.[1] !== undefined) return !predicateHolds(not[1], context);
  const keyValue = /^(\w+)\s*=\s*"([^"]*)"$/.exec(trimmed);
  if (keyValue?.[1] !== undefined && keyValue[2] !== undefined) {
    const key = keyValue[1];
    const value = keyValue[2];
    if (key === 'feature') return context.features.includes(value);
    if (key === 'target_os') return context.targetOs === value;
    if (key === 'target_arch') return context.targetArch === value;
    // An unknown key/value pair: keep the file rather than drop it, because a
    // wrong drop hides a real import (this resolver is best-effort).
    return true;
  }
  if (trimmed === 'unix') return context.targetOs !== 'windows';
  if (trimmed === 'windows') return context.targetOs === 'windows';
  // A bare custom cfg or an unknown predicate: keep the file.
  return true;
}

/** Split a cfg argument list on top-level commas. */
function splitArguments(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const character of body) {
    if (character === '(') depth += 1;
    if (character === ')') depth -= 1;
    if (character === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += character;
  }
  parts.push(current);
  return parts.map(part => part.trim()).filter(part => part !== '');
}

/** Does a whole `#[cfg(...)]` expression hold? */
export function cfgHolds(expression: string, context: RustBuildContext): boolean {
  return predicateHolds(expression, context);
}

/** The position of an import path inside a source file. */
function positionOfSpecifier(text: string, importPath: string): Position | undefined {
  const tail = importPath.slice(importPath.lastIndexOf('::') + 2);
  let index = text.indexOf(importPath);
  let offset: number;
  if (index === -1) {
    index = text.indexOf(tail);
    offset = 0;
  } else {
    offset = importPath.length - tail.length;
  }
  if (index === -1) return undefined;
  const at = index + offset;
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

export class RustResolver implements DependencyResolver {
  readonly language = 'rust';

  private readonly rootDir: string;
  private readonly lspClient: LspClient | undefined;
  private readonly context: RustBuildContext;

  constructor(options: RustResolverOptions) {
    this.rootDir = resolvePath(options.rootDir);
    this.lspClient = options.lspClient;
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
      textDocument: { uri, languageId: 'rust', version: 1, text },
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
    const crate = this.crateRoot();
    if (crate.isErr()) return err(crate.error);
    const srcRoot = crate.value.srcRoot;
    const segments = importPath.split('::').filter(segment => segment !== '');
    if (segments.length === 0) return ok([]);
    const head = segments[0];
    let base: string | undefined;
    if (head === 'crate') {
      base = join(srcRoot, ...segments.slice(1));
    } else if (head === 'self') {
      base = join(this.moduleDirOf(source, srcRoot), ...segments.slice(1));
    } else if (head === 'super') {
      base = join(dirname(this.moduleDirOf(source, srcRoot)), ...segments.slice(1));
    }
    if (base === undefined || base === '') {
      // A bare path is an external crate: the registry is not on disk here.
      return ok([]);
    }
    const file = this.moduleFile(base);
    if (file === undefined) return ok([]);
    return ok([this.edge(source, file)]);
  }

  /** The crate root: the source root plus the manifest check. */
  private crateRoot(): Result<{ readonly srcRoot: string }, StitchError> {
    const manifest = join(this.rootDir, 'Cargo.toml');
    const srcRoot = join(this.rootDir, 'src');
    if (!existsSync(manifest)) {
      return ok({ srcRoot: existsSync(srcRoot) ? srcRoot : this.rootDir });
    }
    const name = readCrateName(this.rootDir);
    if (name === undefined) {
      return err({
        code: 'CONFIG_ERROR',
        field: 'resolve.cargo',
        message: `the Cargo.toml of ${this.rootDir} has no [package] name`,
      });
    }
    return ok({ srcRoot: existsSync(srcRoot) ? srcRoot : this.rootDir });
  }

  /** The directory a file's own module lives in (for self:: and super::). */
  private moduleDirOf(filePath: string, srcRoot: string): string {
    const name = basename(filePath);
    const dir = dirname(filePath);
    if (name === 'mod.rs') return dir;
    if (name === 'main.rs' || name === 'lib.rs') return srcRoot;
    return join(dir, name.replace(/\.rs$/, ''));
  }

  /** The file a module path points at: `<path>.rs` or `<path>/mod.rs`. */
  private moduleFile(modulePath: string): string | undefined {
    const flat = `${modulePath}.rs`;
    if (existsSync(flat) && !this.excludedByCfg(flat)) return flat;
    const nested = join(modulePath, 'mod.rs');
    if (existsSync(nested) && !this.excludedByCfg(nested)) return nested;
    return undefined;
  }

  /** Is the file gated out by an inner `#![cfg(...)]` the context fails? */
  private excludedByCfg(file: string): boolean {
    const text = this.readText(file);
    if (text === undefined) return false;
    const match = /^#!\[cfg\(([\s\S]*?)\)\]/m.exec(text);
    if (match === null || match[1] === undefined) return false;
    return !cfgHolds(match[1], this.context);
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
export function createRustResolver(options: RustResolverOptions): RustResolver {
  return new RustResolver(options);
}

/** The confidence values this resolver emits. */
export const RUST_RESOLUTION_CONFIDENCES: readonly ResolutionConfidence[] = [
  'lsp-high',
  'heuristic-medium',
];
