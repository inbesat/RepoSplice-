// Git Core clone (P-069): clone parent repositories shallow (default,
// fast) or full (filter-repo compatible, P-070).
//
// Security design (SECRETS.md — read before touching this file):
// - Credentials NEVER go in the URL. They travel as a `-c
//   http.extraHeader=Authorization: Basic <base64>` option, so the URL
//   stays clean in every log line, error, and status output.
// - The base64 blob is still reversible, so on failure the KNOWN header
//   string is scrubbed from message + gitOutput by exact match (no
//   pattern guessing). Tests assert the password appears nowhere.
// - Log lines bind only the redacted URL (redactUrlCredentials strips
//   user-embedded `user:pass@`); the credentials object is never logged.
//
// Reliability:
// - Validation (empty url/target, bad depth, depth-without-shallow, blank
//   branch, bad timeoutMs, empty credential fields) returns CONFIG_ERROR
//   BEFORE any I/O — no spawn, no mkdir, no factory construction.
// - ensureDir runs BEFORE the git client is built: simple-git's
//   constructor throws on a missing baseDir, and we never let it.
// - Clone failures and verify failures both map to GIT_ERROR (never a
//   throw); the silence timeout (timeoutMs, default 2 min) kills hung
//   network clones via simple-git's timeout plugin (wired in factory.ts).
// - Success is verified, not assumed: `status()` must answer on the fresh
//   target before ok(targetDir) is returned.

import { Buffer } from 'node:buffer';
import type { StatusResult } from 'simple-git';
import { ok, err, type Result } from 'neverthrow';
import type { StitchError } from '../result/index.js';
import { createGit, type GitFactoryOptions } from './factory.js';
import { ensureDir } from '../util/fs.js';
import { logger, createJobLogger } from '../logger/index.js';

/** Default clone depth for shallow clones. */
export const DEFAULT_CLONE_DEPTH = 1;

/** Default silence timeout (ms) for clone + verify git processes. */
export const DEFAULT_CLONE_TIMEOUT_MS = 120_000;

/** PAT / basic-auth credentials. Travel via header, never the URL. */
export interface CloneCredentials {
  username: string;
  password: string;
}

export interface CloneOptions {
  url: string;
  targetDir: string;
  /** Shallow `--depth` clone. Default: true (full clone for P-070 compat: false). */
  shallow?: boolean;
  /** Depth for shallow clones. Default: 1. Rejected unless shallow. */
  depth?: number;
  /** Checkout this branch after cloning. */
  branch?: string;
  /** Private-repo auth (see header design above). */
  credentials?: CloneCredentials;
  /** Silence timeout ms for git processes. Default: 120_000. */
  timeoutMs?: number;
  /** Job id for structured logs (acceptance: logs carry jobId). */
  jobId?: string;
}

/**
 * The narrow git surface cloneRepo needs. simple-git's `Git` satisfies it
 * (Response<T> is SimpleGit & Promise<T>), and tests inject plain object
 * literals — no casts, no full-SimpleGit fakes.
 */
export interface CloneGit {
  clone(repoPath: string, localPath: string, options?: string[]): Promise<string>;
  status(): Promise<StatusResult>;
}

/** Runtime seams: only the git client factory (fs + network stay real). */
export interface CloneRuntime {
  createGit?: (options: GitFactoryOptions) => CloneGit;
}

interface NormalizedCloneOptions {
  url: string;
  targetDir: string;
  shallow: boolean;
  depth: number;
  branch?: string;
  credentials?: CloneCredentials;
  timeoutMs: number;
}

/** Default factory: real createGit wrapped to the narrow CloneGit seam. */
function defaultCreateGit(options: GitFactoryOptions): CloneGit {
  const git = createGit(options);
  return {
    clone: (repo, target, cloneOptions) => git.clone(repo, target, cloneOptions),
    status: () => git.status(),
  };
}

/**
 * Strip user-embedded credentials from a URL for display (`https://u:p@h`
 * → `https://***@h`). Non-URL forms (scp syntax, file://) pass through.
 */
export function redactUrlCredentials(url: string): string {
  return url.replace(/:\/\/[^/\s]+:[^/\s]*@/, '://***@');
}

/** Build the `-c http.extraHeader=...` value, or undefined without creds. */
function authHeader(credentials: CloneCredentials | undefined): string | undefined {
  if (credentials === undefined) return undefined;
  const basic = Buffer.from(`${credentials.username}:${credentials.password}`, 'utf8').toString(
    'base64'
  );
  return `http.extraHeader=Authorization: Basic ${basic}`;
}

function invalid(field: string, message: string): Result<NormalizedCloneOptions, StitchError> {
  return err({ code: 'CONFIG_ERROR', field, message });
}

/** Validate everything before any I/O (no spawn, no mkdir on misuse). */
function validateCloneOptions(opts: CloneOptions): Result<NormalizedCloneOptions, StitchError> {
  if (opts.url.trim() === '') return invalid('url', 'cloneRepo: url is required');
  if (opts.targetDir.trim() === '') return invalid('targetDir', 'cloneRepo: targetDir is required');
  const shallow = opts.shallow ?? true;
  const depth = opts.depth ?? DEFAULT_CLONE_DEPTH;
  if (!Number.isInteger(depth) || depth < 1) {
    return invalid('depth', `cloneRepo: depth must be an integer >= 1, got ${String(opts.depth)}`);
  }
  if (!shallow && opts.depth !== undefined) {
    return invalid('depth', 'cloneRepo: depth requires shallow (omit depth for a full clone)');
  }
  if (opts.branch !== undefined && opts.branch.trim() === '') {
    return invalid('branch', 'cloneRepo: branch must not be blank');
  }
  const timeoutMs = opts.timeoutMs ?? DEFAULT_CLONE_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
    return invalid(
      'timeoutMs',
      `cloneRepo: timeoutMs must be an integer >= 1, got ${String(opts.timeoutMs)}`
    );
  }
  if (
    opts.credentials !== undefined &&
    (opts.credentials.username === '' || opts.credentials.password === '')
  ) {
    return invalid('credentials', 'cloneRepo: credentials need a non-empty username and password');
  }
  return ok({
    url: opts.url,
    targetDir: opts.targetDir,
    shallow,
    depth,
    ...(opts.branch !== undefined ? { branch: opts.branch } : {}),
    ...(opts.credentials !== undefined ? { credentials: opts.credentials } : {}),
    timeoutMs,
  });
}

function causeDetail(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * Clone a repository. Returns ok(targetDir) after a verifying `status()`.
 * Users tracking progress need the path; the report (branch, depth) is in
 * the structured logs. See the header comment for the secrets design.
 */
export async function cloneRepo(
  opts: CloneOptions,
  runtime: CloneRuntime = {}
): Promise<Result<string, StitchError>> {
  const normalized = validateCloneOptions(opts);
  if (normalized.isErr()) return err(normalized.error);
  const { url, targetDir, shallow, depth, timeoutMs } = normalized.value;
  const branch = normalized.value.branch;
  const credentials = normalized.value.credentials;
  const log = (opts.jobId === undefined ? logger : createJobLogger(opts.jobId)).child({
    op: 'clone',
    url: redactUrlCredentials(url),
    targetDir,
  });

  const ensured = await ensureDir(targetDir);
  if (ensured.isErr()) return err(ensured.error);

  // Deterministic option order: depth, branch, then auth (asserted by tests).
  // simple-git inserts these between `clone` and the repo path (verified in
  // its task source), so `-c` lands where git accepts it.
  const cloneArgs: string[] = [];
  if (shallow) cloneArgs.push('--depth', String(depth));
  if (branch !== undefined) cloneArgs.push('--branch', branch);
  const header = authHeader(credentials);
  if (header !== undefined) cloneArgs.push('-c', header);
  const scrub = (text: string): string =>
    header === undefined ? text : text.split(header).join('***');

  const create = runtime.createGit ?? defaultCreateGit;
  let git: CloneGit;
  try {
    git = create({ baseDir: targetDir, timeoutMs });
  } catch (cause: unknown) {
    const detail = causeDetail(cause);
    log.error({ err: detail }, 'Clone failed: git client init');
    return err({ code: 'GIT_ERROR', message: `Clone failed: ${detail}`, gitOutput: detail });
  }

  log.info(
    { shallow, depth: shallow ? depth : null, branch: branch ?? null },
    'Cloning repository'
  );
  try {
    await git.clone(url, targetDir, cloneArgs);
  } catch (cause: unknown) {
    const detail = scrub(causeDetail(cause));
    log.error({ err: detail }, 'Clone failed');
    return err({ code: 'GIT_ERROR', message: `Clone failed: ${detail}`, gitOutput: detail });
  }

  let status: StatusResult;
  try {
    status = await git.status();
  } catch (cause: unknown) {
    const detail = scrub(causeDetail(cause));
    log.error({ err: detail }, 'Clone verification failed');
    return err({
      code: 'GIT_ERROR',
      message: `Clone verification failed: ${detail}`,
      gitOutput: detail,
    });
  }
  log.info({ current: status.current }, 'Clone complete');
  return ok(targetDir);
}
