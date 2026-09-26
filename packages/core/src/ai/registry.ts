// Provider Registry (P-134) + Model Validation (P-135) + Tool-Calling Block (P-143).
//
// Runtime provider factory with zod-validated config. Instantiates the
// correct ChatProvider implementation based on config.provider, validates the
// instance via conformsToChatProvider (P-131), validates model capabilities
// via assertModelCapable (P-135), enforces tool-calling policy (P-143), and
// returns a ready-to-use provider with its resolved config attached for audit
// logging (P-145).
//
// Built-ins are registered with static imports: a synchronous module body
// cannot `await`, so dynamic `await import(...)` inside a factory is not an
// option here.

import { logger } from '../logger/index.js';
import { conformsToChatProvider, type ChatProvider } from './provider.js';
import { OpenAICompatibleProvider } from './openaiCompatible.js';
import { AnthropicProvider } from './anthropicProvider.js';
import { MockProvider } from './mock.js';
import { PROVIDER_ENV_KEYS, resolveApiKey, type ProviderConfigInput } from './config.js';
import { getModel, assertModelCapable, isToolCallingBlocked, type ModelSpec } from './models.js';
import type { ToolCallPolicyConfig } from './block.js';
import { type StitchError } from '../result/index.js';
import { ok, err, type Result } from 'neverthrow';

/** Constructor arguments a provider factory receives. */
export interface ProviderFactoryConfig {
  model: string;
  apiKey: string;
  baseUrl?: string;
  maxTokens?: number;
  defaultHeaders?: Record<string, string>;
}

/** Type for provider factory functions. */
export type ProviderFactory = (config: ProviderFactoryConfig) => ChatProvider;

/** Registry of provider factories. Plugins register more at runtime (P-287). */
export const providerRegistry = new Map<string, ProviderFactory>();

/**
 * The provider currently serving AI calls (P-146).
 *
 * `createProvider` publishes on success and `ProviderManager` republishes on
 * every failover, so CLI (P-196/P-198) and web (P-216) can surface which
 * backend is live without threading the manager through their call paths.
 */
let activeProvider: ChatProvider | null = null;

/** Publish the provider currently serving calls. */
export function setActiveProvider(provider: ChatProvider | null): void {
  activeProvider = provider;
}

/** The provider currently serving calls, or null before the first creation. */
export function getActiveProvider(): ChatProvider | null {
  return activeProvider;
}

/** Reset the active provider (tests / job teardown). */
export function clearActiveProviderForTests(): void {
  activeProvider = null;
}

/**
 * Register a custom provider factory.
 * Used by third-party plugins (P-287) to extend the provider ecosystem.
 * Throws if a factory for the same provider id already exists.
 */
export function registerProvider(providerId: string, factory: ProviderFactory): void {
  if (providerRegistry.has(providerId)) {
    throw new Error('Provider factory for "' + providerId + '" already registered');
  }
  providerRegistry.set(providerId, factory);
}

/**
 * Get a registered provider factory by id.
 * Throws if the provider id is not registered.
 */
export function getProviderFactory(providerId: string): ProviderFactory {
  const factory = providerRegistry.get(providerId);
  if (!factory) {
    throw new Error('No provider factory registered for "' + providerId + '"');
  }
  return factory;
}

/**
 * OpenRouter / OpenAI / Ollama share one implementation; only the `provider`
 * discriminator differs. `maxTokens` is a per-call option for this backend
 * (see OpenAICompatibleProvider.chat), not a constructor field, so it is not
 * forwarded here.
 */
function openAiCompatibleFactory(provider: string): ProviderFactory {
  return config =>
    new OpenAICompatibleProvider({
      provider,
      model: config.model,
      apiKey: config.apiKey,
      ...(config.baseUrl !== undefined ? { baseUrl: config.baseUrl } : {}),
      ...(config.defaultHeaders !== undefined ? { defaultHeaders: config.defaultHeaders } : {}),
    });
}

function anthropicFactory(config: ProviderFactoryConfig): ChatProvider {
  return new AnthropicProvider({
    model: config.model,
    apiKey: config.apiKey,
    ...(config.baseUrl !== undefined ? { baseUrl: config.baseUrl } : {}),
    ...(config.maxTokens !== undefined ? { maxTokens: config.maxTokens } : {}),
  });
}

function mockFactory(config: ProviderFactoryConfig): ChatProvider {
  return new MockProvider({ model: config.model });
}

// Built-ins registered once at module load.
providerRegistry.set('openrouter', openAiCompatibleFactory('openrouter'));
providerRegistry.set('openai', openAiCompatibleFactory('openai'));
providerRegistry.set('ollama', openAiCompatibleFactory('ollama'));
providerRegistry.set('anthropic', anthropicFactory);
// P-144: `mock` resolves with no key and no model-eligibility gate.
providerRegistry.set('mock', mockFactory);

/** Providers that never require an API key (local / test backends). */
const KEYLESS_PROVIDERS = new Set(['ollama', 'mock']);

/** Extra, phase-3 policy inputs accepted alongside the parsed config. */
export interface CreateProviderOpts {
  /** P-143: the task requires tool schemas — enforce capability + policy. */
  needsTools?: boolean;
  /** P-143: `[ai].overrideToolModels` opt-ins. */
  toolCallPolicy?: ToolCallPolicyConfig;
}

/** Extract a stable code from an error thrown by a blueprint-mandated throw. */
function thrownCode(e: unknown): string | undefined {
  if (e instanceof Error) {
    const code = (e as Error & { code?: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

function thrownMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Create a ChatProvider instance from a validated ProviderConfig.
 *
 * Order matters (P-143): an unregistered provider is rejected *before* the
 * API-key check so a typo'd provider id reports INVALID_PROVIDER rather than
 * a confusing missing-key error. Model policy is checked *before* capability,
 * because an explicit `overrideToolModels` opt-in is what lifts the
 * `supportsTools:false` gate.
 *
 * @param config - Zod-validated ProviderConfig (or an input literal)
 * @param opts - Tool requirement + policy overrides (P-143)
 * @returns Result<ChatProvider, StitchError>
 */
export async function createProvider(
  config: ProviderConfigInput,
  opts: CreateProviderOpts = {}
): Promise<Result<ChatProvider, StitchError>> {
  const providerId = config.provider;

  // 1. Provider must be registered — INVALID_PROVIDER before the key check.
  if (!providerRegistry.has(providerId)) {
    return err({
      code: 'INVALID_PROVIDER',
      message: 'Unknown provider: ' + providerId,
    });
  }

  // 2. Resolve API key (config -> env). Ollama and mock are keyless.
  if (!KEYLESS_PROVIDERS.has(providerId)) {
    if (!resolveApiKey(config)) {
      const envKeyName = PROVIDER_ENV_KEYS[providerId] ?? '';
      return err({
        code: 'CONFIG_ERROR',
        field: 'apiKey',
        message:
          'API key required for provider "' +
          providerId +
          '". Provide in config or set ' +
          (envKeyName || 'the provider API key') +
          ' environment variable.',
      });
    }
  }

  // 3. Instantiate via the registered factory.
  const factory = providerRegistry.get(providerId);
  if (!factory) {
    return err({
      code: 'INVALID_PROVIDER',
      message: 'No provider factory registered for "' + providerId + '"',
    });
  }

  const apiKey = resolveApiKey(config) ?? '';
  let provider: ChatProvider;
  try {
    provider = factory({
      model: config.model,
      apiKey,
      ...(config.baseUrl !== undefined ? { baseUrl: config.baseUrl } : {}),
      ...(config.maxTokens !== undefined ? { maxTokens: config.maxTokens } : {}),
    });
  } catch (e) {
    return err({
      code: 'INTERNAL',
      message: 'Failed to instantiate provider "' + providerId + '": ' + thrownMessage(e),
    });
  }

  // 4. Validate against the ChatProvider contract (P-131). The guard throws
  //    by blueprint, so it is caught here and re-shaped into a Result.
  try {
    conformsToChatProvider(provider);
  } catch (e) {
    return err({
      code: 'INVALID_PROVIDER',
      message: 'Provider "' + providerId + '" failed contract validation: ' + thrownMessage(e),
    });
  }

  // 5. Model gates (P-135 capability, P-143 policy).
  //    The mock backend exists for tests/dev and is always allowed.
  if (providerId !== 'mock') {
    const modelSpec = resolveModelSpec(config.model);
    if (modelSpec) {
      const policy = opts.toolCallPolicy ?? {};
      const optedIn = (policy.overrideToolModels ?? []).includes(modelSpec.id);

      if (opts.needsTools === true) {
        // Policy first: the override is what lifts the supportsTools gate.
        if (isToolCallingBlocked(modelSpec, policy)) {
          return err({
            code: 'TOOL_CALLING_BLOCKED',
            message: `Tool calling is blocked by default for model ${modelSpec.id}`,
            model: modelSpec.id,
            remedy: 'Add model to [ai].overrideToolModels in stitch.toml to opt in',
          });
        }
        if (!optedIn) {
          const capErr = capabilityError(modelSpec);
          if (capErr) return err(capErr);
        }
      }
    }
  }

  // Attach resolved config for the audit log (P-145).
  Object.defineProperty(provider, 'resolvedConfig', {
    value: config,
    writable: false,
    enumerable: false,
    configurable: false,
  });

  logger.debug({ provider: providerId, model: config.model }, 'Provider created');
  // P-146: this is the provider now serving calls until a failover replaces it.
  setActiveProvider(provider);
  return ok(provider);
}

/**
 * Look up a model, tolerating unknown ids.
 *
 * `getModel` throws `UNKNOWN_MODEL` (blueprint-declared) for ids that are not
 * in the curated registry. Plugin/local ids such as `anthropic/claude-sonnet-4`
 * legitimately fall outside it, so an unknown id warns and skips validation
 * instead of failing the provider creation.
 */
function resolveModelSpec(modelId: string): ModelSpec | undefined {
  try {
    return getModel(modelId);
  } catch (e) {
    logger.warn(
      { model: modelId, reason: thrownMessage(e) },
      'Unknown model id; skipping capability validation'
    );
    return undefined;
  }
}

/**
 * Run `assertModelCapable`, mapping its blueprint-declared throw onto a
 * typed error instead of propagating it.
 */
function capabilityError(modelSpec: ModelSpec): StitchError | undefined {
  try {
    assertModelCapable(modelSpec, { needsTools: true });
    return undefined;
  } catch (e) {
    if (thrownCode(e) === 'MODEL_INCAPABLE') {
      return { code: 'MODEL_INCAPABLE', message: thrownMessage(e) };
    }
    return {
      code: 'INTERNAL',
      message: 'Model validation failed for "' + modelSpec.id + '": ' + thrownMessage(e),
    };
  }
}

export { resolveApiKey } from './config.js';
export type { ProviderConfig, ProviderConfigInput } from './config.js';
export type { ToolCallPolicyConfig } from './block.js';
