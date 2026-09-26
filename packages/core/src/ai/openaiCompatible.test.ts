import { describe, it, expect, vi, afterEach } from 'vitest';
import { logger } from '../logger/index.js';
import { redactPaths } from '../logger/redact.js';
import { OpenAICompatibleProvider, mapSdkError } from './openaiCompatible.js';
import type { ChatCompletionsPort, PortCreateArgs } from './openaiCompatible.js';
import type { ChatResponse } from './types.js';
import { DEFAULT_BASE_URLS } from './openai.js';

const CONFIG = { provider: 'openrouter', model: 'anthropic/claude-sonnet-4', apiKey: 'sk-test' };

function makeStreamPort(chunks: unknown[]): ChatCompletionsPort {
  return {
    create: (_args: PortCreateArgs): Promise<unknown> =>
      Promise.resolve(
        (async function* () {
          for (const chunk of chunks) yield chunk;
        })()
      ),
  };
}

function makeCompletionPort(completion: unknown): ChatCompletionsPort {
  return {
    create: (_args: PortCreateArgs): Promise<unknown> => Promise.resolve(completion),
  };
}

async function collect(stream: AsyncIterable<ChatResponse>): Promise<ChatResponse[]> {
  const out: ChatResponse[] = [];
  for await (const chunk of stream) out.push(chunk);
  return out;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('P-132 provider: streaming chat', () => {
  it('streams chat completion', async () => {
    const port = makeStreamPort([
      { choices: [{ delta: { content: 'Hello ' }, finish_reason: null }] },
      { choices: [{ delta: { content: 'world' }, finish_reason: null }] },
      {
        choices: [{ delta: {}, finish_reason: 'stop' }],
        usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
      },
    ]);
    const provider = new OpenAICompatibleProvider(CONFIG, port);
    const stream = provider.chat([{ role: 'user', content: 'hi' }]);
    expect(typeof stream[Symbol.asyncIterator]).toBe('function');
    const chunks = await collect(stream);
    expect(chunks).toHaveLength(3);
    expect(chunks.map(c => c.content).join('')).toBe('Hello world');
    const last = chunks[chunks.length - 1]!;
    expect(last.finishReason).toBe('stop');
    expect(last.usage).toEqual({ input: 5, output: 3, total: 8 });
  });

  it('buffers tool call deltas', async () => {
    const port = makeStreamPort([
      {
        choices: [
          {
            delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'read_file' } }] },
            finish_reason: null,
          },
        ],
      },
      {
        choices: [
          {
            delta: { tool_calls: [{ index: 0, function: { arguments: '{"path":' } }] },
            finish_reason: null,
          },
        ],
      },
      {
        choices: [
          {
            delta: { tool_calls: [{ index: 0, function: { arguments: '"src/x.ts"}' } }] },
            finish_reason: 'tool_calls',
          },
        ],
      },
    ]);
    const provider = new OpenAICompatibleProvider(CONFIG, port);
    const chunks = await collect(provider.chat([{ role: 'user', content: 'read it' }]));
    const terminal = chunks[chunks.length - 1]!;
    expect(terminal.finishReason).toBe('tool_calls');
    expect(terminal.toolCalls).toEqual([
      { id: 'call_1', name: 'read_file', arguments: { path: 'src/x.ts' } },
    ]);
    expect(chunks.map(c => c.content).join('')).toBe('');
  });

  it('non-stream returns single chunk', async () => {
    const port = makeCompletionPort({
      choices: [
        {
          message: {
            content: 'done',
            tool_calls: [{ id: 'c1', function: { name: 't', arguments: '{"a":1}' } }],
          },
          finish_reason: 'tool_calls',
        },
      ],
      usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 },
    });
    const provider = new OpenAICompatibleProvider(CONFIG, port);
    const chunks = await collect(
      provider.chat([{ role: 'user', content: 'go' }], [], { stream: false })
    );
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.content).toBe('done');
    expect(chunks[0]?.toolCalls).toEqual([{ id: 'c1', name: 't', arguments: { a: 1 } }]);
    expect(chunks[0]?.finishReason).toBe('tool_calls');
    expect(chunks[0]?.usage).toEqual({ input: 2, output: 1, total: 3 });
  });

  it('normalizes finish reason + usage', async () => {
    const cases: Array<{ finish: unknown; usage: unknown; reason: string; total: number }> = [
      { finish: 'stop', usage: undefined, reason: 'stop', total: 0 },
      { finish: 'length', usage: undefined, reason: 'length', total: 0 },
      { finish: 'content_filter', usage: undefined, reason: 'content_filter', total: 0 },
      { finish: 'function_call', usage: undefined, reason: 'tool_calls', total: 0 },
      { finish: 'bogus', usage: undefined, reason: 'error', total: 0 },
      { finish: 'stop', usage: { prompt_tokens: 4 }, reason: 'stop', total: 4 },
    ];
    for (const c of cases) {
      const port = makeCompletionPort({
        choices: [{ message: { content: 'x' }, finish_reason: c.finish }],
        ...(c.usage !== undefined ? { usage: c.usage } : {}),
      });
      const provider = new OpenAICompatibleProvider(CONFIG, port);
      const chunks = await collect(
        provider.chat([{ role: 'user', content: 'go' }], [], { stream: false })
      );
      expect(chunks).toHaveLength(1);
      expect(chunks[0]?.finishReason).toBe(c.reason);
      expect(chunks[0]?.usage.total).toBe(c.total);
    }
    const malformed = makeCompletionPort({ choices: [] });
    const provider = new OpenAICompatibleProvider(CONFIG, malformed);
    const chunks = await collect(
      provider.chat([{ role: 'user', content: 'go' }], [], { stream: false })
    );
    expect(chunks[0]?.finishReason).toBe('error');
  });

  it('maps 429 to retryable rate limit', () => {
    const limited = mapSdkError({ status: 429, message: 'slow down' }, 'openrouter');
    expect(limited.kind).toBe('rate_limit');
    expect(limited.retryable).toBe(true);
    expect(limited.providerName).toBe('openrouter');
    const denied = mapSdkError({ status: 401, message: 'bad key' }, 'openrouter');
    expect(denied.kind).toBe('auth');
    expect(denied.retryable).toBe(false);
    expect(new OpenAICompatibleProvider(CONFIG, makeCompletionPort({})).isRetryable(limited)).toBe(
      true
    );
    expect(new OpenAICompatibleProvider(CONFIG, makeCompletionPort({})).isRetryable(denied)).toBe(
      false
    );
  });

  it('uses openrouter default base url', () => {
    const provider = new OpenAICompatibleProvider(CONFIG, makeCompletionPort({}));
    expect(provider.baseUrl).toBe(DEFAULT_BASE_URLS.openrouter);
    expect(provider.provider).toBe('openrouter');
    expect(provider.model).toBe('anthropic/claude-sonnet-4');
    const custom = new OpenAICompatibleProvider(
      { ...CONFIG, baseUrl: 'https://proxy.example/v1' },
      makeCompletionPort({})
    );
    expect(custom.baseUrl).toBe('https://proxy.example/v1');
  });

  it('never logs apiKey', async () => {
    const sentinel = 'sk-test-sentinel-9z9z';
    const debugSpy = vi.spyOn(logger, 'debug');
    const warnSpy = vi.spyOn(logger, 'warn');
    const okProvider = new OpenAICompatibleProvider(
      { ...CONFIG, apiKey: sentinel },
      makeStreamPort([{ choices: [{ delta: { content: 'hi' }, finish_reason: 'stop' }] }])
    );
    await collect(okProvider.chat([{ role: 'user', content: 'hi' }]));
    const failing = new OpenAICompatibleProvider(
      { ...CONFIG, apiKey: sentinel },
      { create: (_args: PortCreateArgs) => Promise.reject(new Error('boom')) }
    );
    const chunks = await collect(failing.chat([{ role: 'user', content: 'hi' }]));
    expect(chunks[chunks.length - 1]?.finishReason).toBe('error');
    expect(failing.lastError?.kind).toBe('unknown');
    const logged = JSON.stringify([...debugSpy.mock.calls, ...warnSpy.mock.calls]);
    expect(logged).not.toContain(sentinel);
    expect(redactPaths.some(p => p === 'apiKey' || p.endsWith('.apiKey'))).toBe(true);
  });

  it('counts tokens heuristically', () => {
    const provider = new OpenAICompatibleProvider(CONFIG, makeCompletionPort({}));
    expect(
      provider.countTokens([
        { role: 'user', content: 'abcd' },
        { role: 'assistant', content: 'ef' },
      ])
    ).toBe(2);
    expect(provider.countTokens([])).toBe(0);
  });
});
