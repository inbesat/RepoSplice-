// git subtree barrel (P-069): the public surface of packages/core/src/git.
// Mirrors util/index.ts — core/src/index.ts re-exports through here, and
// cli/web must still import only via the root barrel (P-013).
export { createGit, checkGitAvailable, isRepo, getStatus, getLog, initRepo } from './factory.js';
export type { Git, GitFactoryOptions } from './factory.js';
export {
  MIN_GIT_VERSION,
  parseGitVersion,
  isGitVersionSupported,
  checkGitVersionOutput,
  localGitVersion,
} from './version.js';
export { checkFilterRepoStatus } from './filterRepo.js';
export type { FilterRepoStatus } from './filterRepo.js';
export { listTags, renameTags } from './tagRename.js';
export type { RenameTagsOptions, RenameTagsResult, TagRenameRuntime } from './tagRename.js';
export { extractPathsViaFilterRepo, DEFAULT_FILTER_REPO_TIMEOUT_MS } from './filterRepo.js';
export type {
  FilterRepoOptions,
  FilterRepoOutput,
  FilterRepoRunner,
  FilterRepoRuntime,
} from './filterRepo.js';
export { mergeRepos, MERGE_AUTHOR_NAME, MERGE_AUTHOR_EMAIL, MERGE_FIXED_DATE } from './merge.js';
export type {
  MergeSource,
  MergeAuthor,
  MergeOptions,
  MergeResult,
  MergeGit,
  MergeStatus,
  MergeLog,
  MergeRuntime,
  ConflictInput,
  ConflictResolver,
  CloneLike,
  FilterRepoLike,
  ListTagsLike,
} from './merge.js';
export {
  cloneRepo,
  redactUrlCredentials,
  DEFAULT_CLONE_DEPTH,
  DEFAULT_CLONE_TIMEOUT_MS,
} from './clone.js';
export type { CloneCredentials, CloneGit, CloneOptions, CloneRuntime } from './clone.js';
export {
  subtreeAdd,
  selectExtractStrategy,
  DEFAULT_SUBTREE_TIMEOUT_MS,
  SUBTREE_AUTHOR_NAME,
  SUBTREE_AUTHOR_EMAIL,
} from './subtree.js';
export type {
  SubtreeOpts,
  SubtreeGit,
  SubtreeRuntime,
  ExtractStrategy,
  StrategyInput,
} from './subtree.js';
export { cherryPickRange, DEFAULT_CHERRY_PICK_TIMEOUT_MS } from './cherryPick.js';
export type {
  CherryPickOpts,
  CherryPickResolveInput,
  CherryPickResolver,
  CherryPickStatus,
  CherryPickGit,
  CherryPickRuntime,
} from './cherryPick.js';
export {
  writeToWorktree,
  removeWorktree,
  parseWorktreeList,
  samePath,
  DEFAULT_WORKTREE_TIMEOUT_MS,
} from './worktree.js';
export type {
  VerifyVerdict,
  VerifyTree,
  WorktreeFile,
  WriteWorktreeOpts,
  WriteWorktreeResult,
  RemoveWorktreeOpts,
  WorktreeRunResult,
  WorktreeRunner,
  WorktreeFs,
  WorktreeRuntime,
} from './worktree.js';
export { commitWithTrailers, buildCommitMessage, DEFAULT_COMMIT_TIMEOUT_MS } from './commit.js';
export type {
  CoAuthor,
  CommitOpts,
  CommitRunner,
  CommitRunResult,
  CommitRuntime,
} from './commit.js';
export {
  pushToRemote,
  parseGitHubRemote,
  DEFAULT_PUSH_TIMEOUT_MS,
  DEFAULT_PROTECTED_BRANCHES,
} from './push.js';
export type {
  PushOpts,
  PushRunner,
  PushRunResult,
  PushRuntime,
  RemoteRepoCheck,
  RepoCreator,
  GitHubRemote,
} from './push.js';
export {
  buildBlameMap,
  saveBlameMap,
  loadBlameMap,
  parseBlamePorcelain,
  DEFAULT_BLAME_TIMEOUT_MS,
} from './blameMap.js';
export type {
  BlameSource,
  LineOrigin,
  FileBlame,
  BlameMap,
  BlameOpts,
  BlameRunner,
  BlameRunResult,
  BlameRuntime,
} from './blameMap.js';
export { createBranch, deleteBranch, renameBranch, DEFAULT_BRANCH_TIMEOUT_MS } from './branches.js';
export type { BranchOpts, BranchRunner, BranchRunResult, BranchRuntime } from './branches.js';
export {
  safeStash,
  safeStashPop,
  DEFAULT_STASH_TIMEOUT_MS,
  DEFAULT_STASH_MESSAGE,
} from './stash.js';
export type {
  StashOpts,
  PopOpts,
  StashOutcome,
  PopOutcome,
  StashRunner,
  StashRunResult,
  StashRuntime,
} from './stash.js';
export {
  mergeGitignores,
  collectGitignores,
  mergeIgnoreTexts,
  rebasePattern,
  DEFAULT_GITIGNORE_GENERATED_AT,
} from './gitignoreMerge.js';
export type {
  GitignoreSource,
  GitignoreRoot,
  GitignoreMergeOpts,
  MergedGitignore,
  MergeEntry,
  MergedIgnoreTexts,
} from './gitignoreMerge.js';
export {
  isBinary,
  classifyFiles,
  parseCheckAttr,
  saveSkipList,
  loadSkipList,
  DEFAULT_BINARY_TIMEOUT_MS,
} from './binary.js';
export type {
  SkipReason,
  SkipDecision,
  BinaryOpts,
  BinaryRuntime,
  BinaryFs,
  BinaryRunResult,
  BinaryRunner,
  BinaryVerdict,
  ClassifiedFiles,
  SkipList,
} from './binary.js';
export {
  detectConflicts,
  resolveConflicts,
  classifyStages,
  unionGitignoreSides,
  resolveTargetPath,
  DEFAULT_CONFLICT_TIMEOUT_MS,
} from './conflict.js';
export type {
  Conflict,
  ConflictGate,
  ConflictKind,
  ConflictOpts,
  ConflictProposal,
  ConflictRecommendation,
  ConflictRunResult,
  ConflictRunner,
  ConflictRuntime,
  ConflictStages,
  GatedConflict,
  GateDecision,
  ManifestMerge,
  ResolvedConflict,
  ResolutionStrategy,
  ResolveReport,
} from './conflict.js';
