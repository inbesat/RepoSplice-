// GitHub branches (P-093): remote branch lifecycle mirroring the local
// twin (P-080) — create/delete/rename via git refs, protections with the
// force-push guard carried over from P-078, and commit statuses feeding
// the merge gate (P-094, verdicts supplied by the sandbox P-177).
//
// Verified behavior (probed via nock against real Octokit v22 — do not
// assume otherwise):
// - `rest.git.createRef`, `rest.git.deleteRef`,
//   `rest.repos.updateBranchProtection`, and `rest.repos.createCommitStatus`
//   exist with these exact names (P-089 lesson: the nock suite proves the
//   seam at compile time and runtime).
// - Duplicate refs fail with 422; missing refs read 404; Octokit throws
//   RequestError (`.status`) on non-2xx.
// - Protection writes take snake_case bodies with `{ enabled }` wrappers
//   around the boolean toggles (not bare booleans).
//
// Safety contract:
// - Branch names validate git ref-format rules up front (no wasted
//   calls, no server-roundtrip typos); remote deletes refuse loudly on
//   404 (typo protection — deleting the wrong branch is destructive,
//   P-076 precedent), never silent no-ops.
// - Force-push protection requires explicit `allowForce` authorization
//   (P-078 guard carried into config); existing refs refuse with an
//   ALREADY_EXISTS-shaped error (P-092 pattern, P-203 promotes later).
// - `protectBranch` SETS the full policy declaratively (absent fields
//   reset to off) — callers pass the whole intended shape, never diffs.
// - Remote rename is create-plus-delete (non-atomic by nature): step
//   failures name their step (`renameBranch create/delete` rides in the
//   operation context) so callers know exactly what landed.
// - Rate limits map with retry guidance (P-089 pattern, never
//   AUTH_ERROR); other statuses reuse the factory taxonomy plus the
//   login hint (P-088); no new codes (P-203 owns taxonomy).
// - Throwing seams map to typed errors; tests throw only inside vitest.
//
// Seams and future phases:
// - P-177 supplies status verdicts (this module posts them);
//   P-094 gates merges on them; P-096 owns retry/backoff (fail fast
//   with retryAfter surfaced); P-313 owns the branching model (names
//   validated here); P-160 gates force approvals (allowForce port).
// - Error mapping duplicates the sibling GitHub modules by codebase
//   convention (P-203 consolidates when the taxonomy lands).

import { ok, err, type Result } from 'neverthrow';
import type { StitchError } from '../result/index.js';
import { statusToStitchError } from './factory.js';

const SHA_RE = /^[0-9a-f]{40}$/;

const LOGIN_HINT = 'run `stitch login` or check token scopes';
/** Message token P-203 will promote to a code (grep-stable contract). */
const ALREADY_EXISTS = 'ALREADY_EXISTS';

/** git check-ref-format subset that matters for API-created refs. */
const REF_FORBIDDEN_CHARS = /[\s~^:?*[\]\\]/;

export type CommitState = 'error' | 'failure' | 'pending' | 'success';

const COMMIT_STATES: readonly CommitState[] = ['error', 'failure', 'pending', 'success'];

export interface RequiredStatusChecks {
  strict: boolean;
  contexts: string[];
}

export interface ProtectionRules {
  requiredStatusChecks?: RequiredStatusChecks | null;
  enforceAdmins?: boolean;
  allowForcePushes?: boolean;
  allowDeletions?: boolean;
  requiredLinearHistory?: boolean;
  requiredConversationResolution?: boolean;
}

export interface ProtectOpts {
  /** Explicit authorization for allowForcePushes (P-160 gate passes this). */
  allowForce?: boolean;
}

export interface StatusOpts {
  context: string;
  state: CommitState;
  description?: string;
  targetUrl?: string;
}

export interface CreatedBranch {
  ref: string;
  sha: string;
}

/** Narrow git-refs seam (method names mirror Octokit exactly). */
export interface BranchGitEndpoint {
  createRef(args: { owner: string; repo: string; ref: string; sha: string }): Promise<{
    data: unknown;
    headers: unknown;
    status: number;
  }>;
  deleteRef(args: { owner: string; repo: string; ref: string }): Promise<{
    data: unknown;
    headers: unknown;
    status: number;
  }>;
}

/** Narrow repos seam (method names mirror Octokit exactly). */
export interface BranchReposEndpoint {
  getCommit(args: { owner: string; repo: string; ref: string }): Promise<{
    data: unknown;
    headers: unknown;
    status: number;
  }>;
  updateBranchProtection(args: {
    owner: string;
    repo: string;
    branch: string;
    required_status_checks: { strict: boolean; contexts: string[] } | null;
    enforce_admins: boolean;
    allow_force_pushes: boolean;
    allow_deletions: boolean;
    required_linear_history: boolean;
    required_conversation_resolution: boolean;
    // Octokit types these as required: null clears (P-160 configures
    // reviewers later; restrictions stay open here by design).
    required_pull_request_reviews: null;
    restrictions: null;
  }): Promise<{ data: unknown; headers: unknown; status: number }>;
  createCommitStatus(args: {
    owner: string;
    repo: string;
    sha: string;
    state: CommitState;
    context: string;
    description?: string;
    target_url?: string;
  }): Promise<{ data: unknown; headers: unknown; status: number }>;
}

/** Narrow client seam (no full-Octokit fakes in tests). */
export interface BranchClient {
  rest: { repos: BranchReposEndpoint; git: BranchGitEndpoint };
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

function checkClient(client: BranchClient, op: string): Result<BranchClient, StitchError> {
  if (client === null || typeof client !== 'object') {
    return invalid('client', `${op}: client is required`);
  }
  return ok(client);
}

function checkRepo(
  owner: string,
  repo: string,
  op: string
): Result<{ owner: string; repo: string }, StitchError> {
  if (!isNonBlankString(owner)) {
    return invalid('owner', `${op}: owner is required`);
  }
  if (!isNonBlankString(repo)) {
    return invalid('repo', `${op}: repo is required`);
  }
  return ok({ owner, repo });
}

function checkBranchName(name: string, field: string, op: string): Result<string, StitchError> {
  if (!isNonBlankString(name)) {
    return invalid(field, `${op}: ${field} is required`);
  }
  if (REF_FORBIDDEN_CHARS.test(name)) {
    return invalid(field, `${op}: ${field} has forbidden characters ("${name}")`);
  }
  if (name.includes('..')) {
    return invalid(field, `${op}: ${field} must not contain ".." ("${name}")`);
  }
  if (name.includes('@{')) {
    return invalid(field, `${op}: ${field} must not contain "@{" ("${name}")`);
  }
  if (name.startsWith('/') || name.endsWith('/')) {
    return invalid(field, `${op}: ${field} must not start or end with "/" ("${name}")`);
  }
  if (name.endsWith('.lock')) {
    return invalid(field, `${op}: ${field} must not end with ".lock" ("${name}")`);
  }
  return ok(name);
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

function alreadyExists(op: string, branch: string, owner: string, repo: string): StitchError {
  return {
    code: 'GITHUB_API_ERROR',
    status: 422,
    message:
      `${op}: branch "${branch}" in ${owner}/${repo} already exists ` +
      `(${ALREADY_EXISTS}; delete it first or pick another name)`,
  };
}

/** From-ref to SHA: 40-hex passes through, otherwise getCommit resolves. */
async function resolveFromSha(
  client: BranchClient,
  owner: string,
  repo: string,
  fromRef: string,
  op: string
): Promise<Result<string, StitchError>> {
  if (SHA_RE.test(fromRef)) return ok(fromRef);
  const commit = await callJson(
    () => client.rest.repos.getCommit({ owner, repo, ref: fromRef }),
    `${op} repos.getCommit`
  );
  if (commit.isErr()) return err(commit.error);
  const sha = (commit.value as { sha?: unknown }).sha;
  if (!isNonBlankString(sha) || !SHA_RE.test(sha)) {
    return err(internalError(op, `commit sha malformed for ref "${fromRef}"`));
  }
  return ok(sha);
}

function parseRefResponse(data: unknown, op: string): Result<CreatedBranch, StitchError> {
  if (typeof data !== 'object' || data === null) {
    return err(internalError(op, 'ref malformed (not an object)'));
  }
  const rec = data as { ref?: unknown; object?: unknown };
  if (!isNonBlankString(rec.ref)) {
    return err(internalError(op, 'ref malformed (ref)'));
  }
  const object = rec.object;
  if (typeof object !== 'object' || object === null) {
    return err(internalError(op, 'ref malformed (object)'));
  }
  const sha = (object as { sha?: unknown }).sha;
  if (!isNonBlankString(sha) || !SHA_RE.test(sha)) {
    return err(internalError(op, 'ref malformed (sha)'));
  }
  return ok({ ref: rec.ref, sha });
}

/**
 * Create a branch ref at a SHA (P-080 parity for the remote side).
 * Existing refs refuse with an ALREADY_EXISTS-shaped error.
 */
export async function createBranch(
  client: BranchClient,
  owner: string,
  repo: string,
  name: string,
  fromRef: string
): Promise<Result<CreatedBranch, StitchError>> {
  const op = 'createBranch';
  const checked = checkClient(client, op);
  if (checked.isErr()) return err(checked.error);
  const repoChecked = checkRepo(owner, repo, op);
  if (repoChecked.isErr()) return err(repoChecked.error);
  const nameChecked = checkBranchName(name, 'name', op);
  if (nameChecked.isErr()) return err(nameChecked.error);
  if (!isNonBlankString(fromRef)) {
    return invalid('fromRef', `${op}: fromRef is required`);
  }
  const sha = await resolveFromSha(
    checked.value,
    repoChecked.value.owner,
    repoChecked.value.repo,
    fromRef,
    op
  );
  if (sha.isErr()) return err(sha.error);
  let response: { data: unknown; headers: unknown; status: number };
  try {
    response = await checked.value.rest.git.createRef({
      owner: repoChecked.value.owner,
      repo: repoChecked.value.repo,
      ref: `refs/heads/${nameChecked.value}`,
      sha: sha.value,
    });
  } catch (error: unknown) {
    if (error instanceof Error && (error as { status?: unknown }).status === 422) {
      return err(
        alreadyExists(op, nameChecked.value, repoChecked.value.owner, repoChecked.value.repo)
      );
    }
    return err(mapCallError(`${op} git.createRef`, error));
  }
  if (response.status === 422) {
    return err(
      alreadyExists(op, nameChecked.value, repoChecked.value.owner, repoChecked.value.repo)
    );
  }
  if (response.status >= 400) {
    return err(mapStatus(response.status, '', `${op} git.createRef`));
  }
  return parseRefResponse(response.data, op);
}

/**
 * Delete a branch ref by short name. Missing branches refuse loudly
 * (typo protection — remote deletes are destructive, never silent).
 */
export async function deleteBranch(
  client: BranchClient,
  owner: string,
  repo: string,
  branch: string
): Promise<Result<void, StitchError>> {
  const op = 'deleteBranch';
  const checked = checkClient(client, op);
  if (checked.isErr()) return err(checked.error);
  const repoChecked = checkRepo(owner, repo, op);
  if (repoChecked.isErr()) return err(repoChecked.error);
  const branchChecked = checkBranchName(branch, 'branch', op);
  if (branchChecked.isErr()) return err(branchChecked.error);
  const deleted = await callJson(
    () =>
      checked.value.rest.git.deleteRef({
        owner: repoChecked.value.owner,
        repo: repoChecked.value.repo,
        ref: `heads/${branchChecked.value}`,
      }),
    `${op} git.deleteRef`
  );
  if (deleted.isErr()) return err(deleted.error);
  return ok(undefined);
}

/**
 * Rename via create-plus-delete (non-atomic by nature): the operation
 * context names the step, so partial failures say what landed.
 */
export async function renameBranch(
  client: BranchClient,
  owner: string,
  repo: string,
  from: string,
  to: string
): Promise<Result<CreatedBranch, StitchError>> {
  const op = 'renameBranch';
  const checked = checkClient(client, op);
  if (checked.isErr()) return err(checked.error);
  const repoChecked = checkRepo(owner, repo, op);
  if (repoChecked.isErr()) return err(repoChecked.error);
  const fromChecked = checkBranchName(from, 'from', op);
  if (fromChecked.isErr()) return err(fromChecked.error);
  const toChecked = checkBranchName(to, 'to', op);
  if (toChecked.isErr()) return err(toChecked.error);
  if (fromChecked.value === toChecked.value) {
    return invalid('to', `${op}: target must differ from source ("${fromChecked.value}")`);
  }
  const sha = await resolveFromSha(
    checked.value,
    repoChecked.value.owner,
    repoChecked.value.repo,
    fromChecked.value,
    `${op} create`
  );
  if (sha.isErr()) return err(sha.error);
  let created: { data: unknown; headers: unknown; status: number };
  try {
    created = await checked.value.rest.git.createRef({
      owner: repoChecked.value.owner,
      repo: repoChecked.value.repo,
      ref: `refs/heads/${toChecked.value}`,
      sha: sha.value,
    });
  } catch (error: unknown) {
    if (error instanceof Error && (error as { status?: unknown }).status === 422) {
      return err(
        alreadyExists(
          `${op} create`,
          toChecked.value,
          repoChecked.value.owner,
          repoChecked.value.repo
        )
      );
    }
    return err(mapCallError(`${op} create git.createRef`, error));
  }
  if (created.status === 422) {
    return err(
      alreadyExists(
        `${op} create`,
        toChecked.value,
        repoChecked.value.owner,
        repoChecked.value.repo
      )
    );
  }
  if (created.status >= 400) {
    return err(mapStatus(created.status, '', `${op} create git.createRef`));
  }
  const parsed = parseRefResponse(created.data, `${op} create`);
  if (parsed.isErr()) return err(parsed.error);
  const removed = await callJson(
    () =>
      checked.value.rest.git.deleteRef({
        owner: repoChecked.value.owner,
        repo: repoChecked.value.repo,
        ref: `heads/${fromChecked.value}`,
      }),
    `${op} delete git.deleteRef`
  );
  if (removed.isErr()) return err(removed.error);
  return ok(parsed.value);
}

interface NormalizedRules {
  required_status_checks: { strict: boolean; contexts: string[] } | null;
  enforce_admins: boolean;
  allow_force_pushes: boolean;
  allow_deletions: boolean;
  required_linear_history: boolean;
  required_conversation_resolution: boolean;
}

function readFlag(
  rules: ProtectionRules,
  field:
    | 'enforceAdmins'
    | 'allowForcePushes'
    | 'allowDeletions'
    | 'requiredLinearHistory'
    | 'requiredConversationResolution',
  op: string
): Result<boolean | undefined, StitchError> {
  const value = rules[field];
  if (value === undefined) return ok(undefined);
  if (typeof value !== 'boolean') {
    return invalid(`rules.${field}`, `${op}: rules.${field} must be a boolean`);
  }
  return ok(value);
}

function normalizeRules(
  rules: ProtectionRules,
  allowForce: boolean,
  op: string
): Result<NormalizedRules, StitchError> {
  if (rules === null || typeof rules !== 'object') {
    return invalid('rules', `${op}: rules are required`);
  }
  let requiredStatusChecks: { strict: boolean; contexts: string[] } | null = null;
  const checks = (rules as { requiredStatusChecks?: unknown }).requiredStatusChecks;
  if (checks !== undefined && checks !== null) {
    if (typeof checks !== 'object') {
      return invalid('rules.requiredStatusChecks', `${op}: requiredStatusChecks must be an object`);
    }
    const rec = checks as { strict?: unknown; contexts?: unknown };
    if (typeof rec.strict !== 'boolean') {
      return invalid(
        'rules.requiredStatusChecks.strict',
        `${op}: requiredStatusChecks.strict must be a boolean`
      );
    }
    if (!Array.isArray(rec.contexts)) {
      return invalid(
        'rules.requiredStatusChecks.contexts',
        `${op}: requiredStatusChecks.contexts must be an array`
      );
    }
    const contexts: string[] = [];
    for (const [index, context] of rec.contexts.entries()) {
      if (!isNonBlankString(context)) {
        return invalid(
          'rules.requiredStatusChecks.contexts',
          `${op}: requiredStatusChecks.contexts[${index}] must not be blank`
        );
      }
      contexts.push(context);
    }
    requiredStatusChecks = { strict: rec.strict, contexts };
  }
  const enforceAdmins = readFlag(rules, 'enforceAdmins', op);
  if (enforceAdmins.isErr()) return err(enforceAdmins.error);
  const allowForcePushes = readFlag(rules, 'allowForcePushes', op);
  if (allowForcePushes.isErr()) return err(allowForcePushes.error);
  if (allowForcePushes.value === true && !allowForce) {
    return invalid(
      'rules.allowForcePushes',
      `${op}: allowForcePushes requires explicit allowForce authorization (P-078 guard)`
    );
  }
  const allowDeletions = readFlag(rules, 'allowDeletions', op);
  if (allowDeletions.isErr()) return err(allowDeletions.error);
  const requiredLinearHistory = readFlag(rules, 'requiredLinearHistory', op);
  if (requiredLinearHistory.isErr()) return err(requiredLinearHistory.error);
  const requiredConversationResolution = readFlag(rules, 'requiredConversationResolution', op);
  if (requiredConversationResolution.isErr()) return err(requiredConversationResolution.error);
  return ok({
    required_status_checks: requiredStatusChecks,
    enforce_admins: enforceAdmins.value ?? false,
    allow_force_pushes: allowForcePushes.value ?? false,
    allow_deletions: allowDeletions.value ?? false,
    required_linear_history: requiredLinearHistory.value ?? false,
    required_conversation_resolution: requiredConversationResolution.value ?? false,
  });
}

/**
 * Set branch protection declaratively (absent fields reset to off).
 * Force-pushes stay off without explicit `allowForce` authorization.
 */
export async function protectBranch(
  client: BranchClient,
  owner: string,
  repo: string,
  branch: string,
  rules: ProtectionRules,
  opts: ProtectOpts = {}
): Promise<Result<void, StitchError>> {
  const op = 'protectBranch';
  const checked = checkClient(client, op);
  if (checked.isErr()) return err(checked.error);
  const repoChecked = checkRepo(owner, repo, op);
  if (repoChecked.isErr()) return err(repoChecked.error);
  const branchChecked = checkBranchName(branch, 'branch', op);
  if (branchChecked.isErr()) return err(branchChecked.error);
  const normalized = normalizeRules(rules, opts.allowForce ?? false, op);
  if (normalized.isErr()) return err(normalized.error);
  const applied = await callJson(
    () =>
      checked.value.rest.repos.updateBranchProtection({
        owner: repoChecked.value.owner,
        repo: repoChecked.value.repo,
        branch: branchChecked.value,
        ...normalized.value,
        required_pull_request_reviews: null,
        restrictions: null,
      }),
    `${op} repos.updateBranchProtection`
  );
  if (applied.isErr()) return err(applied.error);
  return ok(undefined);
}

/**
 * Post a commit status (sandbox verdicts gate the merge in P-094).
 */
export async function setStatus(
  client: BranchClient,
  owner: string,
  repo: string,
  sha: string,
  opts: StatusOpts
): Promise<Result<void, StitchError>> {
  const op = 'setStatus';
  const checked = checkClient(client, op);
  if (checked.isErr()) return err(checked.error);
  const repoChecked = checkRepo(owner, repo, op);
  if (repoChecked.isErr()) return err(repoChecked.error);
  if (!SHA_RE.test(sha)) {
    return invalid('sha', `${op}: sha must be a 40-hex commit SHA`);
  }
  if (opts === null || typeof opts !== 'object') {
    return invalid('opts', `${op}: opts are required`);
  }
  if (!isNonBlankString(opts.context)) {
    return invalid('context', `${op}: context is required`);
  }
  if (!COMMIT_STATES.includes(opts.state)) {
    return invalid('state', `${op}: state must be one of ${COMMIT_STATES.join(', ')}`);
  }
  if (opts.description !== undefined && typeof opts.description !== 'string') {
    return invalid('description', `${op}: description must be a string`);
  }
  if (opts.targetUrl !== undefined && typeof opts.targetUrl !== 'string') {
    return invalid('targetUrl', `${op}: targetUrl must be a string`);
  }
  const posted = await callJson(
    () =>
      checked.value.rest.repos.createCommitStatus({
        owner: repoChecked.value.owner,
        repo: repoChecked.value.repo,
        sha,
        state: opts.state,
        context: opts.context,
        ...(opts.description !== undefined ? { description: opts.description } : {}),
        ...(opts.targetUrl !== undefined ? { target_url: opts.targetUrl } : {}),
      }),
    `${op} repos.createCommitStatus`
  );
  if (posted.isErr()) return err(posted.error);
  return ok(undefined);
}
