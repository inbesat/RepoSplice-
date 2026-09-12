// GitHub repo tree (P-090): single-call recursive trees for the
// file-picker and tree UI (P-213/214) and source scoping (P-191).
// `getRepoTree` resolves the ref to a SHA (direct, branch, or default),
// fetches once via `git.getTree`, normalizes to flat + nested shapes,
// and filters through ignore/prune rules. Raw trees cache by resolved
// SHA (P-086 RefCache = the P-303 layer); filters apply post-cache so
// keys stay filter-free.
//
// Verified behavior (probed via nock against real Octokit v22 — do not
// assume otherwise):
// - `rest.git.getTree`, `rest.repos.getCommit`, `rest.repos.get` exist
//   with these exact names (P-089 lesson: seam names must mirror
//   Octokit — the nock suite proves it at compile time and runtime).
// - Octokit throws RequestError (`.status`, `.headers`) on non-2xx;
//   resolved responses are 2xx (non-2xx resolutions still map).
// - Recursive trees arrive flat (blobs + trees + submodule commits);
//   `truncated: true` marks server-side cutoffs.
//
// Safety contract:
// - Truncated trees REFUSE (fail-closed: pickers must never silently
//   miss files); malformed entries refuse whole-call (never invent
//   paths — P-089 listing precedent).
// - `defaultBranch: null` (empty repos) refuses with guidance instead
//   of resolving a branch that does not exist (P-087 lesson).
// - Rate limits map like P-089 (GITHUB_API_ERROR + retry-after
//   contract, never AUTH_ERROR); other statuses reuse the factory
//   taxonomy plus the login hint (P-088); no new codes (P-203 owns it).
// - Throwing seams map to typed errors; tests throw only inside vitest.
//
// Seams and future phases:
// - P-097 owns GraphQL (trees API only here — no half client);
//   P-096 owns retry/backoff (fail fast with retryAfter surfaced);
//   P-091 fetches contents (trees carry metadata + sizes only);
//   P-303 persists the cache (this module hands it raw SHA-keyed
//   trees); P-213/214 consume the nested shape.

import { ok, err, type Result } from 'neverthrow';
import type { StitchError } from '../result/index.js';
import { statusToStitchError } from './factory.js';
import { buildIgnoreMatcher } from '../util/ignore.js';
import { fetchCached, type RefCache } from '../git/perf.js';

export type TreeEntryType = 'blob' | 'tree' | 'commit';

const SHA_RE = /^[0-9a-f]{40}$/;

const LOGIN_HINT = 'run `stitch login` or check token scopes';

/** Flat entry: repo-relative POSIX path plus git metadata. */
export interface TreeNode {
  path: string;
  type: TreeEntryType;
  sha: string;
  /** Blob byte size (absent for trees; P-091 skips big blobs by this). */
  size?: number;
}

export type NestedKind = 'dir' | 'file' | 'submodule';

/** Picker-ready node (P-213/214): implicit dirs carry sha ''. */
export interface NestedEntry {
  name: string;
  path: string;
  kind: NestedKind;
  sha: string;
  size?: number;
  children?: NestedEntry[];
}

export interface RepoTree {
  flat: TreeNode[];
  nested: NestedEntry[];
}

export interface GetRepoTreeOpts {
  /** Branch name or SHA. Absent: the repo default branch. */
  ref?: string;
  /** Recursive single call. Default: true (false = top level only). */
  recursive?: boolean;
  /** Gitignore-style patterns dropped post-fetch (P-012 matcher). */
  ignore?: string[];
  /** Dir prefixes pruned post-fetch (P-091 defers their contents). */
  pruneDirs?: string[];
  /** Opt-in entry cap (fail-closed past it). Absent: uncapped. */
  maxEntries?: number;
  /** SHA-keyed raw-tree cache (P-303 layer). Absent: no caching. */
  cache?: RefCache<TreeNode[]>;
}

/** Narrow meta seam (real Octokit satisfies this structurally). */
export interface RepoMetaEndpoint {
  get(args: { owner: string; repo: string }): Promise<{
    data: unknown;
    headers: unknown;
    status: number;
  }>;
  getCommit(args: {
    owner: string;
    repo: string;
    ref: string;
  }): Promise<{ data: unknown; headers: unknown; status: number }>;
}

/** Narrow tree seam (`getTree`, mirroring Octokit exactly). */
export interface TreeEndpoint {
  getTree(args: {
    owner: string;
    repo: string;
    tree_sha: string;
    recursive?: string;
  }): Promise<{ data: unknown; headers: unknown; status: number }>;
}

/** Narrow client seam (no full-Octokit fakes in tests). */
export interface TreeClient {
  rest: { repos: RepoMetaEndpoint; git: TreeEndpoint };
}

function invalid(field: string, message: string): Result<never, StitchError> {
  return err({ code: 'CONFIG_ERROR', field, message });
}

function internalError(op: string, message: string): StitchError {
  return { code: 'INTERNAL', message: `${op}: ${message}` };
}

/** Non-blank string (type predicate so callers narrow safely). */
function isNonBlankString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function checkClient(client: TreeClient, op: string): Result<TreeClient, StitchError> {
  if (client === null || typeof client !== 'object') {
    return invalid('client', `${op}: client is required`);
  }
  return ok(client);
}

/** Status mapping reuses the factory taxonomy, enriched with the hint. */
function mapStatus(status: number, statusText: string, op: string): StitchError {
  const base = statusToStitchError(status, statusText, op);
  if (base.code !== 'AUTH_ERROR') return base;
  return { ...base, message: `${base.message} (${LOGIN_HINT})` };
}

/** Case-tolerant single-header read (plain bags and Headers instances). */
function headerValue(headers: unknown, name: string): string | undefined {
  if (typeof headers !== 'object' || headers === null) return undefined;
  const rec = headers as Record<string, unknown>;
  const direct = rec[name];
  if (typeof direct === 'string') return direct;
  const getter = rec['get'];
  if (typeof getter === 'function') {
    const out = (getter as (headerName: string) => unknown).call(rec, name);
    return typeof out === 'string' ? out : undefined;
  }
  return undefined;
}

/** Response headers off a thrown RequestError (direct bag, then nested). */
function thrownHeaders(error: object): unknown {
  const rec = error as { headers?: unknown; response?: unknown };
  if (rec.headers !== undefined) return rec.headers;
  if (typeof rec.response === 'object' && rec.response !== null) {
    return (rec.response as { headers?: unknown }).headers;
  }
  return undefined;
}

/** 429 outright; 403 only with the rate-limit signature (else auth). */
function isRateLimited(status: number, message: string, headers: unknown): boolean {
  if (status !== 403 && status !== 429) return false;
  if (status === 429) return true;
  const remaining = headerValue(headers, 'x-ratelimit-remaining');
  if (remaining !== undefined && remaining.trim() === '0') return true;
  return /rate limit/i.test(message);
}

/**
 * Seconds to wait: `retry-after` first, else the reset epoch, else null.
 * The `(retry after Ns)` message format is the P-096 parse contract.
 */
function retryAfterSecs(headers: unknown): number | null {
  const direct = headerValue(headers, 'retry-after');
  if (direct !== undefined) {
    const secs = Number(direct);
    if (Number.isFinite(secs) && secs >= 0) return Math.floor(secs);
  }
  const reset = headerValue(headers, 'x-ratelimit-reset');
  if (reset !== undefined) {
    const epoch = Number(reset);
    if (Number.isFinite(epoch)) {
      return Math.max(0, Math.ceil(epoch - Date.now() / 1000));
    }
  }
  return null;
}

function rateLimitError(op: string, status: number, headers: unknown): StitchError {
  const after = retryAfterSecs(headers);
  const when = after === null ? 'retry delay unknown' : `retry after ${after}s`;
  return {
    code: 'GITHUB_API_ERROR',
    status,
    message: `${op}: rate limited by GitHub (${when})`,
  };
}

/** Thrown-call mapping: rate limits first, then the status taxonomy. */
function mapCallError(op: string, error: unknown): StitchError {
  if (error instanceof Error) {
    const rec = error as { status?: unknown };
    const status = typeof rec.status === 'number' ? rec.status : 0;
    const headers = thrownHeaders(error);
    if (isRateLimited(status, error.message, headers)) {
      return rateLimitError(op, status, headers);
    }
    return mapStatus(status, error.message, op);
  }
  return {
    code: 'GITHUB_API_ERROR',
    status: 0,
    message: `${op} failed: ${String(error)}`,
  };
}

/** One raw call: throw-mapping plus resolved-status mapping. */
async function callJson(
  call: () => Promise<{ data: unknown; headers: unknown; status: number }>,
  what: string
): Promise<Result<unknown, StitchError>> {
  let response: { data: unknown; headers: unknown; status: number };
  try {
    response = await call();
  } catch (error: unknown) {
    return err(mapCallError(what, error));
  }
  if (response.status >= 400) {
    return err(mapStatus(response.status, '', what));
  }
  return ok(response.data);
}

/**
 * Ref to SHA: 40-hex passes through (no call); otherwise the commit is
 * resolved (branch names); absent refs fall back to the default branch
 * (which empty repos lack — refused with guidance, P-087 lesson).
 */
async function resolveRefSha(
  client: TreeClient,
  owner: string,
  repo: string,
  ref: string | undefined,
  op: string
): Promise<Result<string, StitchError>> {
  let name = ref;
  if (name === undefined) {
    const meta = await callJson(() => client.rest.repos.get({ owner, repo }), `${op} repos.get`);
    if (meta.isErr()) return err(meta.error);
    const branch = (meta.value as { default_branch?: unknown }).default_branch;
    if (!isNonBlankString(branch)) {
      return err({
        code: 'CONFIG_ERROR',
        field: 'repo',
        message: `${op}: repo has no default branch (empty?)`,
      });
    }
    name = branch;
  }
  if (SHA_RE.test(name)) return ok(name);
  const commit = await callJson(
    () => client.rest.repos.getCommit({ owner, repo, ref: name as string }),
    `${op} repos.getCommit`
  );
  if (commit.isErr()) return err(commit.error);
  const sha = (commit.value as { sha?: unknown }).sha;
  if (!isNonBlankString(sha) || !SHA_RE.test(sha)) {
    return err(internalError(op, `commit sha malformed for ref "${name}"`));
  }
  return ok(sha);
}

function parseTreeEntry(data: unknown, where: string): Result<TreeNode, StitchError> {
  if (typeof data !== 'object' || data === null) {
    return err(internalError(where, 'entry malformed (not an object)'));
  }
  const rec = data as { path?: unknown; type?: unknown; sha?: unknown; size?: unknown };
  if (!isNonBlankString(rec.path)) {
    return err(internalError(where, 'entry malformed (path)'));
  }
  if (rec.type !== 'blob' && rec.type !== 'tree' && rec.type !== 'commit') {
    return err(internalError(where, 'entry malformed (type)'));
  }
  if (!isNonBlankString(rec.sha) || !SHA_RE.test(rec.sha)) {
    return err(internalError(where, 'entry malformed (sha)'));
  }
  let size: number | undefined;
  if (rec.size !== undefined && rec.size !== null) {
    if (typeof rec.size !== 'number' || !Number.isInteger(rec.size) || rec.size < 0) {
      return err(internalError(where, 'entry malformed (size)'));
    }
    size = rec.size;
  }
  return ok({
    path: rec.path,
    type: rec.type,
    sha: rec.sha,
    ...(size !== undefined ? { size } : {}),
  });
}

/** Raw nodes at a SHA (single call; truncation refuses, never partial). */
async function fetchTreeNodes(
  client: TreeClient,
  owner: string,
  repo: string,
  sha: string,
  recursive: boolean,
  op: string
): Promise<Result<TreeNode[], StitchError>> {
  const body = await callJson(
    () =>
      client.rest.git.getTree({
        owner,
        repo,
        tree_sha: sha,
        ...(recursive ? { recursive: 'true' } : {}),
      }),
    `${op} git.getTree`
  );
  if (body.isErr()) return err(body.error);
  const payload = body.value;
  if (typeof payload !== 'object' || payload === null) {
    return err(internalError(op, 'tree body malformed (not an object)'));
  }
  const rec = payload as { sha?: unknown; truncated?: unknown; tree?: unknown };
  if (!isNonBlankString(rec.sha) || !SHA_RE.test(rec.sha)) {
    return err(internalError(op, 'tree body malformed (sha)'));
  }
  if (rec.truncated === true) {
    return err({
      code: 'GITHUB_API_ERROR',
      status: 200,
      message: `${op}: tree truncated by GitHub for ${owner}/${repo}@${sha} (too large for a single call)`,
    });
  }
  if (!Array.isArray(rec.tree)) {
    return err(internalError(op, 'tree body malformed (entries not an array)'));
  }
  const nodes: TreeNode[] = [];
  for (const [index, raw] of rec.tree.entries()) {
    const parsed = parseTreeEntry(raw, `${op} entry ${index}`);
    if (parsed.isErr()) return err(parsed.error);
    nodes.push(parsed.value);
  }
  return ok(nodes);
}

function normalizePruneDir(dir: string): string {
  return dir.trim().replace(/^\/+/, '').replace(/\/+$/, '');
}

/** Flat nodes to the picker shape: implicit dirs, sorted siblings. */
export function buildNestedTree(nodes: TreeNode[]): NestedEntry[] {
  // Index children by parent path (insertion-ordered) plus every
  // intermediate dir (synthesized when the listing omits parents, e.g.
  // after ignore/prune filtering) and explicit empty dirs. Name ties
  // (file vs dir, impossible from GitHub) order files first, stably.
  const byParent = new Map<string, TreeNode[]>();
  const allDirs = new Set<string>();
  const dirSha = new Map<string, string>();
  for (const node of nodes) {
    const parent = parentPath(node.path);
    const bucket = byParent.get(parent);
    if (bucket === undefined) byParent.set(parent, [node]);
    else bucket.push(node);
    if (node.type === 'tree') {
      allDirs.add(node.path);
      dirSha.set(node.path, node.sha);
    }
    let rest = node.path;
    for (;;) {
      const slash = rest.lastIndexOf('/');
      if (slash === -1) break;
      rest = rest.slice(0, slash);
      allDirs.add(rest);
    }
  }
  const build = (dirPath: string): NestedEntry[] => {
    const prefix = dirPath === '' ? '' : `${dirPath}/`;
    const out: NestedEntry[] = [];
    for (const node of byParent.get(dirPath) ?? []) {
      if (node.type === 'tree') continue;
      out.push({
        name: node.path.slice(prefix.length),
        path: node.path,
        kind: node.type === 'commit' ? 'submodule' : 'file',
        sha: node.sha,
        ...(node.size !== undefined ? { size: node.size } : {}),
      });
    }
    for (const dir of allDirs) {
      if (!dir.startsWith(prefix)) continue;
      const rest = dir.slice(prefix.length);
      if (rest.includes('/')) continue;
      out.push({
        name: rest,
        path: dir,
        kind: 'dir',
        sha: dirSha.get(dir) ?? '',
        children: build(dir),
      });
    }
    // Sibling names are unique per map construction, so equals never
    // occurs (documented, not branched).
    return out.sort((a, b) => (a.name < b.name ? -1 : 1));
  };
  return build('');
}

/** Parent path of a repo-relative path ('' for top-level entries). */
function parentPath(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? '' : path.slice(0, slash);
}

/**
 * Recursive repo tree in one call: resolve the ref, fetch at its SHA
 * (cached raw when a cache is given), then filter, cap, and nest.
 * Filters apply post-cache so keys stay filter-free.
 */
export async function getRepoTree(
  client: TreeClient,
  owner: string,
  repo: string,
  opts: GetRepoTreeOpts = {}
): Promise<Result<RepoTree, StitchError>> {
  const op = 'getRepoTree';
  if (!isNonBlankString(owner)) {
    return invalid('owner', `${op}: owner is required`);
  }
  if (!isNonBlankString(repo)) {
    return invalid('repo', `${op}: repo is required`);
  }
  const checked = checkClient(client, op);
  if (checked.isErr()) return err(checked.error);
  if (opts.ref !== undefined && !isNonBlankString(opts.ref)) {
    return invalid('ref', `${op}: ref must not be blank`);
  }
  if (opts.recursive !== undefined && typeof opts.recursive !== 'boolean') {
    return invalid('recursive', `${op}: recursive must be a boolean`);
  }
  if (opts.ignore !== undefined && !Array.isArray(opts.ignore)) {
    return invalid('ignore', `${op}: ignore must be an array of patterns`);
  }
  if (opts.ignore !== undefined) {
    for (const [index, pattern] of opts.ignore.entries()) {
      if (typeof pattern !== 'string') {
        return invalid('ignore', `${op}: ignore[${index}] must be a string`);
      }
    }
  }
  if (opts.pruneDirs !== undefined && !Array.isArray(opts.pruneDirs)) {
    return invalid('pruneDirs', `${op}: pruneDirs must be an array of dir paths`);
  }
  const pruned: string[] = [];
  if (opts.pruneDirs !== undefined) {
    for (const [index, dir] of opts.pruneDirs.entries()) {
      if (!isNonBlankString(dir)) {
        return invalid('pruneDirs', `${op}: pruneDirs[${index}] must not be blank`);
      }
      pruned.push(normalizePruneDir(dir));
    }
  }
  if (
    opts.maxEntries !== undefined &&
    (!Number.isInteger(opts.maxEntries) || opts.maxEntries < 1)
  ) {
    return invalid('maxEntries', `${op}: maxEntries must be an integer >= 1`);
  }
  if (opts.cache !== undefined && typeof opts.cache?.get !== 'function') {
    return invalid('cache', `${op}: cache is required`);
  }
  const recursive = opts.recursive ?? true;
  const key = `${owner}/${repo}@${opts.ref ?? ''}`;
  const resolveSha = (): Promise<Result<string, StitchError>> =>
    resolveRefSha(checked.value, owner, repo, opts.ref, op);
  const fetch = (sha: string): Promise<Result<TreeNode[], StitchError>> =>
    fetchTreeNodes(checked.value, owner, repo, sha, recursive, op);
  let nodes: TreeNode[];
  if (opts.cache === undefined) {
    const sha = await resolveSha();
    if (sha.isErr()) return err(sha.error);
    const fetched = await fetch(sha.value);
    if (fetched.isErr()) return err(fetched.error);
    nodes = fetched.value;
  } else {
    const cached = await fetchCached(opts.cache, key, resolveSha, fetch);
    if (cached.isErr()) return err(cached.error);
    nodes = cached.value.value;
  }
  return finishTree(nodes, opts, op);
}

/** Post-cache shaping shared by the cached and uncached paths. */
function finishTree(
  raw: TreeNode[],
  opts: GetRepoTreeOpts,
  op: string
): Result<RepoTree, StitchError> {
  let matcher: ((path: string) => boolean) | null = null;
  if (opts.ignore !== undefined) {
    try {
      matcher = buildIgnoreMatcher(opts.ignore);
    } catch {
      // Defensive only (probed P-083: non-empty strings never throw, and
      // elements are validated above); the no-throw rule needs the guard.
      return err(internalError(op, 'ignore matcher failed'));
    }
  }
  const pruned: string[] = [];
  if (opts.pruneDirs !== undefined) {
    for (const dir of opts.pruneDirs) {
      pruned.push(normalizePruneDir(dir));
    }
  }
  const kept = raw.filter(node => {
    if (matcher !== null && matcher(node.path)) return false;
    if (pruned.some(dir => node.path === dir || node.path.startsWith(`${dir}/`))) return false;
    return true;
  });
  if (opts.maxEntries !== undefined && kept.length > opts.maxEntries) {
    return err({
      code: 'GITHUB_API_ERROR',
      status: 0,
      message: `${op}: tree exceeds maxEntries ${opts.maxEntries} (${kept.length} entries): raise maxEntries or pruneDirs`,
    });
  }
  return ok({ flat: kept, nested: buildNestedTree(kept) });
}
