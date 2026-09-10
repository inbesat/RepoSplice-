// Blame/provenance map foundation (P-079): file → origin mapping that
// CREDITS (P-182), SBOM (P-183), checksum manifest (P-186), and the UI
// provenance view (P-185) consume. Flow: validate args -> rev-parse ->
// `ls-files -s` (tracked files + blob SHAs) -> `blame --line-porcelain`
// per file -> group lines by commit -> resolve each block's source ->
// BlameMap (sorted, deterministic).
//
// Verified behavior (real git 2.47 on this box — do not assume otherwise):
// - `ls-files -s -z` emits `mode blob stage\tpath\0` (stage 0 when
//   merged; paths may contain spaces, never NUL).
// - `blame --line-porcelain -- <path>` emits blocks `<sha> <orig> <final>
//   <count>` + `author`/`author-mail <..>`/`author-time`/`summary`/
//   optional `previous`/`boundary` + `filename <path>` + exactly `count`
//   TAB-prefixed content lines. Uncommitted lines carry the all-zero SHA.
//   Binary files blame fine (byte content, same shape) — authorship of
//   binaries still counts, so nothing is excluded here (P-082's text-only
//   skip applies to its own consumers, not to attribution).
// - `merge-base --is-ancestor A B`: exit 0 = true, 1 = false (silent),
//   128 + "Not a valid commit name" for unknown objects (an object absent
//   from this repo's graph cannot be anyone's ancestor — sound false).
//
// Source resolution per blamed SHA, in order (first hit wins):
//  1. Merge-topology ancestry: the unique tip containing the SHA (cached
//     per SHA; needs tipShas from the merge that built the child, P-072).
//     Zero or multiple matches fall through — shared linear history is
//     information-theoretically ambiguous (no DAG query can recover the
//     authoring branch of a commit both sides contain), as are post-merge
//     local commits outside all tips.
//  2. Path prefix (the filter-repo/subtree layout mapping, P-070/073):
//     longest match wins; an absent prefix never matches (fail-closed),
//     an explicit empty prefix is the deliberate catch-all.
//  3. Null (unknown — P-181 flags these, never fabricates).
// Commit ground truth beats layout metadata: a line whose commit sits on
// another source's side resolves there even under a foreign prefix.
//
// Safety contract:
// - Validation (blank repoPath, malformed sources/tips, bad timeout)
//   returns CONFIG_ERROR BEFORE any spawn.
// - Every runner rejection -> INTERNAL; nonzero exits -> typed GIT_ERROR
//   (124 = timeout sentinel); malformed git output -> INTERNAL (never
//   silent corruption: the porcelain parser is a strict state machine).
// - Persistence uses the P-030 `provenance` table through the structural
//   `DbLike` surface (works under vitest via fakes; production passes the
//   opened StitchDb): replace-whole-map per repo (DELETE + INSERTs, one
//   row per file keyed by blob SHA), so stale files never linger. Payload
//   carries a format version for P-181/P-250 readers.
// - Only paths + SHAs + counts reach the logs, never file contents.
// - No new StitchError codes (P-203 owns future taxonomy).
//
// Seams and future phases:
// - BlameRuntime.run is the only process seam (execFile default).
// - P-181 builds ProvenanceMap/getOrigin on top (per-file rows are the
//   query grain); P-186 reads blob SHAs for checksums; P-075 conflict
//   context and P-182 CREDITS consume origins. P-086 owns blame-at-scale
//   performance; no unbounded inputs are capped here.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ok, err, type Result } from 'neverthrow';
import type { StitchError } from '../result/index.js';
import { logger, createJobLogger } from '../logger/index.js';
import { type DbLike, type SQLiteValue, dbAll, dbRun } from '../store/schema.js';

/** Silence timeout (ms): local blame plumbing, same budget as siblings. */
export const DEFAULT_BLAME_TIMEOUT_MS = 60_000;

/** Exec timeout sentinel: Node kills the child (SIGTERM/ETIMEDOUT). */
const TIMEOUT_EXIT_CODE = 124;

/** Stored payload format version (readers must tolerate newer shapes). */
const BLAME_PAYLOAD_VERSION = 1;

/** A source repo contributing to the child (P-072 MergeSource harmony). */
export interface BlameSource {
  /** Source name (remote-safe label, e.g. `repo-a`). */
  name: string;
  /**
   * Child-tree prefix from the filter-repo/subtree mapping (no slashes).
   * Absent matches nothing (fail-closed); pass an explicit empty prefix
   * to claim unmatched paths deliberately.
   */
  prefix?: string;
  /** Source ref the extract came from (branch/tag, for attribution). */
  ref?: string;
  /** SPDX license id for the attribution chain (P-125/126 resolve later). */
  license?: string;
  /** Merged tip SHA for ancestry attribution (40-hex when present). */
  tipSha?: string;
}

/** One contiguous line-block attributed to a single commit. */
export interface LineOrigin {
  /** 1-based final-file line numbers, inclusive. */
  startLine: number;
  endLine: number;
  /** Blamed commit SHA; null for uncommitted (all-zero) lines. */
  sha: string | null;
  author: string;
  authorMail: string | null;
  authorTime: number | null;
  /** Resolved source name; null when honestly unknown. */
  sourceRepo: string | null;
  sourceRef: string | null;
  license: string | null;
}

/** One tracked file with its line origins in file order. */
export interface FileBlame {
  path: string;
  blobSha: string;
  origins: LineOrigin[];
}

/** Whole-tree map, files sorted by path for stable exports (P-282). */
export interface BlameMap {
  repoPath: string;
  files: FileBlame[];
}

export interface BlameOpts {
  /** Silence timeout ms for git processes. Default: 60_000. */
  timeoutMs?: number;
  /** Job id for structured logs. */
  jobId?: string;
}

/** Process result as data: exit codes are signals, never rejections. */
export interface BlameRunResult {
  exitCode: number;
  stdout: Buffer;
  stderr: string;
}

export interface BlameRunner {
  (args: readonly string[], cwd: string, opts: { timeoutMs: number }): Promise<BlameRunResult>;
}

export interface BlameRuntime {
  run?: BlameRunner;
}

const execFileAsync = promisify(execFile);

/** Default runner: real git via PATH, killed after timeoutMs of silence. */
async function defaultRun(
  args: readonly string[],
  cwd: string,
  opts: { timeoutMs: number }
): Promise<BlameRunResult> {
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
  result: BlameRunResult,
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
  result: BlameRunResult,
  timeoutMs: number
): Result<Buffer, StitchError> {
  if (result.exitCode === 0) return ok(result.stdout);
  return err(runFailure(op, result, timeoutMs));
}

interface BoundRuntime {
  run: BlameRunner;
}

function bindRuntime(runtime: BlameRuntime | undefined): BoundRuntime {
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
  let result: BlameRunResult;
  try {
    result = await bound.run(args, cwd, { timeoutMs });
  } catch (error) {
    return err(internalError(op, error));
  }
  return checkRun(op, result, timeoutMs);
}

const SHA_RE = /^[0-9a-f]{40}$/;
const ZERO_SHA = '0'.repeat(40);

interface NormalizedSource {
  name: string;
  /**
   * Normalized child-tree prefix, or null when absent. Absent is NOT a
   * catch-all (fail-closed: no silent claim); pass an explicit empty
   * prefix to claim unmatched paths deliberately.
   */
  prefix: string | null;
  ref: string | null;
  license: string | null;
  tipSha: string | null;
}

interface NormalizedBlame {
  repoPath: string;
  sources: NormalizedSource[];
  timeoutMs: number;
  jobId: string | undefined;
}

/** Validate everything (including tip SHA shapes) before any spawn. */
function normalizeBlameOpts(
  repoPath: string,
  sources: BlameSource[],
  opts: BlameOpts
): Result<NormalizedBlame, StitchError> {
  if (repoPath.trim() === '') {
    return invalid('repoPath', 'buildBlameMap: repoPath is required');
  }
  const normalized: NormalizedSource[] = [];
  for (const source of sources) {
    if (source.name.trim() === '') {
      return invalid('sources', 'buildBlameMap: source names must not be blank');
    }
    const rawPrefix = source.prefix ?? null;
    const prefix = rawPrefix === null ? null : rawPrefix.replace(/^\/+|\/+$/g, '');
    if (source.tipSha !== undefined && !SHA_RE.test(source.tipSha)) {
      return invalid('sources', `buildBlameMap: tipSha for "${source.name}" must be a 40-hex SHA`);
    }
    normalized.push({
      name: source.name,
      prefix,
      ref: source.ref ?? null,
      license: source.license ?? null,
      tipSha: source.tipSha ?? null,
    });
  }
  const timeoutMs = opts.timeoutMs ?? DEFAULT_BLAME_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
    return invalid('timeoutMs', 'buildBlameMap: timeoutMs must be an integer >= 1');
  }
  return ok({ repoPath, sources: normalized, timeoutMs, jobId: opts.jobId });
}

/** Confirm repoPath is a git repo: CONFIG when it is not, GIT otherwise. */
async function ensureRepo(
  bound: BoundRuntime,
  repoPath: string,
  timeoutMs: number
): Promise<Result<void, StitchError>> {
  const gitDir = await runGit(
    bound,
    'blame rev-parse',
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
        message: `buildBlameMap: not a git repository ("${repoPath}")`,
      });
    }
    return err(gitDir.error);
  }
  return ok(undefined);
}

interface TrackedFile {
  path: string;
  blobSha: string;
}

const LS_FILES_RE = /^([0-9]+) ([0-9a-f]{40}) ([0-9]+)\t([\s\S]*)$/;

/** Tracked files + blob SHAs from one `ls-files -s -z` call. */
function parseLsFiles(output: Buffer): Result<TrackedFile[], StitchError> {
  const files: TrackedFile[] = [];
  const chunks = output
    .toString('utf8')
    .split('\0')
    .filter(part => part !== '');
  for (const chunk of chunks) {
    const match = LS_FILES_RE.exec(chunk);
    if (match?.[2] === undefined || match[4] === undefined) {
      return err(internalError('blame ls-files', `malformed entry ${JSON.stringify(chunk)}`));
    }
    files.push({ path: match[4], blobSha: match[2] });
  }
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return ok(files);
}

interface BlameBlock {
  sha: string | null;
  startLine: number;
  endLine: number;
  author: string;
  authorMail: string | null;
  authorTime: number | null;
}

const BLAME_HEADER_RE = /^([0-9a-f]{40}) ([0-9]+) ([0-9]+) ([0-9]+)$/;

function parseMail(value: string): string | null {
  const trimmed = value.trim();
  const angled = /^<([^<>]*)>$/.exec(trimmed);
  const mailbox = angled?.[1] ?? trimmed;
  return mailbox === '' ? null : mailbox;
}

function parseTime(value: string): number | null {
  const trimmed = value.trim();
  if (!/^[0-9]+$/.test(trimmed)) return null;
  const time = Number.parseInt(trimmed, 10);
  return Number.isSafeInteger(time) ? time : null;
}

/**
 * Parse `blame --line-porcelain` into line blocks (final-file line
 * numbers). Strict state machine: headers, known metadata keys, and
 * TAB-prefixed content only — anything else is INTERNAL, never silently
 * skipped. All-zero SHAs (uncommitted lines) become null.
 */
export function parseBlamePorcelain(
  output: string,
  path: string
): Result<BlameBlock[], StitchError> {
  const malformed = (detail: string): Result<BlameBlock[], StitchError> =>
    err(internalError('blame parse', `${detail} (file "${path}")`));
  const blocks: BlameBlock[] = [];
  const lines = output.split('\n');
  let index = 0;
  while (index < lines.length) {
    // Blank lines separate blocks (and may trail the output) — skip them
    // on every iteration, not just at the start.
    while (index < lines.length && (lines[index]?.trim() ?? '') === '') index += 1;
    if (index >= lines.length) break;
    const header = lines[index] ?? '';
    const match = BLAME_HEADER_RE.exec(header);
    if (match?.[1] === undefined || match[3] === undefined || match[4] === undefined) {
      return malformed(`malformed header ${JSON.stringify(header)}`);
    }
    const rawSha = match[1];
    const startLine = Number.parseInt(match[3], 10);
    const count = Number.parseInt(match[4], 10);
    if (!Number.isSafeInteger(startLine) || !Number.isSafeInteger(count) || count < 1) {
      return malformed(`bad line numbers in ${JSON.stringify(header)}`);
    }
    let author: string | null = null;
    let authorMail: string | null = null;
    let authorTime: number | null = null;
    let contents = 0;
    index += 1;
    while (index < lines.length) {
      const line = lines[index] ?? '';
      if (line.startsWith('\t')) {
        contents += 1;
        index += 1;
        if (contents === count) break;
        continue;
      }
      if (BLAME_HEADER_RE.test(line)) break;
      if (line.trim() === '') {
        index += 1;
        continue;
      }
      if (line.startsWith('author ')) author = line.slice('author '.length);
      else if (line.startsWith('author-mail '))
        authorMail = parseMail(line.slice('author-mail '.length));
      else if (line.startsWith('author-time '))
        authorTime = parseTime(line.slice('author-time '.length));
      index += 1;
    }
    if (contents !== count) {
      return malformed(`expected ${count} content lines, found ${contents}`);
    }
    if (author === null || author === '') {
      return malformed('missing author');
    }
    blocks.push({
      sha: rawSha === ZERO_SHA ? null : rawSha,
      startLine,
      endLine: startLine + count - 1,
      author,
      authorMail,
      authorTime,
    });
  }
  return ok(blocks);
}

/** `merge-base --is-ancestor`: 0 true, 1 false, unknown-object false, else error. */
async function isAncestor(
  bound: BoundRuntime,
  repoPath: string,
  sha: string,
  tipSha: string,
  timeoutMs: number
): Promise<Result<boolean, StitchError>> {
  let result: BlameRunResult;
  try {
    result = await bound.run(['merge-base', '--is-ancestor', sha, tipSha], repoPath, { timeoutMs });
  } catch (error) {
    return err(internalError('blame merge-base', error));
  }
  if (result.exitCode === 0) return ok(true);
  if (result.exitCode === 1) return ok(false);
  if (result.exitCode === 128 && /not a valid commit name/i.test(result.stderr)) {
    return ok(false);
  }
  return err(runFailure('blame merge-base', result, timeoutMs));
}

/** Longest-prefix match; explicit '' is the catch-all, absent never matches. */
function matchPrefix(sources: NormalizedSource[], path: string): NormalizedSource | null {
  let best: NormalizedSource | null = null;
  let bestLen = -1;
  for (const source of sources) {
    const prefix = source.prefix;
    if (prefix === null) continue;
    if (prefix === '') {
      if (best === null) {
        best = source;
        bestLen = -1;
      }
      continue;
    }
    if (path !== prefix && !path.startsWith(`${prefix}/`)) continue;
    if (prefix.length > bestLen) {
      best = source;
      bestLen = prefix.length;
    }
  }
  return best;
}

interface Attribution {
  sourceRepo: string | null;
  sourceRef: string | null;
  license: string | null;
}

/** Resolve one blamed SHA: unique ancestry wins, then prefix, then null. */
async function attributeSha(
  bound: BoundRuntime,
  repoPath: string,
  sources: NormalizedSource[],
  path: string,
  sha: string | null,
  cache: Map<string, NormalizedSource | null>,
  timeoutMs: number
): Promise<Result<Attribution, StitchError>> {
  // The ancestry verdict depends on the SHA alone and is cached; the
  // prefix fallback depends on the PATH and must run per file — caching
  // the resolved answer would poison other paths sharing the commit.
  const none: Attribution = { sourceRepo: null, sourceRef: null, license: null };
  const prefixed = matchPrefix(sources, path);
  const fallback: Attribution =
    prefixed === null
      ? none
      : { sourceRepo: prefixed.name, sourceRef: prefixed.ref, license: prefixed.license };
  if (sha === null) return ok(fallback);
  let unique = cache.get(sha);
  if (unique === undefined) {
    const tipped: Array<{ source: NormalizedSource; tip: string }> = [];
    for (const source of sources) {
      if (source.tipSha !== null) tipped.push({ source, tip: source.tipSha });
    }
    let matches = 0;
    let found: NormalizedSource | null = null;
    for (const { source, tip } of tipped) {
      const ancestor = await isAncestor(bound, repoPath, sha, tip, timeoutMs);
      if (ancestor.isErr()) return err(ancestor.error);
      if (ancestor.value) {
        matches += 1;
        found = source;
      }
    }
    unique = matches === 1 ? found : null;
    cache.set(sha, unique);
  }
  if (unique === null) return ok(fallback);
  return ok({ sourceRepo: unique.name, sourceRef: unique.ref, license: unique.license });
}

async function blameFile(
  bound: BoundRuntime,
  repoPath: string,
  sources: NormalizedSource[],
  file: TrackedFile,
  cache: Map<string, NormalizedSource | null>,
  timeoutMs: number
): Promise<Result<FileBlame, StitchError>> {
  const blamed = await runGit(
    bound,
    'blame',
    ['blame', '--line-porcelain', '--', file.path],
    repoPath,
    timeoutMs
  );
  if (blamed.isErr()) return err(blamed.error);
  const blocks = parseBlamePorcelain(blamed.value.toString('utf8'), file.path);
  if (blocks.isErr()) return err(blocks.error);
  const origins: LineOrigin[] = [];
  for (const block of blocks.value) {
    const attribution = await attributeSha(
      bound,
      repoPath,
      sources,
      file.path,
      block.sha,
      cache,
      timeoutMs
    );
    if (attribution.isErr()) return err(attribution.error);
    origins.push({
      startLine: block.startLine,
      endLine: block.endLine,
      sha: block.sha,
      author: block.author,
      authorMail: block.authorMail,
      authorTime: block.authorTime,
      sourceRepo: attribution.value.sourceRepo,
      sourceRef: attribution.value.sourceRef,
      license: attribution.value.license,
    });
  }
  return ok({ path: file.path, blobSha: file.blobSha, origins });
}

/**
 * Build the file → origin map for a child tree. Returns paths, blob SHAs,
 * and per-line-block origins with resolved sources.
 */
export async function buildBlameMap(
  repoPath: string,
  sources: BlameSource[],
  opts: BlameOpts = {},
  runtime?: BlameRuntime
): Promise<Result<BlameMap, StitchError>> {
  const normalized = normalizeBlameOpts(repoPath, sources, opts);
  if (normalized.isErr()) return err(normalized.error);
  const bound = bindRuntime(runtime);
  const options = normalized.value;
  const log = (options.jobId === undefined ? logger : createJobLogger(options.jobId)).child({
    op: 'blame',
    repoPath: options.repoPath,
  });

  const repo = await ensureRepo(bound, options.repoPath, options.timeoutMs);
  if (repo.isErr()) return err(repo.error);

  const listed = await runGit(
    bound,
    'blame ls-files',
    ['ls-files', '-s', '-z'],
    options.repoPath,
    options.timeoutMs
  );
  if (listed.isErr()) return err(listed.error);
  const files = parseLsFiles(listed.value);
  if (files.isErr()) return err(files.error);

  const blamed: FileBlame[] = [];
  const cache = new Map<string, NormalizedSource | null>();
  for (const file of files.value) {
    const entry = await blameFile(
      bound,
      options.repoPath,
      options.sources,
      file,
      cache,
      options.timeoutMs
    );
    if (entry.isErr()) return err(entry.error);
    blamed.push(entry.value);
  }
  log.debug({ files: blamed.length }, 'blame map built');
  return ok({ repoPath: options.repoPath, files: blamed });
}

interface StoredFilePayload {
  v: number;
  path: string;
  blobSha: string;
  origins: LineOrigin[];
}

function toStored(file: FileBlame): StoredFilePayload {
  return {
    v: BLAME_PAYLOAD_VERSION,
    path: file.path,
    blobSha: file.blobSha,
    origins: file.origins,
  };
}

function isLineOrigin(value: unknown): value is LineOrigin {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record['startLine'] === 'number' &&
    typeof record['endLine'] === 'number' &&
    (typeof record['sha'] === 'string' || record['sha'] === null) &&
    typeof record['author'] === 'string' &&
    (typeof record['authorMail'] === 'string' || record['authorMail'] === null) &&
    (typeof record['authorTime'] === 'number' || record['authorTime'] === null) &&
    (typeof record['sourceRepo'] === 'string' || record['sourceRepo'] === null) &&
    (typeof record['sourceRef'] === 'string' || record['sourceRef'] === null) &&
    (typeof record['license'] === 'string' || record['license'] === null)
  );
}

function fromStored(payload: unknown): FileBlame | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const record = payload as { path?: unknown; blobSha?: unknown; origins?: unknown };
  if (typeof record.path !== 'string' || typeof record.blobSha !== 'string') return null;
  if (!Array.isArray(record.origins) || !record.origins.every(isLineOrigin)) return null;
  return { path: record.path, blobSha: record.blobSha, origins: record.origins };
}

/**
 * Persist a whole map to the P-030 `provenance` table (replace-whole-map
 * per repo, one row per file keyed by blob SHA). Accepts the structural
 * `DbLike` surface: production passes the opened StitchDb, P-181 refines.
 */
export async function saveBlameMap(db: DbLike, map: BlameMap): Promise<Result<void, StitchError>> {
  const deleted = dbRun(db, 'DELETE FROM provenance WHERE repo = ?', map.repoPath);
  if (deleted.isErr()) return err(deleted.error);
  const ordered = [...map.files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  for (const file of ordered) {
    const stored = dbRun(
      db,
      'INSERT INTO provenance (repo, commit_sha, payload) VALUES (?, ?, ?)',
      map.repoPath,
      file.blobSha,
      JSON.stringify(toStored(file)) as SQLiteValue
    );
    if (stored.isErr()) return err(stored.error);
  }
  return ok(undefined);
}

/** Load a persisted map (files sorted by path for stable exports). */
export async function loadBlameMap(
  db: DbLike,
  repoPath: string
): Promise<Result<BlameMap, StitchError>> {
  const selected = dbAll(db, 'SELECT payload FROM provenance WHERE repo = ?', repoPath);
  if (selected.isErr()) return err(selected.error);
  const files: FileBlame[] = [];
  for (const row of selected.value) {
    const raw = row['payload'];
    if (typeof raw !== 'string') {
      return err(internalError('blame load', `non-string payload for repo "${repoPath}"`));
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch (cause: unknown) {
      return err(internalError('blame load', cause));
    }
    const file = fromStored(parsed);
    if (file === null) {
      return err(internalError('blame load', `malformed payload for repo "${repoPath}"`));
    }
    files.push(file);
  }
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return ok({ repoPath, files });
}
