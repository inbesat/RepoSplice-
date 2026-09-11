// Rollback/abort (P-085): abort in-progress git ops and restore a known
// state — the per-op abort (cherry-pick/merge/rebase P-074/072) and the
// whole-job rollback P-245 will drive. Flow (abort): validate -> detect
// the sequencer marker (no-op when absent: idempotent, P-250) -> abort ->
// verify the marker cleared. Flow (reset): validate -> resolve the ref to
// a SHA (doubles as the repo check) -> gate dirt (refuse, or stash first
// via P-081) -> `reset --hard <sha>` -> verify HEAD landed -> verify
// clean (P-084). Flow (job): abort all sequencers -> remove the staging
// worktree (P-076) -> resetTo -> pop the snapshotted stash entry
// (P-081, expectedRef) -> verify clean when nothing was popped.
//
// Verified behavior (real git 2.47 on this box — do not assume otherwise):
// - `rev-parse --verify --quiet MERGE_HEAD|CHERRY_PICK_HEAD|REBASE_HEAD`
//   exits 0 iff that op is in progress (mutually exclusive, probed) —
//   pure-git detection, no fs seam needed. REBASE_HEAD covers the stopped
//   rebase (the only state where abort is meaningful).
// - Aborts with nothing in progress exit 128 ("no merge to abort" / "no
//   cherry-pick or revert in progress" / "no rebase in progress") —
//   hence the detection gate; absent markers are a silent no-op.
// - In-progress aborts exit 0 and clear their marker, restoring the
//   pre-op tree (tracked files; pre-existing untracked files survive,
//   so post-abort never asserts clean — only marker clearance).
// - `rev-parse --verify <ref>^{commit}` prints the full SHA; unresolvable
//   refs exit 128 ("Needed a single revision"); outside a repo the same
//   spawn reports "not a git repository" (CONFIG, P-084 precedent).
// - `reset --hard` discards tracked dirt but NEVER touches untracked
//   files — so resetTo refuses ANY dirt (tracked or untracked) unless
//   stash-first is engaged (`-u` takes untracked too), keeping the
//   post-reset clean invariant exact.
//
// Safety contract:
// - Never resets over unstashed work: default refuses with a typed
//   GIT_ERROR carrying the sorted paths plus stash guidance (P-203 will
//   promote this shape to DIRTY_TREE); opt-in `{ stash: true }` stashes
//   first via P-081 (which itself refuses unmerged trees).
// - Post-mutation verifications (marker cleared, HEAD landed, tree clean)
//   are INVARIANTS: violations are INTERNAL (reachable only through
//   races), never silent.
// - A popped job snapshot legitimately leaves restored work behind, so
//   the final clean assert runs ONLY when nothing was popped.
// - Only op names, SHAs and counts reach the logs (never file contents);
//   the offending paths travel in returned errors (P-074 precedent).
// - The runner returns exit codes as data (P-075 pattern: 124 = timeout
//   sentinel); every rejection -> INTERNAL; no new StitchError codes
//   (P-203 owns future taxonomy).
//
// Seams and future phases:
// - RollbackRuntimes carries one seam per composed primitive (git /
//   worktree / stash / clean); RollbackRunner.run is the only process
//   seam (execFile default).
// - P-245 owns job persistence: JobSnapshot is the record P-238 takes at
//   stage start (P-250 idempotency) and RollbackOutcome is the marker
//   payload P-245/P-187 persist. Provenance/DB writes stay in P-245 —
//   this module never touches the store (no job tables exist yet).

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ok, err, type Result } from 'neverthrow';
import type { StitchError } from '../result/index.js';
import { logger, createJobLogger } from '../logger/index.js';
import { assertClean, type CleanOpts, type CleanRuntime } from './clean.js';
import {
  safeStash,
  safeStashPop,
  type PopOpts,
  type StashOpts,
  type StashRuntime,
} from './stash.js';
import { removeWorktree, type RemoveWorktreeOpts, type WorktreeRuntime } from './worktree.js';

/** Silence timeout (ms): local abort/reset plumbing, same as siblings. */
export const DEFAULT_ROLLBACK_TIMEOUT_MS = 60_000;

/** Exec timeout sentinel: Node kills the child (SIGTERM/ETIMEDOUT). */
const TIMEOUT_EXIT_CODE = 124;

/** Full SHAs only (rev-parse output; P-081 precedent). */
const SHA_RE = /^[0-9a-f]{40}$/;

/** Abortable op kinds (worktree delegates to P-076 removal). */
export type AbortKind = 'merge' | 'cherry-pick' | 'rebase' | 'worktree';

const ABORT_KINDS: readonly AbortKind[] = ['merge', 'cherry-pick', 'rebase', 'worktree'];

/** Sequenced kinds, aborted in fixed order by rollbackJob. */
const SEQUENCED: readonly Exclude<AbortKind, 'worktree'>[] = ['merge', 'cherry-pick', 'rebase'];

interface AbortSpec {
  marker: string;
  argv: readonly string[];
}

const ABORT_SPECS: Record<Exclude<AbortKind, 'worktree'>, AbortSpec> = {
  merge: { marker: 'MERGE_HEAD', argv: ['merge', '--abort'] },
  'cherry-pick': { marker: 'CHERRY_PICK_HEAD', argv: ['cherry-pick', '--abort'] },
  rebase: { marker: 'REBASE_HEAD', argv: ['rebase', '--abort'] },
};

export interface AbortOpts {
  /** Required for kind 'worktree': the staging tree to remove. */
  worktreePath?: string;
  /** Silence timeout ms for git processes. Default: 60_000. */
  timeoutMs?: number;
  /** Job id for structured logs. */
  jobId?: string;
}

export interface ResetStashOpts {
  /** Stash message (argv-safe, never logged). Default: stitch resetTo. */
  message?: string;
}

/** Default stash message (identifiable in `stash list`, P-187 audit). */
export const DEFAULT_RESET_STASH_MESSAGE = 'stitch resetTo';

export interface ResetOpts {
  /**
   * Stash-first (P-081) instead of refusing on dirt. `true` uses the
   * default message; an object sets it. Absent (default): refuse.
   */
  stash?: ResetStashOpts | true;
  /** Silence timeout ms for git processes. Default: 60_000. */
  timeoutMs?: number;
  /** Job id for structured logs. */
  jobId?: string;
}

export interface ResetOutcome {
  /** Resolved full SHA that HEAD now points at. */
  ref: string;
  /** Whether a stash-first snapshot was taken. */
  stashed: boolean;
  /** New top entry SHA; null unless stash-first ran on a dirty tree. */
  stashRef: string | null;
}

/**
 * Pre-stage snapshot (recorded at P-238 stage start, P-250 idempotency):
 * everything rollbackJob needs to restore the exact prior state.
 */
export interface JobSnapshot {
  /** Pre-stage ref (branch, tag or SHA — resolved before mutating). */
  ref: string;
  /** Staging worktree to remove (P-076). Absent: none. */
  worktreePath?: string;
  /** Stash entry holding the pre-stage work (P-081); null: none. */
  stashRef?: string | null;
}

export interface RollbackOutcome {
  /** Sequencer kinds actually aborted, in fixed order. */
  aborted: AbortKind[];
  worktreeRemoved: boolean;
  /** Resolved full SHA that HEAD now points at. */
  resetRef: string;
  popped: boolean;
}

export interface RollbackOpts {
  /** Stash-first passthrough for the reset step (see ResetOpts). */
  stash?: ResetStashOpts | true;
  /** Silence timeout ms for git processes. Default: 60_000. */
  timeoutMs?: number;
  /** Job id for structured logs. */
  jobId?: string;
}

/** Process result as data: exit codes are signals, never rejections. */
export interface RollbackRunResult {
  exitCode: number;
  stdout: Buffer;
  stderr: string;
}

export interface RollbackRunner {
  (args: readonly string[], cwd: string, opts: { timeoutMs: number }): Promise<RollbackRunResult>;
}

/** One seam per composed primitive (mirrors their own runtime shapes). */
export interface RollbackRuntimes {
  git?: RollbackRunner;
  worktree?: WorktreeRuntime;
  stash?: StashRuntime;
  clean?: CleanRuntime;
}

const execFileAsync = promisify(execFile);

/** Default runner: real git via PATH, killed after timeoutMs of silence. */
async function defaultRun(
  args: readonly string[],
  cwd: string,
  opts: { timeoutMs: number }
): Promise<RollbackRunResult> {
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
  result: RollbackRunResult,
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
  run: RollbackRunner;
}

function bindRuntime(runtimes: RollbackRuntimes | undefined): BoundRuntime {
  return { run: runtimes?.git ?? defaultRun };
}

/** Run git, converting runner rejections (spawn failures) to INTERNAL. */
async function runGit(
  bound: BoundRuntime,
  op: string,
  args: readonly string[],
  cwd: string,
  timeoutMs: number
): Promise<Result<Buffer, StitchError>> {
  let result: RollbackRunResult;
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
}

function normalizeBase(
  repoPath: string,
  timeoutMs: number | undefined,
  op: string
): Result<NormalizedBase, StitchError> {
  if (repoPath.trim() === '') {
    return invalid('repoPath', `${op}: repoPath is required`);
  }
  const resolved = timeoutMs ?? DEFAULT_ROLLBACK_TIMEOUT_MS;
  if (!Number.isInteger(resolved) || resolved < 1) {
    return invalid('timeoutMs', `${op}: timeoutMs must be an integer >= 1`);
  }
  return ok({ repoPath, timeoutMs: resolved });
}

function rollbackLog(
  jobId: string | undefined,
  op: string,
  repoPath: string
): ReturnType<typeof logger.child> {
  const base = jobId === undefined ? logger : createJobLogger(jobId);
  return base.child({ op, repoPath });
}

/** Optional jobId spread (exactOptionalPropertyTypes: no explicit undefined). */
function withJobId(jobId: string | undefined): { jobId: string } | Record<string, never> {
  return jobId === undefined ? {} : { jobId };
}

/**
 * Sequencer presence via `rev-parse --verify --quiet` (exit 0 = present,
 * exit 1 = absent; anything else is loud). Doubles as the repo check:
 * outside a repo git reports "not a git repository" (CONFIG, P-084).
 */
async function markerPresent(
  bound: BoundRuntime,
  marker: string,
  repoPath: string,
  op: string,
  timeoutMs: number
): Promise<Result<boolean, StitchError>> {
  let result: RollbackRunResult;
  try {
    result = await bound.run(['rev-parse', '--verify', '--quiet', marker], repoPath, {
      timeoutMs,
    });
  } catch (error) {
    return err(internalError(`${op} detect`, error));
  }
  if (result.exitCode === 0) return ok(true);
  if (result.exitCode === 1) return ok(false);
  if (/not a git repository/i.test(result.stderr)) {
    return err({
      code: 'CONFIG_ERROR',
      field: 'repoPath',
      message: `${op}: not a git repository ("${repoPath}")`,
    });
  }
  return err(runFailure(`${op} detect`, result, timeoutMs));
}

/**
 * Resolve any ref to its full SHA (doubles as the repo check). Unresolvable
 * refs are CONFIG (nothing has mutated yet); malformed output is INTERNAL.
 */
async function resolveRef(
  bound: BoundRuntime,
  repoPath: string,
  op: string,
  ref: string,
  timeoutMs: number
): Promise<Result<string, StitchError>> {
  const resolved = await runGit(
    bound,
    `${op} resolve`,
    ['rev-parse', '--verify', `${ref}^{commit}`],
    repoPath,
    timeoutMs
  );
  if (resolved.isErr()) {
    if (
      resolved.error.code === 'GIT_ERROR' &&
      /not a git repository/i.test(resolved.error.message)
    ) {
      return err({
        code: 'CONFIG_ERROR',
        field: 'repoPath',
        message: `${op}: not a git repository ("${repoPath}")`,
      });
    }
    if (
      resolved.error.code === 'GIT_ERROR' &&
      /needed a single revision|unknown revision|bad revision/i.test(resolved.error.message)
    ) {
      return err({
        code: 'CONFIG_ERROR',
        field: 'ref',
        message: `${op}: ref "${ref}" does not resolve to a commit`,
      });
    }
    return err(resolved.error);
  }
  const sha = resolved.value.toString('utf8').trim();
  if (!SHA_RE.test(sha)) {
    return err(internalError(`${op} resolve`, `malformed SHA ${JSON.stringify(sha)}`));
  }
  return ok(sha);
}

/**
 * Abort one sequenced kind when present (no-op when absent). Shared by
 * abortGitOp and rollbackJob so detection can never drift between them.
 */
async function abortIfPresent(
  bound: BoundRuntime,
  repoPath: string,
  op: string,
  kind: Exclude<AbortKind, 'worktree'>,
  timeoutMs: number,
  log: ReturnType<typeof logger.child>
): Promise<Result<boolean, StitchError>> {
  const spec = ABORT_SPECS[kind];
  const present = await markerPresent(bound, spec.marker, repoPath, op, timeoutMs);
  if (present.isErr()) return err(present.error);
  if (!present.value) {
    log.debug({ kind }, 'no sequencer in progress (no-op)');
    return ok(false);
  }
  const aborted = await runGit(bound, `${op} ${kind}`, [...spec.argv], repoPath, timeoutMs);
  if (aborted.isErr()) return err(aborted.error);
  const cleared = await markerPresent(bound, spec.marker, repoPath, op, timeoutMs);
  if (cleared.isErr()) return err(cleared.error);
  if (cleared.value) {
    return err(internalError(op, `${kind} sequencer still present after abort`));
  }
  log.debug({ kind }, 'operation aborted');
  return ok(true);
}

/**
 * Abort an in-progress git op (or remove a staging worktree). Absent
 * sequencers are an idempotent no-op; a stuck sequencer fails closed.
 */
export async function abortGitOp(
  repoPath: string,
  kind: AbortKind,
  opts: AbortOpts = {},
  runtimes?: RollbackRuntimes
): Promise<Result<void, StitchError>> {
  const op = 'abortGitOp';
  const normalized = normalizeBase(repoPath, opts.timeoutMs, op);
  if (normalized.isErr()) return err(normalized.error);
  if (!ABORT_KINDS.includes(kind)) {
    return invalid('kind', `${op}: unknown abort kind ${JSON.stringify(kind)}`);
  }
  const bound = bindRuntime(runtimes);
  const options = normalized.value;
  const log = rollbackLog(opts.jobId, 'abort', options.repoPath);

  if (kind === 'worktree') {
    if (opts.worktreePath === undefined || opts.worktreePath.trim() === '') {
      return invalid('worktreePath', `${op}: worktreePath is required for kind "worktree"`);
    }
    const removeOpts: RemoveWorktreeOpts = {
      timeoutMs: options.timeoutMs,
      ...withJobId(opts.jobId),
    };
    const removed = await removeWorktree(
      options.repoPath,
      opts.worktreePath,
      removeOpts,
      runtimes?.worktree
    );
    if (removed.isErr()) return err(removed.error);
    return ok(undefined);
  }

  const aborted = await abortIfPresent(bound, options.repoPath, op, kind, options.timeoutMs, log);
  if (aborted.isErr()) return err(aborted.error);
  return ok(undefined);
}

/**
 * Hard-reset to a recorded pre-stage ref. Refuses over ANY dirt (tracked
 * or untracked — reset would discard the former and the clean invariant
 * would then lie about the latter) unless stash-first is engaged. Resolves
 * the ref to a SHA before mutating so the reset target cannot drift.
 */
export async function resetTo(
  repoPath: string,
  ref: string,
  opts: ResetOpts = {},
  runtimes?: RollbackRuntimes
): Promise<Result<ResetOutcome, StitchError>> {
  const op = 'resetTo';
  const normalized = normalizeBase(repoPath, opts.timeoutMs, op);
  if (normalized.isErr()) return err(normalized.error);
  if (ref.trim() === '') {
    return invalid('ref', `${op}: ref is required`);
  }
  const bound = bindRuntime(runtimes);
  const options = normalized.value;
  const log = rollbackLog(opts.jobId, 'reset', options.repoPath);

  const sha = await resolveRef(bound, options.repoPath, op, ref, options.timeoutMs);
  if (sha.isErr()) return err(sha.error);

  let stashed = false;
  let stashRef: string | null = null;
  if (opts.stash !== undefined) {
    const message =
      opts.stash === true
        ? DEFAULT_RESET_STASH_MESSAGE
        : (opts.stash.message ?? DEFAULT_RESET_STASH_MESSAGE);
    const stashOpts: StashOpts = {
      message,
      timeoutMs: options.timeoutMs,
      ...withJobId(opts.jobId),
    };
    const snapshot = await safeStash(options.repoPath, stashOpts, runtimes?.stash);
    if (snapshot.isErr()) return err(snapshot.error);
    stashed = snapshot.value.stashed;
    stashRef = snapshot.value.ref;
  } else {
    const cleanOpts: CleanOpts = { timeoutMs: options.timeoutMs, ...withJobId(opts.jobId) };
    const clean = await assertClean(options.repoPath, op, cleanOpts, runtimes?.clean);
    if (clean.isErr()) {
      if (clean.error.code !== 'GIT_ERROR') return err(clean.error);
      return err({
        code: 'GIT_ERROR',
        message: `${clean.error.message} (stash first via P-081 safeStash, or pass { stash: true })`,
      });
    }
  }

  const reset = await runGit(
    bound,
    op,
    ['reset', '--hard', sha.value],
    options.repoPath,
    options.timeoutMs
  );
  if (reset.isErr()) return err(reset.error);

  const head = await runGit(
    bound,
    `${op} verify`,
    ['rev-parse', 'HEAD'],
    options.repoPath,
    options.timeoutMs
  );
  if (head.isErr()) return err(head.error);
  const landed = head.value.toString('utf8').trim();
  if (landed !== sha.value) {
    return err(
      internalError(op, `HEAD drifted after reset (expected ${sha.value}, found ${landed})`)
    );
  }

  const cleanOpts: CleanOpts = { timeoutMs: options.timeoutMs, ...withJobId(opts.jobId) };
  const final = await assertClean(options.repoPath, op, cleanOpts, runtimes?.clean);
  if (final.isErr()) {
    return err(internalError(op, 'tree not clean after reset (invariant violated)'));
  }

  log.debug({ ref: sha.value, stashed }, 'reset complete');
  return ok({ ref: sha.value, stashed, stashRef });
}

/**
 * Whole-job rollback for a pre-stage snapshot: abort every sequencer,
 * remove the staging worktree, reset to the snapshot ref, then pop the
 * snapshotted stash entry (expectedRef-guarded). The final clean verify
 * runs only when nothing was popped — restored work legitimately dirties
 * the tree. Outcome kinds/refs are the marker payload P-245 persists.
 */
export async function rollbackJob(
  repoPath: string,
  snapshot: JobSnapshot,
  opts: RollbackOpts = {},
  runtimes?: RollbackRuntimes
): Promise<Result<RollbackOutcome, StitchError>> {
  const op = 'rollbackJob';
  const normalized = normalizeBase(repoPath, opts.timeoutMs, op);
  if (normalized.isErr()) return err(normalized.error);
  if (snapshot === null || typeof snapshot !== 'object') {
    return invalid('snapshot', `${op}: snapshot is required`);
  }
  if (snapshot.ref.trim() === '') {
    return invalid('snapshot.ref', `${op}: snapshot.ref is required`);
  }
  if (snapshot.worktreePath !== undefined && snapshot.worktreePath.trim() === '') {
    return invalid('snapshot.worktreePath', `${op}: snapshot.worktreePath must not be blank`);
  }
  if (
    snapshot.stashRef !== undefined &&
    snapshot.stashRef !== null &&
    snapshot.stashRef.trim() === ''
  ) {
    return invalid('snapshot.stashRef', `${op}: snapshot.stashRef must not be blank`);
  }
  const bound = bindRuntime(runtimes);
  const options = normalized.value;
  const log = rollbackLog(opts.jobId, 'rollback', options.repoPath);

  const aborted: AbortKind[] = [];
  for (const kind of SEQUENCED) {
    const done = await abortIfPresent(bound, options.repoPath, op, kind, options.timeoutMs, log);
    if (done.isErr()) return err(done.error);
    if (done.value) aborted.push(kind);
  }

  let worktreeRemoved = false;
  if (snapshot.worktreePath !== undefined) {
    const removeOpts: RemoveWorktreeOpts = {
      timeoutMs: options.timeoutMs,
      ...withJobId(opts.jobId),
    };
    const removed = await removeWorktree(
      options.repoPath,
      snapshot.worktreePath,
      removeOpts,
      runtimes?.worktree
    );
    if (removed.isErr()) return err(removed.error);
    worktreeRemoved = true;
  }

  const resetOpts: ResetOpts = {
    ...(opts.stash !== undefined ? { stash: opts.stash } : {}),
    timeoutMs: options.timeoutMs,
    ...withJobId(opts.jobId),
  };
  const reset = await resetTo(options.repoPath, snapshot.ref, resetOpts, runtimes);
  if (reset.isErr()) return err(reset.error);

  let popped = false;
  if (snapshot.stashRef !== undefined && snapshot.stashRef !== null) {
    const popOpts: PopOpts = {
      expectedRef: snapshot.stashRef,
      timeoutMs: options.timeoutMs,
      ...withJobId(opts.jobId),
    };
    const pop = await safeStashPop(options.repoPath, popOpts, runtimes?.stash);
    if (pop.isErr()) return err(pop.error);
    if (!pop.value.popped) {
      return err(internalError(op, 'expected stash entry missing after reset'));
    }
    popped = true;
  }

  if (!popped) {
    const cleanOpts: CleanOpts = { timeoutMs: options.timeoutMs, ...withJobId(opts.jobId) };
    const verify = await assertClean(options.repoPath, op, cleanOpts, runtimes?.clean);
    if (verify.isErr()) {
      return err(internalError(op, 'tree not clean after rollback (invariant violated)'));
    }
  }

  log.debug({ aborted, worktreeRemoved, resetRef: reset.value.ref, popped }, 'job rolled back');
  return ok({ aborted, worktreeRemoved, resetRef: reset.value.ref, popped });
}
