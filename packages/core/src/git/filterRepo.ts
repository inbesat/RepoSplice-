import { ok, err, type Result } from 'neverthrow';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { StitchError } from '../result/index.js';
import { logger, createJobLogger } from '../logger/index.js';

/**
 * git-filter-repo presence probe (P-066). filter-repo is the engine behind
 * path extraction/history rewrite (P-070); `stitch doctor` (P-068) calls
 * `checkFilterRepoStatus` with its own process runner.
 *
 * Deliberately NO minimum-version constant (unlike `MIN_GIT_VERSION`):
 * upstream `git-filter-repo --version` reports its own revision hash
 * (verified: 2.47.0 prints `a40bce548d2c`), not semver, so there is nothing
 * sound to compare. The raw string is carried through opaquely for display;
 * presence is the gate. If upstream ever ships comparable versions, add the
 * floor then — with a real sample, not a guess.
 */
export interface FilterRepoStatus {
  available: boolean;
  /** Raw `--version` output (opaque revision), or null when unknown. */
  version: string | null;
  /** Install hint, set only when the binary is missing. */
  fix?: string;
}

const INSTALL_HINT = 'pip install git-filter-repo, then add the Python Scripts directory to PATH';

/**
 * Probe for the `git-filter-repo` binary via an injected runner (same seam
 * as `localGitVersion`: pass `(args) => execFile('git-filter-repo', args)`).
 * Never throws and never reports a missing binary as an error — absence is
 * a normal, doctor-hintable state, so it comes back as data.
 */
export async function checkFilterRepoStatus(
  run: (args: readonly string[]) => Promise<string>
): Promise<Result<FilterRepoStatus, StitchError>> {
  let output: string;
  try {
    output = await run(['--version']);
  } catch {
    return ok({ available: false, version: null, fix: INSTALL_HINT });
  }
  const version = output.trim();
  return ok({ available: true, version: version === '' ? null : version });
}

const execFileAsync = promisify(execFile);

/** Default silence timeout (ms): history rewrites are slower than clones. */
export const DEFAULT_FILTER_REPO_TIMEOUT_MS = 300_000;

/** filter-repo process output (success path). */
export interface FilterRepoOutput {
  stdout: string;
  stderr: string;
}

/**
 * Runner seam: invoke the `git-filter-repo` binary with an explicit cwd
 * (never the ambient process cwd — P-070 incident: an implicit-cwd probe
 * rewrote the project repo itself). Rejects on failure, execFile-style.
 */
export interface FilterRepoRunner {
  (args: readonly string[], cwd: string, opts: { timeoutMs: number }): Promise<FilterRepoOutput>;
}

/** Default runner: real binary via PATH, killed after timeoutMs of silence. */
async function defaultFilterRepoRun(
  args: readonly string[],
  cwd: string,
  opts: { timeoutMs: number }
): Promise<FilterRepoOutput> {
  const { stdout, stderr } = await execFileAsync('git-filter-repo', [...args], {
    cwd,
    timeout: opts.timeoutMs,
  });
  return { stdout, stderr };
}

/** Default git runner for post-condition checks (explicit cwd, trimmed). */
async function defaultGitRun(args: readonly string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('git', [...args], { cwd });
  return stdout.trim();
}

export interface FilterRepoOptions {
  /** Repo to rewrite in place (a fresh clone — filter-repo drops remotes). */
  repoPath: string;
  /** Repo-relative posix paths to keep (union of `--path` flags). */
  paths: string[];
  /** Prefix the kept tree moves under (`--to-subdirectory-filter`). */
  targetSubdir: string;
  /** Tag prefix (`--tag-rename :<prefix>`). Default: `${subdir}-`. */
  tagPrefix?: string;
  /** Silence timeout ms for the rewrite. Default: 300_000. */
  timeoutMs?: number;
  /** Job id for structured logs. */
  jobId?: string;
}

/** Runtime seams: the rewrite runner plus git for post-checks. */
export interface FilterRepoRuntime {
  filterRepo?: FilterRepoRunner;
  git?: (args: readonly string[], cwd: string) => Promise<string>;
}

interface NormalizedFilterRepoOptions {
  repoPath: string;
  paths: string[];
  subdir: string;
  tagPrefix: string;
  timeoutMs: number;
}

/** Repo-relative posix subpath: non-blank, no absolute, no traversal. */
function isSafeSubpath(p: string): boolean {
  if (p.trim() === '') return false;
  if (p.startsWith('/')) return false;
  if (/^[A-Za-z]:[\\/]/.test(p)) return false;
  if (p.includes('\\')) return false;
  if (p.split('/').includes('..')) return false;
  return true;
}

function invalid(field: string, message: string): Result<NormalizedFilterRepoOptions, StitchError> {
  return err({ code: 'CONFIG_ERROR', field, message });
}

/** Validate everything before touching the repo (rewrite is destructive). */
function validateFilterRepoOptions(
  opts: FilterRepoOptions
): Result<NormalizedFilterRepoOptions, StitchError> {
  if (opts.repoPath.trim() === '') {
    return invalid('repoPath', 'extractPathsViaFilterRepo: repoPath is required');
  }
  if (opts.paths.length === 0) {
    return invalid('paths', 'extractPathsViaFilterRepo: paths must name at least one path');
  }
  for (const p of opts.paths) {
    if (!isSafeSubpath(p)) {
      return invalid(
        'paths',
        `extractPathsViaFilterRepo: rejecting unsafe path ${JSON.stringify(p)} ` +
          '(repo-relative forward-slash paths only, no absolute, no .. traversals)'
      );
    }
  }
  const subdir = opts.targetSubdir.replace(/\/+$/, '');
  if (!isSafeSubpath(subdir)) {
    return invalid(
      'targetSubdir',
      `extractPathsViaFilterRepo: rejecting unsafe targetSubdir ${JSON.stringify(opts.targetSubdir)}`
    );
  }
  if (opts.tagPrefix !== undefined && opts.tagPrefix.trim() === '') {
    return invalid('tagPrefix', 'extractPathsViaFilterRepo: tagPrefix must not be blank');
  }
  const timeoutMs = opts.timeoutMs ?? DEFAULT_FILTER_REPO_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
    return invalid(
      'timeoutMs',
      `extractPathsViaFilterRepo: timeoutMs must be an integer >= 1, got ${String(opts.timeoutMs)}`
    );
  }
  return ok({
    repoPath: opts.repoPath,
    paths: [...opts.paths],
    subdir,
    tagPrefix: opts.tagPrefix ?? `${subdir}-`,
    timeoutMs,
  });
}

function causeDetail(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** Spawn error code without tripping union narrowing (P-068 lesson). */
function spawnCode(cause: unknown): unknown {
  if (cause instanceof Error) return (cause as { code?: unknown }).code;
  return undefined;
}

/** True when the failure means "binary not installed" (hint, don't dump). */
function isMissingBinary(cause: unknown): boolean {
  if (spawnCode(cause) === 'ENOENT') return true;
  return causeDetail(cause).includes('ENOENT');
}

function causeStderr(cause: unknown): string {
  if (cause instanceof Error) {
    const stderr: unknown = (cause as { stderr?: unknown }).stderr;
    if (typeof stderr === 'string' && stderr.trim() !== '') return `\n${stderr.trim()}`;
  }
  return '';
}

/**
 * Extract paths from a cloned repo, rewriting history (P-070). Keeps only
 * commits touching `paths`, moves the kept tree under `targetSubdir/`,
 * and renames tags with `tagPrefix` (`:prefix` = prepend-all, verified
 * against upstream --help). Returns ok(repoPath).
 *
 * Verified behavior (real 2.47.0 binary, P-070 probes — do not assume
 * otherwise):
 * - Works on shallow clones too (no refusal); full clones keep full
 *   per-path history either way.
 * - An unmatched --path exits 0 and EMPTIES the repo: the post-condition
 *   check below turns that into GIT_ERROR instead of a silent wipe.
 * - The origin remote is REMOVED by the rewrite: callers (P-072) must
 *   re-add remotes before pushing anywhere.
 * - Authors/dates survive on kept commits (blame-verified).
 */
export async function extractPathsViaFilterRepo(
  opts: FilterRepoOptions,
  runtime: FilterRepoRuntime = {}
): Promise<Result<string, StitchError>> {
  const normalized = validateFilterRepoOptions(opts);
  if (normalized.isErr()) return err(normalized.error);
  const { repoPath, paths, subdir, tagPrefix, timeoutMs } = normalized.value;
  const log = (opts.jobId === undefined ? logger : createJobLogger(opts.jobId)).child({
    op: 'filter-repo',
    repoPath,
    targetSubdir: subdir,
  });

  // Deterministic order: force, paths, subdir, tag rename (asserted).
  const args: string[] = ['--force'];
  for (const p of paths) args.push('--path', p);
  args.push('--to-subdirectory-filter', subdir, '--tag-rename', `:${tagPrefix}`);

  const run = runtime.filterRepo ?? defaultFilterRepoRun;
  const git = runtime.git ?? defaultGitRun;
  log.info({ paths, tagPrefix }, 'Running git filter-repo');
  try {
    await run(args, repoPath, { timeoutMs });
  } catch (cause: unknown) {
    if (isMissingBinary(cause)) {
      const detail = 'git-filter-repo binary not found on PATH';
      log.error({ err: detail }, 'filter-repo failed');
      return err({ code: 'GIT_ERROR', message: `${detail}: ${INSTALL_HINT}`, gitOutput: detail });
    }
    const detail = `${causeDetail(cause)}${causeStderr(cause)}`;
    log.error({ err: detail }, 'filter-repo failed');
    return err({ code: 'GIT_ERROR', message: `filter-repo failed: ${detail}`, gitOutput: detail });
  }

  let remaining: string;
  try {
    remaining = await git(['rev-list', '--count', 'HEAD'], repoPath);
  } catch (cause: unknown) {
    const detail = causeDetail(cause);
    log.error({ err: detail }, 'filter-repo left no verifiable history');
    return err({
      code: 'GIT_ERROR',
      message: `filter-repo left no commits (paths matched nothing?): ${detail}`,
      gitOutput: detail,
    });
  }
  if (remaining.trim() === '' || remaining.trim() === '0') {
    const detail = `rev-list count is ${JSON.stringify(remaining.trim())}`;
    log.error({ err: detail }, 'filter-repo left no verifiable history');
    return err({
      code: 'GIT_ERROR',
      message: `filter-repo left no commits (paths matched nothing?): ${detail}`,
      gitOutput: detail,
    });
  }
  log.info({ commits: remaining.trim() }, 'filter-repo complete');
  return ok(repoPath);
}
