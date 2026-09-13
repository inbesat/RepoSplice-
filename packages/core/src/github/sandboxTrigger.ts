// GitHub Actions sandbox trigger (P-100): dispatch a build/verify
// workflow for a child repo and monitor it into a verdict — the GH
// backend P-175 consumes when Docker is unavailable. `triggerSandbox`
// dispatches (repository or workflow dispatch) with an allowlisted,
// secret-free payload tagging the P-239 job id; `monitorSandboxRun`
// finds the run for the sha via P-095, correlates it to the job, and
// relays fresh status into a P-176-shaped result.
//
// Verified behavior (probed against real Octokit v22 — do not assume
// otherwise):
// - `rest.repos.createDispatchEvent({ owner, repo, event_type,
//   client_payload })` and `rest.actions.createWorkflowDispatch({
//   owner, repo, workflow_id, ref, inputs })` exist (runtime + type
//   probe); the nock suite proves the names at compile time and
//   runtime, plus the wire paths `POST /repos/{owner}/{repo}/dispatches`
//   and `POST /repos/{owner}/{repo}/actions/workflows/{id}/dispatches`.
// - Both dispatches answer 204 with no body (no run id at dispatch
//   time — correlation happens by sha via P-095, never by id).
// - Workflow inputs must be strings; repository payloads are free-form.
//
// Safety contract:
// - Payloads are allowlisted (sha/ecosystem/ref/job/timeout + scanned
//   extras) — provider keys have no typed field to travel through,
//   and secret-named extra keys refuse BEFORE any dispatch call
//   (P-265/P-206). Refusals never echo values, only key names.
// - `local-docker` refuses loudly (P-169 owns that backend — silently
//   misrouting backends hides misconfiguration).
// - Empty run lists fail fast (dispatch accepted, run not yet created —
//   P-096 loops); drifted relay SHAs refuse (never misattribute);
//   single observations never claim flakiness (P-176 owns repeats).
// - Rate limits map with retry guidance (P-089 pattern, never
//   AUTH_ERROR); other statuses reuse the factory taxonomy plus the
//   login hint (P-088); no new codes (P-203 owns taxonomy).
// - Throwing seams map to typed errors; tests throw only inside vitest.
//
// Seams and future phases:
// - P-175 renders the workflow template listening for `sandbox-run`
//   (overridable) and calls triggerSandbox + monitorSandboxRun;
//   P-174 owns timeout/limits (timeoutMinutes is its port); P-176
//   owns repeat-based flaky detection (flaky stays false here);
//   P-241 routes verdicts; P-096 loops monitor with backoff (fail fast
//   here with retryAfter surfaced).
// - NOTE (blueprint label drift): P-100's spec tags "(P-178 workflow)"
//   and "(P-177)" for the conclusion — P-178 is actually layer cache
//   and P-177 is cleanup; the workflow template is P-175's and the
//   conclusion relay is P-095's (both composed as such here).
// - Error mapping duplicates the sibling GitHub modules by codebase
//   convention (P-203 consolidates when the taxonomy lands).

import { ok, err, type Result } from 'neverthrow';
import type { StitchError } from '../result/index.js';
import { statusToStitchError } from './factory.js';
import type { SandboxBackend } from '../config/schema.js';
import {
  relayWorkflowRun,
  findRunsForSha,
  correlateRunToJob,
  type ActionsRunsEndpoint,
  type JobRef,
} from './actionsStatus.js';

const SHA_RE = /^[0-9a-f]{40}$/;

const LOGIN_HINT = 'run `stitch login` or check token scopes';

/** Repository event type the P-175 template listens for. */
export const DEFAULT_SANDBOX_EVENT_TYPE = 'sandbox-run';

/** Dispatch mechanism (spec: repository_dispatch / workflow_dispatch). */
export type SandboxDispatchKind = 'repository' | 'workflow';

/** Secret-named keys are never allowed into workflow payloads. */
const FORBIDDEN_KEY_RE =
  /token|apikey|api_key|secret|password|passwd|privatekey|private_key|authorization|auth|credential|clientsecret/i;

export interface TriggerSandboxOpts {
  /** 40-hex commit under test (required). */
  sha: string;
  /** Ecosystem under test (P-103 values flow through; required). */
  ecosystem: string;
  /**
   * Branch context. Rides the repository payload when given; REQUIRED
   * for workflow dispatch (the API needs a ref to run from).
   */
  ref?: string;
  /** P-239 job id tagging the dispatch for correlation (required). */
  jobId: string;
  /** Dispatch mechanism. Default: 'repository'. */
  dispatch?: SandboxDispatchKind;
  /** Workflow file or id (required for workflow dispatch). */
  workflow?: string;
  /** Repository event type (repository dispatch only). Default: 'sandbox-run'. */
  eventType?: string;
  /** P-174 port: minutes forwarded as the workflow timeout (>= 1). */
  timeoutMinutes?: number;
  /**
   * Config-selected backend (P-009 `SandboxBackend`; P-175 owns the
   * choice). Only 'github-actions' dispatches here — 'docker' refuses
   * loudly (P-169 owns that backend; silently misrouting backends
   * hides misconfiguration).
   */
  backend?: SandboxBackend;
  /**
   * Extra workflow inputs (workflow dispatch only; strings per the API).
   * Keys are secret-scanned before any call.
   */
  inputs?: Record<string, string>;
  /**
   * Extra repository payload fields. Keys are secret-scanned before
   * any call.
   */
  clientPayload?: Record<string, unknown>;
}

/** What was dispatched (echoed for the pipeline record). */
export interface SandboxDispatch {
  owner: string;
  repo: string;
  dispatch: SandboxDispatchKind;
  /** Workflow file/id (workflow dispatch only). */
  workflow?: string;
  sha: string;
  ref?: string;
  ecosystem: string;
  jobId: string;
  timeoutMinutes?: number;
}

export interface MonitorSandboxOpts {
  /** P-239 job id the run must correlate to (required). */
  jobId: string;
  /** Branch scope for the run search (passed to P-095). */
  branch?: string;
}

/**
 * P-176-shaped verdict for one observation. `flaky` is always false
 * here — P-176's checkFlaky owns repeat-based detection; the field
 * exists so its verdicts flow through this shape.
 */
export interface SandboxRunVerdict {
  runId: number;
  url: string;
  sha: string;
  jobId: string;
  completed: boolean;
  conclusion: string | null;
  /** True only when completed with conclusion 'success'. */
  pass: boolean;
  /** Always false here (P-176 owns repeats). */
  flaky: boolean;
}

/** Narrow repository-dispatch seam (mirrors Octokit exactly). */
export interface SandboxReposEndpoint {
  createDispatchEvent(args: {
    owner: string;
    repo: string;
    event_type: string;
    client_payload?: Record<string, unknown>;
  }): Promise<{ data: unknown; headers: unknown; status: number }>;
}

/** Narrow workflow-dispatch seam (P-095's seam plus the dispatch call). */
export interface SandboxActionsEndpoint extends ActionsRunsEndpoint {
  createWorkflowDispatch(args: {
    owner: string;
    repo: string;
    workflow_id: string;
    ref: string;
    inputs?: Record<string, string>;
  }): Promise<{ data: unknown; headers: unknown; status: number }>;
}

/** Narrow client seam (no full-Octokit fakes in tests). */
export interface SandboxTriggerClient {
  rest: { repos: SandboxReposEndpoint; actions: SandboxActionsEndpoint };
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

function checkClient(
  client: SandboxTriggerClient,
  op: string
): Result<SandboxTriggerClient, StitchError> {
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
 * Secret-key scan over caller extras (P-265/P-206): refuses BEFORE any
 * dispatch. Names the offending key only — values never echo.
 */
function assertNoSecrets(
  values: Record<string, unknown>,
  field: string,
  op: string
): Result<void, StitchError> {
  for (const key of Object.keys(values)) {
    if (FORBIDDEN_KEY_RE.test(key)) {
      return invalid(
        field,
        `${op}: ${field} key "${key}" looks like a secret — provider keys never ride workflow payloads`
      );
    }
  }
  return ok(undefined);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return Object.values(value as Record<string, unknown>).every(item => typeof item === 'string');
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Dispatch a build/verify workflow for the sha with an allowlisted,
 * secret-free payload tagging the job id. Answers which dispatch
 * landed (204s carry no run id — monitor correlates by sha).
 */
export async function triggerSandbox(
  client: SandboxTriggerClient,
  owner: string,
  repo: string,
  opts: TriggerSandboxOpts
): Promise<Result<SandboxDispatch, StitchError>> {
  const op = 'triggerSandbox';
  const checked = checkClient(client, op);
  if (checked.isErr()) return err(checked.error);
  if (!isNonBlankString(owner)) {
    return invalid('owner', `${op}: owner is required`);
  }
  if (!isNonBlankString(repo)) {
    return invalid('repo', `${op}: repo is required`);
  }
  if (opts === null || typeof opts !== 'object') {
    return invalid('opts', `${op}: opts is required`);
  }
  if (!isNonBlankString(opts.sha) || !SHA_RE.test(opts.sha)) {
    return invalid('sha', `${op}: sha must be a 40-hex commit sha`);
  }
  if (!isNonBlankString(opts.ecosystem)) {
    return invalid('ecosystem', `${op}: ecosystem is required`);
  }
  if (opts.ref !== undefined && !isNonBlankString(opts.ref)) {
    return invalid('ref', `${op}: ref must not be blank`);
  }
  if (!isNonBlankString(opts.jobId)) {
    return invalid('jobId', `${op}: jobId is required`);
  }
  if (
    opts.timeoutMinutes !== undefined &&
    (!Number.isInteger(opts.timeoutMinutes) || opts.timeoutMinutes < 1)
  ) {
    return invalid('timeoutMinutes', `${op}: timeoutMinutes must be an integer >= 1`);
  }
  if (
    opts.dispatch !== undefined &&
    opts.dispatch !== 'repository' &&
    opts.dispatch !== 'workflow'
  ) {
    return invalid('dispatch', `${op}: dispatch must be 'repository' or 'workflow'`);
  }
  if (opts.workflow !== undefined && !isNonBlankString(opts.workflow)) {
    return invalid('workflow', `${op}: workflow must not be blank`);
  }
  if (opts.backend !== undefined && opts.backend !== 'github-actions') {
    return invalid(
      'backend',
      `${op}: backend "${opts.backend}" does not dispatch here (P-169 owns local-docker)`
    );
  }
  if (opts.inputs !== undefined && !isStringRecord(opts.inputs)) {
    return invalid('inputs', `${op}: inputs must be a record of strings`);
  }
  if (opts.clientPayload !== undefined && !isUnknownRecord(opts.clientPayload)) {
    return invalid('clientPayload', `${op}: clientPayload must be a record`);
  }

  const dispatch = opts.dispatch ?? 'repository';
  if (dispatch === 'workflow') {
    if (!isNonBlankString(opts.workflow)) {
      return invalid('workflow', `${op}: workflow dispatch requires a workflow file or id`);
    }
    if (!isNonBlankString(opts.ref)) {
      return invalid('ref', `${op}: workflow dispatch requires a ref to run from`);
    }
  }

  if (opts.inputs !== undefined) {
    const scanned = assertNoSecrets(opts.inputs, 'inputs', op);
    if (scanned.isErr()) return err(scanned.error);
  }
  if (opts.clientPayload !== undefined) {
    const scanned = assertNoSecrets(opts.clientPayload, 'clientPayload', op);
    if (scanned.isErr()) return err(scanned.error);
  }

  if (dispatch === 'workflow' && opts.workflow !== undefined && opts.ref !== undefined) {
    const inputs: Record<string, string> = {
      sha: opts.sha,
      ecosystem: opts.ecosystem,
      job_id: opts.jobId,
    };
    if (opts.timeoutMinutes !== undefined) {
      inputs.timeout_minutes = String(opts.timeoutMinutes);
    }
    if (opts.inputs !== undefined) {
      for (const [key, value] of Object.entries(opts.inputs)) {
        inputs[key] = value;
      }
    }
    const sent = await callJson(
      () =>
        checked.value.rest.actions.createWorkflowDispatch({
          owner,
          repo,
          workflow_id: opts.workflow as string,
          ref: opts.ref as string,
          inputs,
        }),
      `${op} actions.createWorkflowDispatch`
    );
    if (sent.isErr()) return err(sent.error);
    const dispatchRecord: SandboxDispatch = {
      owner,
      repo,
      dispatch,
      workflow: opts.workflow,
      sha: opts.sha,
      ref: opts.ref,
      ecosystem: opts.ecosystem,
      jobId: opts.jobId,
    };
    if (opts.timeoutMinutes !== undefined) {
      dispatchRecord.timeoutMinutes = opts.timeoutMinutes;
    }
    return ok(dispatchRecord);
  }

  const eventType = opts.eventType ?? DEFAULT_SANDBOX_EVENT_TYPE;
  if (!isNonBlankString(eventType)) {
    return invalid('eventType', `${op}: eventType must not be blank`);
  }
  const clientPayload: Record<string, unknown> = {
    sha: opts.sha,
    ecosystem: opts.ecosystem,
    job_id: opts.jobId,
  };
  if (opts.ref !== undefined) {
    clientPayload.ref = opts.ref;
  }
  if (opts.timeoutMinutes !== undefined) {
    clientPayload.timeout_minutes = opts.timeoutMinutes;
  }
  if (opts.clientPayload !== undefined) {
    for (const [key, value] of Object.entries(opts.clientPayload)) {
      clientPayload[key] = value;
    }
  }
  const sent = await callJson(
    () =>
      checked.value.rest.repos.createDispatchEvent({
        owner,
        repo,
        event_type: eventType,
        client_payload: clientPayload,
      }),
    `${op} repos.createDispatchEvent`
  );
  if (sent.isErr()) return err(sent.error);
  const dispatchRecord: SandboxDispatch = {
    owner,
    repo,
    dispatch,
    sha: opts.sha,
    ecosystem: opts.ecosystem,
    jobId: opts.jobId,
  };
  if (opts.ref !== undefined) {
    dispatchRecord.ref = opts.ref;
  }
  if (opts.timeoutMinutes !== undefined) {
    dispatchRecord.timeoutMinutes = opts.timeoutMinutes;
  }
  return ok(dispatchRecord);
}

/**
 * Monitor the dispatched run: find runs for the sha (P-095), correlate
 * the latest to the job (P-239 descriptor), relay fresh status, and map
 * the conclusion into a P-176-shaped verdict. Empty lists fail fast
 * (P-096 loops until the run appears).
 */
export async function monitorSandboxRun(
  client: SandboxTriggerClient,
  owner: string,
  repo: string,
  sha: string,
  opts: MonitorSandboxOpts
): Promise<Result<SandboxRunVerdict, StitchError>> {
  const op = 'monitorSandboxRun';
  const checked = checkClient(client, op);
  if (checked.isErr()) return err(checked.error);
  if (!isNonBlankString(owner)) {
    return invalid('owner', `${op}: owner is required`);
  }
  if (!isNonBlankString(repo)) {
    return invalid('repo', `${op}: repo is required`);
  }
  if (!isNonBlankString(sha) || !SHA_RE.test(sha)) {
    return invalid('sha', `${op}: sha must be a 40-hex commit sha`);
  }
  if (opts === null || typeof opts !== 'object') {
    return invalid('opts', `${op}: opts is required`);
  }
  if (!isNonBlankString(opts.jobId)) {
    return invalid('jobId', `${op}: jobId is required`);
  }
  if (opts.branch !== undefined && !isNonBlankString(opts.branch)) {
    return invalid('branch', `${op}: branch must not be blank`);
  }

  const found = await findRunsForSha(checked.value, owner, repo, sha, {
    ...(opts.branch !== undefined ? { branch: opts.branch } : {}),
  });
  if (found.isErr()) return err(found.error);
  if (found.value.length === 0) {
    return err({
      code: 'GITHUB_API_ERROR',
      status: 0,
      message: `${op}: no workflow runs found for sha ${sha} (dispatch may still be queued)`,
    });
  }
  const candidate = found.value[0];
  // Defensive only (non-empty dense arrays always carry [0]; the
  // no-throw rule needs the guard under noUncheckedIndexedAccess).
  if (candidate === undefined) {
    return err(internalError(op, 'run search returned no candidate'));
  }
  const jobRef: JobRef = { jobId: opts.jobId, headSha: sha };
  if (opts.branch !== undefined) {
    jobRef.ref = opts.branch;
  }
  // Defensive only (the list is already sha-filtered, so correlation
  // cannot miss — the no-throw rule needs the guard).
  // Defensive only (the list is already sha-filtered, so correlation
  // cannot miss — the no-throw rule needs the guard).
  if (correlateRunToJob(candidate, [jobRef]) !== opts.jobId) {
    return err(internalError(op, `run ${candidate.runId} did not correlate to job ${opts.jobId}`));
  }

  const relayed = await relayWorkflowRun(checked.value, owner, repo, candidate.runId);
  if (relayed.isErr()) return err(relayed.error);
  if (relayed.value.headSha !== sha) {
    return err(internalError(op, `run ${relayed.value.runId} sha drifted from ${sha}`));
  }
  const completed = relayed.value.status === 'completed';
  return ok({
    runId: relayed.value.runId,
    url: relayed.value.url,
    sha,
    jobId: opts.jobId,
    completed,
    conclusion: relayed.value.conclusion,
    pass: completed && relayed.value.conclusion === 'success',
    flaky: false,
  });
}
