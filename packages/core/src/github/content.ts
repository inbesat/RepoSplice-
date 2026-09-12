// GitHub file content (P-091): single and bounded-batch blob fetch for
// the AI agent (P-148/P-152), diff analysis (P-217), and license scans
// (P-124). `getFileContent` resolves the ref once and decodes one blob;
// `getFileContentsBatch` resolves once, then fans out over P-086's
// bounded map with per-path SHA-keyed caching (pending entries skip
// rework — the P-040/030-adjacent diff strategy).
//
// Verified behavior (probed via nock against real Octokit v22 — do not
// assume otherwise):
// - `rest.repos.getContent` exists with this exact name (P-089 lesson).
// - File blobs arrive `{ type: 'file', content: <base64 with newlines>,
//   encoding: 'base64' }`; directories arrive as ARRAYS (not objects);
//   files past ~1MB arrive WITHOUT content (`encoding: 'none'`).
// - Octokit throws RequestError (`.status`, `.headers`) on non-2xx.
//
// Safety contract:
// - Binary blobs FLAG (`binary: true`, empty content) — never shipped
//   as text (NUL sniff; P-082 needs a disk repo so the sniff lives
//   here, documented). Extension lists are caller hints, not verdicts.
// - Oversized blobs TRUNCATE only under explicit `maxBytes` (byte
//   boundary may split a codepoint — deterministic U+FFFD, documented);
//   GitHub-withheld content ERRORS with blob-API guidance (never an
//   invented empty file).
// - Non-file paths refuse with kind-specific guidance (dirs, symlinks,
//   submodules are CONFIG misuse, not transport failures).
// - Batch failures are deterministic: per-item outcomes resolve in
//   INPUT order (first error wins), never completion order (P-282).
// - Rate limits map like P-089/P-090 (GITHUB_API_ERROR + retry-after
//   contract, never AUTH_ERROR); other statuses reuse the factory
//   taxonomy plus the login hint (P-088); no new codes (P-203 owns it).
// - Throwing seams map to typed errors; tests throw only inside vitest.
//
// Seams and future phases:
// - P-096 owns retry/backoff (fail fast with retryAfter surfaced);
//   P-303 persists the cache (raw SHA-keyed blobs handed over);
//   P-243 owns size policy (maxBytes is opt-in mechanism only);
//   P-163 owns token budgets (truncated flags feed it).

import { ok, err, type Result } from 'neverthrow';
import type { StitchError } from '../result/index.js';
import { statusToStitchError } from './factory.js';
import { mapParallel, fetchCached, DEFAULT_PERF_CONCURRENCY, type RefCache } from '../git/perf.js';

const SHA_RE = /^[0-9a-f]{40}$/;

const LOGIN_HINT = 'run `stitch login` or check token scopes';

/** Decoded blob with transport honesty flags. */
export interface BlobContent {
  /** Requested path (echoed, never re-derived). */
  path: string;
  sha: string;
  size: number;
  encoding: 'utf-8';
  /** Decoded text ('' when binary or truncated-to-zero). */
  content: string;
  binary: boolean;
  truncated: boolean;
}

export interface FileContentOpts {
  /** Branch name or SHA. Absent: the repo default branch. */
  ref?: string;
  /** Opt-in byte cap (truncates past it). Absent: full content. */
  maxBytes?: number;
  /** Extra binary extensions ('.png', dot included). NUL sniff always runs. */
  binaryExts?: string[];
  /** SHA-keyed blob cache (P-303 layer). Absent: no caching. */
  cache?: RefCache<BlobContent>;
}

export interface BatchSpec {
  owner: string;
  repo: string;
  ref?: string;
  paths: readonly string[];
}

export interface BatchOpts {
  concurrency?: number;
  maxBytes?: number;
  binaryExts?: string[];
  cache?: RefCache<BlobContent>;
}

interface NormalizedFileOpts {
  maxBytes?: number;
  binaryExts?: string[];
  cache?: RefCache<BlobContent>;
}

/** Narrow content seam (`getContent`, mirroring Octokit exactly). */
export interface ContentMetaEndpoint {
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
  getContent(args: {
    owner: string;
    repo: string;
    path: string;
    ref: string;
  }): Promise<{ data: unknown; headers: unknown; status: number }>;
}

/** Narrow client seam (no full-Octokit fakes in tests). */
export interface ContentClient {
  rest: { repos: ContentMetaEndpoint };
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

function checkClient(client: ContentClient, op: string): Result<ContentClient, StitchError> {
  if (client === null || typeof client !== 'object') {
    return invalid('client', `${op}: client is required`);
  }
  return ok(client);
}

/** Shared file-option validation (single + batch call this once each). */
function checkFileOpts(
  opts: { maxBytes?: unknown; binaryExts?: unknown; cache?: unknown },
  op: string
): Result<NormalizedFileOpts, StitchError> {
  let maxBytes: number | undefined;
  if (opts.maxBytes !== undefined) {
    if (!Number.isInteger(opts.maxBytes) || (opts.maxBytes as number) < 1) {
      return invalid('maxBytes', `${op}: maxBytes must be an integer >= 1`);
    }
    maxBytes = opts.maxBytes as number;
  }
  let binaryExts: string[] | undefined;
  if (opts.binaryExts !== undefined) {
    if (!Array.isArray(opts.binaryExts)) {
      return invalid('binaryExts', `${op}: binaryExts must be an array of extensions`);
    }
    const exts: string[] = [];
    for (const [index, ext] of opts.binaryExts.entries()) {
      if (typeof ext !== 'string') {
        return invalid('binaryExts', `${op}: binaryExts[${index}] must be a string`);
      }
      exts.push(ext);
    }
    binaryExts = exts;
  }
  let cache: RefCache<BlobContent> | undefined;
  if (opts.cache !== undefined) {
    if (typeof (opts.cache as { get?: unknown } | null)?.get !== 'function') {
      return invalid('cache', `${op}: cache is required`);
    }
    cache = opts.cache as RefCache<BlobContent>;
  }
  return ok({
    ...(maxBytes !== undefined ? { maxBytes } : {}),
    ...(binaryExts !== undefined ? { binaryExts } : {}),
    ...(cache !== undefined ? { cache } : {}),
  });
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
  client: ContentClient,
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

function parseBlob(
  data: unknown,
  path: string,
  fileOpts: NormalizedFileOpts,
  op: string,
  status: number
): Result<BlobContent, StitchError> {
  if (Array.isArray(data)) {
    return err({
      code: 'CONFIG_ERROR',
      field: 'path',
      message: `${op}: "${path}" is a directory, not a file`,
    });
  }
  if (typeof data !== 'object' || data === null) {
    return err(internalError(op, 'blob malformed (not an object)'));
  }
  const rec = data as {
    type?: unknown;
    sha?: unknown;
    size?: unknown;
    content?: unknown;
    encoding?: unknown;
  };
  if (rec.type !== 'file') {
    const detail =
      rec.type === 'symlink'
        ? 'symlink (pass its target)'
        : rec.type === 'submodule'
          ? 'submodule'
          : `unexpected type ${JSON.stringify(rec.type) ?? 'missing'}`;
    return err({
      code: 'CONFIG_ERROR',
      field: 'path',
      message: `${op}: "${path}" is not a file (${detail})`,
    });
  }
  if (!isNonBlankString(rec.sha) || !SHA_RE.test(rec.sha)) {
    return err(internalError(op, 'blob malformed (sha)'));
  }
  if (typeof rec.size !== 'number' || !Number.isInteger(rec.size) || (rec.size as number) < 0) {
    return err(internalError(op, 'blob malformed (size)'));
  }
  if (typeof rec.content !== 'string' || rec.encoding !== 'base64') {
    // GitHub withholds content past ~1MB (absent content, encoding
    // 'none'); anything else misshapen is a malformed payload.
    if (rec.content === undefined || rec.content === null) {
      return err({
        code: 'GITHUB_API_ERROR',
        status,
        message: `${op}: "${path}" content withheld by GitHub (too large for the content API — fetch the blob directly)`,
      });
    }
    return err(internalError(op, 'blob malformed (content/encoding)'));
  }
  const bytes = Buffer.from(rec.content, 'base64');
  const exts = fileOpts.binaryExts ?? [];
  const lowered = path.toLowerCase();
  const binary = exts.some(ext => lowered.endsWith(ext.toLowerCase())) || bytes.includes(0);
  if (binary) {
    return ok({
      path,
      sha: rec.sha,
      size: rec.size,
      encoding: 'utf-8',
      content: '',
      binary: true,
      truncated: false,
    });
  }
  if (fileOpts.maxBytes !== undefined && bytes.length > fileOpts.maxBytes) {
    return ok({
      path,
      sha: rec.sha,
      size: rec.size,
      encoding: 'utf-8',
      content: bytes.subarray(0, fileOpts.maxBytes).toString('utf8'),
      binary: false,
      truncated: true,
    });
  }
  return ok({
    path,
    sha: rec.sha,
    size: rec.size,
    encoding: 'utf-8',
    content: bytes.toString('utf8'),
    binary: false,
    truncated: false,
  });
}

/** One blob at a resolved SHA (no ref work left). */
async function fetchBlob(
  client: ContentClient,
  owner: string,
  repo: string,
  path: string,
  sha: string,
  fileOpts: NormalizedFileOpts,
  op: string
): Promise<Result<BlobContent, StitchError>> {
  const body = await callJson(
    () => client.rest.repos.getContent({ owner, repo, path, ref: sha }),
    `${op} repos.getContent`
  );
  if (body.isErr()) return err(body.error);
  return parseBlob(body.value, path, fileOpts, op, 200);
}

/**
 * One file: validate, resolve the ref, fetch (cached raw when a cache is
 * given). The cache key carries the resolved SHA, so branch moves
 * refetch by construction.
 */
export async function getFileContent(
  client: ContentClient,
  owner: string,
  repo: string,
  path: string,
  opts: FileContentOpts = {}
): Promise<Result<BlobContent, StitchError>> {
  const op = 'getFileContent';
  if (!isNonBlankString(owner)) {
    return invalid('owner', `${op}: owner is required`);
  }
  if (!isNonBlankString(repo)) {
    return invalid('repo', `${op}: repo is required`);
  }
  if (!isNonBlankString(path)) {
    return invalid('path', `${op}: path is required`);
  }
  const checked = checkClient(client, op);
  if (checked.isErr()) return err(checked.error);
  if (opts.ref !== undefined && !isNonBlankString(opts.ref)) {
    return invalid('ref', `${op}: ref must not be blank`);
  }
  const fileOpts = checkFileOpts(opts, op);
  if (fileOpts.isErr()) return err(fileOpts.error);
  const options = fileOpts.value;
  // Stable per requested ref+path; the stored SHA detects branch moves
  // (fetchCached refetches on mismatch) — never key by 'pending'.
  const key = `${owner}/${repo}@${opts.ref ?? ''}/${path}`;
  const resolveSha = (): Promise<Result<string, StitchError>> =>
    resolveRefSha(checked.value, owner, repo, opts.ref, op);
  if (options.cache === undefined) {
    const sha = await resolveSha();
    if (sha.isErr()) return err(sha.error);
    return fetchBlob(checked.value, owner, repo, path, sha.value, options, op);
  }
  const cached = await fetchCached(
    options.cache,
    key,
    resolveSha,
    (sha: string): Promise<Result<BlobContent, StitchError>> =>
      fetchBlob(checked.value, owner, repo, path, sha, options, op)
  );
  if (cached.isErr()) return err(cached.error);
  return ok(cached.value.value);
}

/**
 * Bounded-parallel batch: the ref resolves ONCE, then paths fan out over
 * P-086's map (SHA-keyed cache skips the already-fetched — the pending
 * diff). Outcomes collapse in INPUT order (first error wins), so results
 * never depend on completion order (P-282).
 */
export async function getFileContentsBatch(
  client: ContentClient,
  spec: BatchSpec,
  opts: BatchOpts = {}
): Promise<Result<Map<string, BlobContent>, StitchError>> {
  const op = 'getFileContentsBatch';
  if (spec === null || typeof spec !== 'object') {
    return invalid('spec', `${op}: spec is required`);
  }
  if (!isNonBlankString(spec.owner)) {
    return invalid('spec.owner', `${op}: spec.owner is required`);
  }
  if (!isNonBlankString(spec.repo)) {
    return invalid('spec.repo', `${op}: spec.repo is required`);
  }
  if (spec.ref !== undefined && !isNonBlankString(spec.ref)) {
    return invalid('spec.ref', `${op}: spec.ref must not be blank`);
  }
  if (!Array.isArray(spec.paths) || spec.paths.length === 0) {
    return invalid('spec.paths', `${op}: spec.paths must be a non-empty array`);
  }
  for (const [index, path] of spec.paths.entries()) {
    if (!isNonBlankString(path)) {
      return invalid('spec.paths', `${op}: spec.paths[${index}] must not be blank`);
    }
  }
  const checked = checkClient(client, op);
  if (checked.isErr()) return err(checked.error);
  const fileOpts = checkFileOpts(opts, op);
  if (fileOpts.isErr()) return err(fileOpts.error);
  const options = fileOpts.value;
  const sha = await resolveRefSha(checked.value, spec.owner, spec.repo, spec.ref, op);
  if (sha.isErr()) return err(sha.error);
  const tip = sha.value;
  const mapped = await mapParallel(
    spec.paths,
    opts.concurrency ?? DEFAULT_PERF_CONCURRENCY,
    async path => {
      const outcome = await fetchOne(checked.value, spec, tip, path, options, op);
      return { path, outcome };
    }
  );
  if (mapped.isErr()) return err(mapped.error);
  const out = new Map<string, BlobContent>();
  for (const entry of mapped.value) {
    // Canary arm (P-086 precedent): fetchOne is total, so runner-level
    // errs are unreachable — loud if that contract ever regresses.
    if (entry.isErr()) return err(entry.error);
    if (entry.value.outcome.isErr()) return err(entry.value.outcome.error);
    out.set(entry.value.path, entry.value.outcome.value);
  }
  return ok(out);
}

/** One cached blob at a pre-resolved SHA (batch inner step). */
async function fetchOne(
  client: ContentClient,
  spec: BatchSpec,
  sha: string,
  path: string,
  fileOpts: NormalizedFileOpts,
  op: string
): Promise<Result<BlobContent, StitchError>> {
  // Requested-ref key (like the single path): one entry per ref+path
  // that updates in place on moves (no cold-entry growth).
  const key = `${spec.owner}/${spec.repo}@${spec.ref ?? ''}/${path}`;
  if (fileOpts.cache === undefined) {
    return fetchBlob(client, spec.owner, spec.repo, path, sha, fileOpts, op);
  }
  const cached = await fetchCached(
    fileOpts.cache,
    key,
    async (): Promise<Result<string, StitchError>> => ok(sha),
    (resolved: string): Promise<Result<BlobContent, StitchError>> =>
      fetchBlob(client, spec.owner, spec.repo, path, resolved, fileOpts, op)
  );
  if (cached.isErr()) return err(cached.error);
  return ok(cached.value.value);
}
