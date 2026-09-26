import { describe, it, expect } from 'vitest';
import { conformsToChatProvider, isRetryableError } from './provider.js';
import type { ChatProvider } from './provider.js';
import type { ChatMessage, ChatOptions, ChatResponse, ProviderError, ToolSchema } from './types.js';

function makeMockProvider(): ChatProvider {
  return {
    name: 'mock-chat',
    model: 'mock-1',
    provider: 'mock',
    id: 'mock/mock-1',
    async *chat(
      messages: ChatMessage[],
      _tools?: ToolSchema[],
      _options?: ChatOptions
    ): AsyncIterable<ChatResponse> {
      void messages;
      yield {
        content: 'hello ',
        toolCalls: [],
        finishReason: 'stop',
        usage: { input: 3, output: 0, total: 3 },
      };
      yield {
        content: 'world',
        toolCalls: [],
        finishReason: 'stop',
        usage: { input: 3, output: 2, total: 5 },
      };
    },
    countTokens(messages: ChatMessage[]): number {
      return messages.reduce((sum, m) => sum + m.content.length, 0);
    },
    isRetryable(err: ProviderError): boolean {
      return isRetryableError(err);
    },
  };
}

function makeProviderError(kind: ProviderError['kind'], retryable: boolean): ProviderError {
  return { kind, message: `${kind} boom`, providerName: 'mock', retryable };
}

describe('P-131 provider: interface contract', () => {
  it('interface compiles via conformsToChatProvider(mock)', () => {
    const mock = makeMockProvider();
    expect(() => conformsToChatProvider(mock)).not.toThrow();
    expect(mock.name).toBe('mock-chat');
    expect(mock.model).toBe('mock-1');
    expect(mock.provider).toBe('mock');
    expect(mock.id).toBe('mock/mock-1');
    expect(mock.countTokens([{ role: 'user', content: 'ping' }])).toBe(4);
    expect(mock.isRetryable(makeProviderError('rate_limit', true))).toBe(true);
    expect(mock.isRetryable(makeProviderError('auth', false))).toBe(false);
  });

  it('rejects malformed provider', () => {
    expect(() => conformsToChatProvider(null)).toThrow(/must be an object/);
    expect(() => conformsToChatProvider('mock')).toThrow(/must be an object/);
    expect(() => conformsToChatProvider({})).toThrow(/non-empty string/);
    expect(() =>
      conformsToChatProvider({
        name: '',
        model: 'm',
        provider: 'p',
        id: 'p/m',
        chat: async function* () {},
        countTokens: () => 0,
        isRetryable: () => false,
      })
    ).toThrow(/provider\.name/);
    expect(() =>
      conformsToChatProvider({
        name: 'n',
        model: 'm',
        provider: 'p',
        id: 'p/m',
        countTokens: () => 0,
        isRetryable: () => false,
      })
    ).toThrow(/provider\.chat/);
    expect(() =>
      conformsToChatProvider({
        name: 'n',
        model: 'm',
        provider: 'p',
        id: 'p/m',
        chat: async function* () {},
        countTokens: 42,
        isRetryable: () => false,
      })
    ).toThrow(/provider\.countTokens/);
  });

  it('types stream as AsyncIterable', async () => {
    const mock = makeMockProvider();
    const stream: AsyncIterable<ChatResponse> = mock.chat([{ role: 'user', content: 'ping' }]);
    expect(typeof stream[Symbol.asyncIterator]).toBe('function');
    let combined = '';
    let chunks = 0;
    for await (const chunk of stream) {
      combined += chunk.content;
      chunks += 1;
      expect(chunk.finishReason).toBe('stop');
    }
    expect(chunks).toBe(2);
    expect(combined).toBe('hello world');
  });
});
