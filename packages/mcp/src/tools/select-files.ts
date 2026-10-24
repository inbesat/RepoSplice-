/**
 * P-358 — the `stitch_select_files` MCP tool (Epic 19, the browsing half).
 *
 * The tool answers one question for a host agent: what is in this repository,
 * and which of it can be stitched? It resolves the repository (a local path or
 * a remote URL) to a working directory, lists the files with the metadata a
 * picker needs — size, language, the commit that last touched the file — and
 * pages the result so a large repository cannot flood the host context.
 *
 * Every project capability the tool needs arrives as an injectable PORT
 * (the P-348/P-357 precedent), and the real ports are assembled from the core
 * PUBLIC BARREL at load time. The module therefore has no runtime dependency on
 * the barrel: it can be imported and unit-tested on its own, and the remote
 * branch can be exercised without a network.
 */
import { execFile } from 'node:child_process';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, posix, resolve } from 'node:path';
import { promisify } from 'node:util';

import { err, ok, type Result } from 'neverthrow';

import type { StitchError } from '@repo-stitcher/core';

import type { ToolDefinition, ToolHandler, ToolInputSchema, ToolRegistry } from './registry.js';

export const SELECT_FILES_TOOL_NAME = 'stitch_select_files';
export const DEFAULT_PAGE_SIZE = 100;
export const MAX_PAGE_SIZE = 1000;
/** How many recent commits the single last-commit pass scans before it stops. */
export const LAST_COMMIT_SCAN_LIMIT = 300;

const GIT_MAX_BUFFER = 32 * 1024 * 1024;
const DEFAULT_IGNORE = ['**/node_modules/**', '**/.git/**'];

const execFileAsync = promisify(execFile);

/** The validated input, in camel case. */
export interface SelectFilesInput {
  readonly repoUrl?: string;
  readonly localPath?: string;
  readonly pathFilter?: string;
  readonly page?: number;
  readonly pageSize?: number;
}

/** One file in the listing, relative to the repository root. */
export interface FileNode {
  readonly path: string;
  readonly type: 'file';
  readonly size?: number;
  readonly language?: string;
  readonly lastCommit?: string;
}

/** What the listing knows about the repository itself. */
export interface RepoMeta {
  readonly source: 'local' | 'remote';
  readonly url?: string;
  readonly commit?: string;
  readonly branch?: string;
  readonly remote?: string;
  readonly fileCount: number;
  readonly ecosystems: readonly string[];
}

export interface SelectFilesOutput {
  readonly tree: readonly FileNode[];
  readonly repo_meta: RepoMeta;
  readonly page: number;
  readonly page_size: number;
  readonly total: number;
  readonly has_more: boolean;
  readonly path_filter?: string;
}

/** A file the enumeration pass found, already relative to the repository root. */
export interface RawEntry {
  readonly path: string;
  readonly size?: number;
}

/** The git facts about a repository, plus a newest-first path -> commit map. */
export interface RepoInspection {
  readonly commit?: string;
  readonly branch?: string;
  readonly remote?: string;
  readonly lastCommits: Readonly<Record<string, string>>;
}

/** A repository resolved to a directory on disk. */
export interface MaterializedRepo {
  readonly root: string;
  readonly source: 'local' | 'remote';
  readonly url?: string;
  /** Deletes a temporary clone. Never present for a local path. */
  readonly cleanup?: () => Promise<void>;
}

/** The seams the tool is built from; all injectable. */
export interface SelectFilesPorts {
  readonly materialize: (input: SelectFilesInput) => Promise<Result<MaterializedRepo, StitchError>>;
  readonly list: (root: string) => Promise<Result<readonly RawEntry[], StitchError>>;
  readonly inspect: (root: string) => Promise<Result<RepoInspection, StitchError>>;
  readonly ecosystems: (root: string) => Promise<Result<readonly string[], StitchError>>;
  readonly language: (path: string) => string | undefined;
}

export const SELECT_FILES_INPUT_SCHEMA: ToolInputSchema = {
  type: 'object',
  properties: {
    repo_url: {
      type: 'string',
      description: 'URL of the repository to browse. Mutually exclusive with local_path.',
    },
    local_path: {
      type: 'string',
      description: 'Path of a local repository to browse. Mutually exclusive with repo_url.',
    },
    path_filter: {
      type: 'string',
      description:
        'Repository-relative directory; only files at or under it are listed. Omit to list everything.',
    },
    page: { type: 'integer', minimum: 1, description: 'One-based page number. Defaults to 1.' },
    page_size: {
      type: 'integer',
      minimum: 1,
      maximum: MAX_PAGE_SIZE,
      description: `Files per page. Defaults to ${DEFAULT_PAGE_SIZE}, capped at ${MAX_PAGE_SIZE}.`,
    },
  },
  additionalProperties: false,
};

export const SELECT_FILES_TOOL: ToolDefinition = {
  name: SELECT_FILES_TOOL_NAME,
  description:
    'List the files of a repository (a local path or a remote URL) with size, language and ' +
    'last-commit metadata, so a host can choose what to stitch. Results are paged.',
  inputSchema: SELECT_FILES_INPUT_SCHEMA,
};

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function configError(field: string, message: string): StitchError {
  return { code: 'CONFIG_ERROR', field, message };
}

function internalError(message: string): StitchError {
  return { code: 'INTERNAL', message };
}

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

function sourceError(
  repoUrl: string | undefined,
  localPath: string | undefined
): StitchError | undefined {
  if (repoUrl === undefined && localPath === undefined) {
    return configError(
      'stitch_select_files.source',
      'exactly one of "repo_url" or "local_path" is required'
    );
  }
  if (repoUrl !== undefined && localPath !== undefined) {
    return configError(
      'stitch_select_files.source',
      '"repo_url" and "local_path" are mutually exclusive'
    );
  }
  return undefined;
}

function readPositiveInt(
  value: unknown,
  field: string,
  max: number | undefined
): Result<number | undefined, StitchError> {
  if (value === undefined || value === null) return ok(undefined);
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    return err(configError(field, `"${field}" must be a positive integer`));
  }
  if (max !== undefined && value > max) {
    return err(configError(field, `"${field}" must be at most ${max}`));
  }
  return ok(value);
}

/** Validates the raw tool arguments into the typed input. */
export function parseSelectFilesInput(
  args: Readonly<Record<string, unknown>>
): Result<SelectFilesInput, StitchError> {
  const repoUrl = asNonEmptyString(args.repo_url);
  const localPath = asNonEmptyString(args.local_path);
  const invalidSource = sourceError(repoUrl, localPath);
  if (invalidSource !== undefined) return err(invalidSource);
  const page = readPositiveInt(args.page, 'stitch_select_files.page', undefined);
  if (page.isErr()) return err(page.error);
  const pageSize = readPositiveInt(args.page_size, 'stitch_select_files.page_size', MAX_PAGE_SIZE);
  if (pageSize.isErr()) return err(pageSize.error);
  const pathFilter = asNonEmptyString(args.path_filter);
  return ok({
    ...(repoUrl !== undefined ? { repoUrl } : {}),
    ...(localPath !== undefined ? { localPath } : {}),
    ...(pathFilter !== undefined ? { pathFilter } : {}),
    ...(page.value !== undefined ? { page: page.value } : {}),
    ...(pageSize.value !== undefined ? { pageSize: pageSize.value } : {}),
  });
}

// shortcut: path_filter is a repository-relative directory prefix, not a glob;
// add glob support when a host asks to filter by extension or wildcard.
function matchesPathFilter(path: string, filter: string | undefined): boolean {
  if (filter === undefined) return true;
  const prefix = filter.replace(/\/+$/, '');
  if (prefix === '' || prefix === '.') return true;
  return path === prefix || path.startsWith(`${prefix}/`);
}

function comparePaths(left: string, right: string): number {
  if (left < right) return -1;
  return left > right ? 1 : 0;
}

function toFileNode(
  entry: RawEntry,
  inspection: RepoInspection,
  language: (path: string) => string | undefined
): FileNode {
  const detected = language(entry.path);
  const lastCommit = inspection.lastCommits[entry.path];
  return {
    path: entry.path,
    type: 'file',
    ...(entry.size !== undefined ? { size: entry.size } : {}),
    ...(detected !== undefined ? { language: detected } : {}),
    ...(lastCommit !== undefined ? { lastCommit } : {}),
  };
}

function compareEcosystems(left: string, right: string): number {
  return left.localeCompare(right);
}

interface BuildOutputArgs {
  readonly input: SelectFilesInput;
  readonly repo: MaterializedRepo;
  readonly entries: readonly RawEntry[];
  readonly inspection: RepoInspection;
  readonly ecosystems: readonly string[];
  readonly language: (path: string) => string | undefined;
}

/** Applies the filter, sorts, paginates and assembles the result. Pure. */
export function buildSelectFilesOutput(args: BuildOutputArgs): SelectFilesOutput {
  const scoped = args.entries
    .filter(entry => matchesPathFilter(entry.path, args.input.pathFilter))
    .slice()
    .sort((left, right) => comparePaths(left.path, right.path));
  const pageSize = args.input.pageSize ?? DEFAULT_PAGE_SIZE;
  const page = args.input.page ?? 1;
  const start = (page - 1) * pageSize;
  const slice = scoped.slice(start, start + pageSize);
  const inspection = args.inspection;
  return {
    tree: slice.map(entry => toFileNode(entry, inspection, args.language)),
    repo_meta: {
      source: args.repo.source,
      ...(args.repo.url !== undefined ? { url: args.repo.url } : {}),
      ...(inspection.commit !== undefined ? { commit: inspection.commit } : {}),
      ...(inspection.branch !== undefined ? { branch: inspection.branch } : {}),
      ...(inspection.remote !== undefined ? { remote: inspection.remote } : {}),
      fileCount: scoped.length,
      ecosystems: [...new Set(args.ecosystems)].sort(compareEcosystems),
    },
    page,
    page_size: pageSize,
    total: scoped.length,
    has_more: start + pageSize < scoped.length,
    ...(args.input.pathFilter !== undefined ? { path_filter: args.input.pathFilter } : {}),
  };
}

/** The handler: resolves the repo, lists it, and always cleans up the clone. */
export function createSelectFilesHandler(ports: SelectFilesPorts): ToolHandler {
  return async args => {
    const parsed = parseSelectFilesInput(args);
    if (parsed.isErr()) return err(parsed.error);
    const input = parsed.value;
    const materialized = await ports.materialize(input);
    if (materialized.isErr()) return err(materialized.error);
    const repo = materialized.value;
    // A port may hand back a native path; every listing is keyed on posix.
    const root = toPosixPath(repo.root);
    try {
      const listed = await ports.list(root);
      if (listed.isErr()) return err(listed.error);
      const inspected = await ports.inspect(root);
      if (inspected.isErr()) return err(inspected.error);
      const ecosystems = await ports.ecosystems(root);
      if (ecosystems.isErr()) return err(ecosystems.error);
      return ok(
        buildSelectFilesOutput({
          input,
          repo,
          entries: listed.value,
          inspection: inspected.value,
          ecosystems: ecosystems.value,
          language: ports.language,
        })
      );
    } finally {
      if (repo.cleanup !== undefined) await repo.cleanup();
    }
  };
}

/** Registers the tool. A duplicate name is the registry's own refusal. */
export function registerSelectFilesTool(
  registry: ToolRegistry,
  ports: SelectFilesPorts
): Result<string, StitchError> {
  const registered = registry.register(SELECT_FILES_TOOL, createSelectFilesHandler(ports));
  if (registered.isErr()) return err(registered.error);
  return ok(SELECT_FILES_TOOL_NAME);
}

/**
 * Turns `git log --format=@@%H --name-only` output into a newest-first
 * path -> commit map. A file keeps the FIRST commit it is seen under, which is
 * the newest one because git prints newest first.
 */
export function parseLastCommits(stdout: string): Record<string, string> {
  const lastCommits: Record<string, string> = {};
  let current: string | undefined;
  for (const raw of stdout.split('\n')) {
    const line = raw.trim();
    if (line === '') continue;
    if (line.startsWith('@@')) {
      current = line.slice(2);
      continue;
    }
    if (current !== undefined && lastCommits[line] === undefined) lastCommits[line] = current;
  }
  return lastCommits;
}

function toPosixPath(path: string): string {
  return path.replace(/\\/g, '/');
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function sizeOf(file: string): Promise<number | undefined> {
  try {
    const info = await stat(file);
    return info.isFile() ? info.size : undefined;
  } catch {
    return undefined;
  }
}

async function runGit(root: string, argv: readonly string[]): Promise<Result<string, StitchError>> {
  try {
    const { stdout } = await execFileAsync('git', ['-C', root, ...argv], {
      maxBuffer: GIT_MAX_BUFFER,
      windowsHide: true,
    });
    return ok(stdout);
  } catch (cause) {
    return err(internalError(`git ${argv[0] ?? ''} failed in ${root}: ${messageOf(cause)}`));
  }
}

async function runGitOptional(root: string, argv: readonly string[]): Promise<string | undefined> {
  const result = await runGit(root, argv);
  if (result.isErr()) return undefined;
  const value = result.value.trim();
  return value === '' ? undefined : value;
}

/** The real ports, assembled from the core barrel's functions. */
interface BarrelPorts {
  readonly listFiles: (
    root: string,
    patterns: string | readonly string[],
    options?: Readonly<Record<string, unknown>>
  ) => Promise<Result<readonly string[], StitchError>>;
  readonly languageForFile: (path: string) => string | undefined;
  readonly detectEcosystems: (
    root: string,
    options?: Readonly<Record<string, unknown>>
  ) => Promise<Result<readonly { readonly ecosystem: string }[], StitchError>>;
  readonly cloneRepo: (
    options: { readonly url: string; readonly targetDir: string },
    runtime?: Readonly<Record<string, unknown>>
  ) => Promise<Result<string, StitchError>>;
}

function createMaterialize(cloneRepo: BarrelPorts['cloneRepo']): SelectFilesPorts['materialize'] {
  return async input => {
    if (input.localPath !== undefined) {
      const root = resolve(input.localPath);
      if (!(await isDirectory(root))) {
        return err(
          configError(
            'stitch_select_files.local_path',
            `the local path "${input.localPath}" is not a directory`
          )
        );
      }
      return ok({ root: toPosixPath(root), source: 'local' });
    }
    const url = input.repoUrl;
    if (url === undefined) {
      return err(configError('stitch_select_files.source', 'a repository source is required'));
    }
    const target = await mkdtemp(join(tmpdir(), 'stitch-select-files-'));
    const cloned = await cloneRepo({ url, targetDir: toPosixPath(target) });
    if (cloned.isErr()) {
      await rm(target, { recursive: true, force: true });
      return err(cloned.error);
    }
    return ok({
      root: toPosixPath(target),
      source: 'remote',
      url,
      cleanup: async () => {
        await rm(target, { recursive: true, force: true });
      },
    });
  };
}

function createList(ports: BarrelPorts): SelectFilesPorts['list'] {
  return async root => {
    const found = await ports.listFiles(root, '**/*', {
      ignore: DEFAULT_IGNORE,
      dot: true,
      nodir: true,
    });
    if (found.isErr()) return err(found.error);
    const entries: RawEntry[] = [];
    for (const absolute of found.value) {
      const relative = posix.relative(root, toPosixPath(absolute));
      if (relative === '' || relative.startsWith('../')) continue;
      // `listFiles` still yields directories, so keep only regular files.
      const size = await sizeOf(absolute);
      if (size === undefined) continue;
      entries.push({ path: relative, size });
    }
    return ok(entries);
  };
}

function createInspect(): SelectFilesPorts['inspect'] {
  return async root => {
    const headResult = await runGit(root, ['rev-parse', 'HEAD']);
    if (headResult.isErr()) return err(headResult.error);
    const branch = await runGitOptional(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
    const remote = await runGitOptional(root, ['config', '--get', 'remote.origin.url']);
    const logResult = await runGit(root, [
      'log',
      `-n${LAST_COMMIT_SCAN_LIMIT}`,
      '--format=@@%H',
      '--name-only',
    ]);
    if (logResult.isErr()) return err(logResult.error);
    return ok({
      commit: headResult.value.trim(),
      ...(branch !== undefined ? { branch } : {}),
      ...(remote !== undefined ? { remote } : {}),
      lastCommits: parseLastCommits(logResult.value),
    });
  };
}

function createEcosystems(ports: BarrelPorts): SelectFilesPorts['ecosystems'] {
  return async root => {
    const found = await ports.detectEcosystems(root, {});
    if (found.isErr()) return err(found.error);
    return ok(found.value.map(entry => entry.ecosystem));
  };
}

/** Assembles the real ports from barrel functions (exported for the driver). */
export function createSelectFilesPorts(ports: BarrelPorts): SelectFilesPorts {
  return {
    materialize: createMaterialize(ports.cloneRepo),
    list: createList(ports),
    inspect: createInspect(),
    ecosystems: createEcosystems(ports),
    language: ports.languageForFile,
  };
}

/**
 * The real ports, assembled from the core public barrel. A missing barrel
 * export is reported rather than papered over.
 */
export async function loadSelectFilesPorts(): Promise<Result<SelectFilesPorts, StitchError>> {
  let barrel: Record<string, unknown>;
  try {
    barrel = (await import('@repo-stitcher/core')) as unknown as Record<string, unknown>;
  } catch (cause) {
    return err(configError('mcp.core', `the core barrel could not be loaded: ${messageOf(cause)}`));
  }
  const missing: string[] = [];
  const pick = <T>(name: string): T | undefined => {
    const value = barrel[name];
    if (value === undefined) {
      missing.push(name);
      return undefined;
    }
    return value as T;
  };
  const listFiles = pick<BarrelPorts['listFiles']>('listFiles');
  const languageForFile = pick<BarrelPorts['languageForFile']>('languageForFile');
  const detectEcosystems = pick<BarrelPorts['detectEcosystems']>('detectEcosystems');
  const cloneRepo = pick<BarrelPorts['cloneRepo']>('cloneRepo');
  if (missing.length > 0) {
    return err(configError('mcp.core', `the core barrel is missing ${missing.join(', ')}`));
  }
  if (
    listFiles === undefined ||
    languageForFile === undefined ||
    detectEcosystems === undefined ||
    cloneRepo === undefined
  ) {
    return err(configError('mcp.core', 'the core barrel is missing required exports'));
  }
  return ok(createSelectFilesPorts({ listFiles, languageForFile, detectEcosystems, cloneRepo }));
}
