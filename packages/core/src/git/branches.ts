// Branch management (P-080): the single typed interface for branch ops
// in the child repo — orchestrator (P-238) and CLI (P-192) build the
// post-merge target + PR branches (P-313) and the multi-user landed
// history (P-093) on these three primitives. Flow per op: validate args
// (+ protection/current-branch guards pre-spawn) -> rev-parse repo ->
// check-ref-format names -> resolve refs -> mutate -> verify the ref
// state moved (or correctly did not).
//
// Verified behavior (real git 2.47 on this box — do not assume otherwise):
// - `branch --show-current` prints the branch name, empty when detached.
// - `show-ref --verify refs/heads/<name>` prints `<sha> <ref>`, exit 128
//   ("not a valid ref") when absent.
// - `branch <name> <ref>` with a bad ref exits 128 ("not a valid object
//   name"); `rev-parse <ref>` fails variously ("unknown revision",
//   "Needed a single revision", "bad revision") for missing refs.
// - `branch -d/-D <missing>` exits 1 ("branch 'x' not found"); `-d` on an
//   unmerged branch exits 1 ("not fully merged" + hints) while `-D`
//   deletes; deleting the checked-out branch exits 1 ("cannot delete
//   branch ... used by worktree") — pre-checked via show-current instead.
// - `branch -m <missing> <new>` exits 128 ("no branch named 'x'");
//   `-m <old> <taken>` exits 128 ("already exists"); renaming the
//   checked-out branch succeeds and HEAD follows it.
// - `check-ref-format --branch <name>` exits 128 ("not a valid branch
//   name") for spaces, `..`, trailing dots, `~^:` etc. (probed P-078).
//
// Safety contract:
// - Validation (blank args, malformed names/refs, force-without-... —
//   there is no force flag on create: an existing branch at a different
//   ref refuses) returns CONFIG_ERROR BEFORE any spawn; protection and
//   current-branch guards likewise never spawn on refusal.
// - Protection guards destruction and evasion of protected branches
//   (delete + rename-away refuse), never creation: post-merge setup must
//   be able to CREATE main. Default set is main/master until P-093
//   supplies the live protection set.
// - Non-force delete keeps git's own unmerged guard (surfaces GIT_ERROR;
//   pass force=true to proceed deliberately). Missing/refusing git
//   operations map by message to CONFIG (caller bug) or surface GIT_ERROR.
// - Every mutation is verified (created ref at the resolved SHA, deleted
//   ref gone, renamed ref moved); state that did not move is INTERNAL.
// - Only branch names + SHAs reach the logs, never file contents.
// - The runner returns exit codes as data (P-075 pattern: 124 = timeout
//   sentinel); every rejection -> INTERNAL; no new StitchError codes
//   (P-203 owns future taxonomy).
//
// Seams and future phases:
// - BranchRuntime.run is the only process seam (execFile default).
// - P-093 owns live protection policy (this default set is fail-closed
//   scaffolding); P-192/P-238 compose these primitives for post-merge
//   setup — no orchestrator is invented here. P-250 idempotency is the
//   same-ref no-op on create.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ok, err, type Result } from 'neverthrow';
import type { StitchError } from '../result/index.js';
import { logger, createJobLogger } from '../logger/index.js';
import { DEFAULT_PROTECTED_BRANCHES } from './push.js';

/** Silence timeout (ms): local branch plumbing, same budget as siblings. */
export const DEFAULT_BRANCH_TIMEOUT_MS = 60_000;

/** Exec timeout sentinel: Node kills the child (SIGTERM/ETIMEDOUT). */
const TIMEOUT_EXIT_CODE = 124;

export interface BranchOpts {
  /** Branches delete/rename-away never touches. Default: main/master. */
  protectedBranches?: readonly string[];
  /** Silence timeout ms for git processes. Default: 60_000. */
  timeoutMs?: number;
  /** Job id for structured logs. */
  jobId?: string;
}

/** Process result as data: exit codes are signals, never rejections. */
export interface BranchRunResult {
  exitCode: number;
  stdout: Buffer;
  stderr: string;
}

export interface BranchRunner {
  (args: readonly string[], cwd: string, opts: { timeoutMs: number }): Promise<BranchRunResult>;
}

export interface BranchRuntime {
  run?: BranchRunner;
}

const execFileAsync = promisify(execFile);

/** Default runner: real git via PATH, killed after timeoutMs of silence. */
async function defaultRun(
  args: readonly string[],
  cwd: string,
  opts: { timeoutMs: number }
): Promise<BranchRunResult> {
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
  result: BranchRunResult,
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
  run: BranchRunner;
}

function bindRuntime(runtime: BranchRuntime | undefined): BoundRuntime {
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
  let result: BranchRunResult;
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
  protectedBranches: readonly string[];
}

/** Shared arg validation (names checked per-op for precise fields). */
function normalizeBase(
  repoPath: string,
  opts: BranchOpts,
  op: string
): Result<NormalizedBase, StitchError> {
  if (repoPath.trim() === '') {
    return invalid('repoPath', `${op}: repoPath is required`);
  }
  const timeoutMs = opts.timeoutMs ?? DEFAULT_BRANCH_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
    return invalid('timeoutMs', `${op}: timeoutMs must be an integer >= 1`);
  }
  return ok({
    repoPath,
    timeoutMs,
    jobId: opts.jobId,
    protectedBranches: opts.protectedBranches ?? DEFAULT_PROTECTED_BRANCHES,
  });
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

/** Pure blank gate: runs before any spawn (validation tests prove it). */
function requireName(op: string, field: string, name: string): Result<void, StitchError> {
  if (name.trim() === '') {
    return invalid(field, `${op}: ${field} is required`);
  }
  return ok(undefined);
}

/**
 * check-ref-format gate: malformed names refuse CONFIG pre-mutation.
 * Precondition: name is non-blank (requireName runs first).
 */
async function checkBranchName(
  bound: BoundRuntime,
  repoPath: string,
  op: string,
  field: string,
  name: string,
  timeoutMs: number
): Promise<Result<void, StitchError>> {
  const checked = await runGit(
    bound,
    `${op} check-ref-format`,
    ['check-ref-format', '--branch', name],
    repoPath,
    timeoutMs
  );
  if (checked.isErr()) {
    const message = checked.error.code === 'GIT_ERROR' ? checked.error.message : '';
    if (/not a valid branch name/i.test(message)) {
      return err({
        code: 'CONFIG_ERROR',
        field,
        message: `${op}: invalid branch name ("${name}")`,
      });
    }
    return err(checked.error);
  }
  return ok(undefined);
}

/** Resolve any rev to a SHA (CONFIG when it does not resolve). */
async function resolveRef(
  bound: BoundRuntime,
  repoPath: string,
  op: string,
  field: string,
  ref: string,
  timeoutMs: number
): Promise<Result<string, StitchError>> {
  const out = await runGit(bound, `${op} rev-parse`, ['rev-parse', ref], repoPath, timeoutMs);
  if (out.isErr()) {
    const message = out.error.code === 'GIT_ERROR' ? out.error.message : '';
    if (
      /unknown revision|needed a single revision|bad revision|unknown commit|not a valid object name|ambiguous argument/i.test(
        message
      )
    ) {
      return err({
        code: 'CONFIG_ERROR',
        field,
        message: `${op}: unknown ref ("${ref}")`,
      });
    }
    return err(out.error);
  }
  const sha = out.value.toString('utf8').trim();
  if (!SHA_RE.test(sha)) {
    return err(internalError(`${op} rev-parse`, `malformed SHA ${JSON.stringify(sha)}`));
  }
  return ok(sha);
}

/** Existing branch SHA, or null when absent (other failures surface). */
async function existingBranchSha(
  bound: BoundRuntime,
  repoPath: string,
  op: string,
  name: string,
  timeoutMs: number
): Promise<Result<string | null, StitchError>> {
  let result: BranchRunResult;
  try {
    result = await bound.run(['show-ref', '--verify', `refs/heads/${name}`], repoPath, {
      timeoutMs,
    });
  } catch (error) {
    return err(internalError(`${op} show-ref`, error));
  }
  if (result.exitCode === 0) {
    const text = result.stdout.toString('utf8').trim().split(/\s+/)[0] ?? '';
    if (!SHA_RE.test(text)) {
      return err(internalError(`${op} show-ref`, `malformed SHA ${JSON.stringify(text)}`));
    }
    return ok(text);
  }
  if (/not a valid ref/i.test(result.stderr)) return ok(null);
  return err(runFailure(`${op} show-ref`, result, timeoutMs));
}

/** Currently checked-out branch ('' when detached). */
async function currentBranch(
  bound: BoundRuntime,
  repoPath: string,
  op: string,
  timeoutMs: number
): Promise<Result<string, StitchError>> {
  const out = await runGit(
    bound,
    `${op} show-current`,
    ['branch', '--show-current'],
    repoPath,
    timeoutMs
  );
  if (out.isErr()) return err(out.error);
  return ok(out.value.toString('utf8').trim());
}

function branchLog(
  jobId: string | undefined,
  op: string,
  repoPath: string
): ReturnType<typeof logger.child> {
  const base = jobId === undefined ? logger : createJobLogger(jobId);
  return base.child({ op, repoPath });
}

/**
 * Create a branch at a ref (default HEAD). Idempotent: an existing branch
 * at the same SHA is a no-op (P-250); at a different SHA it refuses.
 */
export async function createBranch(
  repoPath: string,
  name: string,
  fromRef?: string,
  opts: BranchOpts = {},
  runtime?: BranchRuntime
): Promise<Result<void, StitchError>> {
  const op = 'createBranch';
  const normalized = normalizeBase(repoPath, opts, op);
  if (normalized.isErr()) return err(normalized.error);
  const blankName = requireName(op, 'name', name);
  if (blankName.isErr()) return err(blankName.error);
  const bound = bindRuntime(runtime);
  const options = normalized.value;
  const log = branchLog(options.jobId, 'branch', options.repoPath);

  const repo = await ensureRepo(bound, options.repoPath, op, options.timeoutMs);
  if (repo.isErr()) return err(repo.error);
  const named = await checkBranchName(bound, options.repoPath, op, 'name', name, options.timeoutMs);
  if (named.isErr()) return err(named.error);

  const base = await resolveRef(
    bound,
    options.repoPath,
    op,
    'fromRef',
    fromRef ?? 'HEAD',
    options.timeoutMs
  );
  if (base.isErr()) return err(base.error);

  const existing = await existingBranchSha(bound, options.repoPath, op, name, options.timeoutMs);
  if (existing.isErr()) return err(existing.error);
  if (existing.value !== null) {
    if (existing.value === base.value) {
      log.debug({ branch: name }, 'branch already exists at ref (no-op)');
      return ok(undefined);
    }
    return err({
      code: 'CONFIG_ERROR',
      field: 'name',
      message: `${op}: branch "${name}" already exists at a different ref`,
    });
  }

  const created = await runGit(
    bound,
    `${op}`,
    ['branch', name, fromRef ?? 'HEAD'],
    options.repoPath,
    options.timeoutMs
  );
  if (created.isErr()) return err(created.error);

  const verify = await existingBranchSha(bound, options.repoPath, op, name, options.timeoutMs);
  if (verify.isErr()) return err(verify.error);
  if (verify.value !== base.value) {
    return err(
      internalError(
        op,
        `branch "${name}" shows ${JSON.stringify(verify.value)} after create, expected ${base.value}`
      )
    );
  }
  log.debug({ branch: name }, 'branch created');
  return ok(undefined);
}

/**
 * Delete a branch. Refuses the checked-out branch and protected branches;
 * keeps git's own unmerged guard unless force=true.
 */
export async function deleteBranch(
  repoPath: string,
  name: string,
  force?: boolean,
  opts: BranchOpts = {},
  runtime?: BranchRuntime
): Promise<Result<void, StitchError>> {
  const op = 'deleteBranch';
  const normalized = normalizeBase(repoPath, opts, op);
  if (normalized.isErr()) return err(normalized.error);
  const bound = bindRuntime(runtime);
  const options = normalized.value;

  if (options.protectedBranches.includes(name)) {
    return err({
      code: 'CONFIG_ERROR',
      field: 'name',
      message: `${op}: refusing to delete protected branch "${name}"`,
    });
  }
  const blankName = requireName(op, 'name', name);
  if (blankName.isErr()) return err(blankName.error);

  const repo = await ensureRepo(bound, options.repoPath, op, options.timeoutMs);
  if (repo.isErr()) return err(repo.error);
  const named = await checkBranchName(bound, options.repoPath, op, 'name', name, options.timeoutMs);
  if (named.isErr()) return err(named.error);

  const current = await currentBranch(bound, options.repoPath, op, options.timeoutMs);
  if (current.isErr()) return err(current.error);
  if (current.value !== '' && current.value === name) {
    return err({
      code: 'CONFIG_ERROR',
      field: 'name',
      message: `${op}: refusing to delete the checked-out branch ("${name}")`,
    });
  }

  const deleted = await runGit(
    bound,
    op,
    ['branch', force === true ? '-D' : '-d', name],
    options.repoPath,
    options.timeoutMs
  );
  if (deleted.isErr()) {
    if (deleted.error.code !== 'GIT_ERROR') return err(deleted.error);
    if (/not found/i.test(deleted.error.message)) {
      return err({
        code: 'CONFIG_ERROR',
        field: 'name',
        message: `${op}: no such branch ("${name}")`,
      });
    }
    return err(deleted.error);
  }

  const gone = await existingBranchSha(bound, options.repoPath, op, name, options.timeoutMs);
  if (gone.isErr()) return err(gone.error);
  if (gone.value !== null) {
    return err(internalError(op, `branch "${name}" is still present after delete`));
  }
  branchLog(options.jobId, 'branch', options.repoPath).debug({ branch: name }, 'branch deleted');
  return ok(undefined);
}

/**
 * Rename a branch. Refuses renaming a protected branch away (evasion),
 * identical names, missing sources, and occupied targets. Renaming the
 * checked-out branch is allowed — HEAD follows it.
 */
export async function renameBranch(
  repoPath: string,
  oldName: string,
  newName: string,
  opts: BranchOpts = {},
  runtime?: BranchRuntime
): Promise<Result<void, StitchError>> {
  const op = 'renameBranch';
  const normalized = normalizeBase(repoPath, opts, op);
  if (normalized.isErr()) return err(normalized.error);
  const bound = bindRuntime(runtime);
  const options = normalized.value;

  if (oldName === newName) {
    return invalid('newName', `${op}: old and new names are identical ("${oldName}")`);
  }
  if (options.protectedBranches.includes(oldName)) {
    return err({
      code: 'CONFIG_ERROR',
      field: 'oldName',
      message: `${op}: refusing to rename protected branch "${oldName}" away`,
    });
  }
  const blankOld = requireName(op, 'oldName', oldName);
  if (blankOld.isErr()) return err(blankOld.error);
  const blankNew = requireName(op, 'newName', newName);
  if (blankNew.isErr()) return err(blankNew.error);

  const repo = await ensureRepo(bound, options.repoPath, op, options.timeoutMs);
  if (repo.isErr()) return err(repo.error);
  const old = await checkBranchName(
    bound,
    options.repoPath,
    op,
    'oldName',
    oldName,
    options.timeoutMs
  );
  if (old.isErr()) return err(old.error);
  const fresh = await checkBranchName(
    bound,
    options.repoPath,
    op,
    'newName',
    newName,
    options.timeoutMs
  );
  if (fresh.isErr()) return err(fresh.error);

  // No existence pre-check: `branch -m` refuses missing sources and
  // occupied targets atomically (probed messages mapped below), so there
  // is no TOCTOU window between check and mutation.
  const renamed = await runGit(
    bound,
    op,
    ['branch', '-m', oldName, newName],
    options.repoPath,
    options.timeoutMs
  );
  if (renamed.isErr()) {
    if (renamed.error.code !== 'GIT_ERROR') return err(renamed.error);
    const text = `${renamed.error.message} ${renamed.error.gitOutput ?? ''}`;
    if (/no branch named/i.test(text)) {
      return err({
        code: 'CONFIG_ERROR',
        field: 'oldName',
        message: `${op}: no such branch ("${oldName}")`,
      });
    }
    if (/already exists/i.test(text)) {
      return err({
        code: 'CONFIG_ERROR',
        field: 'newName',
        message: `${op}: a branch named "${newName}" already exists`,
      });
    }
    return err(renamed.error);
  }

  const moved = await existingBranchSha(bound, options.repoPath, op, newName, options.timeoutMs);
  if (moved.isErr()) return err(moved.error);
  const vacated = await existingBranchSha(bound, options.repoPath, op, oldName, options.timeoutMs);
  if (vacated.isErr()) return err(vacated.error);
  if (moved.value === null || vacated.value !== null) {
    return err(
      internalError(
        op,
        `rename of "${oldName}" did not move cleanly (new: ${JSON.stringify(moved.value)}, old: ${JSON.stringify(vacated.value)})`
      )
    );
  }
  branchLog(options.jobId, 'branch', options.repoPath).debug(
    { oldName, newName },
    'branch renamed'
  );
  return ok(undefined);
}
