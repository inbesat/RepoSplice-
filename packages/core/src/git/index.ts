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
export { extractPathsViaFilterRepo, DEFAULT_FILTER_REPO_TIMEOUT_MS } from './filterRepo.js';
export type {
  FilterRepoOptions,
  FilterRepoOutput,
  FilterRepoRunner,
  FilterRepoRuntime,
} from './filterRepo.js';
export {
  cloneRepo,
  redactUrlCredentials,
  DEFAULT_CLONE_DEPTH,
  DEFAULT_CLONE_TIMEOUT_MS,
} from './clone.js';
export type { CloneCredentials, CloneGit, CloneOptions, CloneRuntime } from './clone.js';
