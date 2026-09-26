import { describe, it, expect } from 'vitest';
import { MockProvider, mockScriptFromText, type MockStep } from './mock.js';
import type { ChatResponse, ProviderError } from './types.js';

describe('P-144 mock: plays back script', () => {
  it('plays back script', async () => {
    const script: MockStep[] = [
      { kind: 'text', text: 'Hello ' },
      { kind: 'text', text: 'world' },
      {
        kind: 'tool_call',
        toolCall: { id: 'call_1', name: 'test_tool', arguments: { foo: 'bar' } },
      },
      { kind: 'finish', finishReason: 'tool_calls', usage: { input: 100, output: 50, total: 150 } },
    ];
    const provider = new MockProvider({ script });

    const responses = [];
    for await (const resp of provider.chat([{ role: 'user', content: 'test' }])) {
      responses.push(resp);
    }

    expect(responses).toHaveLength(1);
    expect(responses[0]!.content).toBe('Hello world');
    expect(responses[0]!.toolCalls).toHaveLength(1);
    expect(responses[0]!.toolCalls[0]!.name).toBe('test_tool');
    expect(responses[0]!.finishReason).toBe('tool_calls');
    expect(responses[0]!.usage.total).toBe(150);
  });

  it('plays back script with stop finish', async () => {
    const script: MockStep[] = [
      { kind: 'text', text: 'Done' },
      { kind: 'finish', finishReason: 'stop', usage: { input: 10, output: 5, total: 15 } },
    ];
    const provider = new MockProvider({ script });

    const responses = [];
    for await (const resp of provider.chat([])) {
      responses.push(resp);
    }

    expect(responses[0]!.finishReason).toBe('stop');
    expect(responses[0]!.content).toBe('Done');
  });
});

describe('P-144 mock: throws configured error', () => {
  it('throws configured error', async () => {
    const error: ProviderError = {
      kind: 'rate_limit',
      message: 'Rate limited',
      providerName: 'mock',
      retryable: true,
    };
    const provider = new MockProvider({ failWith: error });

    await expect(async () => {
      const seen: ChatResponse[] = [];
      for await (const resp of provider.chat([])) {
        seen.push(resp); // should not reach here
      }
    }).rejects.toThrow();
  });
});

describe('P-144 mock: defaults to stop', () => {
  it('defaults to stop when no script', async () => {
    const provider = new MockProvider();

    const responses = [];
    for await (const resp of provider.chat([])) {
      responses.push(resp);
    }

    expect(responses).toHaveLength(1);
    expect(responses[0]!.finishReason).toBe('stop');
    expect(responses[0]!.content).toBe('');
    expect(responses[0]!.toolCalls).toHaveLength(0);
  });

  it('echoes content when set', async () => {
    const provider = new MockProvider({ echoContent: 'Echo reply' });

    const responses = [];
    for await (const resp of provider.chat([])) {
      responses.push(resp);
    }

    expect(responses[0]!.content).toBe('Echo reply');
  });
});

describe('P-144 mock: counts calls and records messages', () => {
  it('counts calls and records messages', async () => {
    const provider = new MockProvider();

    expect(provider.calls).toBe(0);

    const msgs1 = [{ role: 'user' as const, content: 'first' }];
    const seen1: ChatResponse[] = [];
    for await (const resp of provider.chat(msgs1)) {
      seen1.push(resp);
    }

    expect(provider.calls).toBe(1);
    expect(provider.lastMessages).toBe(msgs1);
    expect(seen1).toHaveLength(1);

    const msgs2 = [{ role: 'user' as const, content: 'second' }];
    const seen2: ChatResponse[] = [];
    for await (const resp of provider.chat(msgs2)) {
      seen2.push(resp);
    }

    expect(provider.calls).toBe(2);
    expect(provider.lastMessages).toBe(msgs2);
    expect(seen2).toHaveLength(1);
  });

  it('counts tokens heuristically', () => {
    const provider = new MockProvider();
    const tokens = provider.countTokens([
      { role: 'user', content: 'Hello world this is a test' },
      { role: 'assistant', content: 'Response' },
    ]);
    expect(tokens).toBeGreaterThan(0);
    // ~4 chars per token
    expect(tokens).toBe(
      Math.ceil('Hello world this is a test'.length / 4) + Math.ceil('Response'.length / 4)
    );
  });
});

describe('P-144 mock: registerable via createProvider', () => {
  it('registerable via createProvider', async () => {
    // Mock is registered by default in the registry
    const { createProvider } = await import('./registry.js');

    const result = await createProvider({
      provider: 'mock',
      model: 'mock-model',
      apiKey: '',
      preferStreaming: true,
    });

    expect(result.isOk()).toBe(true);
    const provider = result._unsafeUnwrap();
    expect(provider.provider).toBe('mock');
  });
});

describe('P-144 mock: convenience helpers', () => {
  it('mockScriptFromText creates echo provider', async () => {
    const provider = mockScriptFromText('Test echo');

    const responses = [];
    for await (const resp of provider.chat([])) {
      responses.push(resp);
    }

    expect(responses[0]!.content).toBe('Test echo');
    expect(responses[0]!.finishReason).toBe('stop');
  });

  it('isRetryable delegates to isRetryableError', () => {
    const provider = new MockProvider();
    const retryable: ProviderError = {
      kind: 'rate_limit',
      message: 'rl',
      providerName: 'mock',
      retryable: true,
    };
    const notRetryable: ProviderError = {
      kind: 'auth',
      message: '401',
      providerName: 'mock',
      retryable: false,
    };

    expect(provider.isRetryable(retryable)).toBe(true);
    expect(provider.isRetryable(notRetryable)).toBe(false);
  });
});
