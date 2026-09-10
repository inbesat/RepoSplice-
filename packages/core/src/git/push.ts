// Push to remote (P-078): push the merged child branch to its remote,
// creating the repo via the GitHub API when missing and gated. Flow:
// validate all args (force/protected guards pre-spawn) -> rev-parse repo
// -> check-ref-format branch -> resolve local SHA -> probe remote SHA
// (ls-remote) -> skip when equal -> ensure remote repo exists (GitHub
// API check + P-092 creator port) -> push (lease-guarded when forcing)
// -> verify the remote shows the local SHA.
//
// Verified behavior (real git 2.47 on this box — do not assume otherwise):
// - `ls-remote <url> <ref>` prints `<sha>\t<ref>\n` per match, empty when
//   the ref is absent, exit 128 ("does not appear to be a git repository")
//   for bogus remotes. New-branch pushes land; re-pushes are silent
//   no-ops (equal SHAs skip before spawning push).
// - Diverged pushes exit 1 with "[rejected] ... (fetch first)" /
//   "(non-fast-forward)": the SERVER is the fast-forward authority. No
//   client-side ancestry check is attempted — `merge-base --is-ancestor`
//   cannot even see unfetched remote SHAs ("Not a valid commit name"), and
//   any check would be TOCTOU-advisory anyway. Force travels as
//   `--force-with-lease=<ref>:<observed-sha>` (atomic server-side guard;
//   up-to-date pushes short-circuit before the lease matters).
// - `check-ref-format --branch <name>` exits 128 ("not a valid branch
//   name") for spaces, `..`, trailing dots, `~^:` etc.; exit 0 echoes the
//   name when valid. `rev-parse --verify refs/heads/<branch>` exits 128
//   ("Needed a single revision") when the local branch is absent.
// - `-c http.extraHeader=...` works for ls-remote/push transport.
//
// Security design (P-069 pattern, SECRETS.md):
// - Credentials NEVER go in the URL. They travel as `-c
//   http.extraHeader=Authorization: Basic <base64>`; the KNOWN header is
//   scrubbed from every failure message by exact match, and user-embedded
//   `user:pass@` URLs are redacted for display. Logs bind only the
//   redacted URL; the credentials object is never logged.
// - Force pushes require explicit `allowForce` (the P-160/296 gate passes
//   it); force to a protected branch refuses regardless. Default
//   protected set is main/master until P-093 supplies the live set.
//
// Safety contract:
// - Validation (blank args, bad timeout, force-without-allowForce,
//   force-to-protected) returns CONFIG_ERROR BEFORE any spawn.
// - Missing remote repo + `createIfMissing` unset refuses CONFIG;
//   `createIfMissing` on non-GitHub remotes refuses CONFIG (P-092 only
//   creates GitHub repos); set without a creator port refuses CONFIG.
//   Creator errors (RBAC deny lives there, P-293) pass through unchanged.
// - Post-push ls-remote must show the local SHA or the push reports
//   INTERNAL (ref moved under us).
// - The runner returns exit codes as data (P-075 pattern: 124 = timeout
//   sentinel); every rejection -> INTERNAL; no new StitchError codes
//   (P-203 owns future taxonomy).
//
// Seams and future phases:
// - PushRuntime.run is the only process seam (execFile default).
// - RemoteRepoCheck/ReproCreator are the narrow ports P-092 implements
//   (existence probe + creation with its own RBAC/scope gates, P-088/293);
//   until then GitHub creation defers through them. P-093 supplies live
//   branch protection; P-206 owns the credential config load; P-243 owns
//   `createIfMissing` config (today an explicit opt). P-094 opens the PR
//   on the pushed branch; P-192 drives this for child C.

import { Buffer } from 'node:buffer';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ok, err, type Result } from 'neverthrow';
import type { StitchError } from '../result/index.js';
import { logger, createJobLogger } from '../logger/index.js';
import { redactUrlCredentials, type CloneCredentials } from './clone.js';

/** Silence timeout (ms): network op, clone parity (P-069). */
export const DEFAULT_PUSH_TIMEOUT_MS = 120_000;

/** Exec timeout sentinel: Node kills the child (SIGTERM/ETIMEDOUT). */
const TIMEOUT_EXIT_CODE = 124;

/** Protected by default until P-093 supplies the live protection set. */
export const DEFAULT_PROTECTED_BRANCHES: readonly string[] = ['main', 'master'];

/** Existence probe for a GitHub remote repo (P-092 implements via API). */
export interface RemoteRepoCheck {
  (owner: string, repo: string): Promise<Result<boolean, StitchError>>;
}

/** GitHub repo creation (P-092 implements with RBAC/scope gates). */
export interface RepoCreator {
  (input: { owner: string; repo: string }): Promise<Result<{ fullName: string }, StitchError>>;
}

export interface PushOpts {
  /** PAT/basic auth: travels via header, never the URL (P-069 pattern). */
  credentials?: CloneCredentials;
  /** Request a force update. Requires allowForce; never default. */
  force?: boolean;
  /** Explicit authorization for force (the P-160/296 gate passes this). */
  allowForce?: boolean;
  /** Branches force never touches. Default: main/master (P-093 pending). */
  protectedBranches?: readonly string[];
  /** Create a missing GitHub repo via repoCreator. Default: false. */
  createIfMissing?: boolean;
  /** P-092 creator port. Required when createIfMissing is set. */
  repoCreator?: RepoCreator;
  /** Existence probe port. Absent: the check is skipped. */
  repoExists?: RemoteRepoCheck;
  /** Silence timeout ms for git processes. Default: 120_000. */
  timeoutMs?: number;
  /** Job id for structured logs. */
  jobId?: string;
}

/** Process result as data: exit codes are signals, never rejections. */
export interface PushRunResult {
  exitCode: number;
  stdout: Buffer;
  stderr: string;
}

export interface PushRunner {
  (args: readonly string[], cwd: string, opts: { timeoutMs: number }): Promise<PushRunResult>;
}

export interface PushRuntime {
  run?: PushRunner;
}

const execFileAsync = promisify(execFile);

/** Default runner: real git via PATH, killed after timeoutMs of silence. */
async function defaultRun(
  args: readonly string[],
  cwd: string,
  opts: { timeoutMs: number }
): Promise<PushRunResult> {
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
  result: PushRunResult,
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
  run: PushRunner;
}

function bindRuntime(runtime: PushRuntime | undefined): BoundRuntime {
  return { run: runtime?.run ?? defaultRun };
}

/** Build the `-c http.extraHeader=...` value, or undefined without creds. */
function authHeader(credentials: CloneCredentials | undefined): string | undefined {
  if (credentials === undefined) return undefined;
  const basic = Buffer.from(`${credentials.username}:${credentials.password}`, 'utf8').toString(
    'base64'
  );
  return `http.extraHeader=Authorization: Basic ${basic}`;
}

/** Strip the KNOWN header and embedded URL creds from failure text. */
function scrubSecrets(text: string, header: string | undefined): string {
  const withoutHeader = header === undefined ? text : text.split(header).join('***');
  return redactUrlCredentials(withoutHeader);
}

/** Run git with the auth header prepended, scrubbing failures on the way out. */
async function runGit(
  bound: BoundRuntime,
  op: string,
  args: readonly string[],
  cwd: string,
  timeoutMs: number,
  header: string | undefined,
  redactedUrl: string
): Promise<Result<Buffer, StitchError>> {
  const fullArgs = header === undefined ? [...args] : ['-c', header, ...args];
  let result: PushRunResult;
  try {
    result = await bound.run(fullArgs, cwd, { timeoutMs });
  } catch (error) {
    return err(internalError(`${op} (${redactedUrl})`, error));
  }
  if (result.exitCode === 0) return ok(result.stdout);
  const failure = runFailure(`${op} (${redactedUrl})`, result, timeoutMs);
  return err({
    code: failure.code,
    message: scrubSecrets(failure.message, header),
    gitOutput: scrubSecrets(failure.gitOutput, header),
  });
}

export interface GitHubRemote {
  owner: string;
  repo: string;
}

/**
 * Split a GitHub remote URL into owner/repo. Accepts https (with or
 * without embedded creds or `.git`), scp (`git@github.com:o/r`), and
 * ssh forms. Anything else (local paths, file://, other hosts) is null —
 * pure git push still works, API steps are skipped.
 */
export function parseGitHubRemote(remoteUrl: string): GitHubRemote | null {
  const trimmed = remoteUrl.trim();
  const scp = /^git@github\.com:([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i.exec(trimmed);
  if (scp?.[1] !== undefined && scp[2] !== undefined) {
    return { owner: scp[1], repo: scp[2] };
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.hostname.toLowerCase() !== 'github.com') return null;
  const segments = parsed.pathname.split('/').filter(segment => segment !== '');
  if (segments.length !== 2 || segments[0] === undefined || segments[1] === undefined) return null;
  return { owner: segments[0], repo: segments[1].replace(/\.git$/, '') };
}

const SHA_RE = /^[0-9a-f]{40}$/;

interface NormalizedPush {
  repoPath: string;
  remoteUrl: string;
  redactedUrl: string;
  branch: string;
  ref: string;
  credentials: CloneCredentials | undefined;
  force: boolean;
  protectedBranches: readonly string[];
  createIfMissing: boolean;
  repoCreator: RepoCreator | undefined;
  repoExists: RemoteRepoCheck | undefined;
  timeoutMs: number;
  jobId: string | undefined;
}

/** Validate args + force guards before any spawn. */
function normalizePushOpts(
  repoPath: string,
  remoteUrl: string,
  branch: string,
  opts: PushOpts
): Result<NormalizedPush, StitchError> {
  if (repoPath.trim() === '') {
    return invalid('repoPath', 'pushToRemote: repoPath is required');
  }
  if (remoteUrl.trim() === '') {
    return invalid('remoteUrl', 'pushToRemote: remoteUrl is required');
  }
  if (branch.trim() === '') {
    return invalid('branch', 'pushToRemote: branch is required');
  }
  const force = opts.force ?? false;
  if (force && opts.allowForce !== true) {
    return invalid('force', 'pushToRemote: force push requires explicit allowForce authorization');
  }
  const protectedBranches = opts.protectedBranches ?? DEFAULT_PROTECTED_BRANCHES;
  if (force && protectedBranches.includes(branch)) {
    return invalid('branch', `pushToRemote: refusing force push to protected branch "${branch}"`);
  }
  const timeoutMs = opts.timeoutMs ?? DEFAULT_PUSH_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
    return invalid('timeoutMs', 'pushToRemote: timeoutMs must be an integer >= 1');
  }
  return ok({
    repoPath,
    remoteUrl,
    redactedUrl: redactUrlCredentials(remoteUrl),
    branch,
    ref: `refs/heads/${branch}`,
    credentials: opts.credentials,
    force,
    protectedBranches,
    createIfMissing: opts.createIfMissing ?? false,
    repoCreator: opts.repoCreator,
    repoExists: opts.repoExists,
    timeoutMs,
    jobId: opts.jobId,
  });
}

/** Confirm repoPath is a git repo: CONFIG when it is not, GIT otherwise. */
async function ensureRepo(
  bound: BoundRuntime,
  repoPath: string,
  redactedUrl: string,
  timeoutMs: number,
  header: string | undefined
): Promise<Result<void, StitchError>> {
  const gitDir = await runGit(
    bound,
    'push rev-parse',
    ['rev-parse', '--git-dir'],
    repoPath,
    timeoutMs,
    header,
    redactedUrl
  );
  if (gitDir.isErr()) {
    const message = gitDir.error.code === 'GIT_ERROR' ? gitDir.error.message : '';
    if (/not a git repository/i.test(message)) {
      return err({
        code: 'CONFIG_ERROR',
        field: 'repoPath',
        message: `pushToRemote: not a git repository ("${repoPath}")`,
      });
    }
    return err(gitDir.error);
  }
  return ok(undefined);
}

/** Resolve the local branch SHA (CONFIG when the branch does not exist). */
async function localBranchSha(
  bound: BoundRuntime,
  normalized: NormalizedPush,
  header: string | undefined
): Promise<Result<string, StitchError>> {
  const { repoPath, branch, ref, redactedUrl, timeoutMs } = normalized;
  const out = await runGit(
    bound,
    'push rev-parse branch',
    ['rev-parse', '--verify', ref],
    repoPath,
    timeoutMs,
    header,
    redactedUrl
  );
  if (out.isErr()) {
    const message = out.error.code === 'GIT_ERROR' ? out.error.message : '';
    if (/needed a single revision|unknown revision|bad revision/i.test(message)) {
      return err({
        code: 'CONFIG_ERROR',
        field: 'branch',
        message: `pushToRemote: no such local branch ("${branch}")`,
      });
    }
    return err(out.error);
  }
  const sha = out.value.toString('utf8').trim();
  if (!SHA_RE.test(sha)) {
    return err(internalError('push rev-parse branch', `malformed SHA ${JSON.stringify(sha)}`));
  }
  return ok(sha);
}

/** Probe the remote branch SHA (`ls-remote`); null when the branch is absent. */
async function remoteBranchSha(
  bound: BoundRuntime,
  normalized: NormalizedPush,
  header: string | undefined
): Promise<Result<string | null, StitchError>> {
  const { repoPath, remoteUrl, ref, redactedUrl, timeoutMs } = normalized;
  const out = await runGit(
    bound,
    'push ls-remote',
    ['ls-remote', remoteUrl, ref],
    repoPath,
    timeoutMs,
    header,
    redactedUrl
  );
  if (out.isErr()) return err(out.error);
  const text = out.value.toString('utf8').trim();
  if (text === '') return ok(null);
  for (const line of text.split('\n')) {
    const tab = line.indexOf('\t');
    if (tab === -1) {
      return err(internalError('push ls-remote', `malformed line ${JSON.stringify(line)}`));
    }
    if (line.slice(tab + 1).trim() === ref) {
      const sha = line.slice(0, tab).trim();
      if (!SHA_RE.test(sha)) {
        return err(internalError('push ls-remote', `malformed SHA ${JSON.stringify(sha)}`));
      }
      return ok(sha);
    }
  }
  return ok(null);
}

/** GitHub repo existence + gated creation (P-092 owns the creation body). */
async function ensureRemoteRepo(
  normalized: NormalizedPush,
  remoteSha: string | null
): Promise<Result<void, StitchError>> {
  // The branch exists remotely, so the repo does too — nothing to ensure.
  if (remoteSha !== null) return ok(undefined);
  const parsed = parseGitHubRemote(normalized.remoteUrl);
  if (parsed === null) {
    if (normalized.createIfMissing) {
      return err({
        code: 'CONFIG_ERROR',
        field: 'createIfMissing',
        message: 'pushToRemote: createIfMissing supports GitHub remotes only',
      });
    }
    // Local paths and other hosts: push decides (a missing remote fails
    // there with its own typed error).
    return ok(undefined);
  }
  // An absent branch on GitHub is usually a NEW branch on an existing repo,
  // not a missing repo — without the existence port the two are
  // indistinguishable, so the push itself is the probe.
  if (normalized.repoExists === undefined) {
    if (normalized.createIfMissing) {
      return err({
        code: 'CONFIG_ERROR',
        field: 'createIfMissing',
        message: 'pushToRemote: createIfMissing requires a repoExists check (P-092 pending)',
      });
    }
    return ok(undefined);
  }
  let exists: Result<boolean, StitchError>;
  try {
    exists = await normalized.repoExists(parsed.owner, parsed.repo);
  } catch (error) {
    return err(internalError('push repo exists check', error));
  }
  if (exists.isErr()) return err(exists.error);
  if (exists.value) return ok(undefined);
  if (!normalized.createIfMissing) {
    return err({
      code: 'CONFIG_ERROR',
      field: 'createIfMissing',
      message: `pushToRemote: remote repository does not exist ("${parsed.owner}/${parsed.repo}"); set createIfMissing to create it`,
    });
  }
  if (normalized.repoCreator === undefined) {
    return err({
      code: 'CONFIG_ERROR',
      field: 'repoCreator',
      message: 'pushToRemote: createIfMissing requires a repoCreator (P-092 pending)',
    });
  }
  let created: Result<{ fullName: string }, StitchError>;
  try {
    created = await normalized.repoCreator({ owner: parsed.owner, repo: parsed.repo });
  } catch (error) {
    return err(internalError('push create repo', error));
  }
  if (created.isErr()) return err(created.error);
  return ok(undefined);
}

/** Push, with lease-guarded force; divergent refusals hint at allowForce. */
async function runPush(
  bound: BoundRuntime,
  normalized: NormalizedPush,
  header: string | undefined,
  remoteSha: string | null
): Promise<Result<void, StitchError>> {
  const { repoPath, remoteUrl, ref, redactedUrl, timeoutMs, force } = normalized;
  const args =
    force && remoteSha !== null
      ? ['push', `--force-with-lease=${ref}:${remoteSha}`, remoteUrl, `${ref}:${ref}`]
      : ['push', remoteUrl, `${ref}:${ref}`];
  const pushed = await runGit(bound, 'push', args, repoPath, timeoutMs, header, redactedUrl);
  if (pushed.isErr()) {
    if (pushed.error.code !== 'GIT_ERROR') return err(pushed.error);
    const text = `${pushed.error.message} ${pushed.error.gitOutput}`;
    if (/non-fast-forward|fetch first|behind.*remote|\[rejected\]/i.test(text)) {
      return err({
        code: 'GIT_ERROR',
        message: `${pushed.error.message} (remote diverged: set allowForce to overwrite, subject to the protected-branch guard)`,
        ...(pushed.error.gitOutput !== undefined ? { gitOutput: pushed.error.gitOutput } : {}),
      });
    }
    return err(pushed.error);
  }
  return ok(undefined);
}

/**
 * Push a local branch to a remote. Skips when the SHAs already match;
 * verifies the remote shows the local SHA afterwards. Resolves void.
 */
export async function pushToRemote(
  repoPath: string,
  remoteUrl: string,
  branch: string,
  opts: PushOpts = {},
  runtime?: PushRuntime
): Promise<Result<void, StitchError>> {
  const normalized = normalizePushOpts(repoPath, remoteUrl, branch, opts);
  if (normalized.isErr()) return err(normalized.error);
  const bound = bindRuntime(runtime);
  const options = normalized.value;
  const log = (options.jobId === undefined ? logger : createJobLogger(options.jobId)).child({
    op: 'push',
    repoPath: options.repoPath,
    remote: options.redactedUrl,
    branch: options.branch,
  });
  const header = authHeader(options.credentials);

  const repo = await ensureRepo(
    bound,
    options.repoPath,
    options.redactedUrl,
    options.timeoutMs,
    header
  );
  if (repo.isErr()) return err(repo.error);

  const format = await runGit(
    bound,
    'push check-ref-format',
    ['check-ref-format', '--branch', options.branch],
    options.repoPath,
    options.timeoutMs,
    header,
    options.redactedUrl
  );
  if (format.isErr()) {
    const message = format.error.code === 'GIT_ERROR' ? format.error.message : '';
    if (/not a valid branch name/i.test(message)) {
      return err({
        code: 'CONFIG_ERROR',
        field: 'branch',
        message: `pushToRemote: invalid branch name ("${options.branch}")`,
      });
    }
    return err(format.error);
  }

  const local = await localBranchSha(bound, options, header);
  if (local.isErr()) return err(local.error);

  const remote = await remoteBranchSha(bound, options, header);
  if (remote.isErr()) return err(remote.error);
  if (remote.value !== null && remote.value === local.value) {
    log.debug('push skipped: remote already up to date');
    return ok(undefined);
  }

  const ensured = await ensureRemoteRepo(options, remote.value);
  if (ensured.isErr()) return err(ensured.error);

  const pushed = await runPush(bound, options, header, remote.value);
  if (pushed.isErr()) return err(pushed.error);

  const verify = await remoteBranchSha(bound, options, header);
  if (verify.isErr()) return err(verify.error);
  if (verify.value !== local.value) {
    return err(
      internalError(
        'push verify',
        `remote shows ${JSON.stringify(verify.value)} after push, expected ${local.value}`
      )
    );
  }
  log.debug('push complete');
  return ok(undefined);
}
