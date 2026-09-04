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
