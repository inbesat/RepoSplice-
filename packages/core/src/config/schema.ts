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
  /**
   * P-168: whether containers may reach the network. `false` starts every
   * container with `NetworkMode: 'none'` (the offline posture P-174 owns).
   * Optional so existing configs are unchanged; `undefined` means "allowed",
   * which is the behaviour that predates this field.
   */
  networkAllow: z.boolean().optional(),
  /**
   * P-169: per-ecosystem image overrides (`sandbox.overrideImage.node` etc.).
   * A user-provided tag short-circuits both the pull and the local build.
   * Keys are the P-103 ecosystem names (`node` | `python` | `rust` | `go`);
   * unknown keys are ignored rather than rejected, so a stale entry cannot
   * break image resolution.
   */
  overrideImage: z.record(z.string(), z.string().min(1)).optional(),
  /**
   * P-169: build each `Dockerfile.<ecosystem>` locally instead of pulling the
   * pinned public image. Requires `dockerfileDir` to be supplied to
   * `ensureImage` (see ADR-042).
   */
  buildLocal: z.boolean().optional(),
  /**
   * P-173: total bytes of artifacts the capture step may extract per run.
   * Bounds disk/memory when a runaway build produces a huge output tree.
   * Optional; `undefined` uses the code default (100 MB).
   */
  maxArtifactBytes: z.number().int().positive().optional(),
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

/**
 * P-158 `[agent]` block: limits on what a tool may hand back to the model.
 *
 * Both fields default, so a config written before P-158 still validates and
 * the effective limits are always present. `maxToolResultBytes` exists because
 * a large-repo tool (`select_files` over a monorepo, `detect_gaps` across a
 * whole ecosystem) can legitimately exceed 1MB, and the correct fix for that is
 * a larger budget — not silently truncating the result.
 */
export const AgentConfigSchema = z.object({
  maxToolResultBytes: z.number().int().positive().default(1_000_000),
  maxToolArgsDepth: z.number().int().positive().max(256).default(16),
  // P-164: the hard spend/iteration guard. 0 means "off" for the two budgets,
  // which is why they are `nonnegative` rather than `positive` - a zero default
  // that meant "spend nothing" would kill every run on its first iteration.
  maxIterations: z.number().int().positive().default(20),
  maxTokens: z.number().int().nonnegative().default(0),
  maxCostUsd: z.number().nonnegative().default(0),
});
export type AgentConfig = z.infer<typeof AgentConfigSchema>;

export const ConfigSchema = z.object({
  github: GitHubConfigSchema,
  openrouter: OpenRouterConfigSchema,
  anthropic: AnthropicConfigSchema,
  ollama: OllamaConfigSchema,
  sandbox: SandboxConfigSchema,
  paths: PathsConfigSchema,
  licensePolicy: LicensePolicySchema,
  autonomy: AutonomySchema,
  agent: AgentConfigSchema.default({
    maxToolResultBytes: 1_000_000,
    maxToolArgsDepth: 16,
    maxIterations: 20,
    maxTokens: 0,
    maxCostUsd: 0,
  }),
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
  agent: {
    maxToolResultBytes: 1_000_000,
    maxToolArgsDepth: 16,
    maxIterations: 20,
    maxTokens: 0,
    maxCostUsd: 0,
  },
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
