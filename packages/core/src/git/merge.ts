// Git Core merge (P-072): clone A+B (P-069), path-extract under prefixes
// (P-070), collect namespaced tags (P-071), and merge both histories into a
// unified child repo with `--allow-unrelated-histories`.
//
// Composition decision (R2 — read before "simplifying" this pipeline):
// P-070's extract already renames tags via `--tag-rename :<prefix>/`
// (rewriting annotated tag objects onto the filtered commits, which only
// filter-repo can do soundly). Calling P-071's renameTags on top would
// prepend a SECOND time (`repo-a/v1` -> `repo-a/repo-a/v1`) — two prepends
// in either order always double, and neither module offers an identity
// rename. So the pipeline passes the final `prefix/` as extract's
// tagPrefix and uses P-071's listTags to collect the namespaced tags into
// the provenance tagMap (originals recovered by stripping the known
// prefix). If a future phase adds a tag-rename skip to extract, revisit.
//
// Safety contract (destructive-op discipline, P-070 rule):
// - Every git/process invocation carries an explicit cwd (workdir, clone
//   dir, or child dir) — never the ambient process cwd.
// - Atomicity: the child is built at its final path; ANY failure after the
//   child dir is created removes it, so no partial child escapes (P-085).
//   Clones live in a temp workdir removed on failure (and always when an
//   explicit targetDir is used). Verified by the rollback test, which
//   reuses the same target immediately after a failure.
// - Conflicts fail fast as GIT_ERROR naming every conflicted path
//   (P-203 will remap these to a CONFLICT code; the message shape already
//   carries the file list). With a resolver hook (P-075 shape) the merge
//   completes and the resolved paths land in MergeResult.conflictList.
// - Determinism (P-282): sources merge in given order; fixed
//   author/committer identity + dates via git env (never ambient env);
//   explicit `-b main` and explicit `-m` messages (never tmp-path-derived
//   defaults); sorted tags and conflicts. The determinism test merges
//   twice and compares tree + commits + tagMap.
//
// Seams and future phases:
// - MergeRuntime.extract IS the strategy port: P-073's subtreeAdd plugs in
//   behind an adapter matching the FilterRepoLike shape.
// - resolveConflicts is the P-075 hook shape; P-075 will supply a default.
// - The child is a fresh `git init` dir, not a P-076 worktree; P-076 can
//   stage on top of MergeResult.childPath.
// - Author identity defaults are fixed here; P-077 owns commit policy.
// - MergeResult feeds the pipeline state (P-238) and provenance (P-079,
//   tagMap keyed by namespaced name so same-named source tags stay
//   lossless; P-181 attribution).
// - Validation (blank/unsafe names, prefixes, paths, duplicates, existing
//   target) returns CONFIG_ERROR before any I/O. Clone/extract/rename
//   failures propagate typed. Private-remotes auth (P-069 CloneCredentials)
//   is not plumbed through MergeSource yet.

import { mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CommitSummary, FetchResult, InitResult, MergeSummary } from 'simple-git';
import { ok, err, type Result } from 'neverthrow';
import type { Logger } from 'pino';
import type { StitchError } from '../result/index.js';
import { createGit, type GitFactoryOptions } from './factory.js';
import { cloneRepo } from './clone.js';
import { extractPathsViaFilterRepo } from './filterRepo.js';
import { listTags } from './tagRename.js';
import { logger, createJobLogger } from '../logger/index.js';

/** Fixed merge identity (P-077 owns commit policy; these are the floor). */
export const MERGE_AUTHOR_NAME = 'repo-stitcher';
export const MERGE_AUTHOR_EMAIL = 'repo-stitcher@localhost';
export const MERGE_FIXED_DATE = '2026-01-01T00:00:00+00:00';
const MERGE_ROOT_MESSAGE = 'repo-stitcher: empty root';

/** One source repo: cloned full (tags must survive), extracted, merged. */
export interface MergeSource {
  /** Remote name in the child + log label. Remote-safe: [A-Za-z0-9._-]. */
  name: string;
  /** Clone URL (file:// fixtures offline; https in production). */
  url: string;
  /** Tree prefix AND tag namespace (`repo-a` -> `repo-a/…`, `repo-a/v1`). */
  prefix: string;
  /** Branch to clone (else the remote default). */
  ref?: string;
  /** Repo-relative paths kept by the P-070 extraction (at least one). */
  paths: string[];
}

/** Commit identity override; date defaults to MERGE_FIXED_DATE. */
export interface MergeAuthor {
  name: string;
  email: string;
  date?: string;
}

/** Resolver input (P-075 hook shape): fix files under childPath in place. */
export interface ConflictInput {
  childPath: string;
  conflicts: string[];
  source: string;
}

/** Return ok({resolved:true}) once the tree is fixed; err aborts the merge. */
export type ConflictResolver = (
  input: ConflictInput
) => Promise<Result<{ resolved: boolean }, StitchError>>;

export interface MergeOptions {
  /** At least two sources, merged in order. */
  sources: MergeSource[];
  /** Child location (created). Default: inside the temp workdir. */
  targetDir?: string;
  author?: MergeAuthor;
  /** Absent: any conflict fails the merge. Present: called per conflict. */
  resolveConflicts?: ConflictResolver;
  jobId?: string;
}

/**
 * Merge outcome. tagMap is keyed by NAMESPACED tag (unique by
 * construction) back to the original name, so same-named source tags
 * (both sides tag v1.0.0) stay lossless for provenance (P-079/181).
 */
export interface MergeResult {
  childPath: string;
  treeSha: string;
  /** Every commit reachable from HEAD, newest-first: the merge spine plus
   * the merged source histories (the commit graph C the spec names). */
  commitShas: string[];
  tagMap: Map<string, string>;
  /** Paths that conflicted and were resolver-fixed (empty when clean). */
  conflictList: string[];
}

/**
 * The narrow git surface the assembler needs. simple-git's `Git`
 * satisfies it via defaultCreateGit; tests inject plain object literals —
 * no casts, no full-SimpleGit fakes. Status and log are narrowed to the
 * two fields the assembler reads so fakes stay trivial.
 */
export interface MergeStatus {
  conflicted: string[];
  clean: boolean;
}

export interface MergeLog {
  commits: string[];
}

export interface MergeGit {
  init(bare: boolean, options?: string[]): Promise<InitResult>;
  addConfig(key: string, value: string): Promise<string>;
  revparse(ref: string): Promise<string>;
  addRemote(name: string, repo: string): Promise<string>;
  fetch(remote: string, ref: string): Promise<FetchResult>;
  merge(options: string[]): Promise<MergeSummary>;
  status(): Promise<MergeStatus>;
  add(files: string[]): Promise<string>;
  commit(message: string, allowEmpty: boolean): Promise<CommitSummary>;
  log(): Promise<MergeLog>;
  env(name: string, value: string): void;
}

export type CloneLike = typeof cloneRepo;
export type FilterRepoLike = typeof extractPathsViaFilterRepo;
export type ListTagsLike = typeof listTags;

/** Runtime seams: strategy (P-073), tag listing, git client factory. */
export interface MergeRuntime {
  clone?: CloneLike;
  extract?: FilterRepoLike;
  listTags?: ListTagsLike;
  createGit?: (options: GitFactoryOptions) => MergeGit;
}

/** Default factory: real createGit wrapped to the narrow MergeGit seam. */
function defaultCreateGit(options: GitFactoryOptions): MergeGit {
  const git = createGit(options);
  return {
    init: (bare, initOptions) => git.init(bare, initOptions),
    addConfig: (key, value) => git.addConfig(key, value),
    revparse: ref => git.revparse(ref),
    addRemote: (name, repo) => git.addRemote(name, repo),
    fetch: (remote, ref) => git.fetch(remote, ref),
    merge: mergeOptions => git.merge(mergeOptions),
    status: async () => {
      const status = await git.status();
      return { conflicted: [...status.conflicted], clean: status.isClean() };
    },
    add: files => git.add(files),
    commit: (message, allowEmpty) =>
      allowEmpty ? git.commit(message, [], { '--allow-empty': null }) : git.commit(message),
    log: async () => ({ commits: (await git.log()).all.map(entry => entry.hash) }),
    env: (name, value) => {
      git.env(name, value);
    },
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

/** Repo-relative posix subpath (mirrors P-070's rule: same strictness). */
function isSafeSubpath(p: string): boolean {
  if (p.trim() === '') return false;
  if (p.startsWith('/')) return false;
  if (/^[A-Za-z]:[\\/]/.test(p)) return false;
  if (p.includes('\\')) return false;
  if (p.split('/').includes('..')) return false;
  return true;
}

function isSafeName(name: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(name);
}

interface NormalizedSource {
  name: string;
  url: string;
  prefix: string;
  paths: string[];
  ref?: string;
}

interface NormalizedMerge {
  sources: NormalizedSource[];
  targetDir?: string;
  authorName: string;
  authorEmail: string;
  authorDate: string;
}

/** Validate everything before any I/O (no spawn, no mkdir on misuse). */
function validateMergeOptions(opts: MergeOptions): Result<NormalizedMerge, StitchError> {
  if (opts.sources.length < 2) {
    return invalid('sources', 'mergeRepos: need at least two sources to merge');
  }
  const names = new Set<string>();
  const prefixes = new Set<string>();
  const sources: NormalizedSource[] = [];
  for (const [index, source] of opts.sources.entries()) {
    const at = `sources[${String(index)}]`;
    if (source.name.trim() === '' || !isSafeName(source.name)) {
      return invalid(`${at}.name`, `mergeRepos: ${at}.name must match [A-Za-z0-9._-]`);
    }
    if (source.url.trim() === '') return invalid(`${at}.url`, `mergeRepos: ${at}.url is required`);
    const prefix = source.prefix.replace(/\/+$/, '');
    if (!isSafeSubpath(prefix)) {
      return invalid(
        `${at}.prefix`,
        `mergeRepos: rejecting unsafe prefix ${JSON.stringify(source.prefix)}`
      );
    }
    if (source.paths.length === 0) {
      return invalid(`${at}.paths`, `mergeRepos: ${at}.paths must name at least one path`);
    }
    for (const p of source.paths) {
      if (!isSafeSubpath(p)) {
        return invalid(`${at}.paths`, `mergeRepos: rejecting unsafe path ${JSON.stringify(p)}`);
      }
    }
    if (source.ref !== undefined && source.ref.trim() === '') {
      return invalid(`${at}.ref`, `mergeRepos: ${at}.ref must not be blank`);
    }
    if (names.has(source.name)) {
      return invalid(
        `${at}.name`,
        `mergeRepos: duplicate source name ${JSON.stringify(source.name)}`
      );
    }
    if (prefixes.has(prefix)) {
      return invalid(`${at}.prefix`, `mergeRepos: duplicate prefix ${JSON.stringify(prefix)}`);
    }
    names.add(source.name);
    prefixes.add(prefix);
    sources.push({
      name: source.name,
      url: source.url,
      prefix,
      paths: [...source.paths],
      ...(source.ref !== undefined ? { ref: source.ref } : {}),
    });
  }
  if (opts.targetDir !== undefined && opts.targetDir.trim() === '') {
    return invalid('targetDir', 'mergeRepos: targetDir must not be blank');
  }
  if (opts.author !== undefined) {
    if (opts.author.name.trim() === '')
      return invalid('author.name', 'mergeRepos: author.name is required');
    if (opts.author.email.trim() === '') {
      return invalid('author.email', 'mergeRepos: author.email is required');
    }
    if (opts.author.date !== undefined && opts.author.date.trim() === '') {
      return invalid('author.date', 'mergeRepos: author.date must not be blank');
    }
  }
  return ok({
    sources,
    ...(opts.targetDir !== undefined ? { targetDir: opts.targetDir } : {}),
    authorName: opts.author?.name ?? MERGE_AUTHOR_NAME,
    authorEmail: opts.author?.email ?? MERGE_AUTHOR_EMAIL,
    authorDate: opts.author?.date ?? MERGE_FIXED_DATE,
  });
}

interface PreparedPaths {
  workdir: string;
  childPath: string;
  explicitTarget: boolean;
}

function internalError(op: string, cause: unknown): StitchError {
  return {
    code: 'INTERNAL',
    message: `${op}: ${causeDetail(cause)}`,
    ...(cause instanceof Error ? { cause } : {}),
  };
}

/** Reserve the workdir + child path. Existing targetDir is CONFIG_ERROR. */
async function preparePaths(args: {
  targetDir?: string;
  log: Logger;
}): Promise<Result<PreparedPaths, StitchError>> {
  if (args.targetDir !== undefined) {
    try {
      await stat(args.targetDir);
      return invalid('targetDir', `mergeRepos: targetDir already exists: ${args.targetDir}`);
    } catch (cause: unknown) {
      if (spawnCode(cause) !== 'ENOENT') return err(internalError('merge stat target', cause));
    }
  }
  let workdir: string;
  try {
    workdir = await mkdtemp(join(tmpdir(), 'stitch-merge-'));
  } catch (cause: unknown) {
    return err(internalError('merge workdir', cause));
  }
  const childPath = args.targetDir ?? join(workdir, 'child');
  try {
    await mkdir(childPath, { recursive: true });
  } catch (cause: unknown) {
    await removePath(workdir, args.log, 'workdir');
    return err(internalError('merge child dir', cause));
  }
  return ok({ workdir, childPath, explicitTarget: args.targetDir !== undefined });
}

/** Best-effort removal: logs and swallows, never throws, never masks. */
async function removePath(path: string, log: Logger, what: string): Promise<void> {
  try {
    await rm(path, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  } catch (cause: unknown) {
    log.warn({ err: causeDetail(cause), path }, `merge cleanup failed for ${what}`);
  }
}

/** Pin author/committer identity + dates on the client (deterministic). */
function applyDeterministicIdentity(
  git: MergeGit,
  identity: { name: string; email: string; date: string }
): void {
  git.env('GIT_AUTHOR_NAME', identity.name);
  git.env('GIT_AUTHOR_EMAIL', identity.email);
  git.env('GIT_AUTHOR_DATE', identity.date);
  git.env('GIT_COMMITTER_NAME', identity.name);
  git.env('GIT_COMMITTER_EMAIL', identity.email);
  git.env('GIT_COMMITTER_DATE', identity.date);
}

/** Init on main + empty root so every source merge is a real merge commit. */
async function initChild(args: { git: MergeGit; log: Logger }): Promise<Result<void, StitchError>> {
  try {
    await args.git.init(false, ['-b', 'main']);
  } catch (cause: unknown) {
    return err(gitFailure('merge init', cause));
  }
  // Hermetic repo-local config (P-064 precedent): ambient machine config
  // (notably Windows system core.autocrlf=true) must not rewrite child
  // bytes, flip modes on resolver adds, or sign commits.
  const hermetic: [string, string][] = [
    ['core.autocrlf', 'false'],
    ['core.fileMode', 'false'],
    ['commit.gpgsign', 'false'],
  ];
  for (const [key, value] of hermetic) {
    try {
      await args.git.addConfig(key, value);
    } catch (cause: unknown) {
      return err(gitFailure(`merge config ${key}`, cause));
    }
  }
  try {
    await args.git.commit(MERGE_ROOT_MESSAGE, true);
  } catch (cause: unknown) {
    return err(gitFailure('merge root commit', cause));
  }
  return ok(undefined);
}

interface PreparedSource {
  dir: string;
  tagEntries: [string, string][];
  hasTags: boolean;
}

/** Clone full (tags must survive) -> filter-repo extract -> tag collection. */
async function prepareSource(args: {
  workdir: string;
  index: number;
  source: NormalizedSource;
  clone: CloneLike;
  extract: FilterRepoLike;
  list: ListTagsLike;
  jobId?: string;
  log: Logger;
}): Promise<Result<PreparedSource, StitchError>> {
  const { source } = args;
  const dir = join(args.workdir, `src-${String(args.index)}-${source.name}`);
  const cloned = await args.clone({
    url: source.url,
    targetDir: dir,
    shallow: false,
    ...(source.ref !== undefined ? { branch: source.ref } : {}),
    ...(args.jobId !== undefined ? { jobId: args.jobId } : {}),
  });
  if (cloned.isErr()) return err(cloned.error);
  const namespace = `${source.prefix}/`;
  const extracted = await args.extract({
    repoPath: dir,
    paths: source.paths,
    targetSubdir: source.prefix,
    tagPrefix: namespace,
    ...(args.jobId !== undefined ? { jobId: args.jobId } : {}),
  });
  if (extracted.isErr()) return err(extracted.error);
  const listed = await args.list(dir);
  if (listed.isErr()) return err(listed.error);
  const tagEntries: [string, string][] = listed.value.map(tag => [
    tag,
    tag.startsWith(namespace) ? tag.slice(namespace.length) : tag,
  ]);
  args.log.info(
    { source: source.name, tags: tagEntries.length },
    'source extracted and tags collected'
  );
  return ok({ dir, tagEntries, hasTags: tagEntries.length > 0 });
}

/** Conclude a resolver-fixed merge: stage everything, commit, verify clean. */
async function concludeResolution(args: {
  child: MergeGit;
  sourceName: string;
  conflicts: string[];
}): Promise<Result<string[], StitchError>> {
  try {
    await args.child.add(['-A']);
  } catch (cause: unknown) {
    return err(gitFailure(`merge stage resolved ${args.sourceName}`, cause));
  }
  try {
    await args.child.commit(`Merge source '${args.sourceName}' (conflicts resolved)`, false);
  } catch (cause: unknown) {
    return err(gitFailure(`merge commit resolved ${args.sourceName}`, cause));
  }
  let clean: MergeStatus;
  try {
    clean = await args.child.status();
  } catch (cause: unknown) {
    return err(gitFailure(`merge verify resolved ${args.sourceName}`, cause));
  }
  if (!clean.clean) {
    return err({
      code: 'GIT_ERROR',
      message: `merge resolver left uncommitted changes in source "${args.sourceName}"`,
    });
  }
  return ok(args.conflicts);
}

/**
 * Fetch one extracted source by tip SHA and merge it with
 * --allow-unrelated-histories. Returns the (sorted) conflict list when a
 * resolver fixed the merge, else [].
 */
async function integrateSource(args: {
  child: MergeGit;
  childPath: string;
  source: NormalizedSource;
  extractedDir: string;
  createGit: (options: GitFactoryOptions) => MergeGit;
  resolver?: ConflictResolver;
  log: Logger;
}): Promise<Result<string[], StitchError>> {
  const { child, source } = args;
  try {
    await child.addRemote(source.name, args.extractedDir);
  } catch (cause: unknown) {
    return err(gitFailure(`merge remote add ${source.name}`, cause));
  }
  let tip: string;
  try {
    tip = await args.createGit({ baseDir: args.extractedDir }).revparse('HEAD');
  } catch (cause: unknown) {
    return err(gitFailure(`merge read tip ${source.name}`, cause));
  }
  try {
    await child.fetch(source.name, tip);
  } catch (cause: unknown) {
    return err(gitFailure(`merge fetch ${source.name}`, cause));
  }
  let mergeError: string | undefined;
  try {
    await child.merge([
      '--allow-unrelated-histories',
      '-m',
      `Merge source '${source.name}' into child`,
      'FETCH_HEAD',
    ]);
    return ok([]);
  } catch (cause: unknown) {
    mergeError = causeDetail(cause);
  }
  let status: MergeStatus;
  try {
    status = await child.status();
  } catch (cause: unknown) {
    return err(gitFailure(`merge inspect ${source.name}`, cause));
  }
  const conflicted = [...status.conflicted].sort();
  if (conflicted.length === 0) {
    return err({
      code: 'GIT_ERROR',
      message: `merge of source "${source.name}" failed without conflicts: ${mergeError ?? 'unknown'}`,
      gitOutput: mergeError,
    });
  }
  args.log.warn({ source: source.name, conflicted }, 'merge conflicts detected');
  if (args.resolver === undefined) {
    return err({
      code: 'GIT_ERROR',
      message: `merge conflicts in source "${source.name}": ${conflicted.join(', ')}`,
      gitOutput: conflicted.join('\n'),
    });
  }
  let decision: Result<{ resolved: boolean }, StitchError>;
  try {
    decision = await args.resolver({
      childPath: args.childPath,
      conflicts: conflicted,
      source: source.name,
    });
  } catch (cause: unknown) {
    return err(internalError(`merge resolver threw for ${source.name}`, cause));
  }
  if (decision.isErr()) return err(decision.error);
  if (!decision.value.resolved) {
    return err({
      code: 'GIT_ERROR',
      message: `merge conflicts in source "${source.name}" left unresolved: ${conflicted.join(', ')}`,
      gitOutput: conflicted.join('\n'),
    });
  }
  const concluded = await concludeResolution({
    child,
    sourceName: source.name,
    conflicts: conflicted,
  });
  if (concluded.isErr()) return err(concluded.error);
  return ok(concluded.value);
}

/** Fetch namespaced tags (skipped for tagless sources: empty refspec fails). */
async function fetchSourceTags(args: {
  child: MergeGit;
  name: string;
  hasTags: boolean;
}): Promise<Result<void, StitchError>> {
  if (!args.hasTags) return ok(undefined);
  try {
    await args.child.fetch(args.name, '+refs/tags/*:refs/tags/*');
  } catch (cause: unknown) {
    return err(gitFailure(`merge tag fetch ${args.name}`, cause));
  }
  return ok(undefined);
}

async function finalizeChild(args: {
  git: MergeGit;
}): Promise<Result<{ treeSha: string; commitShas: string[] }, StitchError>> {
  let treeSha: string;
  try {
    treeSha = (await args.git.revparse('HEAD^{tree}')).trim();
  } catch (cause: unknown) {
    return err(gitFailure('merge tree lookup', cause));
  }
  let logged: MergeLog;
  try {
    logged = await args.git.log();
  } catch (cause: unknown) {
    return err(gitFailure('merge log', cause));
  }
  return ok({ treeSha, commitShas: logged.commits });
}

interface BuildArgs {
  sources: NormalizedSource[];
  workdir: string;
  childPath: string;
  identity: { name: string; email: string; date: string };
  clone: CloneLike;
  extract: FilterRepoLike;
  list: ListTagsLike;
  makeGit: (options: GitFactoryOptions) => MergeGit;
  resolver?: ConflictResolver;
  jobId?: string;
  log: Logger;
}

/** Clone -> extract -> tags -> merge each source, then finalize. No cleanup. */
async function buildChild(args: BuildArgs): Promise<Result<MergeResult, StitchError>> {
  const child = args.makeGit({ baseDir: args.childPath });
  applyDeterministicIdentity(child, args.identity);
  const inited = await initChild({ git: child, log: args.log });
  if (inited.isErr()) return err(inited.error);
  const tagEntries: [string, string][] = [];
  const conflictList: string[] = [];
  for (const [index, source] of args.sources.entries()) {
    const prepared = await prepareSource({
      workdir: args.workdir,
      index,
      source,
      clone: args.clone,
      extract: args.extract,
      list: args.list,
      ...(args.jobId !== undefined ? { jobId: args.jobId } : {}),
      log: args.log,
    });
    if (prepared.isErr()) return err(prepared.error);
    for (const entry of prepared.value.tagEntries) tagEntries.push(entry);
    const integrated = await integrateSource({
      child,
      childPath: args.childPath,
      source,
      extractedDir: prepared.value.dir,
      createGit: args.makeGit,
      ...(args.resolver !== undefined ? { resolver: args.resolver } : {}),
      log: args.log,
    });
    if (integrated.isErr()) return err(integrated.error);
    for (const conflict of integrated.value) conflictList.push(conflict);
    const fetched = await fetchSourceTags({
      child,
      name: source.name,
      hasTags: prepared.value.hasTags,
    });
    if (fetched.isErr()) return err(fetched.error);
    args.log.info({ source: source.name }, 'source integrated');
  }
  const final = await finalizeChild({ git: child });
  if (final.isErr()) return err(final.error);
  return ok({
    childPath: args.childPath,
    treeSha: final.value.treeSha,
    commitShas: final.value.commitShas,
    tagMap: new Map(tagEntries),
    conflictList,
  });
}

/**
 * Merge sources A+B (+N) into a unified child repo. See the header for the
 * composition, atomicity, and determinism contracts.
 */
export async function mergeRepos(
  opts: MergeOptions,
  runtime: MergeRuntime = {}
): Promise<Result<MergeResult, StitchError>> {
  const normalized = validateMergeOptions(opts);
  if (normalized.isErr()) return err(normalized.error);
  const log = (opts.jobId === undefined ? logger : createJobLogger(opts.jobId)).child({
    op: 'merge',
    sources: normalized.value.sources.map(source => source.name),
  });
  const prepared = await preparePaths({
    ...(normalized.value.targetDir !== undefined ? { targetDir: normalized.value.targetDir } : {}),
    log,
  });
  if (prepared.isErr()) return err(prepared.error);
  const { workdir, childPath, explicitTarget } = prepared.value;
  log.info({ childPath }, 'merging sources');

  let failed = true;
  try {
    const built = await buildChild({
      sources: normalized.value.sources,
      workdir,
      childPath,
      identity: {
        name: normalized.value.authorName,
        email: normalized.value.authorEmail,
        date: normalized.value.authorDate,
      },
      clone: runtime.clone ?? cloneRepo,
      extract: runtime.extract ?? extractPathsViaFilterRepo,
      list: runtime.listTags ?? listTags,
      makeGit: runtime.createGit ?? defaultCreateGit,
      ...(opts.resolveConflicts !== undefined ? { resolver: opts.resolveConflicts } : {}),
      ...(opts.jobId !== undefined ? { jobId: opts.jobId } : {}),
      log,
    });
    if (built.isErr()) {
      await removePath(childPath, log, 'child');
      return err(built.error);
    }
    failed = false;
    log.info(
      { tree: built.value.treeSha, commits: built.value.commitShas.length },
      'merge complete'
    );
    return ok(built.value);
  } finally {
    // Clones are always temp; the default-target child lives in the workdir
    // and must survive success.
    if (failed || explicitTarget) await removePath(workdir, log, 'workdir');
  }
}
