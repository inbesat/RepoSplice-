// P-337 — the Python import resolver.
//
// Two paths, one contract: the language server answers when it is available
// (pyright over LSP — confidence `lsp-high`), jedi answers when it is not
// (confidence `heuristic-medium`). The shape mirrors the TS resolver (P-336):
// the caller never has to know which path produced an edge; it reads the
// confidence tag.
//
// An import that resolves to nothing is NOT an error: the resolver returns an
// empty edge list, because "this import is unresolved" is a finding, not a
// failure of the resolver. Only a failure of the resolver itself (no python,
// no jedi, an unreadable file) is an error.
//
// jedi is a PYTHON package, so the resolver reaches it through a small bridge
// script (jedi_helper.py) instead of importing it in node.

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
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

/** The jedi bridge: it resolves one specifier and returns the target paths. */
export type JediRunner = (
  filePath: string,
  importSpec: string
) => Promise<Result<readonly string[], StitchError>>;

export interface PythonResolverOptions {
  /** The workspace root — every reported path is relative to it. */
  readonly rootDir: string;
  /** The language server (P-335). Absent = the jedi path only. */
  readonly lspClient?: LspClient;
  /** The jedi bridge. Absent = the real bridge (jedi_helper.py) is used. */
  readonly jediRunner?: JediRunner;
  /** The python interpreter that runs the bridge. */
  readonly pythonPath?: string;
  /** The bridge script. Absent = the one next to this module. */
  readonly jediHelperPath?: string;
  /** Extra sys.path roots searched for absolute imports. */
  readonly sysPaths?: readonly string[];
}

interface Position {
  readonly line: number;
  readonly character: number;
}

/**
 * The python interpreters to try, in order.
 *
 * `STITCH_PYTHON` and `PYTHON` are the explicit overrides; the PATH names
 * come next (the right ones on Linux/macOS/CI); the Windows Store aliases
 * (`python.exe` in WindowsApps) are stubs that resolve to nothing, so the
 * real interpreter of a pythoncore install is the last resort.
 */
const PYTHON_CANDIDATES: readonly string[] = [
  process.env['STITCH_PYTHON'] ?? '',
  process.env['PYTHON'] ?? '',
  'python3',
  'python',
  'C:\\Users\\Lenovo\\AppData\\Local\\Python\\pythoncore-3.14-64\\python.exe',
];

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

/** The last segment of a dotted specifier (the identifier a server wants). */
function tailOf(importSpec: string): string {
  const cut = importSpec.lastIndexOf('.');
  return cut === -1 ? importSpec : importSpec.slice(cut + 1);
}

/**
 * The position of the specifier's identifier inside a source file.
 *
 * A dotted python specifier (`.module`, `pkg.module`) is not a position a
 * server can resolve — the identifier is. The specifier's own occurrence
 * gives the anchor; when the file spells the import differently (a
 * `from pkg.sub import child` for the specifier `pkg.sub.child`) the tail
 * alone is looked up.
 */
function positionOfSpecifier(text: string, importSpec: string): Position | undefined {
  const tail = tailOf(importSpec);
  let index = text.indexOf(importSpec);
  let offset: number;
  if (index === -1) {
    index = text.indexOf(tail);
    offset = 0;
  } else {
    offset = importSpec.length - tail.length;
  }
  if (index === -1) return undefined;
  const at = index + offset;
  const upTo = text.slice(0, at);
  const line = upTo.split('\n').length - 1;
  const lastBreak = upTo.lastIndexOf('\n');
  const character = lastBreak === -1 ? at : at - lastBreak - 1;
  return { line, character };
}

export class PythonResolver implements DependencyResolver {
  readonly language = 'python';

  /** What this resolver can do (P-341). */
  getCapabilities(): ResolverCapabilities {
    return {
      language: this.language,
      strategies: ['lsp-high', 'heuristic-medium'],
      lsp: this.lspClient === undefined ? 'absent' : 'configured',
    };
  }

  /** Probe the language server; the jedi fallback needs no server (P-341). */
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
  private readonly injectedJedi: JediRunner | undefined;
  private readonly pythonPath: string | undefined;
  private readonly helperPath: string;
  private readonly sysPaths: readonly string[];

  constructor(options: PythonResolverOptions) {
    this.rootDir = resolvePath(options.rootDir);
    this.lspClient = options.lspClient;
    this.injectedJedi = options.jediRunner;
    this.pythonPath = options.pythonPath;
    this.helperPath = options.jediHelperPath ?? join(import.meta.dirname, 'jedi_helper.py');
    this.sysPaths = options.sysPaths ?? [];
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
    return this.resolveViaJedi(source, importSpec);
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
      textDocument: { uri, languageId: 'python', version: 1, text },
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

  /** The jedi path — the fallback when the language server is not there. */
  private async resolveViaJedi(
    source: string,
    importSpec: string
  ): Promise<Result<ResolvedImport[], StitchError>> {
    const runner = this.injectedJedi ?? ((file, spec) => this.runJediBridge(file, spec));
    const resolved = await runner(source, importSpec);
    if (resolved.isErr()) return err(resolved.error);
    const edges: ResolvedImport[] = [];
    for (const target of resolved.value) {
      edges.push({
        sourceFile: this.relative(source),
        targetFile: this.relative(target),
        confidence: 'heuristic-medium',
      });
    }
    return ok(edges);
  }

  /** Run the jedi bridge with the python interpreter. */
  private async runJediBridge(
    filePath: string,
    importSpec: string
  ): Promise<Result<readonly string[], StitchError>> {
    if (!existsSync(this.helperPath)) {
      return err({
        code: 'CONFIG_ERROR',
        field: 'resolve.jedi',
        message: `the jedi bridge is missing: ${this.helperPath}`,
      });
    }
    let lastFailure = 'no python interpreter answered';
    for (const candidate of this.pythonCandidates()) {
      // The workspace root travels with the bridge: an absolute import (a
      // package beside the file) has to resolve the way it would on the
      // real sys.path.
      const run = await this.spawnPython(candidate, [
        this.helperPath,
        filePath,
        importSpec,
        this.rootDir,
        ...this.sysPaths,
      ]);
      if (run === undefined) continue; // the interpreter does not exist here
      if (run.ok) return ok(run.targets);
      lastFailure = run.detail;
      if (run.missingJedi) break; // the interpreter is there, jedi is not
    }
    return err({
      code: 'CONFIG_ERROR',
      field: 'resolve.jedi',
      message: `jedi could not resolve ${importSpec}: ${lastFailure}`,
    });
  }

  private pythonCandidates(): readonly string[] {
    const configured = this.pythonPath;
    if (configured !== undefined && configured !== '') return [configured];
    return PYTHON_CANDIDATES.filter(candidate => candidate !== '');
  }

  private async spawnPython(
    python: string,
    args: readonly string[]
  ): Promise<
    | { readonly ok: true; readonly targets: readonly string[] }
    | { readonly ok: false; readonly detail: string; readonly missingJedi: boolean }
    | undefined
  > {
    return new Promise(resolve => {
      let stdout = '';
      let stderr = '';
      let settled = false;
      const child = spawn(python, [...args], { stdio: ['ignore', 'pipe', 'pipe'] });
      child.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8');
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8');
      });
      child.on('error', () => {
        if (settled) return;
        settled = true;
        resolve(undefined); // the interpreter does not exist here
      });
      child.on('close', code => {
        if (settled) return;
        settled = true;
        if (code === 0) {
          resolve({ ok: true, targets: this.parseTargets(stdout) });
          return;
        }
        const detail = (stderr.trim() || stdout.trim() || `exit code ${String(code)}`).slice(-400);
        resolve({ ok: false, detail, missingJedi: /jedi/i.test(detail) });
      });
    });
  }

  private parseTargets(stdout: string): readonly string[] {
    for (const line of stdout.split('\n').reverse()) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('{')) continue;
      try {
        const parsed = JSON.parse(trimmed) as { targets?: unknown };
        if (Array.isArray(parsed.targets)) {
          return parsed.targets.filter((target): target is string => typeof target === 'string');
        }
      } catch {
        // Not our line — keep looking.
      }
    }
    return [];
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
export function createPythonResolver(options: PythonResolverOptions): PythonResolver {
  return new PythonResolver(options);
}

/** The confidence values this resolver emits (the same set as the TS one). */
export const RESOLUTION_CONFIDENCES: readonly ResolutionConfidence[] = [
  'lsp-high',
  'heuristic-medium',
];
