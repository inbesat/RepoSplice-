// Git cherry-pick ranges (P-074): bring specific upstream commits into a
// repo with fine-grained control — used by the agent (P-154/P-165) and the
// merge-resume path (P-246). Flow: preflights -> fetch source -> resolve
// range -> single `git cherry-pick` (stops at the first problem) ->
// classify -> abort (P-085) or resolver handoff (P-075 shape) -> SHAs.
//
// Verified behavior (real git on this box — do not assume otherwise):
// - A conflicting pick exits 1 with `UU <file>` porcelain and
//   CHERRY_PICK_HEAD set to the stopping commit.
// - An already-applied (empty) pick exits 1 with CLEAN porcelain,
//   CHERRY_PICK_HEAD set, and a "now empty" message. Discriminator:
//   conflicted non-empty (or a stopping commit with conflicts) vs neither.
// - `cherry-pick --abort` with no sequencer state exits 128 ("no
//   cherry-pick or revert in progress"), so the abort is conditional on
//   sequencer files — never blind.
// - `symbolic-ref HEAD` (no --quiet: simple-git's raw resolves silent
//   failures instead of rejecting) prints the ref on a branch (unborn
//   included) and rejects when detached.
// - `git fetch <path>` fetches the remote HEAD history: SHA ranges
//   resolve, but foreign branch NAMES generally do not (no refspec).
//
// Safety contract (destructive-op discipline, P-070 rule):
// - The git client is bound to repoPath (explicit cwd, never ambient).
// - Guard order is structural-first: repo -> overlapping operation
//   (CHERRY_PICK/MERGE/REVERT_HEAD present) -> clean tree (P-084's future
//   home; dirty refuses, satisfying P-081 stash safety by never risking
//   uncommitted work) -> on-branch (detached refuses: un-pushable) ->
//   HEAD exists -> fetch (network last) -> resolve.
// - On failure the sequencer is aborted and HEAD-unchanged + clean is
//   verified (P-085): no partial picks linger. A throwing resolver maps
//   to INTERNAL after the same revert.
// - Conflict errors carry the stopping commit + files (P-203 will remap
//   these to a CONFLICT code); with a resolver the pick is continued and
//   the new SHAs returned like a clean run.
// - Secrets: the remote is redacted in logs/messages (P-069 pattern); no
//   credentials are plumbed (same limitation as merge/subtree).
// - Every git rejection maps to a typed StitchError (never a throw); no
//   new codes (P-203 owns future taxonomy).
//
// Seams and future phases:
// - CherryPickRuntime.createGit is the only seam (P-016 factory default).
// - P-075 supplies resolver implementations; P-076 stages on worktrees;
//   both consume the types here. P-246 replays via the returned SHAs.

import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { ok, err, type Result } from 'neverthrow';
import type { Logger } from 'pino';
import type { StitchError } from '../result/index.js';
import { createGit, type GitFactoryOptions } from './factory.js';
import { redactUrlCredentials } from './clone.js';
import { logger, createJobLogger } from '../logger/index.js';

/** Silence timeout (ms): fetch is network, like a clone (P-069 parity). */
export const DEFAULT_CHERRY_PICK_TIMEOUT_MS = 120_000;

export interface CherryPickOpts {
  /** Absent: any conflict/error aborts. Present: called per conflict. */
  resolveConflicts?: CherryPickResolver;
  /** Silence timeout ms for git processes. Default: 120_000. */
  timeoutMs?: number;
  /** Job id for structured logs. */
  jobId?: string;
}

/** Resolver input (P-075 hook shape): fix files under repoPath in place. */
export interface CherryPickResolveInput {
  repoPath: string;
  commit: string;
  conflicts: string[];
}

/** Return ok({resolved:true}) once the tree is fixed; err aborts the pick. */
export type CherryPickResolver = (
  input: CherryPickResolveInput
) => Promise<Result<{ resolved: boolean }, StitchError>>;

/** Narrow status: only what the guards and classifier read. */
export interface CherryPickStatus {
  clean: boolean;
  conflicted: string[];
  dirty: string[];
}

/**
 * The narrow git surface cherryPickRange needs. simple-git's `Git`
 * satisfies it via defaultCreateGit; tests inject plain object literals.
 */
export interface CherryPickGit {
  checkIsRepo(): Promise<boolean>;
  status(): Promise<CherryPickStatus>;
  revparse(ref: string): Promise<string>;
  raw(commands: string[]): Promise<string>;
}

/** Runtime seams: only the git client factory (fs stays real). */
export interface CherryPickRuntime {
  createGit?: (options: GitFactoryOptions) => CherryPickGit;
}

/** Default factory: real createGit wrapped to the narrow CherryPickGit seam. */
function defaultCreateGit(options: GitFactoryOptions): CherryPickGit {
  const git = createGit(options);
  return {
    checkIsRepo: () => git.checkIsRepo(),
    status: async () => {
      const status = await git.status();
      return {
        clean: status.isClean(),
        conflicted: [...status.conflicted],
        dirty: status.files.map(file => file.path).sort(),
      };
    },
    revparse: ref => git.revparse(ref),
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

/**
 * One-line summary of any StitchError for embedding one error inside
 * another's message. Most codes carry `message`; USER_CANCELLED carries
 * `reason`; anything else falls back to a code + JSON dump (those never
 * flow through here in practice, but the summary must stay total).
 */
function errorSummary(error: StitchError): string {
  if (error.code === 'USER_CANCELLED') return `cancelled: ${error.reason}`;
  if ('message' in error) return error.message;
  return `stitch ${error.code} error: ${JSON.stringify(error)}`;
}

interface NormalizedPick {
  repoPath: string;
  sourceRemote: string;
  range: { kind: 'shas'; shas: string[] } | { kind: 'range'; rangeStr: string };
  timeoutMs: number;
}

/** Validate everything before any I/O (no spawn on misuse). */
function validatePickArgs(
  repoPath: string,
  sourceRemote: string,
  range: string | string[],
  opts: CherryPickOpts
): Result<NormalizedPick, StitchError> {
  if (repoPath.trim() === '') {
    return invalid('repoPath', 'cherryPickRange: repoPath is required');
  }
  if (sourceRemote.trim() === '') {
    return invalid('sourceRemote', 'cherryPickRange: sourceRemote is required');
  }
  let normalizedRange: NormalizedPick['range'];
  if (typeof range === 'string') {
    if (range.trim() === '') return invalid('range', 'cherryPickRange: range is required');
    normalizedRange = { kind: 'range', rangeStr: range };
  } else {
    if (range.length === 0) {
      return invalid('range', 'cherryPickRange: range must name at least one commit');
    }
    for (const sha of range) {
      if (sha.trim() === '') {
        return invalid('range', 'cherryPickRange: range must not contain blank SHAs');
      }
    }
    normalizedRange = { kind: 'shas', shas: [...range] };
  }
  const timeoutMs = opts.timeoutMs ?? DEFAULT_CHERRY_PICK_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
    return invalid(
      'timeoutMs',
      `cherryPickRange: timeoutMs must be an integer >= 1, got ${String(opts.timeoutMs)}`
    );
  }
  return ok({
    repoPath,
    sourceRemote,
    range: normalizedRange,
    timeoutMs,
  });
}

interface RepoState {
  gitDir: string;
  preHead: string;
}

/** Sequencer files that mean another operation owns the tree. */
const OVERLAP_HEADS = ['CHERRY_PICK_HEAD', 'MERGE_HEAD', 'REVERT_HEAD'] as const;

async function headFileExists(gitDir: string, name: string): Promise<boolean> {
  try {
    await stat(join(gitDir, name));
    return true;
  } catch {
    return false;
  }
}

/**
 * Structural guards (P-084/P-081/P-076 future homes documented in the
 * header): repo, overlapping operation, clean tree, on-branch, HEAD.
 */
async function checkRepoState(args: {
  git: CherryPickGit;
  repoPath: string;
  log: Logger;
}): Promise<Result<RepoState, StitchError>> {
  let inside: boolean;
  try {
    inside = await args.git.checkIsRepo();
  } catch (cause: unknown) {
    return err(gitFailure('cherry-pick repo check', cause));
  }
  if (!inside) {
    return err({
      code: 'GIT_ERROR',
      message: `cherryPickRange: repoPath is not a git repository: ${args.repoPath}`,
    });
  }
  let gitDir: string;
  try {
    gitDir = (await args.git.raw(['rev-parse', '--absolute-git-dir'])).trim();
  } catch (cause: unknown) {
    return err(gitFailure('cherry-pick git dir', cause));
  }
  for (const head of OVERLAP_HEADS) {
    let present = false;
    try {
      await stat(join(gitDir, head));
      present = true;
    } catch (cause: unknown) {
      if (spawnCode(cause) !== 'ENOENT')
        return err(internalError('cherry-pick overlap check', cause));
    }
    if (present) {
      return err({
        code: 'GIT_ERROR',
        message: `cherryPickRange: refusing: ${head} exists (another operation in progress)`,
      });
    }
  }
  let status: CherryPickStatus;
  try {
    status = await args.git.status();
  } catch (cause: unknown) {
    return err(gitFailure('cherry-pick status', cause));
  }
  if (!status.clean) {
    return err({
      code: 'GIT_ERROR',
      message: `cherryPickRange: refusing: worktree not clean: ${status.dirty.join(', ')}`,
    });
  }
  try {
    // No --quiet: simple-git's raw resolves (instead of rejecting) when a
    // failing command prints nothing, so the noisy form is required — it
    // prints the ref on a branch and rejects when detached.
    await args.git.raw(['symbolic-ref', 'HEAD']);
  } catch {
    return err({
      code: 'GIT_ERROR',
      message: 'cherryPickRange: refusing: detached HEAD (check out a branch first)',
    });
  }
  let preHead: string;
  try {
    preHead = (await args.git.revparse('HEAD')).trim();
  } catch (cause: unknown) {
    return err(gitFailure('cherry-pick read HEAD (repo has no commits yet)', cause));
  }
  return ok({ gitDir, preHead });
}

/** Fetch the source so the commits exist locally (network last). */
async function fetchSource(args: {
  git: CherryPickGit;
  sourceRemote: string;
  log: Logger;
}): Promise<Result<void, StitchError>> {
  try {
    await args.git.raw(['fetch', args.sourceRemote]);
  } catch (cause: unknown) {
    const detail = redactUrlCredentials(causeDetail(cause));
    args.log.error({ err: detail }, 'cherry-pick fetch failed');
    return err({
      code: 'GIT_ERROR',
      message: `cherryPickRange: fetch failed for ${redactUrlCredentials(args.sourceRemote)}: ${detail}`,
      gitOutput: detail,
    });
  }
  return ok(undefined);
}

/**
 * Resolve the range to an ordered commit list: explicit SHAs keep caller
 * order (each verified a commit); `<from>..<to>` resolves oldest-first.
 */
async function resolveCommits(args: {
  git: CherryPickGit;
  pick: NormalizedPick;
  log: Logger;
}): Promise<Result<string[], StitchError>> {
  if (args.pick.range.kind === 'shas') {
    for (const sha of args.pick.range.shas) {
      try {
        await args.git.raw(['rev-parse', '--verify', `${sha}^{commit}`]);
      } catch {
        return invalid('range', `cherryPickRange: unknown commit ${JSON.stringify(sha)}`);
      }
    }
    return ok(args.pick.range.shas);
  }
  const rangeStr = args.pick.range.rangeStr;
  let output: string;
  try {
    output = await args.git.raw(['rev-list', '--reverse', '--topo-order', rangeStr]);
  } catch (cause: unknown) {
    return invalid(
      'range',
      `cherryPickRange: unresolvable range ${JSON.stringify(rangeStr)}: ${causeDetail(cause)}`
    );
  }
  const commits = output
    .split('\n')
    .map(line => line.trim())
    .filter(line => line !== '');
  if (commits.length === 0) {
    return invalid(
      'range',
      `cherryPickRange: range ${JSON.stringify(rangeStr)} resolved to no commits`
    );
  }
  args.log.info({ commits: commits.length }, 'cherry-pick range resolved');
  return ok(commits);
}

/** Single `git cherry-pick`: stops at the first problem by construction. */
async function tryPick(args: {
  git: CherryPickGit;
  shas: string[];
  log: Logger;
}): Promise<Result<void, StitchError>> {
  args.log.info({ commits: args.shas.length }, 'cherry-picking commits');
  try {
    await args.git.raw(['cherry-pick', ...args.shas]);
  } catch (cause: unknown) {
    return err(gitFailure('cherry-pick', cause));
  }
  return ok(undefined);
}

type PickFailure =
  { kind: 'conflict'; commit: string; files: string[] } | { kind: 'fatal'; error: StitchError };

/** Read a sequencer file; absent (or unreadable) means no such state. */
async function readHeadFile(gitDir: string, name: string): Promise<string | undefined> {
  try {
    const content = await readFile(join(gitDir, name), 'utf8');
    const sha = content.trim().split('\n')[0]?.trim();
    return sha === undefined || sha === '' ? undefined : sha;
  } catch {
    return undefined;
  }
}

/**
 * Classify a failed pick: conflicts (stopping commit + files), an empty
 * pick (clean tree with sequencer state — git's own "now empty" shape),
 * leftover dirt without conflicts, or anything else with the raw detail.
 */
async function classifyPickFailure(args: {
  git: CherryPickGit;
  gitDir: string;
  pickError: StitchError;
  log: Logger;
}): Promise<PickFailure> {
  let status: CherryPickStatus;
  try {
    status = await args.git.status();
  } catch (cause: unknown) {
    args.log.warn({ err: causeDetail(cause) }, 'cherry-pick inspection failed');
    return { kind: 'fatal', error: args.pickError };
  }
  const conflicted = [...status.conflicted].sort();
  const stopping = await readHeadFile(args.gitDir, 'CHERRY_PICK_HEAD');
  if (conflicted.length > 0) {
    return {
      kind: 'conflict',
      commit: stopping ?? 'unknown commit',
      files: conflicted,
    };
  }
  const detail = errorSummary(args.pickError);
  if (!status.clean) {
    return {
      kind: 'fatal',
      error: {
        code: 'GIT_ERROR',
        message: `cherryPickRange: pick stopped with uncommitted changes but no conflicts (${status.dirty.join(', ')}): ${detail}`,
        gitOutput: detail,
      },
    };
  }
  if (stopping !== undefined) {
    return {
      kind: 'fatal',
      error: {
        code: 'GIT_ERROR',
        message: `cherryPickRange: pick stopped with no changes to commit (empty pick involving ${stopping}): ${detail}`,
        gitOutput: detail,
      },
    };
  }
  return { kind: 'fatal', error: args.pickError };
}

function conflictError(commit: string, files: string[]): StitchError {
  return {
    code: 'GIT_ERROR',
    message: `cherryPickRange: pick stopped at ${commit} with conflicts: ${files.join(', ')}`,
    gitOutput: files.join('\n'),
  };
}

/** Abort when sequencer state exists; never blind (blind abort exits 128). */
async function abortIfNeeded(args: {
  git: CherryPickGit;
  gitDir: string;
  log: Logger;
}): Promise<Result<void, { code: 'GIT_ERROR'; message: string; gitOutput: string }>> {
  let state = false;
  for (const head of ['CHERRY_PICK_HEAD', 'REVERT_HEAD'] as const) {
    if (await headFileExists(args.gitDir, head)) state = true;
  }
  if (!state) return ok(undefined);
  try {
    await args.git.raw(['cherry-pick', '--abort']);
  } catch (cause: unknown) {
    return err(gitFailure('cherry-pick abort', cause));
  }
  return ok(undefined);
}

/** Prove the revert: HEAD unmoved and tree clean (P-085). */
async function verifyReverted(args: {
  git: CherryPickGit;
  preHead: string;
}): Promise<Result<void, StitchError>> {
  let head: string;
  try {
    head = (await args.git.revparse('HEAD')).trim();
  } catch (cause: unknown) {
    return err(gitFailure('cherry-pick verify HEAD', cause));
  }
  if (head !== args.preHead) {
    return err({
      code: 'GIT_ERROR',
      message: 'cherryPickRange: revert failed (HEAD moved during abort)',
    });
  }
  let status: CherryPickStatus;
  try {
    status = await args.git.status();
  } catch (cause: unknown) {
    return err(gitFailure('cherry-pick verify status', cause));
  }
  if (!status.clean) {
    return err({
      code: 'GIT_ERROR',
      message: `cherryPickRange: revert failed (tree dirty: ${status.dirty.join(', ')})`,
    });
  }
  return ok(undefined);
}

/** Revert path shared by every failure: abort, verify, report. */
async function revertAndReport(args: {
  git: CherryPickGit;
  gitDir: string;
  preHead: string;
  error: StitchError;
  log: Logger;
}): Promise<StitchError> {
  const aborted = await abortIfNeeded({ git: args.git, gitDir: args.gitDir, log: args.log });
  if (aborted.isErr()) {
    return {
      ...aborted.error,
      message: `${aborted.error.message} (while reverting: ${errorSummary(args.error)})`,
    };
  }
  const verified = await verifyReverted({ git: args.git, preHead: args.preHead });
  if (verified.isErr()) return verified.error;
  return args.error;
}

/** The new SHAs the pick created, oldest-first (what landed, P-246). */
async function collectShas(args: {
  git: CherryPickGit;
  preHead: string;
  log: Logger;
}): Promise<Result<string[], StitchError>> {
  let output: string;
  try {
    output = await args.git.raw(['rev-list', '--reverse', '--topo-order', `${args.preHead}..HEAD`]);
  } catch (cause: unknown) {
    return err(gitFailure('cherry-pick new commits lookup', cause));
  }
  const shas = output
    .split('\n')
    .map(line => line.trim())
    .filter(line => line !== '');
  if (shas.length === 0) {
    return err({
      code: 'GIT_ERROR',
      message: 'cherryPickRange: pick left no new commits',
    });
  }
  args.log.info({ commits: shas.length }, 'cherry-pick complete');
  return ok(shas);
}

/**
 * Pick a commit range from a source remote into the repo, returning the
 * new SHAs oldest-first. See the header for guards, conflicts, and revert.
 */
export async function cherryPickRange(
  repoPath: string,
  sourceRemote: string,
  range: string | string[],
  opts: CherryPickOpts = {},
  runtime: CherryPickRuntime = {}
): Promise<Result<string[], StitchError>> {
  const normalized = validatePickArgs(repoPath, sourceRemote, range, opts);
  if (normalized.isErr()) return err(normalized.error);
  const log = (opts.jobId === undefined ? logger : createJobLogger(opts.jobId)).child({
    op: 'cherry-pick',
    repoPath: normalized.value.repoPath,
  });
  let git: CherryPickGit;
  try {
    git = (runtime.createGit ?? defaultCreateGit)({
      baseDir: normalized.value.repoPath,
      timeoutMs: normalized.value.timeoutMs,
    });
  } catch (cause: unknown) {
    return err(gitFailure('cherry-pick git client init', cause));
  }
  const state = await checkRepoState({ git, repoPath: normalized.value.repoPath, log });
  if (state.isErr()) return err(state.error);
  const fetched = await fetchSource({
    git,
    sourceRemote: normalized.value.sourceRemote,
    log,
  });
  if (fetched.isErr()) return err(fetched.error);
  const commits = await resolveCommits({ git, pick: normalized.value, log });
  if (commits.isErr()) return err(commits.error);
  const picked = await tryPick({ git, shas: commits.value, log });
  if (picked.isOk()) {
    const shas = await collectShas({ git, preHead: state.value.preHead, log });
    if (shas.isErr()) return err(shas.error);
    return ok(shas.value);
  }
  const failure = await classifyPickFailure({
    git,
    gitDir: state.value.gitDir,
    pickError: picked.error,
    log,
  });
  if (failure.kind !== 'conflict' || opts.resolveConflicts === undefined) {
    const error =
      failure.kind === 'conflict' ? conflictError(failure.commit, failure.files) : failure.error;
    return err(
      await revertAndReport({
        git,
        gitDir: state.value.gitDir,
        preHead: state.value.preHead,
        error,
        log,
      })
    );
  }
  let decision: Result<{ resolved: boolean }, StitchError>;
  try {
    decision = await opts.resolveConflicts({
      repoPath: normalized.value.repoPath,
      commit: failure.commit,
      conflicts: failure.files,
    });
  } catch (cause: unknown) {
    return err(
      await revertAndReport({
        git,
        gitDir: state.value.gitDir,
        preHead: state.value.preHead,
        error: internalError('cherry-pick resolver threw', cause),
        log,
      })
    );
  }
  if (decision.isErr()) {
    return err(
      await revertAndReport({
        git,
        gitDir: state.value.gitDir,
        preHead: state.value.preHead,
        error: decision.error,
        log,
      })
    );
  }
  if (!decision.value.resolved) {
    return err(
      await revertAndReport({
        git,
        gitDir: state.value.gitDir,
        preHead: state.value.preHead,
        error: conflictError(failure.commit, failure.files),
        log,
      })
    );
  }
  try {
    await git.raw(['add', '-A']);
  } catch (cause: unknown) {
    return err(
      await revertAndReport({
        git,
        gitDir: state.value.gitDir,
        preHead: state.value.preHead,
        error: gitFailure('cherry-pick stage resolved', cause),
        log,
      })
    );
  }
  try {
    await git.raw(['cherry-pick', '--continue']);
  } catch (cause: unknown) {
    return err(
      await revertAndReport({
        git,
        gitDir: state.value.gitDir,
        preHead: state.value.preHead,
        error: gitFailure('cherry-pick continue', cause),
        log,
      })
    );
  }
  let after: CherryPickStatus;
  try {
    after = await git.status();
  } catch (cause: unknown) {
    return err(
      await revertAndReport({
        git,
        gitDir: state.value.gitDir,
        preHead: state.value.preHead,
        error: gitFailure('cherry-pick verify resolved', cause),
        log,
      })
    );
  }
  if (!after.clean) {
    // The pick already landed (abort would destroy it): report, don't revert.
    return err({
      code: 'GIT_ERROR',
      message: `cherryPickRange: resolver left uncommitted changes after continue: ${after.dirty.join(', ')}`,
    });
  }
  const shas = await collectShas({ git, preHead: state.value.preHead, log });
  if (shas.isErr()) return err(shas.error);
  return ok(shas.value);
}
