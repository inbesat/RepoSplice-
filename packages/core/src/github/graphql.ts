// GitHub GraphQL trees (P-097): deep trees in one v4 query, normalized
// to the P-090 shape so the picker layer stays transport-agnostic.
// `graphqlTree` builds a depth-nested query, walks the response into
// flat nodes, filters, caps, and nests via P-090's builder. Unknown or
// unservable refs fall back to the REST path (which owns ref truth);
// anything else fails typed and loud.
//
// Verified behavior (probed against real Octokit v22 — do not assume
// otherwise):
// - `o.graphql(query, variables)` POSTs to /graphql and resolves the
//   DATA payload directly (no envelope); GraphQL `errors` arrive as a
//   THROWN error carrying `.errors` (no `.status`), never as a value.
// - Only `NOT_FOUND`-typed errors (or absent repositories/objects)
//   trigger the REST fallback; every other error maps without retrying
//   another transport.
// - Response entry `path`s are repo-root-relative; `type` spans blob,
//   tree, and commit (submodules); trees nest `object.entries` per
//   queried level.
//
// Safety contract:
// - Malformed entries refuse whole-call (never invent paths — P-089
//   listing precedent); server truncation has no GraphQL equivalent,
//   so the opt-in `maxEntries` cap is the large-tree guard here.
// - Filters apply post-fetch AND post-cache (cache keys carry depth and
//   resolved SHA, never filter state — P-090 rule).
// - Rate limits map with retry guidance (P-089 pattern, never
//   AUTH_ERROR); other statuses reuse the factory taxonomy plus the
//   login hint (P-088); no new codes (P-203 owns taxonomy).
// - Throwing seams map to typed errors; tests throw only inside vitest.
//
// Seams and future phases:
// - P-213/214 consume flat+nested (identical types via P-090 import);
//   P-096 loops this call with backoff (fail fast with retryAfter
//   surfaced); P-303 persists the cache (raw SHA-keyed trees handed
//   over); P-103 reads the same shapes for ecosystem detection.
// - Error mapping duplicates the sibling GitHub modules by codebase
//   convention (P-203 consolidates when the taxonomy lands).

import { ok, err, type Result } from 'neverthrow';
import type { StitchError } from '../result/index.js';
import { statusToStitchError } from './factory.js';
import { buildIgnoreMatcher } from '../util/ignore.js';
import { type RefCache } from '../git/perf.js';
import { buildNestedTree, getRepoTree, type TreeNode, type RepoTree } from './tree.js';

/** Re-exported so picker layers import one module (identical shape). */
export type { TreeNode, RepoTree };

const SHA_RE = /^[0-9a-f]{40}$/;

const LOGIN_HINT = 'run `stitch login` or check token scopes';
const DEFAULT_EXPRESSION = 'HEAD';
const DEFAULT_DEPTH = 1;

export interface GraphqlOpts {
  /** Rev/path expression (`main`, `abc123:src`, ...). Default: 'HEAD'. */
  expression?: string;
  /** Nesting levels >= 1. Default: 1 (top level only). */
  depth?: number;
  /** Gitignore-style patterns dropped post-fetch (P-012 matcher). */
  ignore?: string[];
  /** Dir prefixes pruned post-fetch (P-091 defers their contents). */
  pruneDirs?: string[];
  /** Opt-in entry cap (fail-closed past it). Absent: uncapped. */
  maxEntries?: number;
  /** SHA-keyed raw-tree cache (P-303 layer). Absent: no caching. */
  cache?: RefCache<TreeNode[]>;
}

/** Narrow GraphQL seam (shape mirrors octokit.graphql exactly). */
export interface GraphqlEndpoint {
  graphql(query: string, variables: Record<string, string>): Promise<unknown>;
}

/** Narrow client seam (P-090's REST seam plus the v4 query). */
export type GraphqlClient = import('./tree.js').TreeClient & {
  graphql(query: string, variables: Record<string, string>): Promise<unknown>;
};

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

function checkClient(client: GraphqlClient, op: string): Result<GraphqlClient, StitchError> {
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

/** GraphQL error list off a thrown failure (null when transport-level). */
function graphqlErrors(error: unknown): unknown[] | null {
  if (typeof error !== 'object' || error === null) return null;
  const errors = (error as { errors?: unknown }).errors;
  return Array.isArray(errors) ? errors : null;
}

function isNotFound(entry: unknown): boolean {
  return (
    typeof entry === 'object' &&
    entry !== null &&
    (entry as { type?: unknown }).type === 'NOT_FOUND'
  );
}

function graphqlError(op: string, errors: unknown[]): StitchError {
  const parts: string[] = [];
  for (const entry of errors) {
    if (typeof entry === 'object' && entry !== null) {
      const message = (entry as { message?: unknown }).message;
      if (typeof message === 'string') parts.push(message);
    }
  }
  const detail = parts.length > 0 ? parts.join('; ') : 'GraphQL request failed';
  return {
    code: 'GITHUB_API_ERROR',
    status: 0,
    message: `${op}: ${detail}`,
  };
}

/**
 * Depth-nested tree query (pure; assumes validated depth >= 1).
 * Level 1 selects bare entries; each deeper level nests one
 * `object { ... on Tree { ... } }` selector inside.
 */
export function buildTreeQuery(depth: number): string {
  const leaf = 'entries { name path oid type }';
  let inner = leaf;
  for (let i = 1; i < depth; i += 1) {
    inner = `entries { name path oid type object { ... on Tree { ${inner} } } }`;
  }
  return (
    'query ($owner: String!, $repo: String!, $expression: String!) ' +
    `{ repository(owner: $owner, name: $repo) { object(expression: $expression) { ... on Tree { ${inner} } } } }`
  );
}

function parseGqlEntry(data: unknown, where: string): Result<TreeNode, StitchError> {
  if (typeof data !== 'object' || data === null) {
    return err(internalError(where, 'entry malformed (not an object)'));
  }
  const rec = data as { path?: unknown; type?: unknown; oid?: unknown };
  if (!isNonBlankString(rec.path)) {
    return err(internalError(where, 'entry malformed (path)'));
  }
  if (rec.type !== 'blob' && rec.type !== 'tree' && rec.type !== 'commit') {
    return err(internalError(where, 'entry malformed (type)'));
  }
  if (!isNonBlankString(rec.oid) || !SHA_RE.test(rec.oid)) {
    return err(internalError(where, 'entry malformed (oid)'));
  }
  return ok({ path: rec.path, type: rec.type, sha: rec.oid });
}

function collectEntries(
  node: unknown,
  level: number,
  depth: number,
  op: string,
  where: string
): Result<TreeNode[], StitchError> {
  if (typeof node !== 'object' || node === null) {
    return err(internalError(where, 'entries malformed (not an object)'));
  }
  const entries = (node as { entries?: unknown }).entries;
  if (!Array.isArray(entries)) {
    return err(internalError(where, 'entries malformed (not an array)'));
  }
  const out: TreeNode[] = [];
  for (const [index, raw] of entries.entries()) {
    const parsed = parseGqlEntry(raw, `${where}[${index}]`);
    if (parsed.isErr()) return err(parsed.error);
    out.push(parsed.value);
    const child = (raw as { object?: unknown }).object;
    if (parsed.value.type === 'tree' && level < depth && child !== undefined && child !== null) {
      const nested = collectEntries(child, level + 1, depth, op, `${where}[${index}].object`);
      if (nested.isErr()) return err(nested.error);
      out.push(...nested.value);
    }
  }
  return ok(out);
}

function normalizePruneDir(dir: string): string {
  return dir.trim().replace(/^\/+/, '').replace(/\/+$/, '');
}

/** Post-fetch shaping shared by fresh and cached raw trees. */
function finishNodes(
  raw: TreeNode[],
  opts: { ignore?: string[]; pruneDirs?: string[]; maxEntries?: number },
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

/** REST fallback (P-090 owns ref truth): filters travel along. */
async function fallbackToRest(
  client: GraphqlClient,
  owner: string,
  repo: string,
  expression: string,
  depth: number,
  opts: GraphqlOpts
): Promise<Result<RepoTree, StitchError>> {
  return getRepoTree(client, owner, repo, {
    ref: expression,
    recursive: depth > 1,
    ...(opts.ignore !== undefined ? { ignore: opts.ignore } : {}),
    ...(opts.pruneDirs !== undefined ? { pruneDirs: opts.pruneDirs } : {}),
    ...(opts.maxEntries !== undefined ? { maxEntries: opts.maxEntries } : {}),
    ...(opts.cache !== undefined ? { cache: opts.cache } : {}),
  });
}

type FetchOutcome =
  | { kind: 'nodes'; nodes: TreeNode[] }
  | { kind: 'fallback' }
  | { kind: 'error'; error: StitchError };

/** One v4 fetch: nodes, REST fallback, or a typed error (never throws). */
async function attemptGraphql(
  client: GraphqlClient,
  owner: string,
  repo: string,
  expression: string,
  depth: number,
  op: string
): Promise<FetchOutcome> {
  const query = buildTreeQuery(depth);
  const variables = { owner, repo, expression };
  let payload: unknown;
  try {
    payload = await client.graphql(query, variables);
  } catch (error: unknown) {
    const errors = graphqlErrors(error);
    if (errors !== null && errors.some(isNotFound)) {
      return { kind: 'fallback' };
    }
    if (errors !== null) {
      return { kind: 'error', error: graphqlError(op, errors) };
    }
    return { kind: 'error', error: mapCallError(`${op} graphql`, error) };
  }
  if (typeof payload !== 'object' || payload === null) {
    return { kind: 'error', error: internalError(op, 'response malformed (not an object)') };
  }
  const repository = (payload as { repository?: unknown }).repository;
  if (repository === null || repository === undefined) {
    return { kind: 'fallback' };
  }
  if (typeof repository !== 'object') {
    return { kind: 'error', error: internalError(op, 'repository malformed') };
  }
  const object = (repository as { object?: unknown }).object;
  if (object === null || object === undefined) {
    return { kind: 'fallback' };
  }
  const collected = collectEntries(object, 1, depth, op, `${op} object`);
  if (collected.isErr()) return { kind: 'error', error: collected.error };
  return { kind: 'nodes', nodes: collected.value };
}

/**
 * Ref to SHA for cache keys (P-090 rule: keys carry resolved SHAs, so
 * branch moves refetch by construction).
 */
async function resolveRefSha(
  client: GraphqlClient,
  owner: string,
  repo: string,
  ref: string,
  op: string
): Promise<Result<string, StitchError>> {
  const name = ref;
  if (SHA_RE.test(name)) return ok(name);
  let commit: { data: unknown; headers: unknown; status: number };
  try {
    commit = await client.rest.repos.getCommit({ owner, repo, ref: name });
  } catch (error: unknown) {
    return err(mapCallError(`${op} repos.getCommit`, error));
  }
  if (commit.status >= 400) {
    return err(mapStatus(commit.status, '', `${op} repos.getCommit`));
  }
  const sha = (commit.data as { sha?: unknown }).sha;
  if (!isNonBlankString(sha) || !SHA_RE.test(sha)) {
    return err(internalError(op, `commit sha malformed for ref "${name}"`));
  }
  return ok(sha);
}

/**
 * One-query repo tree with REST fallback: resolve the cache key,
 * serve hits, else fetch v4, normalize, filter, cap, and nest.
 * Unknown/absent refs fall back (REST decides); all else maps typed.
 */
export async function graphqlTree(
  client: GraphqlClient,
  owner: string,
  repo: string,
  opts: GraphqlOpts = {}
): Promise<Result<RepoTree, StitchError>> {
  const op = 'graphqlTree';
  const checked = checkClient(client, op);
  if (checked.isErr()) return err(checked.error);
  if (!isNonBlankString(owner)) {
    return invalid('owner', `${op}: owner is required`);
  }
  if (!isNonBlankString(repo)) {
    return invalid('repo', `${op}: repo is required`);
  }
  const expression = opts.expression ?? DEFAULT_EXPRESSION;
  if (!isNonBlankString(expression)) {
    return invalid('expression', `${op}: expression must not be blank`);
  }
  const depth = opts.depth ?? DEFAULT_DEPTH;
  if (!Number.isInteger(depth) || depth < 1) {
    return invalid('depth', `${op}: depth must be an integer >= 1`);
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
  if (opts.pruneDirs !== undefined) {
    for (const [index, dir] of opts.pruneDirs.entries()) {
      if (!isNonBlankString(dir)) {
        return invalid('pruneDirs', `${op}: pruneDirs[${index}] must not be blank`);
      }
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

  if (opts.cache === undefined) {
    const outcome = await attemptGraphql(checked.value, owner, repo, expression, depth, op);
    if (outcome.kind === 'fallback') {
      return fallbackToRest(checked.value, owner, repo, expression, depth, opts);
    }
    if (outcome.kind === 'error') return err(outcome.error);
    return finishNodes(outcome.nodes, opts, op);
  }
  const sha = await resolveRefSha(checked.value, owner, repo, expression, op);
  if (sha.isErr()) return err(sha.error);
  const key = `${owner}/${repo}@${sha.value}/gql:${depth}`;
  const hit = opts.cache.get(key);
  if (hit !== undefined && hit.sha === sha.value) {
    return finishNodes(hit.value, opts, op);
  }
  const outcome = await attemptGraphql(checked.value, owner, repo, expression, depth, op);
  if (outcome.kind === 'fallback') {
    return fallbackToRest(checked.value, owner, repo, expression, depth, opts);
  }
  if (outcome.kind === 'error') return err(outcome.error);
  opts.cache.set(key, sha.value, outcome.nodes);
  return finishNodes(outcome.nodes, opts, op);
}
