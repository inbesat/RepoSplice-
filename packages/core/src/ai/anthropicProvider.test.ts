// P-133 provider tests (offline, injected fake messages client).
// The 6 test names below are mandated by PHASES_DETAILED.md P-133.

import { describe, it, expect } from 'vitest';
import { AnthropicProvider, type AnthropicMessagesPort } from './anthropicProvider.js';
import type { ChatMessage, ChatResponse } from './types.js';

const CONFIG = { model: 'claude-sonnet-4', apiKey: 'sk-ant-test' };

type PortArgs = Parameters<AnthropicMessagesPort['create']>[0];

/** Port that plays back scripted stream chunks. */
function streamPort(chunks: unknown[]): AnthropicMessagesPort {
  return {
    create: () =>
      Promise.resolve(
        (async function* () {
          for (const chunk of chunks) yield chunk;
        })()
      ),
  };
}

/** Port that fails, optionally capturing the create args first. */
function failingPort(
  error: unknown,
  capture?: { args: PortArgs | undefined }
): AnthropicMessagesPort {
  return {
    create: args => {
      if (capture !== undefined) capture.args = args;
      return Promise.reject(error);
    },
  };
}

/** Port that captures create args and plays back a completion object. */
function completionPort(
  completion: unknown,
  capture: { args: PortArgs | undefined }
): AnthropicMessagesPort {
  return {
    create: args => {
      capture.args = args;
      return Promise.resolve(completion);
    },
  };
}

async function drain(
  provider: AnthropicProvider,
  messages: ChatMessage[],
  options?: { stream: false }
): Promise<ChatResponse[]> {
  const out: ChatResponse[] = [];
  for await (const chunk of provider.chat(messages, undefined, options)) out.push(chunk);
  return out;
}

describe('P-133 AnthropicProvider', () => {
  it('streams text deltas', async () => {
    const provider = new AnthropicProvider(
      CONFIG,
      streamPort([
        { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello ' } },
        { type: 'content_block_delta', delta: { type: 'text_delta', text: 'world' } },
        {
          type: 'message_delta',
          delta: { stop_reason: 'end_turn' },
          usage: { input_tokens: 5, output_tokens: 3 },
        },
      ])
    );
    const chunks = await drain(provider, [{ role: 'user', content: 'hi' }]);
    expect(chunks).toHaveLength(3);
    expect(chunks.map(c => c.content).join('')).toBe('Hello world');
    const last = chunks[chunks.length - 1]!;
    expect(last.finishReason).toBe('stop');
    expect(last.usage).toEqual({ input: 5, output: 3, total: 8 });
  });

  it('converts tool role to tool_result', async () => {
    const capture: { args: PortArgs | undefined } = { args: undefined };
    const port: AnthropicMessagesPort = {
      create: args => {
        capture.args = args;
        return Promise.resolve(
          (async function* () {
            yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'ok' } };
            yield {
              type: 'message_delta',
              delta: { stop_reason: 'end_turn' },
              usage: { input_tokens: 2, output_tokens: 1 },
            };
          })()
        );
      },
    };
    const provider = new AnthropicProvider(CONFIG, port);
    const messages: ChatMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'read file' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'call_1', name: 'read', arguments: { path: 'x.ts' } }],
      },
      { role: 'tool', content: 'file contents', toolCallId: 'call_1' },
    ];
    await drain(provider, messages);
    const args = capture.args;
    expect(args).toBeDefined();
    const received = args!.messages;
    expect(received).toHaveLength(3);
    expect(received[1]).toEqual({
      role: 'assistant',
      content: [{ type: 'tool_use', id: 'call_1', name: 'read', input: { path: 'x.ts' } }],
    });
    expect(received[2]).toEqual({
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'call_1', content: 'file contents', is_error: false },
      ],
    });
  });

  it('accumulates tool_use json', async () => {
    const provider = new AnthropicProvider(
      CONFIG,
      streamPort([
        {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'tool_use', id: 'toolu_1', name: 'get_weather' },
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'input_json_delta', partial_json: '{"city":' },
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'input_json_delta', partial_json: ' "Paris"}' },
        },
        {
          type: 'message_delta',
          delta: { stop_reason: 'tool_use' },
          usage: { input_tokens: 8, output_tokens: 4 },
        },
      ])
    );
    const chunks = await drain(provider, [{ role: 'user', content: 'weather?' }]);
    const last = chunks[chunks.length - 1]!;
    expect(last.toolCalls).toEqual([
      { id: 'toolu_1', name: 'get_weather', arguments: { city: 'Paris' } },
    ]);
    expect(last.finishReason).toBe('tool_calls');
    expect(last.usage).toEqual({ input: 8, output: 4, total: 12 });
  });

  it('normalizes stop reason + usage', async () => {
    const provider = new AnthropicProvider(
      CONFIG,
      streamPort([
        { type: 'message_start', message: { usage: { input_tokens: 10 } } },
        { type: 'content_block_delta', delta: { type: 'text_delta', text: 'partial' } },
        {
          type: 'message_delta',
          delta: { stop_reason: 'max_tokens' },
          usage: { output_tokens: 5 },
        },
      ])
    );
    const chunks = await drain(provider, [{ role: 'user', content: 'go' }]);
    const last = chunks[chunks.length - 1]!;
    expect(last.finishReason).toBe('length');
    expect(last.usage).toEqual({ input: 10, output: 5, total: 15 });
  });

  it('moves system to top-level system', async () => {
    const capture: { args: PortArgs | undefined } = { args: undefined };
    const port: AnthropicMessagesPort = {
      create: args => {
        capture.args = args;
        return Promise.resolve(
          (async function* () {
            yield {
              type: 'message_delta',
              delta: { stop_reason: 'end_turn' },
              usage: { input_tokens: 1, output_tokens: 1 },
            };
          })()
        );
      },
    };
    const provider = new AnthropicProvider(CONFIG, port);
    await drain(provider, [
      { role: 'system', content: 'Be terse.' },
      { role: 'user', content: 'hi' },
    ]);
    const args = capture.args;
    expect(args).toBeDefined();
    expect(args!.system).toBe('Be terse.');
    expect(args!.messages).toEqual([{ role: 'user', content: 'hi' }]);
    const roles = args!.messages.map(m => (m as { role: string }).role);
    expect(roles).not.toContain('system');
  });

  it('maps overloaded to retryable', async () => {
    const provider = new AnthropicProvider(
      CONFIG,
      failingPort({ status: 429, message: 'overloaded' })
    );
    const chunks = await drain(provider, [{ role: 'user', content: 'hi' }]);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.finishReason).toBe('error');
    expect(provider.lastError).toEqual({
      kind: 'rate_limit',
      retryable: true,
      message: 'overloaded',
      providerName: 'anthropic',
    });
    expect(provider.isRetryable(provider.lastError!)).toBe(true);
  });

  it('maps auth error to non-retryable', async () => {
    const provider = new AnthropicProvider(
      CONFIG,
      failingPort({ status: 401, message: 'invalid api key' })
    );
    const chunks = await drain(provider, [{ role: 'user', content: 'hi' }]);
    expect(chunks[0]!.finishReason).toBe('error');
    expect(provider.lastError).toMatchObject({ kind: 'auth', retryable: false });
    expect(provider.isRetryable(provider.lastError!)).toBe(false);
  });

  it('supports non-stream completion responses', async () => {
    const capture: { args: PortArgs | undefined } = { args: undefined };
    const provider = new AnthropicProvider(
      CONFIG,
      completionPort(
        {
          content: [{ type: 'text', text: 'done' }],
          stop_reason: 'max_tokens',
          usage: { input_tokens: 7, output_tokens: 4 },
        },
        capture
      )
    );
    const chunks = await drain(provider, [{ role: 'user', content: 'go' }], { stream: false });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.content).toBe('done');
    expect(chunks[0]!.finishReason).toBe('length');
    expect(chunks[0]!.usage).toEqual({ input: 7, output: 4, total: 11 });
    expect(capture.args!.stream).toBe(false);
  });

  it('countTokens uses chars/4 heuristic', () => {
    const provider = new AnthropicProvider(CONFIG, streamPort([]));
    expect(provider.countTokens([{ role: 'user', content: 'a'.repeat(40) }])).toBe(10);
    expect(provider.name).toBe('anthropic/claude-sonnet-4');
  });
});
