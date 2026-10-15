// Re-export the neverthrow primitives that every core module uses. Importing
// from this barrel (not from 'neverthrow' directly) gives cli/web a single
// import surface and lets us add helpers (match, fromPromise alias, error
// factories) without touching every consumer.
export {
  Result,
  ResultAsync,
  ok,
  err,
  okAsync,
  errAsync,
  fromPromise,
  fromSafePromise,
  fromThrowable,
  fromAsyncThrowable,
} from 'neverthrow';

// Re-export the neverthrow types so consumers can write `Result<T, E>` without
// reaching into neverthrow.
export type { Ok, Err } from 'neverthrow';

import { ResultAsync, ok, err, type Result as ResultType } from 'neverthrow';

/**
 * Exhaustively match a Result by requiring both branches. Throws at compile
 * time if a consumer forgets one (TS error: not all code paths return).
 *
 *   const value = match(loadConfig(), {
 *     onOk: (cfg) => cfg.sandbox.backend,
 *     onErr: (e) => 'docker',
 *   });
 */
export function match<T, E, A, B = A>(
  result: ResultType<T, E>,
  branches: { onOk: (value: T) => A; onErr: (error: E) => B }
): A | B {
  return result.isOk() ? branches.onOk(result.value) : branches.onErr(result.error);
}

/**
 * StitchError: typed error kinds with stable codes covering all pipeline
 * stages. Mirrors INTEGRATIONS.md §9.1; extended with AUTH_ERROR, COST_LIMIT,
 * and COMPLIANCE_VIOLATION per PHASES_DETAILED.md P-011 (which lists 11 stages:
 * git, github, deps, license, ai, sandbox, orchestration, config, auth, cost,
 * compliance). Stable string codes let the CLI render typed errors and the
 * web dashboard filter on them.
 *
 * GitHub HTTP failures carry dedicated codes per P-102 (consumed by the
 * CLI exit map in P-203 and the help surface in P-316): AUTH_FAILED (401),
 * RATE_LIMIT (429 / rate-limited 403), FORBIDDEN (other 403s), NOT_FOUND
 * (404), NETWORK (transport/abort with no HTTP status). Each carries a
 * human hint plus the offending repo/scope for the UI. AUTH_ERROR stays
 * for local validation (bad config, missing scopes) that never hit HTTP.
 *
 * Deps manifest parsing carries dedicated codes per P-104: DEPS_PARSE_ERROR
 * (malformed manifest content, with the offending file) and FILE_NOT_FOUND
 * (manifest path missing, or content empty). P-105-P-107 reuse both.
 * Deps manifest union carries ECOSYSTEM_MISMATCH per P-108 (inputs span
 * more than one ecosystem, with the sorted ecosystem list).
 */
export type StitchError =
  | { code: 'GIT_ERROR'; message: string; gitOutput?: string }
  | {
      code: 'GITHUB_API_ERROR';
      status: number;
      message: string;
      hint?: string;
      repo?: string;
      scope?: string;
    }
  | { code: 'DOCKER_ERROR'; message: string; containerId?: string }
  // P-168: an image pull failed. Distinct from `DOCKER_ERROR` (a container
  // operation failed) because the remedies differ — a pull failure is about
  // the registry/image/tag or daemon auth, and P-175's GH Actions fallback
  // keys off it, while a container failure is about the run itself.
  | { code: 'DOCKER_PULL_FAILED'; message: string; image?: string }
  // P-169: building a local per-ecosystem image failed. Distinct from both a
  // pull failure (registry/image) and `DOCKER_ERROR` (a container operation):
  // a build failure is about the Dockerfile/context the user asked us to use.
  | { code: 'DOCKER_BUILD_FAILED'; message: string; image?: string }
  | { code: 'AI_PROVIDER_ERROR'; provider: string; message: string }
  | { code: 'LICENSE_VIOLATION'; license: string; policy: 'warn' | 'deny' }
  | { code: 'DEPENDENCY_CONFLICT'; packages: string[]; details: string }
  | { code: 'SANDBOX_FAILED'; step: 'install' | 'build' | 'test'; logs: string }
  // P-155 agent tool `run_build`: no build backend was available, so the
  // verification could not run. Distinct from `SANDBOX_FAILED`, which means a
  // build ran and failed — here nothing ran at all, and the agent loop must not
  // treat the absence of a verdict as a failing verdict.
  | { code: 'SANDBOX_UNAVAILABLE'; message: string; backend?: string }
  | { code: 'CONFIG_ERROR'; field: string; message: string }
  | { code: 'USER_CANCELLED'; reason: string }
  | { code: 'INTERNAL'; message: string; cause?: Error }
  | { code: 'AUTH_ERROR'; provider: string; message: string }
  | { code: 'COST_LIMIT'; provider: string; spentUsd: number; limitUsd: number; message?: string }
  | { code: 'COMPLIANCE_VIOLATION'; rule: string; message: string }
  | { code: 'UNKNOWN_LICENSE'; id: string }
  | {
      code: 'AUTH_FAILED';
      provider: string;
      message: string;
      hint: string;
      repo?: string;
      scope?: string;
    }
  | {
      code: 'RATE_LIMIT';
      status: number;
      message: string;
      hint: string;
      repo?: string;
      scope?: string;
    }
  | {
      code: 'FORBIDDEN';
      provider: string;
      message: string;
      hint: string;
      repo?: string;
      scope?: string;
    }
  | {
      code: 'NOT_FOUND';
      status: number;
      message: string;
      hint: string;
      repo?: string;
      scope?: string;
    }
  | { code: 'NETWORK'; message: string; hint: string; repo?: string; scope?: string }
  | { code: 'DEPS_PARSE_ERROR'; file: string; message: string }
  | { code: 'FILE_NOT_FOUND'; path: string; message: string }
  | { code: 'ECOSYSTEM_MISMATCH'; message: string; ecosystems: string[] }
  | { code: 'LOCKFILE_GENERATION_FAILED'; command: string; exitCode: number; stderr: string }
  | { code: 'LOCKFILE_NOT_CREATED'; lockfilePath: string; command: string; stderr: string }
  | { code: 'UNSUPPORTED_ECOSYSTEM'; ecosystem: string; message: string }
  | { code: 'LICENSE_SCAN_FAILED'; message: string }
  | { code: 'SCANCODE_MISSING'; message: string; action: string; optInPath?: string }
  | { code: 'SCANCODE_FAILED'; message: string; stderr?: string; exitCode?: number }
  // P-136/P-138/P-140/P-141/P-143 AI runtime codes: policy, tool loop,
  // retry, provider construction, tool-argument parsing, and prompts.
  | { code: 'TOOL_CALLING_BLOCKED'; message: string; model: string; remedy: string }
  | { code: 'LOOP_LIMIT'; message: string }
  // P-164: the loop's token budget, distinct from COST_LIMIT. Tokens and dollars
  // are different budgets - a cheap model can exhaust a token cap with no dollar
  // consequence, and an expensive one can hit the dollar cap first - so a run
  // that stopped for one reason must not be reported as the other.
  | {
      code: 'TOKEN_LIMIT';
      spentTokens: number;
      limitTokens: number;
      message: string;
    }
  | { code: 'UNKNOWN_TOOL'; message: string }
  | { code: 'TOOL_DENIED'; message: string }
  | { code: 'TOOL_ARGS_INVALID_JSON'; message: string }
  | { code: 'TOOL_ARGS_VALIDATION'; message: string }
  | { code: 'INVALID_PROVIDER'; message: string }
  | { code: 'UNKNOWN_MODEL'; message: string }
  | { code: 'MODEL_INCAPABLE'; message: string }
  | { code: 'ABORTED'; message: string }
  // P-156 agent tool `ask_user`: no human answered before the configured bound.
  // Distinct from `ABORTED` (the human actively cancelled) and from
  // `USER_CANCELLED`, because "no reply" and "declined" are different events
  // the agent loop must react to differently.
  | { code: 'USER_TIMEOUT'; message: string; timeoutMs: number }
  | { code: 'RETRY_EXHAUSTED'; message: string }
  | { code: 'PROMPT_NOT_FOUND'; message: string }
  | { code: 'PROMPT_MISSING_VAR'; message: string }
  // P-146 runtime provider switch: every failover candidate was exhausted or
  // rejected by the model/tool policy, so the job cannot continue.
  | { code: 'NO_FAILOVER'; message: string; exhausted: string[] }
  // P-148 agent tool `select_files`: a requested path is not present in the
  // scanned listing of the source repo it was asked to come from (or the
  // supplied glob matched nothing). `missing` lists the unresolvable
  // selectors — explicit paths absent from the listing, plus the glob string
  // itself when it matched nothing — so the UI can show precisely what the
  // model got wrong instead of a generic failure.
  | {
      code: 'SELECT_PATH_NOT_FOUND';
      message: string;
      repo: 'A' | 'B';
      missing: string[];
      glob?: string;
    }
  // P-158 agent tool-result validation: the tool reported SUCCESS but returned
  // a payload too large to hand back to the model. Distinct from every other
  // tool code because the tool itself did not fail — a caller cannot fix this
  // by changing the tool's arguments, only by raising
  // `MAX_TOOL_RESULT_BYTES` (P-009 `[agent]` block) or narrowing the request.
  | { code: 'TOOL_RESULT_TOO_LARGE'; message: string; size: number; max: number }
  // P-159 agent state machine: the orchestrator was asked to make a move the
  // lifecycle does not permit. Distinct from every other code because nothing
  // failed — the agent is in a state from which the requested one is
  // unreachable, which is a programming/contract error rather than a runtime
  // fault. `from`/`to` are plain strings (not the `AgentState` union) so this
  // contract module never has to import from the agent module, which imports
  // from here.
  | { code: 'ILLEGAL_TRANSITION'; message: string; from: string; to: string }
  // P-161 undo stack: asked to roll back the most recent action when there is
  // no action to roll back. Distinct from every other code because nothing
  // failed and nothing is wrong — the caller asked for a no-op that cannot be
  // performed, and the loop must be able to tell that apart from a revert that
  // was attempted and failed.
  | { code: 'NOTHING_TO_UNDO'; message: string };

export type StitchErrorCode = StitchError['code'];

/** All stable error codes. Used by tests to assert uniqueness. */
export const STITCH_ERROR_CODES = [
  'GIT_ERROR',
  'GITHUB_API_ERROR',
  'DOCKER_ERROR',
  'DOCKER_PULL_FAILED',
  'DOCKER_BUILD_FAILED',
  'AI_PROVIDER_ERROR',
  'LICENSE_VIOLATION',
  'DEPENDENCY_CONFLICT',
  'SANDBOX_FAILED',
  'SANDBOX_UNAVAILABLE',
  'CONFIG_ERROR',
  'USER_CANCELLED',
  'INTERNAL',
  'AUTH_ERROR',
  'COST_LIMIT',
  'COMPLIANCE_VIOLATION',
  'UNKNOWN_LICENSE',
  'AUTH_FAILED',
  'RATE_LIMIT',
  'FORBIDDEN',
  'NOT_FOUND',
  'NETWORK',
  'DEPS_PARSE_ERROR',
  'FILE_NOT_FOUND',
  'ECOSYSTEM_MISMATCH',
  'LOCKFILE_GENERATION_FAILED',
  'LOCKFILE_NOT_CREATED',
  'UNSUPPORTED_ECOSYSTEM',
  'LICENSE_SCAN_FAILED',
  'SCANCODE_MISSING',
  'SCANCODE_FAILED',
  'TOOL_CALLING_BLOCKED',
  'LOOP_LIMIT',
  'TOKEN_LIMIT',
  'UNKNOWN_TOOL',
  'TOOL_DENIED',
  'TOOL_ARGS_INVALID_JSON',
  'TOOL_ARGS_VALIDATION',
  'INVALID_PROVIDER',
  'UNKNOWN_MODEL',
  'MODEL_INCAPABLE',
  'ABORTED',
  'USER_TIMEOUT',
  'RETRY_EXHAUSTED',
  'PROMPT_NOT_FOUND',
  'PROMPT_MISSING_VAR',
  'NO_FAILOVER',
  'SELECT_PATH_NOT_FOUND',
  'TOOL_RESULT_TOO_LARGE',
  'ILLEGAL_TRANSITION',
  'NOTHING_TO_UNDO',
] as const satisfies readonly StitchErrorCode[];

/**
 * Human-readable message for any StitchError variant.
 *
 * Not every variant carries `message` (USER_CANCELLED carries `reason`,
 * COST_LIMIT carries amounts, UNKNOWN_LICENSE carries an id), so reading
 * `error.message` off the union is a type error. This accessor returns the
 * variant's own message when it has one and falls back to the code, so
 * callers never reach for a property the variant lacks.
 */
export function stitchErrorMessage(error: StitchError): string {
  const withMessage = error as { readonly message?: unknown };
  return typeof withMessage.message === 'string' ? withMessage.message : error.code;
}

/** Factory: ok with a known stitch error type. */
export function stitchOk<T>(value: T): ResultType<T, StitchError> {
  return ok(value);
}

/** Factory: err with a known stitch error type. */
export function stitchErr<E extends StitchError>(error: E): ResultType<never, E> {
  return err(error);
}

/**
 * fromInternalPromise: like neverthrow's fromPromise but defaults the error
 * mapper to a typed INTERNAL StitchError. Use this for any unsafe
 * promise-producing call where you just want a typed failure result.
 */
export function fromInternalPromise<T>(
  promise: PromiseLike<T>,
  messagePrefix = 'rejected'
): ResultAsync<T, StitchError> {
  return ResultAsync.fromPromise(promise, (e: unknown) => ({
    code: 'INTERNAL' as const,
    message: `${messagePrefix}: ${e instanceof Error ? e.message : String(e)}`,
    ...(e instanceof Error ? { cause: e } : {}),
  }));
}

/** Re-export Result as a named import alias for ergonomic consumers. */
export type { ResultType };
