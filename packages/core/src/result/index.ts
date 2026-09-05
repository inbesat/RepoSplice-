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
 */
export type StitchError =
  | { code: 'GIT_ERROR'; message: string; gitOutput?: string }
  | { code: 'GITHUB_API_ERROR'; status: number; message: string }
  | { code: 'DOCKER_ERROR'; message: string; containerId?: string }
  | { code: 'AI_PROVIDER_ERROR'; provider: string; message: string }
  | { code: 'LICENSE_VIOLATION'; license: string; policy: 'warn' | 'deny' }
  | { code: 'DEPENDENCY_CONFLICT'; packages: string[]; details: string }
  | { code: 'SANDBOX_FAILED'; step: 'install' | 'build' | 'test'; logs: string }
  | { code: 'CONFIG_ERROR'; field: string; message: string }
  | { code: 'USER_CANCELLED'; reason: string }
  | { code: 'INTERNAL'; message: string; cause?: Error }
  | { code: 'AUTH_ERROR'; provider: string; message: string }
  | { code: 'COST_LIMIT'; provider: string; spentUsd: number; limitUsd: number }
  | { code: 'COMPLIANCE_VIOLATION'; rule: string; message: string };

export type StitchErrorCode = StitchError['code'];

/** All stable error codes. Used by tests to assert uniqueness. */
export const STITCH_ERROR_CODES = [
  'GIT_ERROR',
  'GITHUB_API_ERROR',
  'DOCKER_ERROR',
  'AI_PROVIDER_ERROR',
  'LICENSE_VIOLATION',
  'DEPENDENCY_CONFLICT',
  'SANDBOX_FAILED',
  'CONFIG_ERROR',
  'USER_CANCELLED',
  'INTERNAL',
  'AUTH_ERROR',
  'COST_LIMIT',
  'COMPLIANCE_VIOLATION',
] as const satisfies readonly StitchErrorCode[];

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
