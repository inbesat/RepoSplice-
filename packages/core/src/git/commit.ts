// Commit with co-author trailers (P-077): commit the staged worktree
// (P-076) attributing each originating author from provenance (P-181) so
// merged child history preserves credit for CREDITS (P-182) and
// licence-compliant attribution (P-126). Flow: validate all args (message
// + authors built first, pre-spawn) -> rev-parse -> pre-check worktree
// state -> stage intended files -> full guard (exact staged set, no
// unstaged/untracked, non-empty) -> `commit -m` -> `rev-parse HEAD`.
//
// Verified behavior (real git 2.47 on this box — do not assume otherwise):
// - `status --porcelain=v1 -z` emits `XY <path>\0` chunks; renames/copies
//   emit `R  <new>\0<old>\0` (new path first, old side as a bare follow-up
//   chunk with no XY prefix). `AM` means staged AND unstaged at once.
// - An empty index makes `commit` exit 1 with a human essay on stdout; the
//   staged-empty guard below refuses first with a typed error instead.
// - `commit -m` round-trips multiline bodies + trailers byte-for-byte
//   (modulo git's trailing-newline cleanup); `rev-parse HEAD` prints the
//   40-hex SHA. Identity comes from the caller's git config (env owns it;
//   trailers carry stitch's attribution, not the committer).
//
// Safety contract (P-084's future home; P-203 owns the DIRTY_TREE code):
// - State refusals (dirty worktree, unexpected/missing/empty staged set)
//   are GIT_ERRORs carrying the offending paths (P-074 dirty precedent);
//   argument misuse (blank message/repoPath, malformed authors, bad
//   timeout, unmatchable files entries) is CONFIG_ERROR pre-spawn.
// - Message: CRLF normalized to LF (P-282); CR/LF stripped from author
//   fields so untrusted input can never smuggle trailer lines (P-265);
//   authors deduped by name + lowercased email, input (lineage) order kept
//   — never sorted, so P-181's origin order survives.
// - Exactness: with `files`, the post-add staged set must equal the
//   intended set (pre-existing staged extras refuse); without `files` the
//   index commits as-is. Stray unstaged modifications and untracked files
//   (anything outside the intended set) always refuse — commit only
//   intended files. Intended files themselves are stageable by definition:
//   the P-076 flow stages untracked work, and an agent stages its edits.
// - Only the SHA + counts reach the logs, never the message body.
// - The runner returns exit codes as data (P-075 pattern: 124 = timeout
//   sentinel); every rejection -> INTERNAL; no new StitchError codes.
//
// Seams and future phases:
// - CommitRuntime.run is the only seam (execFile default); no fs writes
//   (the message travels via `commit -m` argv).
// - P-084 clean.ts will own assertClean; until then the guard here is the
//   enforcement point for the write→commit loop. P-085 rollback consumes
//   the returned SHA; P-165/P-181 supply message + lineage-ordered authors.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ok, err, type Result } from 'neverthrow';
import type { StitchError } from '../result/index.js';
import { logger, createJobLogger } from '../logger/index.js';

/** Silence timeout (ms): local commit plumbing, same budget as siblings. */
export const DEFAULT_COMMIT_TIMEOUT_MS = 60_000;

/** Exec timeout sentinel: Node kills the child (SIGTERM/ETIMEDOUT). */
const TIMEOUT_EXIT_CODE = 124;

const TRAILER_PREFIX = 'Co-Authored-By:';

/** Provenance-supplied author (P-181 shape, name + mailbox). */
export interface CoAuthor {
  name: string;
  email: string;
}

export interface CommitOpts {
  /** Intended relative paths to stage; absent = commit the index as-is. */
  files?: string[];
  /** Silence timeout ms for git processes. Default: 60_000. */
  timeoutMs?: number;
  /** Job id for structured logs. */
  jobId?: string;
}

/** Process result as data: exit codes are signals, never rejections. */
export interface CommitRunResult {
  exitCode: number;
  stdout: Buffer;
  stderr: string;
}

export interface CommitRunner {
  (args: readonly string[], cwd: string, opts: { timeoutMs: number }): Promise<CommitRunResult>;
}

export interface CommitRuntime {
  run?: CommitRunner;
}

const execFileAsync = promisify(execFile);

/** Default runner: real git via PATH, killed after timeoutMs of silence. */
async function defaultRun(
  args: readonly string[],
  cwd: string,
  opts: { timeoutMs: number }
): Promise<CommitRunResult> {
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

/** State refusal: GIT_ERROR carrying the offending paths (P-074 precedent). */
function refuse(paths: string, message: string): Result<never, StitchError> {
  return err({ code: 'GIT_ERROR', message: `commitWithTrailers: refusing: ${message}: ${paths}` });
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
  result: CommitRunResult,
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
  result: CommitRunResult,
  timeoutMs: number
): Result<Buffer, StitchError> {
  if (result.exitCode === 0) return ok(result.stdout);
  return err(runFailure(op, result, timeoutMs));
}

interface BoundRuntime {
  run: CommitRunner;
}

function bindRuntime(runtime: CommitRuntime | undefined): BoundRuntime {
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
  let result: CommitRunResult;
  try {
    result = await bound.run(args, cwd, { timeoutMs });
  } catch (error) {
    return err(internalError(op, error));
  }
  return checkRun(op, result, timeoutMs);
}

/** Collapse CR/LF runs to a single space (P-265: no smuggled lines). */
function flatField(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+$/;

interface SanitizedAuthor {
  name: string;
  email: string;
}

/** Sanitize one author: flat fields, non-empty, plausible mailbox. */
function sanitizeAuthor(author: CoAuthor): Result<SanitizedAuthor, StitchError> {
  const name = flatField(author.name);
  const email = flatField(author.email);
  if (name === '' || email === '') {
    return invalid('coAuthors', 'commitWithTrailers: co-author name and email are required');
  }
  if (!EMAIL_RE.test(email)) {
    return invalid(
      'coAuthors',
      `commitWithTrailers: co-author email is not a mailbox ("${email}")`
    );
  }
  return ok({ name, email });
}

/**
 * Build the commit bytes: normalized message + blank line + one trailer
 * per deduplicated author + trailing newline. Pure and total over its
 * inputs — same inputs always yield the same bytes (P-282). Authors keep
 * first-occurrence (lineage) order; duplicates collapse by name plus
 * lowercased mailbox.
 */
export function buildCommitMessage(
  message: string,
  coAuthors: CoAuthor[]
): Result<string, StitchError> {
  if (message.trim() === '') {
    return invalid('message', 'commitWithTrailers: message is required');
  }
  const seen = new Set<string>();
  const trailers: string[] = [];
  for (const author of coAuthors) {
    const sanitized = sanitizeAuthor(author);
    if (sanitized.isErr()) return err(sanitized.error);
    const key = `${sanitized.value.name}\n${sanitized.value.email.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    trailers.push(`${TRAILER_PREFIX} ${sanitized.value.name} <${sanitized.value.email}>`);
  }
  const body = message.replace(/\r\n/g, '\n').replace(/\n+$/, '');
  return ok(`${body}\n\n${trailers.join('\n')}\n`);
}

/** Worktree state split from one porcelain call: staged/unstaged/untracked. */
interface TreeState {
  staged: Set<string>;
  unstaged: Set<string>;
  untracked: Set<string>;
}

const UNMERGED_XY = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU']);

/**
 * Parse `status --porcelain=v1 -z`. Rename/copy entries consume their bare
 * follow-up chunk (old path); the committed tree carries the new path.
 */
function parseStatus(output: Buffer): Result<TreeState, StitchError> {
  const state: TreeState = { staged: new Set(), unstaged: new Set(), untracked: new Set() };
  const chunks = output
    .toString('utf8')
    .split('\0')
    .filter(part => part !== '');
  let index = 0;
  while (index < chunks.length) {
    const chunk = chunks[index];
    if (chunk === undefined || chunk.length < 4 || chunk[2] !== ' ') {
      return err(
        internalError('commit parse status', `malformed entry ${JSON.stringify(chunk ?? '')}`)
      );
    }
    const xy = chunk.slice(0, 2);
    const path = chunk.slice(3);
    if (xy === '??') {
      state.untracked.add(path);
      index += 1;
      continue;
    }
    if (UNMERGED_XY.has(xy)) {
      return refuse(path, 'unmerged entries cannot be committed');
    }
    if (xy[0] === 'R' || xy[0] === 'C') {
      // Rename/copy: the next bare chunk is the old path — consume it.
      if (index + 1 >= chunks.length) {
        return err(internalError('commit parse status', `truncated rename for "${path}"`));
      }
      index += 1;
    }
    if (xy[0] !== ' ' && xy[0] !== undefined) state.staged.add(path);
    if (xy[1] !== ' ' && xy[1] !== undefined) state.unstaged.add(path);
    index += 1;
  }
  return ok(state);
}

function normalizeRel(rel: string): string {
  return rel.startsWith('./') ? rel.slice(2) : rel;
}

interface NormalizedCommit {
  repoPath: string;
  fullMessage: string;
  files: string[] | undefined;
  timeoutMs: number;
  jobId: string | undefined;
}

/** Validate args + build the message before any spawn. */
function normalizeCommitOpts(
  repoPath: string,
  message: string,
  coAuthors: CoAuthor[],
  opts: CommitOpts
): Result<NormalizedCommit, StitchError> {
  if (repoPath.trim() === '') {
    return invalid('repoPath', 'commitWithTrailers: repoPath is required');
  }
  const fullMessage = buildCommitMessage(message, coAuthors);
  if (fullMessage.isErr()) return err(fullMessage.error);
  let files: string[] | undefined;
  if (opts.files !== undefined) {
    files = [];
    for (const file of opts.files) {
      if (file.trim() === '') {
        return invalid('files', 'commitWithTrailers: file paths must not be blank');
      }
      files.push(normalizeRel(file));
    }
  }
  const timeoutMs = opts.timeoutMs ?? DEFAULT_COMMIT_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
    return invalid('timeoutMs', 'commitWithTrailers: timeoutMs must be an integer >= 1');
  }
  return ok({ repoPath, fullMessage: fullMessage.value, files, timeoutMs, jobId: opts.jobId });
}

/** Confirm repoPath is a git repo: CONFIG when it is not, GIT otherwise. */
async function ensureRepo(
  bound: BoundRuntime,
  repoPath: string,
  timeoutMs: number
): Promise<Result<void, StitchError>> {
  const gitDir = await runGit(
    bound,
    'commit rev-parse',
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
        message: `commitWithTrailers: not a git repository ("${repoPath}")`,
      });
    }
    return err(gitDir.error);
  }
  return ok(undefined);
}

async function readState(
  bound: BoundRuntime,
  repoPath: string,
  timeoutMs: number
): Promise<Result<TreeState, StitchError>> {
  const status = await runGit(
    bound,
    'commit status',
    ['status', '--porcelain=v1', '-z'],
    repoPath,
    timeoutMs
  );
  if (status.isErr()) return err(status.error);
  return parseStatus(status.value);
}

/** Pre-add check: stray (unintended) unstaged or untracked drift refuses. Intended files are exempt — staging them is this call's job. */
function preCheck(state: TreeState, files: string[] | undefined): Result<void, StitchError> {
  const intended = new Set(files ?? []);
  const strayUnstaged = [...state.unstaged].filter(path => !intended.has(path));
  const strayUntracked = [...state.untracked].filter(path => !intended.has(path));
  if (strayUnstaged.length > 0) {
    return refuse(strayUnstaged.sort().join(', '), 'unstaged changes would not be committed');
  }
  if (strayUntracked.length > 0) {
    return refuse(strayUntracked.sort().join(', '), 'untracked files would not be committed');
  }
  return ok(undefined);
}

/** Post-add guard: exact staged set (when intended), still clean, non-empty. */
function postCheck(state: TreeState, files: string[] | undefined): Result<void, StitchError> {
  if (files !== undefined) {
    const expected = new Set(files);
    const missing = [...expected].filter(path => !state.staged.has(path));
    const extra = [...state.staged].filter(path => !expected.has(path));
    if (missing.length > 0 || extra.length > 0) {
      const detail = [
        ...(missing.length > 0 ? [`missing: ${missing.sort().join(', ')}`] : []),
        ...(extra.length > 0 ? [`unexpected: ${extra.sort().join(', ')}`] : []),
      ].join('; ');
      return refuse(detail, 'staged set is not the intended set');
    }
  }
  if (state.unstaged.size > 0) {
    return refuse(
      [...state.unstaged].sort().join(', '),
      'unstaged changes appeared during staging'
    );
  }
  if (state.untracked.size > 0) {
    return refuse(
      [...state.untracked].sort().join(', '),
      'untracked files appeared during staging'
    );
  }
  if (state.staged.size === 0) {
    return refuse('nothing staged', 'nothing to commit');
  }
  return ok(undefined);
}

const SHA_RE = /^[0-9a-f]{40}$/;

/**
 * Commit the staged worktree with co-author trailers. With `files`, stages
 * exactly those paths and refuses anything else; without, commits the
 * index as-is. Resolves to the new commit SHA.
 */
export async function commitWithTrailers(
  repoPath: string,
  message: string,
  coAuthors: CoAuthor[],
  opts: CommitOpts = {},
  runtime?: CommitRuntime
): Promise<Result<string, StitchError>> {
  const normalized = normalizeCommitOpts(repoPath, message, coAuthors, opts);
  if (normalized.isErr()) return err(normalized.error);
  const bound = bindRuntime(runtime);
  const options = normalized.value;
  const log = (options.jobId === undefined ? logger : createJobLogger(options.jobId)).child({
    op: 'commit',
    repoPath: options.repoPath,
  });

  const repo = await ensureRepo(bound, options.repoPath, options.timeoutMs);
  if (repo.isErr()) return err(repo.error);

  const before = await readState(bound, options.repoPath, options.timeoutMs);
  if (before.isErr()) return err(before.error);
  const pre = preCheck(before.value, options.files);
  if (pre.isErr()) return err(pre.error);

  if (options.files !== undefined && options.files.length > 0) {
    const added = await runGit(
      bound,
      'commit add',
      ['add', '--', ...options.files],
      options.repoPath,
      options.timeoutMs
    );
    if (added.isErr()) {
      const text = added.error.code === 'GIT_ERROR' ? added.error.message : '';
      if (/did not match/i.test(text)) {
        return err({
          code: 'CONFIG_ERROR',
          field: 'files',
          message: `commitWithTrailers: files entry matched nothing (${text})`,
        });
      }
      return err(added.error);
    }
  }

  const after = await readState(bound, options.repoPath, options.timeoutMs);
  if (after.isErr()) return err(after.error);
  const post = postCheck(after.value, options.files);
  if (post.isErr()) return err(post.error);

  const committed = await runGit(
    bound,
    'commit',
    ['commit', '-m', options.fullMessage],
    options.repoPath,
    options.timeoutMs
  );
  if (committed.isErr()) return err(committed.error);

  const head = await runGit(
    bound,
    'commit rev-parse',
    ['rev-parse', 'HEAD'],
    options.repoPath,
    options.timeoutMs
  );
  if (head.isErr()) return err(head.error);
  const sha = head.value.toString('utf8').trim();
  if (!SHA_RE.test(sha)) {
    return err(internalError('commit rev-parse', `malformed SHA ${JSON.stringify(sha)}`));
  }
  log.debug({ sha }, 'commit created');
  return ok(sha);
}
