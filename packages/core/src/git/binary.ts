// Binary skip list (P-082): detect binary files so text-based processing
// (diff P-217, AI analysis P-148/P-163, license header scan P-124) skips
// them — while merges (P-192) and checksums (P-186) still carry every byte.
// Flow per file: validate -> rev-parse -> `check-attr -z binary diff` ->
// extension config -> magic-byte sniff of the worktree content.
// `classifyFiles` partitions a list; skip decisions persist to the P-030
// `provenance` table (single versioned row per repo) for deterministic
// reuse (P-250/P-282) and audit (P-187).
//
// Verified behavior (real git 2.47 on this box — do not assume otherwise):
// - `check-attr -z <attrs> -- <path>` prints `<path>\0<attr>\0<value>\0`
//   triples with `set`/`unset`/`unspecified`, exit 0 even for missing
//   files (all unspecified). `*.bin binary` reports binary:set +
//   diff:unset; `*.dat -diff` reports binary:unspecified + diff:unset;
//   `*.txt text` reports text:set with diff unspecified.
// - Git's own binary rule (probed `diff` output): diff-attr off OR NUL in
//   content — a `text` marking does NOT rescue NUL bytes ("Binary files
//   differ" either way), and `-diff` marks even pure-text content binary.
//   This module implements exactly that rule, then the caller ext list:
//     binary:set -> binary | diff unset/false -> binary |
//     ext match -> binary | NUL in first 8000 -> binary | else text.
//   `binary: unset` and the `text` attr carry no signal under this rule
//   and are not consulted (documented so the next reader doesn't add
//   them back).
//
// Safety contract:
// - Extension matching is case-sensitive basename-suffix (fail-closed for
//   compliance consumers like license scan: never skip on a near-match).
//   The default ext list is EMPTY — only caller config (P-243 later) and
//   git's own signals decide unless configured.
// - Magic sniffing reads at most the first 8000 bytes (git's window);
//   unreadable paths fail INTERNAL (loud), never default-text.
// - Skip rows are replace-whole-list per repo (DELETE + one INSERT), so
//   stale decisions never linger; rows carry the HEAD SHA so readers can
//   tell whether the list matches their tree.
// - Only paths + decisions + counts reach the logs, never file contents.
// - The runner returns exit codes as data (P-075 pattern: 124 = timeout
//   sentinel); every rejection -> INTERNAL; no new StitchError codes
//   (P-203 owns future taxonomy).
//
// Seams and future phases:
// - BinaryRuntime.run is the process seam (execFile default);
//   BinaryRuntime.fs (readPrefix) keeps content sniffing scriptable.
// - P-243 owns the `[git].binaryExts` config that feeds `binaryExts`;
//   P-163/P-217/P-124 consume `classifyFiles`; P-186 checksums the
//   carried bytes; P-181 refines attribution. No new tables: the generic
//   P-030 `provenance` row carries the versioned skip payload.

import { execFile } from 'node:child_process';
import { open } from 'node:fs/promises';
import { promisify } from 'node:util';
import { ok, err, type Result } from 'neverthrow';
import type { StitchError } from '../result/index.js';
import { logger, createJobLogger } from '../logger/index.js';
import { resolveTargetPath } from './conflict.js';
import { type DbLike, type SQLiteValue, dbAll, dbRun } from '../store/schema.js';

/** Silence timeout (ms): local attr/sniff plumbing, same budget as siblings. */
export const DEFAULT_BINARY_TIMEOUT_MS = 60_000;

/** Exec timeout sentinel: Node kills the child (SIGTERM/ETIMEDOUT). */
const TIMEOUT_EXIT_CODE = 124;

/** Magic-byte window git itself uses for binary detection. */
const BINARY_SNIFF_BYTES = 8000;

/** Stored skip-list payload format version (readers tolerate newer shapes). */
const SKIP_PAYLOAD_VERSION = 1;

/** Why a file was (or was not) skipped. */
export type SkipReason = 'attr' | 'ext' | 'magic' | 'text';

/** One file's skip verdict. */
export interface SkipDecision {
  path: string;
  binary: boolean;
  reason: SkipReason;
}

export interface BinaryOpts {
  /** Extra binary extensions ('.png'); case-sensitive; default: none. */
  binaryExts?: string[];
  /** Silence timeout ms for git processes. Default: 60_000. */
  timeoutMs?: number;
  /** Job id for structured logs. */
  jobId?: string;
}

export interface BinaryRuntime {
  run?: BinaryRunner;
  fs?: BinaryFs;
}

/** Content port: first bytes of a worktree file (scriptable sniffing). */
export interface BinaryFs {
  readPrefix(path: string, maxBytes: number): Promise<Buffer>;
}

/** Process result as data: exit codes are signals, never rejections. */
export interface BinaryRunResult {
  exitCode: number;
  stdout: Buffer;
  stderr: string;
}

export interface BinaryRunner {
  (args: readonly string[], cwd: string, opts: { timeoutMs: number }): Promise<BinaryRunResult>;
}

const execFileAsync = promisify(execFile);

/** Default runner: real git via PATH, killed after timeoutMs of silence. */
async function defaultRun(
  args: readonly string[],
  cwd: string,
  opts: { timeoutMs: number }
): Promise<BinaryRunResult> {
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
  result: BinaryRunResult,
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
  run: BinaryRunner;
  fs: BinaryFs;
}

/** Default fs: first-window read, handle always closed. */
const defaultFs: BinaryFs = {
  readPrefix: async (path, maxBytes) => {
    const handle = await open(path, 'r');
    try {
      const buffer = Buffer.alloc(maxBytes);
      const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
      return buffer.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  },
};

function bindRuntime(runtime: BinaryRuntime | undefined): BoundRuntime {
  return {
    run: runtime?.run ?? defaultRun,
    fs: runtime?.fs ?? defaultFs,
  };
}

/** Run git, converting runner rejections (spawn failures) to INTERNAL. */
async function runGit(
  bound: BoundRuntime,
  op: string,
  args: readonly string[],
  cwd: string,
  timeoutMs: number
): Promise<Result<Buffer, StitchError>> {
  let result: BinaryRunResult;
  try {
    result = await bound.run(args, cwd, { timeoutMs });
  } catch (error) {
    return err(internalError(op, error));
  }
  if (result.exitCode === 0) return ok(result.stdout);
  return err(runFailure(op, result, timeoutMs));
}

/** Attributes consulted, in query order (stable parse pairing). */
const BINARY_ATTRS = ['binary', 'diff'] as const;

type AttrValue = 'set' | 'unset' | 'unspecified';

/**
 * Parse `check-attr -z` triples for one path. Every requested attr must
 * appear exactly once with a known value — anything else is INTERNAL
 * (never guess policy).
 */
export function parseCheckAttr(
  output: Buffer,
  path: string,
  attrs: readonly string[]
): Result<Record<string, AttrValue>, StitchError> {
  const chunks = output
    .toString('utf8')
    .split('\0')
    .filter(part => part !== '');
  if (chunks.length !== attrs.length * 3) {
    return err(
      internalError(
        'binary check-attr',
        `expected ${attrs.length} triples, got ${chunks.length / 3}`
      )
    );
  }
  const values: Record<string, AttrValue> = {};
  for (let i = 0; i < attrs.length; i += 1) {
    const gotPath = chunks[i * 3] ?? '';
    const gotAttr = chunks[i * 3 + 1] ?? '';
    const gotValue = chunks[i * 3 + 2] ?? '';
    if (gotPath !== path || gotAttr !== attrs[i]) {
      return err(
        internalError(
          'binary check-attr',
          `mismatched triple ${JSON.stringify(gotPath)}/${JSON.stringify(gotAttr)}`
        )
      );
    }
    if (gotValue !== 'set' && gotValue !== 'unset' && gotValue !== 'unspecified') {
      return err(
        internalError(
          'binary check-attr',
          `unknown value ${JSON.stringify(gotValue)} for "${gotAttr}"`
        )
      );
    }
    values[gotAttr] = gotValue;
  }
  return ok(values);
}

/** Git's own binary rule over NUL bytes in the sniff window. */
function hasNulByte(window: Buffer): boolean {
  return window.subarray(0, Math.min(window.length, BINARY_SNIFF_BYTES)).includes(0);
}

function extMatches(file: string, exts: readonly string[]): boolean {
  const base = file.split('/').pop() ?? file;
  return exts.some(ext => {
    const normalized = ext.startsWith('.') ? ext : `.${ext}`;
    return base.endsWith(normalized);
  });
}

interface NormalizedBinary {
  repoPath: string;
  file: string;
  absPath: string;
  exts: string[];
  timeoutMs: number;
  jobId: string | undefined;
}

/** Validate args + resolve the contained absolute path before any spawn. */
function normalizeBinaryOpts(
  repoPath: string,
  file: string,
  opts: BinaryOpts
): Result<NormalizedBinary, StitchError> {
  if (repoPath.trim() === '') {
    return invalid('repoPath', 'isBinary: repoPath is required');
  }
  if (file.trim() === '') {
    return invalid('file', 'isBinary: file is required');
  }
  const target = resolveTargetPath(repoPath, file);
  if (target.isErr()) {
    return err({
      code: 'CONFIG_ERROR',
      field: 'file',
      message: `isBinary: refusing "${file}" (${target.error.code})`,
    });
  }
  const timeoutMs = opts.timeoutMs ?? DEFAULT_BINARY_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
    return invalid('timeoutMs', 'isBinary: timeoutMs must be an integer >= 1');
  }
  return ok({
    repoPath,
    file,
    absPath: target.value,
    exts: opts.binaryExts ?? [],
    timeoutMs,
    jobId: opts.jobId,
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

export interface BinaryVerdict {
  binary: boolean;
  reason: SkipReason;
}

/**
 * Decide one file: explicit repo policy (attr) beats caller config (ext),
 * which beats content (magic). Anything unreadable fails loud.
 */
export async function isBinary(
  repoPath: string,
  file: string,
  opts: BinaryOpts = {},
  runtime?: BinaryRuntime
): Promise<Result<BinaryVerdict, StitchError>> {
  const normalized = normalizeBinaryOpts(repoPath, file, opts);
  if (normalized.isErr()) return err(normalized.error);
  const bound = bindRuntime(runtime);
  const options = normalized.value;

  const repo = await ensureRepo(bound, options.repoPath, 'isBinary', options.timeoutMs);
  if (repo.isErr()) return err(repo.error);

  const attrOut = await runGit(
    bound,
    'isBinary check-attr',
    ['check-attr', '-z', ...BINARY_ATTRS, '--', options.file],
    options.repoPath,
    options.timeoutMs
  );
  if (attrOut.isErr()) return err(attrOut.error);
  const attrs = parseCheckAttr(attrOut.value, options.file, BINARY_ATTRS);
  if (attrs.isErr()) return err(attrs.error);

  if (attrs.value['binary'] === 'set' || attrs.value['diff'] === 'unset') {
    return ok({ binary: true, reason: 'attr' });
  }
  if (extMatches(options.file, options.exts)) {
    return ok({ binary: true, reason: 'ext' });
  }
  let window: Buffer;
  try {
    window = await bound.fs.readPrefix(options.absPath, BINARY_SNIFF_BYTES);
  } catch (error) {
    return err(internalError('isBinary read', error));
  }
  if (hasNulByte(window)) {
    return ok({ binary: true, reason: 'magic' });
  }
  return ok({ binary: false, reason: 'text' });
}

export interface ClassifiedFiles {
  text: string[];
  binary: string[];
}

/**
 * Partition paths into text vs binary (input order preserved). Any single
 * failure fails the call — silently misclassifying is worse than erring.
 */
export async function classifyFiles(
  repoPath: string,
  files: string[],
  opts: BinaryOpts = {},
  runtime?: BinaryRuntime
): Promise<Result<ClassifiedFiles, StitchError>> {
  const text: string[] = [];
  const binary: string[] = [];
  for (const file of files) {
    const verdict = await isBinary(repoPath, file, opts, runtime);
    if (verdict.isErr()) return err(verdict.error);
    if (verdict.value.binary) binary.push(file);
    else text.push(file);
  }
  return ok({ text, binary });
}

export interface SkipList {
  repoPath: string;
  /** HEAD at save time (null when unborn); readers compare to reuse. */
  headSha: string | null;
  decisions: SkipDecision[];
}

interface StoredSkipPayload {
  v: number;
  headSha: string | null;
  decisions: SkipDecision[];
}

function isSkipDecision(value: unknown): value is SkipDecision {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record['path'] === 'string' &&
    typeof record['binary'] === 'boolean' &&
    (record['reason'] === 'attr' ||
      record['reason'] === 'ext' ||
      record['reason'] === 'magic' ||
      record['reason'] === 'text')
  );
}

/** Resolve HEAD (null when unborn and nothing to key on is an error). */
async function resolveHead(
  bound: BoundRuntime,
  repoPath: string,
  timeoutMs: number,
  hasFiles: boolean
): Promise<Result<string | null, StitchError>> {
  if (!hasFiles) return ok(null);
  const out = await runGit(
    bound,
    'skip save rev-parse',
    ['rev-parse', 'HEAD'],
    repoPath,
    timeoutMs
  );
  if (out.isErr()) return err(out.error);
  const sha = out.value.toString('utf8').trim();
  if (!/^[0-9a-f]{40}$/.test(sha)) {
    return err(internalError('skip save rev-parse', `malformed SHA ${JSON.stringify(sha)}`));
  }
  return ok(sha);
}

/**
 * Persist skip decisions to the P-030 `provenance` table (replace-whole
 * list per repo: one DELETE + one INSERT, so stale verdicts never linger).
 */
export async function saveSkipList(
  db: DbLike,
  repoPath: string,
  decisions: SkipDecision[],
  opts: BinaryOpts = {},
  runtime?: BinaryRuntime
): Promise<Result<void, StitchError>> {
  if (repoPath.trim() === '') {
    return invalid('repoPath', 'saveSkipList: repoPath is required');
  }
  const bound = bindRuntime(runtime);
  const timeoutMs = opts.timeoutMs ?? DEFAULT_BINARY_TIMEOUT_MS;
  const head = await resolveHead(bound, repoPath, timeoutMs, decisions.length > 0);
  if (head.isErr()) return err(head.error);
  const ordered = [...decisions].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const payload: StoredSkipPayload = {
    v: SKIP_PAYLOAD_VERSION,
    headSha: head.value,
    decisions: ordered,
  };
  const deleted = dbRun(db, 'DELETE FROM provenance WHERE repo = ?', repoPath);
  if (deleted.isErr()) return err(deleted.error);
  const stored = dbRun(
    db,
    'INSERT INTO provenance (repo, commit_sha, payload) VALUES (?, ?, ?)',
    repoPath,
    head.value,
    JSON.stringify(payload) as SQLiteValue
  );
  if (stored.isErr()) return err(stored.error);
  const log = (opts.jobId === undefined ? logger : createJobLogger(opts.jobId)).child({
    op: 'binary-skip',
    repoPath,
  });
  log.debug(
    { files: ordered.length, binary: ordered.filter(entry => entry.binary).length },
    'skip list saved'
  );
  return ok(undefined);
}

/** Load a persisted skip list (empty when never saved). */
export async function loadSkipList(
  db: DbLike,
  repoPath: string
): Promise<Result<SkipList, StitchError>> {
  const selected = dbAll(db, 'SELECT payload FROM provenance WHERE repo = ?', repoPath);
  if (selected.isErr()) return err(selected.error);
  if (selected.value.length === 0) {
    return ok({ repoPath, headSha: null, decisions: [] });
  }
  const raw = selected.value[0]?.['payload'];
  if (typeof raw !== 'string') {
    return err(internalError('skip load', `non-string payload for repo "${repoPath}"`));
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (cause: unknown) {
    return err(internalError('skip load', cause));
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return err(internalError('skip load', `malformed payload for repo "${repoPath}"`));
  }
  const record = parsed as { headSha?: unknown; decisions?: unknown };
  if (!Array.isArray(record.decisions) || !record.decisions.every(isSkipDecision)) {
    return err(internalError('skip load', `malformed payload for repo "${repoPath}"`));
  }
  return ok({
    repoPath,
    headSha: typeof record.headSha === 'string' ? record.headSha : null,
    decisions: record.decisions,
  });
}
