// Thin typed wrapper around `simple-git` so every later P-069+ module
// imports a stable, Result-returning surface (P-011 contract) instead of
// the raw lib. The wrapper:
//   - sets non-interactive env defaults (GIT_TERMINAL_PROMPT=0, P-265)
//   - returns Result<T, StitchError> from every public helper
//   - never throws on lib API misuse
//
// Raw `simpleGit()` is still re-exported for advanced callers that need
// streaming task events; the rest of core should prefer the helpers below.

import simpleGit, {
  type SimpleGit,
  type StatusResult,
  type LogResult,
  type InitResult,
} from 'simple-git';
import { ok, err, ResultAsync, type Result } from 'neverthrow';
import { fromInternalPromise, type StitchError } from '../result/index.js';

export type Git = SimpleGit;

export interface GitFactoryOptions {
  /** Set GIT_TERMINAL_PROMPT=0 (P-265 — non-interactive). Default: true. */
  nonInteractive?: boolean;
  /** Working directory for the underlying git invocation. */
  baseDir?: string;
}

const GIT_NON_INTERACTIVE_ENV = '0';

/**
 * Build a `simple-git` instance pre-configured for the repo-stitcher
 * conventions. Use this in every later P-069+ module instead of calling
 * `simpleGit()` directly.
 */
export function createGit(opts: GitFactoryOptions = {}): Git {
  const { nonInteractive = true, baseDir } = opts;
  // simple-git v3 doesn't accept `env` in its options object — the env
  // is set after creation via the `env(name, value)` chainable builder.
  const git = simpleGit({ baseDir: baseDir ?? process.cwd() });
  if (nonInteractive) {
    git.env('GIT_TERMINAL_PROMPT', GIT_NON_INTERACTIVE_ENV);
  }
  return git;
}

// ─── High-level Result-returning helpers (Phase 0 surface) ────────────────
// P-069+ modules should add their own typed wrappers (cloneRepo, mergeRepos,
// etc.). For now we ship the minimal surface P-016 needs to prove the
// integration works and the factory produces a usable instance.

export function getStatus(git: Git): ResultAsync<StatusResult, StitchError> {
  return fromInternalPromise(git.status(), 'git.status');
}

export function getLog(
  git: Git,
  options: { maxCount?: number } = {}
): ResultAsync<LogResult, StitchError> {
  if (options.maxCount !== undefined) {
    return fromInternalPromise(git.log([`-n`, String(options.maxCount)]), 'git.log');
  }
  return fromInternalPromise(git.log(), 'git.log');
}

export function isRepo(git: Git): ResultAsync<boolean, StitchError> {
  return fromInternalPromise(git.checkIsRepo(), 'git.checkIsRepo').map((isRepo: boolean) => isRepo);
}

export function initRepo(git: Git, bare = false): ResultAsync<InitResult, StitchError> {
  return fromInternalPromise(git.init(bare), 'git.init');
}

export async function checkGitAvailable(): Promise<
  Result<{ version: string; raw: unknown }, StitchError>
> {
  // simple-git's `version()` returns `{major, minor, patch, agent, installed}`.
  // On success we format a human-readable string; on failure (binary missing)
  // the rejection becomes a typed GIT_ERROR StitchError.
  const probe = simpleGit();
  const result = await fromInternalPromise(probe.version(), 'git.version');
  if (result.isErr()) {
    return err({
      code: 'GIT_ERROR',
      message: 'git binary not found on PATH (P-063 requirement: min git 2.40)',
    });
  }
  const v = result.value as { major: number; minor: number; patch: number };
  return ok({ version: `git version ${v.major}.${v.minor}.${v.patch}`, raw: result.value });
}
