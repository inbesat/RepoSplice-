// Stash safety (P-081): the safety net around operations that could
// clobber uncommitted agent/merge work — stash before (P-238), restore
// after, roll back exactly (P-085). Flow (stash): validate -> rev-parse
// -> porcelain (clean = idempotent no-op, unmerged = refuse) -> snapshot
// list top -> `stash push -u -m` -> verify a new top appeared. Flow (pop):
// validate -> rev-parse -> porcelain (unmerged = never pop over a
// conflict) -> snapshot top (empty = no-op; expectedRef mismatch =
// refuse) -> `stash pop --index` -> verify the entry was consumed.
//
// Verified behavior (real git 2.47 on this box — do not assume otherwise):
// - `stash push` on a clean tree exits 0 with "No local changes to save"
//   (the porcelain pre-check means this is only ever a race).
// - `stash push -u -m <msg>` prints "Saved working directory and index
//   state ...", includes untracked files, and leaves a clean tree.
// - `stash list --format=%H` prints one full SHA per line, empty when no
//   entries; the newest entry is always on top.
// - `stash pop --index` restores the staged/unstaged split plus untracked
//   files, drops the entry ("Dropped refs/stash@{0} (sha)"), and exits 0.
// - `stash pop` with no entries exits 1 ("No stash entries found").
// - `stash push` on unmerged entries exits 1 ("needs merge", "could not
//   write index") — pre-checked via porcelain instead for a typed refusal.
//
// Safety contract:
// - Untracked files count as dirty (fail-closed: `-u` stashes them, and
//   the clean check sees `??` entries). Ignored files stay put.
// - Unmerged index entries refuse BOTH directions: stash would fail
//   inside git anyway, and pop would risk the conflicted tree —
//   callers (human/agent) resolve first (P-075).
// - Pop snapshots the top SHA first: an empty stash is a symmetric no-op,
//   an unexpected top refuses (never pop someone else's entry), and the
//   post-pop list must show the entry consumed (INTERNAL otherwise).
// - A push that records no entry is INTERNAL (only reachable through a
//   race — loud, never silent).
// - Only the stash ref + counts reach the logs (P-187 audit + recovery),
//   never file contents or the message body.
// - The runner returns exit codes as data (P-075 pattern: 124 = timeout
//   sentinel); every rejection -> INTERNAL; no new StitchError codes
//   (P-203 owns future taxonomy).
//
// Seams and future phases:
// - StashRuntime.run is the only process seam (execFile default).
// - P-084 owns assertClean (this clean check is the enforcement point
//   until then); P-085 coordinates job rollback on these outcomes;
//   P-238 wraps merge stages with stash/pop pairs keyed off the returned
//   flags. Unmerged porcelain codes mirror P-075's set (git's stable UI,
//   parsed independently per the codebase pattern).

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ok, err, type Result } from 'neverthrow';
import type { StitchError } from '../result/index.js';
import { logger, createJobLogger } from '../logger/index.js';

/** Silence timeout (ms): local stash plumbing, same budget as siblings. */
export const DEFAULT_STASH_TIMEOUT_MS = 60_000;

/** Exec timeout sentinel: Node kills the child (SIGTERM/ETIMEDOUT). */
const TIMEOUT_EXIT_CODE = 124;

/** Default stash message (identifiable in `stash list`, P-187 audit). */
export const DEFAULT_STASH_MESSAGE = 'stitch safeStash';

/** Porcelain XY codes marking unmerged index entries (git status docs). */
const UNMERGED_CODES = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU']);

export interface StashOpts {
  /** Stash message (argv-safe, never logged). Default: stitch safeStash. */
  message?: string;
  /** Silence timeout ms for git processes. Default: 60_000. */
  timeoutMs?: number;
  /** Job id for structured logs. */
  jobId?: string;
}

export interface PopOpts {
  /** Pop only when the top entry is this SHA (else refuse). */
  expectedRef?: string;
  /** Silence timeout ms for git processes. Default: 60_000. */
  timeoutMs?: number;
  /** Job id for structured logs. */
  jobId?: string;
}

export interface StashOutcome {
  stashed: boolean;
  /** New top entry SHA; null when nothing was stashed. */
  ref: string | null;
}

export interface PopOutcome {
  popped: boolean;
  /** Consumed entry SHA; null when nothing was popped. */
  ref: string | null;
}

/** Process result as data: exit codes are signals, never rejections. */
export interface StashRunResult {
  exitCode: number;
  stdout: Buffer;
  stderr: string;
}

export interface StashRunner {
  (args: readonly string[], cwd: string, opts: { timeoutMs: number }): Promise<StashRunResult>;
}

export interface StashRuntime {
  run?: StashRunner;
}

const execFileAsync = promisify(execFile);

/** Default runner: real git via PATH, killed after timeoutMs of silence. */
async function defaultRun(
  args: readonly string[],
  cwd: string,
  opts: { timeoutMs: number }
): Promise<StashRunResult> {
  try {
    const { stdout, stderr } = await execFileAsync('git', [...args], {
      cwd,
      timeout: opts.timeoutMs,
      maxBuffer: 16 * 1024 * 1024,
      encoding: 'buffer',
    });
    return { exitCode: 0, stdout: stdout as Buffer, stderr: String(stderr) };
  } catch (error) {
    return { exitCode: exitCodeOf(error), stdout: Buffer.from(''), stderr: detailOf(error) };
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

function detailOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

/** State refusal: GIT_ERROR carrying the offending paths (P-074 precedent). */
function refuse(message: string, paths: string): Result<never, StitchError> {
  return err({ code: 'GIT_ERROR', message: `safeStash: refusing: ${message}: ${paths}` });
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
  result: StashRunResult,
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
  run: StashRunner;
}

function bindRuntime(runtime: StashRuntime | undefined): BoundRuntime {
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
  let result: StashRunResult;
  try {
    result = await bound.run(args, cwd, { timeoutMs });
  } catch (error) {
    return err(internalError(op, error));
  }
  if (result.exitCode === 0) return ok(result.stdout);
  return err(runFailure(op, result, timeoutMs));
}

const SHA_RE = /^[0-9a-f]{40}$/;

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
  const resolved = timeoutMs ?? DEFAULT_STASH_TIMEOUT_MS;
  if (!Number.isInteger(resolved) || resolved < 1) {
    return invalid('timeoutMs', `${op}: timeoutMs must be an integer >= 1`);
  }
  return ok({ repoPath, timeoutMs: resolved, jobId: undefined });
}

/** Confirm repoPath is a git repo: CONFIG when it is not, GIT otherwise. */
async function ensureRepo(
  bound: BoundRuntime,
  repoPath: string,
  op: string,
  timeoutMs: number
): Promise<Result<void, StitchError>> {
  const gitDir = await runGit(
    bound,
    `${op} rev-parse`,
    ['rev-parse', '--git-dir'],
    repoPath,
    timeoutMs
  );
  if (gitDir.isErr()) {
    const message = gitDir.error.code === 'GIT_ERROR' ? gitDir.error.message : '';
    if (/not a git repository/i.test(message)) {
      return err({
        code: 'CONFIG_ERROR',
        field: 'repoPath',
        message: `${op}: not a git repository ("${repoPath}")`,
      });
    }
    return err(gitDir.error);
  }
  return ok(undefined);
}

/** Porcelain paths split into unmerged vs dirty (untracked counts dirty). */
interface TreeState {
  unmerged: string[];
  dirty: string[];
}

function readTreeState(output: Buffer): Result<TreeState, StitchError> {
  // Never trim chunks: leading-space codes (' M modified') are load-bearing
  // (P-077 lesson) — only drop truly empty segments. Malformed chunks fail
  // closed (INTERNAL): a safety net must never misread dirt as clean.
  const unmerged: string[] = [];
  const dirty: string[] = [];
  for (const entry of output
    .toString('utf8')
    .split('\0')
    .filter(part => part !== '')) {
    if (entry.length < 4 || entry[2] !== ' ') {
      return err(internalError('stash status', `malformed entry ${JSON.stringify(entry)}`));
    }
    const xy = entry.slice(0, 2);
    const path = entry.slice(3);
    if (UNMERGED_CODES.has(xy)) unmerged.push(path);
    else dirty.push(path);
  }
  return ok({ unmerged, dirty });
}

async function treeState(
  bound: BoundRuntime,
  repoPath: string,
  op: string,
  timeoutMs: number
): Promise<Result<TreeState, StitchError>> {
  const status = await runGit(
    bound,
    `${op} status`,
    ['status', '--porcelain=v1', '-z'],
    repoPath,
    timeoutMs
  );
  if (status.isErr()) return err(status.error);
  return readTreeState(status.value);
}

function stashLog(
  jobId: string | undefined,
  op: string,
  repoPath: string
): ReturnType<typeof logger.child> {
  const base = jobId === undefined ? logger : createJobLogger(jobId);
  return base.child({ op, repoPath });
}

/** Top stash entry SHA, or null when the stash is empty. */
async function stashTop(
  bound: BoundRuntime,
  repoPath: string,
  op: string,
  timeoutMs: number
): Promise<Result<string | null, StitchError>> {
  const list = await runGit(
    bound,
    `${op} list`,
    ['stash', 'list', '--format=%H'],
    repoPath,
    timeoutMs
  );
  if (list.isErr()) return err(list.error);
  const first = list.value
    .toString('utf8')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line !== '')[0];
  if (first === undefined) return ok(null);
  if (!SHA_RE.test(first)) {
    return err(internalError(`${op} list`, `malformed stash SHA ${JSON.stringify(first)}`));
  }
  return ok(first);
}

/**
 * Stash tracked + untracked work under an explicit message. Clean trees
 * are a no-op (P-250); unmerged trees refuse. Resolves whether anything
 * was stashed and the new top entry SHA.
 */
export async function safeStash(
  repoPath: string,
  opts: StashOpts = {},
  runtime?: StashRuntime
): Promise<Result<StashOutcome, StitchError>> {
  const op = 'safeStash';
  const normalized = normalizeBase(repoPath, opts.timeoutMs, op);
  if (normalized.isErr()) return err(normalized.error);
  const bound = bindRuntime(runtime);
  const options = normalized.value;
  const log = stashLog(opts.jobId, 'stash', options.repoPath);

  const repo = await ensureRepo(bound, options.repoPath, op, options.timeoutMs);
  if (repo.isErr()) return err(repo.error);

  const state = await treeState(bound, options.repoPath, op, options.timeoutMs);
  if (state.isErr()) return err(state.error);
  if (state.value.unmerged.length > 0) {
    return refuse('cannot stash with unmerged entries', state.value.unmerged.sort().join(', '));
  }
  if (state.value.dirty.length === 0) {
    log.debug('stash skipped: tree clean (no-op)');
    return ok({ stashed: false, ref: null });
  }

  const before = await stashTop(bound, options.repoPath, op, options.timeoutMs);
  if (before.isErr()) return err(before.error);

  const pushed = await runGit(
    bound,
    op,
    ['stash', 'push', '-u', '-m', opts.message ?? DEFAULT_STASH_MESSAGE],
    options.repoPath,
    options.timeoutMs
  );
  if (pushed.isErr()) return err(pushed.error);

  const after = await stashTop(bound, options.repoPath, op, options.timeoutMs);
  if (after.isErr()) return err(after.error);
  if (after.value === null || after.value === before.value) {
    return err(internalError(op, 'push reported success but no entry was recorded'));
  }
  log.debug({ ref: after.value }, 'stash recorded');
  return ok({ stashed: true, ref: after.value });
}

/**
 * Restore the top stash entry (with `--index` for exact staged splits).
 * Refuses over unmerged entries and unexpected tops; empty stashes are a
 * symmetric no-op. Resolves whether anything was popped and its SHA.
 */
export async function safeStashPop(
  repoPath: string,
  opts: PopOpts = {},
  runtime?: StashRuntime
): Promise<Result<PopOutcome, StitchError>> {
  const op = 'safeStashPop';
  const normalized = normalizeBase(repoPath, opts.timeoutMs, op);
  if (normalized.isErr()) return err(normalized.error);
  const bound = bindRuntime(runtime);
  const options = normalized.value;
  const log = stashLog(opts.jobId, 'stash-pop', options.repoPath);

  const repo = await ensureRepo(bound, options.repoPath, op, options.timeoutMs);
  if (repo.isErr()) return err(repo.error);

  const state = await treeState(bound, options.repoPath, op, options.timeoutMs);
  if (state.isErr()) return err(state.error);
  if (state.value.unmerged.length > 0) {
    return err({
      code: 'GIT_ERROR',
      message: `safeStashPop: refusing: never pop over unmerged entries: ${state.value.unmerged.sort().join(', ')}`,
    });
  }

  const top = await stashTop(bound, options.repoPath, op, options.timeoutMs);
  if (top.isErr()) return err(top.error);
  if (top.value === null) {
    log.debug('pop skipped: stash empty (no-op)');
    return ok({ popped: false, ref: null });
  }
  if (opts.expectedRef !== undefined && top.value !== opts.expectedRef) {
    return err({
      code: 'GIT_ERROR',
      message: `safeStashPop: refusing: stash top ${top.value} is not the expected ${opts.expectedRef}`,
    });
  }

  const popped = await runGit(
    bound,
    op,
    ['stash', 'pop', '--index'],
    options.repoPath,
    options.timeoutMs
  );
  if (popped.isErr()) return err(popped.error);

  const after = await stashTop(bound, options.repoPath, op, options.timeoutMs);
  if (after.isErr()) return err(after.error);
  if (after.value === top.value) {
    return err(internalError(op, 'pop reported success but the entry is still listed'));
  }
  log.debug({ ref: top.value }, 'stash popped');
  return ok({ popped: true, ref: top.value });
}
