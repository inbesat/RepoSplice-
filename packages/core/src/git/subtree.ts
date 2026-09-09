// Git subtree add (P-073): the filter-repo alternative for bringing a whole
// child repo under a prefix with history preserved naturally (or squashed).
// Selected by config/strategy (P-243: `git.strategy`) via
// selectExtractStrategy below; the orchestrator (P-238) will call it through
// a MergeRuntime.extract adapter.
//
// Verified behavior (real git-subtree on this box — do not assume
// otherwise):
// - `git subtree add --prefix=<p> <repo> <ref>` merges the child's history
//   verbatim plus `Add '<p>/' from commit '<tip>'` (prefix + tip only, no
//   machine paths — deterministic and provenance-rich, P-079).
// - `--squash` yields two commits (`Squashed '<p>/' content…` + `Merge
//   commit … as '<p>'`); child messages are absent.
// - Re-adding a prefix fails inside git (`fatal: prefix 'x' already
//   exists.`); the fs preflight below fails earlier with CONFIG_ERROR, and
//   the git error maps to GIT_ERROR if ever raced.
// - `git -c k=v` pairs BEFORE the subcommand work through simple-git's raw
//   array form; identity + gpgsign flags are passed, but deliberately NO
//   core.autocrlf override: on a repo committed under ambient autocrlf,
//   flipping it makes git-subtree's own clean-tree check fail ("working
//   tree has modifications. Cannot add."). The user's line-ending config
//   rules; tests set repo-local autocrlf=false on their own fixtures.
// - `ls-remote --symref <repo> HEAD` prints `ref: refs/heads/<b>\tHEAD`;
//   `ls-remote <repo> <branch>` prints `<sha>\trefs/heads/<b>`; unknown
//   branch exits 0 with EMPTY output (CONFIG_ERROR, not GIT_ERROR);
//   unreachable repo exits 128 (GIT_ERROR).
//
// Safety contract (destructive-op discipline, P-070 rule):
// - The git client is bound to parentRepo (explicit cwd, never ambient).
// - Preflight order is cheap-first: pure validation -> parent exists ->
//   parent is a repo -> prefix free (all local) -> ls-remote (network).
//   The existing-prefix refusal fires with ZERO git calls.
// - Secrets: childRepo URLs stay out of messages; failures are scrubbed
//   with redactUrlCredentials (user:pass@ can never surface), mirroring
//   clone.ts (P-069). No credentials are plumbed (same limitation as
//   mergeRepos, P-072).
// - Every git rejection maps to a typed StitchError (never a throw); no
//   new codes (P-203 owns future taxonomy).
//
// Seams and future phases:
// - SubtreeRuntime.createGit is the only seam (P-016 factory by default).
// - P-238 consumes selectExtractStrategy + subtreeAdd; P-243 supplies the
//   `prefer` value from `git.strategy`.

import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { ok, err, type Result } from 'neverthrow';
import type { Logger } from 'pino';
import type { StitchError } from '../result/index.js';
import { createGit, type GitFactoryOptions } from './factory.js';
import { redactUrlCredentials } from './clone.js';
import { logger, createJobLogger } from '../logger/index.js';

/** Silence timeout (ms): subtree add fetches + merges, like filter-repo. */
export const DEFAULT_SUBTREE_TIMEOUT_MS = 300_000;

/** Fixed commit identity (P-077 owns commit policy; this is the floor). */
export const SUBTREE_AUTHOR_NAME = 'repo-stitcher';
export const SUBTREE_AUTHOR_EMAIL = 'repo-stitcher@localhost';

export interface SubtreeOpts {
  /** Child branch/commit to add. Default: the remote HEAD (resolved). */
  branch?: string;
  /** Squash the child history into one commit. Default: false. */
  squash?: boolean;
  /** Silence timeout ms for git processes. Default: 300_000. */
  timeoutMs?: number;
  /** Job id for structured logs. */
  jobId?: string;
}

/**
 * The narrow git surface subtreeAdd needs. simple-git's `Git` satisfies
 * it via defaultCreateGit; tests inject plain object literals — no casts.
 */
export interface SubtreeGit {
  checkIsRepo(): Promise<boolean>;
  raw(commands: string[]): Promise<string>;
}

/** Runtime seams: only the git client factory (fs stays real). */
export interface SubtreeRuntime {
  createGit?: (options: GitFactoryOptions) => SubtreeGit;
}

/** Extraction strategy names, matching P-243 `git.strategy` exactly. */
export type ExtractStrategy = 'filter-repo' | 'subtree';

/** Selector input: doctor's probe result (P-065/P-068) + config preference. */
export interface StrategyInput {
  filterRepoAvailable: boolean;
  prefer?: ExtractStrategy;
}

/** Default factory: real createGit wrapped to the narrow SubtreeGit seam. */
function defaultCreateGit(options: GitFactoryOptions): SubtreeGit {
  const git = createGit(options);
  return {
    checkIsRepo: () => git.checkIsRepo(),
    raw: commands => git.raw(commands),
  };
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

/** Spawn error code without tripping union narrowing (P-068 lesson). */
function spawnCode(cause: unknown): unknown {
  if (cause instanceof Error) return (cause as { code?: unknown }).code;
  return undefined;
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

/** Repo-relative posix subpath (mirrors P-070's rule: same strictness). */
function isSafeSubpath(p: string): boolean {
  if (p.trim() === '') return false;
  if (p.startsWith('/')) return false;
  if (/^[A-Za-z]:[\\/]/.test(p)) return false;
  if (p.includes('\\')) return false;
  if (p.split('/').includes('..')) return false;
  return true;
}

interface NormalizedSubtree {
  parentRepo: string;
  childRepo: string;
  prefix: string;
  branch?: string;
  squash: boolean;
  timeoutMs: number;
}

/** Validate everything before any I/O (no spawn, no stat on misuse). */
function validateSubtreeArgs(
  parentRepo: string,
  childRepo: string,
  prefix: string,
  opts: SubtreeOpts
): Result<NormalizedSubtree, StitchError> {
  if (parentRepo.trim() === '') {
    return invalid('parentRepo', 'subtreeAdd: parentRepo is required');
  }
  if (childRepo.trim() === '') {
    return invalid('childRepo', 'subtreeAdd: childRepo is required');
  }
  const cleanPrefix = prefix.replace(/\/+$/, '');
  if (!isSafeSubpath(cleanPrefix)) {
    return invalid(
      'prefix',
      `subtreeAdd: rejecting unsafe prefix ${JSON.stringify(prefix)} ` +
        '(repo-relative forward-slash paths only, no absolute, no .. traversals)'
    );
  }
  if (opts.branch !== undefined && opts.branch.trim() === '') {
    return invalid('branch', 'subtreeAdd: branch must not be blank');
  }
  const timeoutMs = opts.timeoutMs ?? DEFAULT_SUBTREE_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
    return invalid(
      'timeoutMs',
      `subtreeAdd: timeoutMs must be an integer >= 1, got ${String(opts.timeoutMs)}`
    );
  }
  return ok({
    parentRepo,
    childRepo,
    prefix: cleanPrefix,
    ...(opts.branch !== undefined ? { branch: opts.branch } : {}),
    squash: opts.squash ?? false,
    timeoutMs,
  });
}

interface CheckedParent {
  git: SubtreeGit;
}

/**
 * Local preflights (no network): parent exists, client builds, parent is
 * a repo, prefix is free. The prefix refusal fires with zero git calls.
 */
async function checkParentRepo(args: {
  parentRepo: string;
  prefix: string;
  makeGit: (options: GitFactoryOptions) => SubtreeGit;
  timeoutMs: number;
}): Promise<Result<CheckedParent, StitchError>> {
  try {
    await stat(args.parentRepo);
  } catch (cause: unknown) {
    if (spawnCode(cause) === 'ENOENT') {
      return invalid('parentRepo', `subtreeAdd: parentRepo does not exist: ${args.parentRepo}`);
    }
    return err(internalError('subtree stat parent', cause));
  }
  // The prefix refusal fires before any git call: an existing tree is never
  // at risk, not even from a read-only probe.
  try {
    await stat(join(args.parentRepo, args.prefix));
    return invalid('prefix', `subtreeAdd: prefix already exists: ${args.prefix}`);
  } catch (cause: unknown) {
    if (spawnCode(cause) !== 'ENOENT') return err(internalError('subtree stat prefix', cause));
  }
  let git: SubtreeGit;
  try {
    git = args.makeGit({ baseDir: args.parentRepo, timeoutMs: args.timeoutMs });
  } catch (cause: unknown) {
    return err(gitFailure('subtree git client init', cause));
  }
  let inside: boolean;
  try {
    inside = await git.checkIsRepo();
  } catch (cause: unknown) {
    return err(gitFailure('subtree repo check', cause));
  }
  if (!inside) {
    return err({
      code: 'GIT_ERROR',
      message: `subtreeAdd: parentRepo is not a git repository: ${args.parentRepo}`,
    });
  }
  return ok({ git });
}

/** Parse `ref: refs/heads/<branch>\tHEAD` from ls-remote --symref output. */
function parseSymrefBranch(output: string): string | undefined {
  for (const line of output.split('\n')) {
    if (!line.startsWith('ref: ')) continue;
    const target = line.slice('ref: '.length).split('\t')[0];
    if (target === undefined || !target.startsWith('refs/heads/')) continue;
    const branch = target.slice('refs/heads/'.length);
    if (branch !== '') return branch;
  }
  return undefined;
}

/**
 * Network preflight + commit resolution. Explicit branch: verified present
 * (empty output = CONFIG_ERROR). Omitted: remote HEAD via --symref, with
 * a documented 'HEAD' fallback for servers without symref support.
 */
async function resolveCommit(args: {
  git: SubtreeGit;
  childRepo: string;
  branch?: string;
  log: Logger;
}): Promise<Result<string, StitchError>> {
  const probeArgs =
    args.branch !== undefined
      ? ['ls-remote', args.childRepo, args.branch]
      : ['ls-remote', '--symref', args.childRepo, 'HEAD'];
  let output: string;
  try {
    output = await args.git.raw(probeArgs);
  } catch (cause: unknown) {
    const detail = redactUrlCredentials(causeDetail(cause));
    args.log.error({ err: detail }, 'subtree child not fetchable');
    return err({
      code: 'GIT_ERROR',
      message: `subtreeAdd: child repo not fetchable: ${detail}`,
      gitOutput: detail,
    });
  }
  if (args.branch !== undefined) {
    if (output.trim() === '') {
      return invalid(
        'branch',
        `subtreeAdd: branch ${JSON.stringify(args.branch)} not found in child repo`
      );
    }
    return ok(args.branch);
  }
  const resolved = parseSymrefBranch(output);
  if (resolved !== undefined) {
    args.log.info({ branch: resolved }, 'subtree resolved remote HEAD');
    return ok(resolved);
  }
  args.log.info('subtree remote hides its HEAD; using HEAD as the commit');
  return ok('HEAD');
}

/** Run `git subtree add` with hermetic identity flags (see header). */
async function runSubtreeAdd(args: {
  git: SubtreeGit;
  childRepo: string;
  prefix: string;
  commit: string;
  squash: boolean;
  log: Logger;
}): Promise<Result<void, StitchError>> {
  const addArgs = [
    '-c',
    `user.name=${SUBTREE_AUTHOR_NAME}`,
    '-c',
    `user.email=${SUBTREE_AUTHOR_EMAIL}`,
    '-c',
    'commit.gpgsign=false',
    'subtree',
    'add',
    `--prefix=${args.prefix}`,
    ...(args.squash ? ['--squash'] : []),
    args.childRepo,
    args.commit,
  ];
  args.log.info({ prefix: args.prefix, squash: args.squash }, 'adding subtree');
  try {
    await args.git.raw(addArgs);
  } catch (cause: unknown) {
    const detail = redactUrlCredentials(causeDetail(cause));
    if (detail.includes(`'subtree' is not a git command`)) {
      const hint = 'git-subtree subcommand not found: ensure a full git installation';
      args.log.error({ err: detail }, 'subtree subcommand missing');
      return err({ code: 'GIT_ERROR', message: `subtreeAdd: ${hint}`, gitOutput: detail });
    }
    args.log.error({ err: detail }, 'subtree add failed');
    return err({ code: 'GIT_ERROR', message: `subtreeAdd failed: ${detail}`, gitOutput: detail });
  }
  return ok(undefined);
}

/** Post-condition: the prefix dir must exist (guards silent no-ops). */
async function verifyPrefix(
  parentRepo: string,
  prefix: string
): Promise<Result<void, StitchError>> {
  try {
    const found = await stat(join(parentRepo, prefix));
    if (!found.isDirectory()) {
      return err({
        code: 'GIT_ERROR',
        message: `subtreeAdd left no prefix dir at ${prefix}`,
      });
    }
  } catch (cause: unknown) {
    const detail = causeDetail(cause);
    return err({
      code: 'GIT_ERROR',
      message: `subtreeAdd left no prefix dir at ${prefix}: ${detail}`,
      gitOutput: detail,
    });
  }
  return ok(undefined);
}

/**
 * Add a whole child repo under `prefix` in the parent, preserving history
 * (or squashing with opts.squash). Returns ok(parentRepo). See the header
 * for the verified behavior and safety contracts.
 */
export async function subtreeAdd(
  parentRepo: string,
  childRepo: string,
  prefix: string,
  opts: SubtreeOpts = {},
  runtime: SubtreeRuntime = {}
): Promise<Result<string, StitchError>> {
  const normalized = validateSubtreeArgs(parentRepo, childRepo, prefix, opts);
  if (normalized.isErr()) return err(normalized.error);
  const log = (opts.jobId === undefined ? logger : createJobLogger(opts.jobId)).child({
    op: 'subtree',
    prefix: normalized.value.prefix,
    child: redactUrlCredentials(normalized.value.childRepo),
  });
  const checked = await checkParentRepo({
    parentRepo: normalized.value.parentRepo,
    prefix: normalized.value.prefix,
    makeGit: runtime.createGit ?? defaultCreateGit,
    timeoutMs: normalized.value.timeoutMs,
  });
  if (checked.isErr()) return err(checked.error);
  const commit = await resolveCommit({
    git: checked.value.git,
    childRepo: normalized.value.childRepo,
    ...(normalized.value.branch !== undefined ? { branch: normalized.value.branch } : {}),
    log,
  });
  if (commit.isErr()) return err(commit.error);
  const added = await runSubtreeAdd({
    git: checked.value.git,
    childRepo: normalized.value.childRepo,
    prefix: normalized.value.prefix,
    commit: commit.value,
    squash: normalized.value.squash,
    log,
  });
  if (added.isErr()) return err(added.error);
  const verified = await verifyPrefix(normalized.value.parentRepo, normalized.value.prefix);
  if (verified.isErr()) return err(verified.error);
  log.info({ commit: commit.value }, 'subtree add complete');
  return ok(normalized.value.parentRepo);
}

/**
 * Choose the extraction strategy: explicit config preference (P-243
 * `git.strategy`) wins; otherwise filter-repo when the binary is present
 * (P-065/P-068 probe) for full history fidelity, subtree as the fallback
 * when it is missing or unsuitable. Unknown preferences fail closed.
 */
export function selectExtractStrategy(input: StrategyInput): Result<ExtractStrategy, StitchError> {
  if (input.prefer === undefined) {
    return ok(input.filterRepoAvailable ? 'filter-repo' : 'subtree');
  }
  if (input.prefer === 'subtree') return ok('subtree');
  if (input.prefer === 'filter-repo') {
    if (!input.filterRepoAvailable) {
      return invalid(
        'strategy',
        'selectExtractStrategy: filter-repo strategy requested but the binary is ' +
          'unavailable (pip install git-filter-repo, then add the Python Scripts directory to PATH)'
      );
    }
    return ok('filter-repo');
  }
  return invalid(
    'strategy',
    `selectExtractStrategy: unknown extract strategy ${JSON.stringify(input.prefer)} ` +
      `(expected 'filter-repo' | 'subtree')`
  );
}
