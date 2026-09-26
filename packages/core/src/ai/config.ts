// Shared constructor config for OpenAI-compatible providers (P-132).
//
// Covers OpenRouter (primary), OpenAI, and Ollama through one shape:
// only `provider` + `apiKey` + `model` are required; `baseUrl` overrides
// the per-provider default (Ollama's custom port, Azure OpenAI), and
// `defaultHeaders` carries OpenRouter dashboard attribution
// (`HTTP-Referer` / `X-Title`) without the wrapper hardcoding them.
export interface OpenAICompatibleConfig {
  provider: string;
  model: string;
  apiKey: string;
  baseUrl?: string;
  defaultHeaders?: Record<string, string>;
}

// Shared constructor config for Anthropic (P-133).
//
// `maxTokens` defaults to 4096 (Anthropic's default); override for
// thinking budgets, custom limits, etc. `baseUrl` enables proxies.
export interface AnthropicConfig {
  model: string;
  apiKey: string;
  baseUrl?: string;
  maxTokens?: number;
}

// Provider configuration schema (P-134).
//
// Zod-validated config that the registry consumes. API keys are resolved
// from config first, then from environment variables as a fallback.
// Never stored, only referenced at runtime.
import { z } from 'zod';

export const ProviderConfigSchema = z.object({
  provider: z.enum(['openrouter', 'openai', 'anthropic', 'ollama', 'mock']),
  model: z.string().min(1),
  apiKey: z.string().min(1).optional(),
  baseUrl: z.string().url().optional(),
  maxTokens: z.number().int().positive().optional(),
  preferStreaming: z.boolean().default(true),
  temperature: z.number().min(0).max(2).optional(),
});
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;

/**
 * Config as a caller *writes* it. `preferStreaming` carries `.default(true)`,
 * so the parsed (output) type requires it while the input type may omit it.
 * `createProvider` / `resolveApiKey` accept this shape so callers and tests
 * can build literals without restating defaults.
 */
export type ProviderConfigInput = z.input<typeof ProviderConfigSchema>;

// Environment variable names for each provider's API key.
export const PROVIDER_ENV_KEYS: Record<string, string> = {
  openrouter: 'OPENROUTER_API_KEY',
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  ollama: '', // Ollama typically doesn't need an API key
  mock: '',
};

/**
 * Resolve the API key for a provider from config, then environment.
 * Returns the key if found, or undefined if not configured.
 */
export function resolveApiKey(config: ProviderConfigInput): string | undefined {
  if (config.apiKey && config.apiKey.length > 0) {
    return config.apiKey;
  }
  const envKey = PROVIDER_ENV_KEYS[config.provider];
  if (envKey && process.env[envKey]) {
    return process.env[envKey];
  }
  // Ollama and mock don't require API keys
  if (config.provider === 'ollama' || config.provider === 'mock') {
    return '';
  }
  return undefined;
}
