// Staging worktree writes (P-076): result writes happen on a detached,
// isolated tree that is committed (P-077) or discarded (P-085) — never on
// the working copy directly. Used by the AI agent (P-165) and the merge
// staging (P-238). Flow: validate everything -> rev-parse -> create
// (`worktree add --detach`) -> stage files -> optional verify (P-171 port)
// -> return the handle. Failures after creation best-effort remove the
// half-built tree so no partial garbage lingers (P-085 philosophy).
//
// Verified behavior (real git 2.47 on this box — do not assume otherwise):
// - `worktree add --detach <path> [<ref>]` works with or without a ref
//   (bare HEAD when omitted); stdout is "HEAD is now at ..." on success.
// - Bad ref: exit 128 `fatal: invalid reference: <ref>` -> CONFIG_ERROR.
// - Non-empty target: exit 128 `'<path>' already exists` (git guards too;
//   the exists pre-check turns it into a deterministic CONFIG first).
// - `worktree list --porcelain` prints `worktree <path>` blocks (forward
//   slashes) separated by blank lines, with `branch ...`, `detached`, or
//   `bare` markers. Membership for removal is decided from this list.
// - `worktree remove --force <path>` deletes the directory INCLUDING
//   untracked files (exit 0, dir gone); re-list verifies.
// - Removing the main tree: exit 128 `is a main working tree`; removing an
//   unregistered path: exit 128 `is not a working tree` — git refuses both,
//   and the pre-checks below refuse first with CONFIG.
// - Locked trees fail even with single --force ("use -f -f"); a lock is an
//   admin state, not abandonment dirt, so it surfaces as GIT_ERROR for the
//   caller (P-085) to handle.
//
// Safety contract:
// - The runner always gets an explicit cwd (P-070 rule); validation runs
//   before any spawn (blank args / empty files / bad timeout never spawn).
// - Every staged rel passes through resolveTargetPath (P-075: resolveWithin
//   P-012 + `.git` refusal P-265) rooted at the WORKTREE — validated before
//   the tree is created, so misuse leaves nothing behind.
// - Removal only touches paths registered in `worktree list`, never the
//   main tree (normalized-equality guard), and re-verifies absence.
// - Contents are written verbatim (no CRLF games); strings only — binary
//   needs a future Buffer overload, not invented here.
// - The runner returns exit codes as data (P-075 pattern: 124 = timeout
//   sentinel); every rejection -> INTERNAL; no new StitchError codes
//   (P-203 owns future taxonomy).
//
// Seams and future phases:
// - WorktreeRuntime.run is the process seam (execFile default);
//   WorktreeRuntime.fs (exists/writeFiles/removeDir) keeps the destructive
//   arms scriptable without touching disk.
// - VerifyTree is the narrow port P-171 runBuild will implement. A failing
//   verdict (pass:false) is NOT an error — files stay for the fix loop
//   (P-171/P-163 philosophy); only infrastructure errors fail.
// - P-077 commits the returned worktreePath; P-085 dispatches removeWorktree
//   for abandonment; P-238 stages through writeToWorktree. The spec's
//   `Result<void>` is widened to `Result<WriteWorktreeResult>` (carrying
//   the worktreePath + created/verified flags) because the same spec's
//   commit-or-discard lifecycle (steps 3-4, acceptance) needs the handle —
//   a void return would strand every consumer.

import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { ok, err, type Result } from 'neverthrow';
import type { StitchError } from '../result/index.js';
import { logger, createJobLogger } from '../logger/index.js';
import { resolveTargetPath } from './conflict.js';

/** Silence timeout (ms): local worktree ops, same budget as conflict plumbing. */
export const DEFAULT_WORKTREE_TIMEOUT_MS = 60_000;

/** Exec timeout sentinel: Node kills the child (SIGTERM/ETIMEDOUT). */
const TIMEOUT_EXIT_CODE = 124;

/** `git worktree list --porcelain` block header. */
const WORKTREE_HEADER = 'worktree ';

/** Verdict from the injected build/verify port (P-171 shape). */
export interface VerifyVerdict {
  pass: boolean;
  detail?: string;
}

/** Narrow port P-171 runBuild will implement. */
export interface VerifyTree {
  (worktreePath: string): Promise<Result<VerifyVerdict, StitchError>>;
}

/** One staged file: repo-relative posix path + exact string content. */
export interface WorktreeFile {
  path: string;
  content: string;
}

export interface WriteWorktreeOpts {
  /** Explicit tree location; default: fresh tmpdir (never clobbers). */
  worktreePath?: string;
  /** Commit-ish to base the detached tree on; default HEAD. */
  ref?: string;
  /** Optional write -> verify gate (P-171 implements). */
  verify?: VerifyTree;
  /** Silence timeout ms for git processes. Default: 60_000. */
  timeoutMs?: number;
  /** Job id for structured logs. */
  jobId?: string;
}

export interface WriteWorktreeResult {
  worktreePath: string;
  created: boolean;
  /** True only when a verifier ran and passed. */
  verified: boolean;
}

export interface RemoveWorktreeOpts {
  /** Silence timeout ms for git processes. Default: 60_000. */
  timeoutMs?: number;
  /** Job id for structured logs. */
  jobId?: string;
}

/** Process result as data: exit codes are signals, never rejections. */
export interface WorktreeRunResult {
  exitCode: number;
  stdout: Buffer;
  stderr: string;
}

export interface WorktreeRunner {
  (args: readonly string[], cwd: string, opts: { timeoutMs: number }): Promise<WorktreeRunResult>;
}

/** Filesystem port: keeps staging + cleanup scriptable without disk I/O. */
export interface WorktreeFs {
  exists(path: string): Promise<boolean>;
  writeFiles(targets: readonly WorktreeFile[]): Promise<void>;
  removeDir(path: string): Promise<void>;
  makeTempDir(prefix: string): Promise<string>;
}

export interface WorktreeRuntime {
  run?: WorktreeRunner;
  fs?: WorktreeFs;
}

const execFileAsync = promisify(execFile);

/** Default runner: real git via PATH, killed after timeoutMs of silence. */
async function defaultRun(
  args: readonly string[],
  cwd: string,
  opts: { timeoutMs: number }
): Promise<WorktreeRunResult> {
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
 * the timeout sentinel (124) is load-bearing (checkRun/runFailure branch
 * on it) and must stay pinned without flaky timing tests.
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

/** Default fs: real disk. Staging creates parents; removal is recursive. */
const defaultFs: WorktreeFs = {
  exists: async path => {
    try {
      await stat(path);
      return true;
    } catch {
      return false;
    }
  },
  writeFiles: async targets => {
    for (const target of targets) {
      await mkdir(dirname(target.path), { recursive: true });
      await writeFile(target.path, target.content, 'utf8');
    }
  },
  removeDir: async path => {
    await rm(path, { recursive: true, force: true });
  },
  makeTempDir: async prefix => mkdtemp(prefix),
};

interface BoundRuntime {
  run: WorktreeRunner;
  fs: WorktreeFs;
}

function bindRuntime(runtime: WorktreeRuntime | undefined): BoundRuntime {
  return {
    run: runtime?.run ?? defaultRun,
    fs: runtime?.fs ?? defaultFs,
  };
}

function runFailure(
  op: string,
  result: WorktreeRunResult,
  timeoutMs: number
): { code: 'GIT_ERROR'; message: string; gitOutput: string } {
  if (result.exitCode === TIMEOUT_EXIT_CODE) {
    return gitFailure(op, `timed out after ${timeoutMs}ms`);
  }
  const detail =
    result.stderr.trim() === '' ? `exit code ${result.exitCode}` : result.stderr.trim();
  return gitFailure(op, detail);
}

function checkRun(
  op: string,
  result: WorktreeRunResult,
  timeoutMs: number
): Result<Buffer, StitchError> {
  if (result.exitCode === 0) return ok(result.stdout);
  return err(runFailure(op, result, timeoutMs));
}

/** Run git, converting runner rejections (spawn failures) to INTERNAL. */
async function runGit(
  bound: BoundRuntime,
  op: string,
  args: readonly string[],
  cwd: string,
  timeoutMs: number
): Promise<Result<Buffer, StitchError>> {
  let result: WorktreeRunResult;
  try {
    result = await bound.run(args, cwd, { timeoutMs });
  } catch (error) {
    return err(internalError(op, error));
  }
  return checkRun(op, result, timeoutMs);
}

/** Parse `worktree list --porcelain` into registered tree paths. */
export function parseWorktreeList(output: string): string[] {
  const paths: string[] = [];
  for (const block of output.split('\n\n')) {
    for (const line of block.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith(WORKTREE_HEADER) && trimmed.length > WORKTREE_HEADER.length) {
        paths.push(trimmed.slice(WORKTREE_HEADER.length).trim());
        break;
      }
    }
  }
  return paths;
}

/** Platform-aware path equality (Windows/macOS filesystems ignore case). */
export function samePath(
  a: string,
  b: string,
  platform: NodeJS.Platform = process.platform
): boolean {
  const left = resolve(a);
  const right = resolve(b);
  if (platform === 'win32' || platform === 'darwin') {
    return left.toLowerCase() === right.toLowerCase();
  }
  return left === right;
}

/** Confirm repoPath is a git repo: CONFIG when it is not, GIT otherwise. */
async function ensureRepo(
  bound: BoundRuntime,
  op: string,
  repoPath: string,
  timeoutMs: number
): Promise<Result<void, StitchError>> {
  const gitDir = await runGit(bound, op, ['rev-parse', '--git-dir'], repoPath, timeoutMs);
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

interface NormalizedWrite {
  repoPath: string;
  entries: Array<{ rel: string; content: string }>;
  worktreePath: string | undefined;
  ref: string;
  verify: VerifyTree | undefined;
  timeoutMs: number;
  jobId: string | undefined;
}

/** Validate everything (paths included) before any spawn or mkdir. */
function normalizeWriteOpts(
  repoPath: string,
  files: Map<string, string>,
  opts: WriteWorktreeOpts
): Result<NormalizedWrite, StitchError> {
  if (repoPath.trim() === '') {
    return invalid('repoPath', 'writeToWorktree: repoPath is required');
  }
  if (files.size === 0) {
    return invalid('files', 'writeToWorktree: files must contain at least one entry');
  }
  const entries: Array<{ rel: string; content: string }> = [];
  for (const [rel, content] of files) {
    if (rel.trim() === '') {
      return invalid('files', 'writeToWorktree: file paths must not be blank');
    }
    if (typeof content !== 'string') {
      return invalid('files', `writeToWorktree: content for "${rel}" must be a string`);
    }
    entries.push({ rel, content });
  }
  if (opts.worktreePath !== undefined && opts.worktreePath.trim() === '') {
    return invalid('worktreePath', 'writeToWorktree: worktreePath must not be blank');
  }
  if (opts.ref !== undefined && opts.ref.trim() === '') {
    return invalid('ref', 'writeToWorktree: ref must not be blank');
  }
  const timeoutMs = opts.timeoutMs ?? DEFAULT_WORKTREE_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
    return invalid('timeoutMs', 'writeToWorktree: timeoutMs must be an integer >= 1');
  }
  return ok({
    repoPath,
    entries,
    worktreePath: opts.worktreePath,
    ref: opts.ref ?? 'HEAD',
    verify: opts.verify,
    timeoutMs,
    jobId: opts.jobId,
  });
}

/** Resolve every rel against the future tree root (misuse leaves nothing). */
function resolveEntries(
  worktreePath: string,
  entries: Array<{ rel: string; content: string }>
): Result<WorktreeFile[], StitchError> {
  const targets: WorktreeFile[] = [];
  for (const entry of entries) {
    const target = resolveTargetPath(worktreePath, entry.rel);
    if (target.isErr()) {
      const detail = 'message' in target.error ? target.error.message : target.error.code;
      return err({
        code: 'CONFIG_ERROR',
        field: 'files',
        message: `writeToWorktree: refusing "${entry.rel}" (${detail})`,
      });
    }
    targets.push({ path: target.value, content: entry.content });
  }
  return ok(targets);
}

/** `git worktree add --detach`: bad refs are caller errors (CONFIG). */
async function createTree(
  bound: BoundRuntime,
  repoPath: string,
  worktreePath: string,
  ref: string,
  timeoutMs: number
): Promise<Result<void, StitchError>> {
  let result: WorktreeRunResult;
  try {
    result = await bound.run(['worktree', 'add', '--detach', worktreePath, ref], repoPath, {
      timeoutMs,
    });
  } catch (error) {
    return err(internalError('worktree add', error));
  }
  if (result.exitCode === 0) return ok(undefined);
  const stderr = result.stderr.trim();
  if (
    /invalid reference|unknown revision|ambiguous argument|bad revision|not a valid object/i.test(
      stderr
    )
  ) {
    return err({
      code: 'CONFIG_ERROR',
      field: 'ref',
      message: `writeToWorktree: unknown ref ("${ref}")`,
    });
  }
  return err(runFailure('worktree add', result, timeoutMs));
}

async function removeDirBestEffort(bound: BoundRuntime, path: string): Promise<void> {
  try {
    await bound.fs.removeDir(path);
  } catch {
    // Best effort: the original error below is what matters.
  }
}

/**
 * Write files into an isolated detached worktree. Returns the handle the
 * commit (P-077) or discard (P-085) path needs.
 */
export async function writeToWorktree(
  repoPath: string,
  files: Map<string, string>,
  opts: WriteWorktreeOpts = {},
  runtime?: WorktreeRuntime
): Promise<Result<WriteWorktreeResult, StitchError>> {
  const normalized = normalizeWriteOpts(repoPath, files, opts);
  if (normalized.isErr()) return err(normalized.error);
  const bound = bindRuntime(runtime);
  const options = normalized.value;
  const log = (options.jobId === undefined ? logger : createJobLogger(options.jobId)).child({
    op: 'worktree',
    repoPath: options.repoPath,
  });

  const repo = await ensureRepo(bound, 'writeToWorktree', options.repoPath, options.timeoutMs);
  if (repo.isErr()) return err(repo.error);

  let worktreePath: string;
  if (options.worktreePath !== undefined) {
    worktreePath = options.worktreePath;
    // Caller-provided targets must be free; mkdtemp paths are fresh by
    // construction and skip this check (they always exist).
    let occupied: boolean;
    try {
      occupied = await bound.fs.exists(worktreePath);
    } catch (error) {
      return err(internalError('worktree target check', error));
    }
    if (occupied) {
      return err({
        code: 'CONFIG_ERROR',
        field: 'worktreePath',
        message: `writeToWorktree: target already exists ("${worktreePath}")`,
      });
    }
  } else {
    try {
      worktreePath = await bound.fs.makeTempDir(join(tmpdir(), 'stitch-worktree-'));
    } catch (error) {
      return err(internalError('worktree tmpdir', error));
    }
  }

  const targets = resolveEntries(worktreePath, options.entries);
  if (targets.isErr()) return err(targets.error);

  const created = await createTree(
    bound,
    options.repoPath,
    worktreePath,
    options.ref,
    options.timeoutMs
  );
  if (created.isErr()) {
    await removeDirBestEffort(bound, worktreePath);
    return err(created.error);
  }
  log.debug({ worktreePath }, 'worktree created');

  try {
    await bound.fs.writeFiles(targets.value);
  } catch (error) {
    await cleanupTree(bound, options.repoPath, worktreePath, options.timeoutMs);
    return err(internalError('worktree stage files', error));
  }

  if (options.verify !== undefined) {
    let verdict: Result<VerifyVerdict, StitchError>;
    try {
      verdict = await options.verify(worktreePath);
    } catch (error) {
      return err(internalError('worktree verify', error));
    }
    if (verdict.isErr()) return err(verdict.error);
    log.debug({ pass: verdict.value.pass }, 'worktree verified');
    return ok({ worktreePath, created: true, verified: verdict.value.pass });
  }
  return ok({ worktreePath, created: true, verified: false });
}

/** Post-staging cleanup: registered remove, falling back to dir removal. */
async function cleanupTree(
  bound: BoundRuntime,
  repoPath: string,
  worktreePath: string,
  timeoutMs: number
): Promise<void> {
  const removed = await removeWorktree(
    repoPath,
    worktreePath,
    { timeoutMs },
    { run: bound.run, fs: bound.fs }
  );
  if (removed.isErr()) {
    await removeDirBestEffort(bound, worktreePath);
  }
}

interface NormalizedRemove {
  repoPath: string;
  worktreePath: string;
  timeoutMs: number;
  jobId: string | undefined;
}

function normalizeRemoveOpts(
  repoPath: string,
  worktreePath: string,
  opts: RemoveWorktreeOpts
): Result<NormalizedRemove, StitchError> {
  if (repoPath.trim() === '') {
    return invalid('repoPath', 'removeWorktree: repoPath is required');
  }
  if (worktreePath.trim() === '') {
    return invalid('worktreePath', 'removeWorktree: worktreePath is required');
  }
  const timeoutMs = opts.timeoutMs ?? DEFAULT_WORKTREE_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
    return invalid('timeoutMs', 'removeWorktree: timeoutMs must be an integer >= 1');
  }
  return ok({ repoPath, worktreePath, timeoutMs, jobId: opts.jobId });
}

/** Registered trees from `worktree list --porcelain`. */
async function listedTrees(
  bound: BoundRuntime,
  repoPath: string,
  timeoutMs: number
): Promise<Result<string[], StitchError>> {
  const list = await runGit(
    bound,
    'worktree list',
    ['worktree', 'list', '--porcelain'],
    repoPath,
    timeoutMs
  );
  if (list.isErr()) return err(list.error);
  return ok(parseWorktreeList(list.value.toString('utf8')));
}

/**
 * Discard a staging worktree: only registered trees, never the main tree,
 * verified gone afterwards. P-085 calls this on abandon.
 */
export async function removeWorktree(
  repoPath: string,
  worktreePath: string,
  opts: RemoveWorktreeOpts = {},
  runtime?: WorktreeRuntime
): Promise<Result<void, StitchError>> {
  const normalized = normalizeRemoveOpts(repoPath, worktreePath, opts);
  if (normalized.isErr()) return err(normalized.error);
  const bound = bindRuntime(runtime);
  const options = normalized.value;
  const log = (options.jobId === undefined ? logger : createJobLogger(options.jobId)).child({
    op: 'worktree-remove',
    repoPath: options.repoPath,
    worktreePath: options.worktreePath,
  });

  // Never the main tree itself — checked before any spawn.
  if (samePath(options.repoPath, options.worktreePath)) {
    return err({
      code: 'CONFIG_ERROR',
      field: 'worktreePath',
      message: 'removeWorktree: refusing to remove the main working tree',
    });
  }

  const trees = await listedTrees(bound, options.repoPath, options.timeoutMs);
  if (trees.isErr()) return err(trees.error);
  if (!trees.value.some(registered => samePath(registered, options.worktreePath))) {
    return err({
      code: 'CONFIG_ERROR',
      field: 'worktreePath',
      message: `removeWorktree: not a registered worktree ("${options.worktreePath}")`,
    });
  }

  const removed = await runGit(
    bound,
    'worktree remove',
    ['worktree', 'remove', '--force', options.worktreePath],
    options.repoPath,
    options.timeoutMs
  );
  if (removed.isErr()) return err(removed.error);

  const after = await listedTrees(bound, options.repoPath, options.timeoutMs);
  if (after.isErr()) return err(after.error);
  if (after.value.some(registered => samePath(registered, options.worktreePath))) {
    return err(
      internalError('worktree remove', `"${options.worktreePath}" is still listed after remove`)
    );
  }
  log.debug('worktree removed');
  return ok(undefined);
}
