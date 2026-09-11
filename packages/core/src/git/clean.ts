// Clean tree verify (P-084): the preflight guard every state-assuming
// operation calls first — merge (P-072), stash safety (P-081), cherry-pick
// (P-074), and the write→commit loop (P-076/077). Flow: validate ->
// ONE `git status --porcelain=v1 -z` spawn (no rev-parse preflight: the
// status failure itself maps non-repos to CONFIG) -> parse fail-closed ->
// filter (unmerged always dirty; `??` droppable; allowlist via the
// P-012/P-036/P-083 matcher) -> boolean (isClean) or typed refusal
// (assertClean, GIT_ERROR carrying the sorted offending paths).
//
// Verified behavior (real git 2.47 on this box — do not assume otherwise):
// - Clean trees exit 0 with empty stdout; any staged/unstaged/untracked
//   entry makes the output non-empty (empty = clean, per spec step 1).
// - Renames print as `R  <new>\0<old>\0`: the second chunk is a BARE
//   path with no XY prefix (probed — the parser consumes it only after
//   an R/C entry and reports the new path alone; the old path no longer
//   exists, so reporting it would be wrong).
// - `-z` prints paths raw (spaces/unicode unquoted); untracked dirs
//   collapse to a single `?? <dir>/` entry (probed).
// - Outside a repo, `status` exits 128 with "fatal: not a git repository"
//   — mapped to CONFIG_ERROR (field repoPath), never GIT_ERROR.
// - Unmerged entries (`UU`, `AA`, ...) refuse in assertClean even when
//   allowlisted: a conflict in progress is never "expected output".
//
// Safety contract:
// - Parse failures are INTERNAL and fail CLOSED (a safety net must never
//   misread dirt as clean — P-081 lesson); a trailing R/C without its
//   source chunk is truncated output, likewise INTERNAL.
// - Only counts + the caller's context reach the logs (never file
//   contents); the offending paths travel in the returned error message
//   (P-074 precedent), capped at 20 with an exact remainder count so a
//   pathological tree cannot build a megabyte message.
// - The runner returns exit codes as data (P-075 pattern: 124 = timeout
//   sentinel); every rejection -> INTERNAL; no new StitchError codes
//   (P-203 owns the future DIRTY_TREE taxonomy — until then refusals are
//   GIT_ERROR, exactly like P-074's `worktree not clean` refusal).
//
// Seams and future phases:
// - CleanRuntime.run is the only process seam (execFile default).
// - P-085 coordinates job rollback on these refusals; P-238 wraps merge
//   stages with assertClean preflights keyed off the returned paths.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ok, err, type Result } from 'neverthrow';
import type { StitchError } from '../result/index.js';
import { logger, createJobLogger } from '../logger/index.js';
import { buildIgnoreMatcher } from '../util/ignore.js';

/** Silence timeout (ms): status porcelain is local and fast. */
export const DEFAULT_CLEAN_TIMEOUT_MS = 60_000;

/** Exec timeout sentinel: Node kills the child (SIGTERM/ETIMEDOUT). */
const TIMEOUT_EXIT_CODE = 124;

/** Porcelain XY codes marking unmerged index entries (git status docs). */
const UNMERGED_CODES = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU']);

/** Cap on paths embedded in a refusal message (exact count always kept). */
const MAX_DIRTY_PATHS_IN_MESSAGE = 20;

export interface CleanOpts {
  /** Ignore untracked (`??`) entries. Default: false (fail-closed). */
  ignoreUntracked?: boolean;
  /**
   * Gitignore-style patterns for expected output (stitched-out dirs,
   * generated manifests — P-083) that must not false-flag the guard.
   * Never excuses unmerged entries.
   */
  allowlist?: readonly string[];
  /** Silence timeout ms for the git process. Default: 60_000. */
  timeoutMs?: number;
  /** Job id for structured logs. */
  jobId?: string;
}

/** One parsed porcelain entry (rename/copy sources already consumed). */
export interface PorcelainEntry {
  xy: string;
  path: string;
}

/** Parsed tree state: conflicts vs everything else. */
export interface PorcelainState {
  unmerged: string[];
  entries: PorcelainEntry[];
}

/** Process result as data: exit codes are signals, never rejections. */
export interface CleanRunResult {
  exitCode: number;
  stdout: Buffer;
  stderr: string;
}

export interface CleanRunner {
  (args: readonly string[], cwd: string, opts: { timeoutMs: number }): Promise<CleanRunResult>;
}

export interface CleanRuntime {
  run?: CleanRunner;
}

const execFileAsync = promisify(execFile);

/** Default runner: real git via PATH, killed after timeoutMs of silence. */
async function defaultRun(
  args: readonly string[],
  cwd: string,
  opts: { timeoutMs: number }
): Promise<CleanRunResult> {
  try {
    const { stdout, stderr } = await execFileAsync('git', [...args], {
      cwd,
      timeout: opts.timeoutMs,
      maxBuffer: 16 * 1024 * 1024,
      encoding: 'buffer',
    });
    return { exitCode: 0, stdout: stdout as Buffer, stderr: String(stderr) };
  } catch (error) {
    return { exitCode: exitCodeOf(error), stdout: Buffer.from(''), stderr: causeDetail(error) };
  }
}

/**
 * Map a spawn rejection to a process exit code. Exported for unit tests:
 * the timeout sentinel (124) is load-bearing (runFailure branches on it)
 * and must stay pinned without flaky timing tests.
 */
export function exitCodeOf(error: unknown): number {
  if (typeof error === 'object' && error !== null) {
    const rec = error as { code?: unknown; killed?: unknown; status?: unknown };
    if (rec.killed === true || rec.code === 'ETIMEDOUT') return TIMEOUT_EXIT_CODE;
    if (typeof rec.code === 'number') return rec.code;
    if (typeof rec.status === 'number') return rec.status;
  }
  return 1;
}

function causeDetail(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** Narrow GIT_ERROR factory (P-071 lesson: never widen to StitchError). */
function gitFailure(
  op: string,
  cause: unknown
): { code: 'GIT_ERROR'; message: string; gitOutput: string } {
  const detail = causeDetail(cause);
  return { code: 'GIT_ERROR', message: `${op} failed: ${detail}`, gitOutput: detail };
}

function invalid(field: string, message: string): Result<never, StitchError> {
  return err({ code: 'CONFIG_ERROR', field, message });
}

function internalError(op: string, cause: unknown): StitchError {
  return {
    code: 'INTERNAL',
    message: `${op}: ${causeDetail(cause)}`,
    ...(cause instanceof Error ? { cause } : {}),
  };
}

function runFailure(
  op: string,
  result: CleanRunResult,
  timeoutMs: number
): { code: 'GIT_ERROR'; message: string; gitOutput: string } {
  if (result.exitCode === TIMEOUT_EXIT_CODE) {
    return gitFailure(op, `timed out after ${timeoutMs}ms`);
  }
  const detail =
    result.stderr.trim() === '' ? `exit code ${result.exitCode}` : result.stderr.trim();
  return gitFailure(op, detail);
}

interface BoundRuntime {
  run: CleanRunner;
}

function bindRuntime(runtime: CleanRuntime | undefined): BoundRuntime {
  return { run: runtime?.run ?? defaultRun };
}

/** Run git, converting runner rejections (spawn failures) to INTERNAL. */
async function runGit(
  bound: BoundRuntime,
  op: string,
  args: readonly string[],
  cwd: string,
  timeoutMs: number
): Promise<Result<Buffer, StitchError>> {
  let result: CleanRunResult;
  try {
    result = await bound.run(args, cwd, { timeoutMs });
  } catch (error) {
    return err(internalError(op, error));
  }
  if (result.exitCode === 0) return ok(result.stdout);
  return err(runFailure(op, result, timeoutMs));
}

interface NormalizedBase {
  repoPath: string;
  timeoutMs: number;
  jobId: string | undefined;
}

function normalizeBase(
  repoPath: string,
  timeoutMs: number | undefined,
  op: string
): Result<NormalizedBase, StitchError> {
  if (repoPath.trim() === '') {
    return invalid('repoPath', `${op}: repoPath is required`);
  }
  const resolved = timeoutMs ?? DEFAULT_CLEAN_TIMEOUT_MS;
  if (!Number.isInteger(resolved) || resolved < 1) {
    return invalid('timeoutMs', `${op}: timeoutMs must be an integer >= 1`);
  }
  return ok({ repoPath, timeoutMs: resolved, jobId: undefined });
}

/**
 * Parse `git status --porcelain=v1 -z` output fail-closed. Rename/copy
 * entries (`R`/`C`) are followed by a bare source-path chunk which is
 * consumed, never reported. Anything structurally off (short chunk,
 * missing separator, trailing source) is INTERNAL — never clean.
 */
export function parsePorcelainStatus(output: Buffer | string): Result<PorcelainState, StitchError> {
  const op = 'clean status';
  const text = typeof output === 'string' ? output : output.toString('utf8');
  // Never trim chunks: leading-space codes (' M modified') are load-bearing
  // (P-077 lesson) — only drop truly empty segments (trailing NUL).
  const unmerged: string[] = [];
  const entries: PorcelainEntry[] = [];
  let expectSource = false;
  for (const chunk of text.split('\0').filter(part => part !== '')) {
    if (expectSource) {
      expectSource = false;
      continue;
    }
    if (chunk.length < 4 || chunk[2] !== ' ') {
      return err(internalError(op, `malformed entry ${JSON.stringify(chunk)}`));
    }
    const xy = chunk.slice(0, 2);
    const path = chunk.slice(3);
    if (UNMERGED_CODES.has(xy)) unmerged.push(path);
    else entries.push({ xy, path });
    if (xy.charAt(0) === 'R' || xy.charAt(0) === 'C') expectSource = true;
  }
  if (expectSource) {
    return err(internalError(op, 'truncated output: rename without its source path'));
  }
  return ok({ unmerged, entries });
}

function cleanLog(
  jobId: string | undefined,
  op: string,
  repoPath: string
): ReturnType<typeof logger.child> {
  const base = jobId === undefined ? logger : createJobLogger(jobId);
  return base.child({ op, repoPath });
}

interface CollectedDirt {
  /** Sorted offending paths (unmerged first, then the rest). */
  paths: string[];
}

/**
 * Single-spawn porcelain read plus filtering. Unmerged entries are always
 * dirt; `??` drops under ignoreUntracked; the allowlist (P-083 matcher)
 * excuses expected output. Non-repos map to CONFIG_ERROR off the status
 * failure itself — no rev-parse preflight (spec: porcelain only).
 */
async function collectDirt(
  bound: BoundRuntime,
  repoPath: string,
  op: string,
  opts: CleanOpts,
  timeoutMs: number
): Promise<Result<CollectedDirt, StitchError>> {
  const status = await runGit(
    bound,
    `${op} status`,
    ['status', '--porcelain=v1', '-z'],
    repoPath,
    timeoutMs
  );
  if (status.isErr()) {
    if (status.error.code === 'GIT_ERROR' && /not a git repository/i.test(status.error.message)) {
      return err({
        code: 'CONFIG_ERROR',
        field: 'repoPath',
        message: `${op}: not a git repository ("${repoPath}")`,
      });
    }
    return err(status.error);
  }
  const parsed = parsePorcelainStatus(status.value);
  if (parsed.isErr()) return err(parsed.error);

  const patterns = (opts.allowlist ?? []).filter(p => p.trim() !== '');
  let matcher: ((relPath: string) => boolean) | null = null;
  if (patterns.length > 0) {
    try {
      matcher = buildIgnoreMatcher(patterns);
    } catch (error) {
      // Defensive only (probed P-083: picomatch accepts every non-empty
      // string); the no-throw rule still requires the guard.
      return err(internalError(`${op} allowlist`, error));
    }
  }

  const dirt: string[] = [...parsed.value.unmerged];
  for (const entry of parsed.value.entries) {
    if (entry.xy === '??' && opts.ignoreUntracked === true) continue;
    if (matcher !== null && matcher(entry.path)) continue;
    dirt.push(entry.path);
  }
  return ok({ paths: dirt.sort() });
}

/** Refusal message: exact count, sorted paths, capped length. */
function refusalMessage(op: string, context: string, paths: string[]): string {
  const shown = paths.slice(0, MAX_DIRTY_PATHS_IN_MESSAGE);
  const noun = paths.length === 1 ? '1 path' : `${paths.length} paths`;
  const tail = paths.length > shown.length ? ` (+${paths.length - shown.length} more)` : '';
  return `${op}: refusing: dirty worktree in "${context}" (${noun}: ${shown.join(', ')})${tail}`;
}

/**
 * True when the worktree has no uncommitted drift. Unmerged entries count
 * as dirty; untracked files count unless ignoreUntracked is set; allowlist
 * patterns excuse expected output (never unmerged entries).
 */
export async function isClean(
  repoPath: string,
  opts: CleanOpts = {},
  runtime?: CleanRuntime
): Promise<Result<boolean, StitchError>> {
  const op = 'isClean';
  const normalized = normalizeBase(repoPath, opts.timeoutMs, op);
  if (normalized.isErr()) return err(normalized.error);
  const bound = bindRuntime(runtime);
  const options = normalized.value;
  const log = cleanLog(opts.jobId, 'clean', options.repoPath);

  const dirt = await collectDirt(bound, options.repoPath, op, opts, options.timeoutMs);
  if (dirt.isErr()) return err(dirt.error);
  const clean = dirt.value.paths.length === 0;
  log.debug({ clean, dirty: dirt.value.paths.length }, 'tree state checked');
  return ok(clean);
}

/**
 * Guard: resolve ok on a clean tree, otherwise a typed GIT_ERROR refusal
 * carrying the sorted offending paths (P-203 will promote this shape to
 * DIRTY_TREE; until then GIT_ERROR, exactly like P-074's refusal).
 */
export async function assertClean(
  repoPath: string,
  context: string,
  opts: CleanOpts = {},
  runtime?: CleanRuntime
): Promise<Result<void, StitchError>> {
  const op = 'assertClean';
  if (context.trim() === '') {
    return invalid('context', `${op}: context is required`);
  }
  const normalized = normalizeBase(repoPath, opts.timeoutMs, op);
  if (normalized.isErr()) return err(normalized.error);
  const bound = bindRuntime(runtime);
  const options = normalized.value;
  const log = cleanLog(opts.jobId, 'clean-assert', options.repoPath);

  const dirt = await collectDirt(bound, options.repoPath, op, opts, options.timeoutMs);
  if (dirt.isErr()) return err(dirt.error);
  if (dirt.value.paths.length > 0) {
    return err({
      code: 'GIT_ERROR',
      message: refusalMessage(op, context, dirt.value.paths),
    });
  }
  log.debug('tree verified clean');
  return ok(undefined);
}
