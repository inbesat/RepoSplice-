export const CORE_NAME = '@repo-stitcher/core';

export {
  GitHubAuthTypeSchema,
  GitHubConfigSchema,
  OpenRouterConfigSchema,
  AnthropicConfigSchema,
  OllamaConfigSchema,
  SandboxBackendSchema,
  SandboxLimitsSchema,
  SandboxConfigSchema,
  PathsConfigSchema,
  LicensePolicySchema,
  AutonomySchema,
  ConfigSchema,
  defaultConfig,
  loadConfig,
} from './config/schema.js';
export type {
  GitHubAuthType,
  GitHubConfig,
  OpenRouterConfig,
  AnthropicConfig,
  OllamaConfig,
  SandboxBackend,
  SandboxLimits,
  SandboxConfig,
  PathsConfig,
  LicensePolicy,
  Autonomy,
  Config,
  ConfigLayer,
} from './config/schema.js';

export { logger, createJobLogger } from './logger/index.js';
export { redactPaths } from './logger/redact.js';

export {
  Result,
  ResultAsync,
  ok,
  err,
  okAsync,
  errAsync,
  fromPromise,
  fromSafePromise,
  fromThrowable,
  fromAsyncThrowable,
  fromInternalPromise,
  match,
  stitchOk,
  stitchErr,
  STITCH_ERROR_CODES,
} from './result/index.js';
export type { Ok, Err, ResultType, StitchError, StitchErrorCode } from './result/index.js';

export {
  monotonicId,
  shortId,
  longId,
  _resetIdCountersForTests,
  toPosix,
  normalizePath,
  trimTrailingSep,
  resolveWithin,
  safeJoin,
  buildIgnoreMatcher,
  shouldIgnore,
} from './util/index.js';
export type { IgnoreMatcher, BuildIgnoreMatcherOptions } from './util/index.js';
