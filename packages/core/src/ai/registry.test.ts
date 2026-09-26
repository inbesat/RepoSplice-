import { describe, it, expect, vi, afterEach } from 'vitest';
import { createProvider, providerRegistry, type ProviderFactory } from './registry.js';
import { ProviderConfigSchema } from './config.js';

const BUILTIN_PROVIDERS = ['openrouter', 'openai', 'anthropic', 'ollama', 'mock'];

afterEach(() => {
  vi.restoreAllMocks();
  const toDelete: string[] = [];
  for (const key of providerRegistry.keys()) {
    if (!BUILTIN_PROVIDERS.includes(key)) toDelete.push(key);
  }
  for (const key of toDelete) providerRegistry.delete(key);
});

describe('P-134 registry: creates providers', () => {
  it('creates openrouter provider', async () => {
    const result = await createProvider({
      provider: 'openrouter',
      model: 'anthropic/claude-sonnet-4',
      apiKey: 'sk-or-test',
    });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const provider = result.value;
      expect(provider.provider).toBe('openrouter');
      expect(provider.name).toContain('openrouter');
      expect(typeof provider.chat).toBe('function');
      expect(typeof provider.countTokens).toBe('function');
      expect(typeof provider.isRetryable).toBe('function');
    }
  });

  it('creates anthropic provider', async () => {
    const result = await createProvider({
      provider: 'anthropic',
      model: 'claude-sonnet-4',
      apiKey: 'sk-ant-test',
    });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const provider = result.value;
      expect(provider.provider).toBe('anthropic');
      expect(provider.name).toContain('anthropic');
    }
  });

  it('creates ollama with no key', async () => {
    const result = await createProvider({ provider: 'ollama', model: 'llama3.1' });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) expect(result.value.provider).toBe('ollama');
  });

  it('creates mock provider', async () => {
    const result = await createProvider({ provider: 'mock', model: 'mock-model' });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) expect(result.value.provider).toBe('mock');
  });
});

describe('P-134 registry: resolves api key from env', () => {
  it('resolves api key from env', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'sk-or-env');
    const result = await createProvider({ provider: 'openrouter', model: 'test-model' });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) expect(result.value.model).toBe('test-model');
  });
});

describe('P-134 registry: fails on invalid config', () => {
  it('fails on invalid config', async () => {
    const result = await createProvider({
      provider: 'invalid-provider' as never,
      model: 'test',
      apiKey: 'sk-test',
    });
    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.code).toBe('INVALID_PROVIDER');
  });

  it('fails on missing apiKey for openrouter', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', '');
    const result = await createProvider({ provider: 'openrouter', model: 'test-model' });
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      const error = result.error;
      expect(error.code).toBe('CONFIG_ERROR');
      if (error.code === 'CONFIG_ERROR') {
        expect(error.field).toBe('apiKey');
        expect(error.message).toContain('OPENROUTER_API_KEY');
      }
    }
  });

  it('fails zod validation for invalid provider', () => {
    const result = ProviderConfigSchema.safeParse({
      provider: 'invalid',
      model: 'test',
      apiKey: 'sk-test',
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toContain('provider');
  });
});

describe('P-134 registry: rejects non-conforming provider', () => {
  it('rejects non-conforming provider', async () => {
    providerRegistry.set('bad-provider', () => ({
      name: '',
      model: 'bad',
      provider: 'bad',
      id: 'bad',
      chat: async function* () {
        yield {
          content: '',
          toolCalls: [],
          finishReason: 'stop' as const,
          usage: { input: 0, output: 0, total: 0 },
        };
      },
      countTokens: () => 0,
      isRetryable: () => false,
    }));
    const result = await createProvider({
      provider: 'bad-provider' as never,
      model: 'test',
      apiKey: 'sk-test',
    });
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      const error = result.error;
      expect(error.code).toBe('INVALID_PROVIDER');
      if (error.code === 'INVALID_PROVIDER') {
        expect(error.message).toContain('contract validation');
      }
    }
  });
});

describe('P-134 registry: registry operations', () => {
  it('registerProvider and getProviderFactory work', async () => {
    const { registerProvider, getProviderFactory } = await import('./registry.js');
    const factory: ProviderFactory = config => ({
      name: 'custom',
      model: config.model,
      provider: 'custom',
      id: 'custom',
      chat: async function* () {
        yield {
          content: '',
          toolCalls: [],
          finishReason: 'stop' as const,
          usage: { input: 0, output: 0, total: 0 },
        };
      },
      countTokens: () => 0,
      isRetryable: () => false,
    });
    registerProvider('custom-test', factory);
    const retrieved = getProviderFactory('custom-test');
    expect(retrieved).toBe(factory);
    expect(() => registerProvider('custom-test', factory)).toThrow();
  });
});
