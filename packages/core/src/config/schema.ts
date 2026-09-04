import { z } from 'zod';

export const GitHubAuthTypeSchema = z.enum(['pat', 'app']);
export type GitHubAuthType = z.infer<typeof GitHubAuthTypeSchema>;

export const GitHubConfigSchema = z.object({
  authType: GitHubAuthTypeSchema,
  token: z.string().min(1).optional(),
  appId: z.number().int().positive().optional(),
  privateKeyPath: z.string().min(1).optional(),
  installationId: z.number().int().positive().optional(),
});
export type GitHubConfig = z.infer<typeof GitHubConfigSchema>;

export const OpenRouterConfigSchema = z.object({
  apiKey: z.string().min(1).optional(),
  defaultModel: z.string().min(1).optional(),
});
export type OpenRouterConfig = z.infer<typeof OpenRouterConfigSchema>;

export const AnthropicConfigSchema = z.object({
  apiKey: z.string().min(1).optional(),
});
export type AnthropicConfig = z.infer<typeof AnthropicConfigSchema>;

export const OllamaConfigSchema = z.object({
  baseUrl: z.url().optional(),
});
export type OllamaConfig = z.infer<typeof OllamaConfigSchema>;

export const SandboxBackendSchema = z.enum(['docker', 'github-actions']);
export type SandboxBackend = z.infer<typeof SandboxBackendSchema>;

export const SandboxLimitsSchema = z.object({
  memory: z.string().min(1),
  cpu: z.string().min(1),
  timeout: z.number().int().positive(),
});
export type SandboxLimits = z.infer<typeof SandboxLimitsSchema>;

export const SandboxConfigSchema = z.object({
  backend: SandboxBackendSchema,
  dockerHost: z.string().min(1).optional(),
  limits: SandboxLimitsSchema,
});
export type SandboxConfig = z.infer<typeof SandboxConfigSchema>;

export const PathsConfigSchema = z.object({
  cacheDir: z.string().min(1),
  worktreeDir: z.string().min(1),
});
export type PathsConfig = z.infer<typeof PathsConfigSchema>;

export const LicensePolicySchema = z.object({
  allow: z.array(z.string()),
  warn: z.array(z.string()),
  deny: z.array(z.string()),
});
export type LicensePolicy = z.infer<typeof LicensePolicySchema>;

export const AutonomySchema = z.object({
  auto: z.array(z.string()),
  gated: z.array(z.string()),
});
export type Autonomy = z.infer<typeof AutonomySchema>;

export const ConfigSchema = z.object({
  github: GitHubConfigSchema,
  openrouter: OpenRouterConfigSchema,
  anthropic: AnthropicConfigSchema,
  ollama: OllamaConfigSchema,
  sandbox: SandboxConfigSchema,
  paths: PathsConfigSchema,
  licensePolicy: LicensePolicySchema,
  autonomy: AutonomySchema,
});
export type Config = z.infer<typeof ConfigSchema>;

export const defaultConfig: Config = {
  github: { authType: 'pat' },
  openrouter: {},
  anthropic: {},
  ollama: {},
  sandbox: {
    backend: 'docker',
    limits: { memory: '2g', cpu: '1', timeout: 600 },
  },
  paths: {
    cacheDir: '.repo-stitcher/cache',
    worktreeDir: '.repo-stitcher/worktrees',
  },
  licensePolicy: { allow: [], warn: [], deny: [] },
  autonomy: { auto: [], gated: [] },
};

export type ConfigLayer = {
  defaults?: DeepPartial<Config>;
  file?: DeepPartial<Config>;
  env?: DeepPartial<Config>;
  cli?: DeepPartial<Config>;
};

type DeepPartial<T> = T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T;

function deepMerge<T extends object>(base: T, override: DeepPartial<T> | undefined): T {
  if (override === undefined) return base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const key of Object.keys(override)) {
    const baseVal = (base as Record<string, unknown>)[key];
    const overVal = (override as Record<string, unknown>)[key];
    if (
      baseVal !== null &&
      typeof baseVal === 'object' &&
      !Array.isArray(baseVal) &&
      overVal !== null &&
      typeof overVal === 'object' &&
      !Array.isArray(overVal)
    ) {
      out[key] = deepMerge(baseVal as object, overVal as DeepPartial<typeof baseVal>);
    } else if (overVal !== undefined) {
      out[key] = overVal;
    }
  }
  return out as T;
}

export function loadConfig(layer: ConfigLayer = {}): Config {
  const merged = deepMerge(defaultConfig, layer.defaults);
  const withFile = deepMerge(merged, layer.file);
  const withEnv = deepMerge(withFile, layer.env);
  const withCli = deepMerge(withEnv, layer.cli);
  const parsed = ConfigSchema.parse(withCli);
  validateGitHubCredentials(parsed.github);
  return parsed;
}

function validateGitHubCredentials(cfg: GitHubConfig): void {
  if (cfg.authType === 'pat' && cfg.token === undefined) {
    throw new Error(
      "GitHub config invalid: authType='pat' requires a token (set github.token, GITHUB_TOKEN env, or --github-token)."
    );
  }
  if (cfg.authType === 'app') {
    const missing: string[] = [];
    if (cfg.appId === undefined) missing.push('appId');
    if (cfg.privateKeyPath === undefined) missing.push('privateKeyPath');
    if (cfg.installationId === undefined) missing.push('installationId');
    if (missing.length > 0) {
      throw new Error(`GitHub config invalid: authType='app' requires ${missing.join(', ')}.`);
    }
  }
}
