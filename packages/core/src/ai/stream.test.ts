import { describe, it, expect } from 'vitest';
import { streamChat, streamChatToString } from './stream.js';
import type { ChatProvider } from './provider.js';
import type { ChatResponse, ReasoningChunk } from './types.js';

/** Provider that plays back one scripted ChatResponse[] per chat() call. */
function fakeProvider(script: ChatResponse[][]): ChatProvider {
  let callIndex = 0;
  return {
    name: 'fake',
    model: 'fake',
    provider: 'fake',
    id: 'fake',
    async *chat() {
      const responses = script[callIndex] ?? [];
      callIndex++;
      for (const response of responses) {
        yield response;
      }
    },
    countTokens: () => 0,
    isRetryable: () => false,
  };
}

async function collect(iterable: AsyncIterable<ReasoningChunk>): Promise<ReasoningChunk[]> {
  const chunks: ReasoningChunk[] = [];
  for await (const chunk of iterable) {
    chunks.push(chunk);
  }
  return chunks;
}

describe('P-136 stream: text streaming', () => {
  it('streams text and done', async () => {
    const provider = fakeProvider([
      [
        {
          content: 'Hello ',
          toolCalls: [],
          finishReason: 'stop',
          usage: { input: 5, output: 3, total: 8 },
        },
        {
          content: 'world',
          toolCalls: [],
          finishReason: 'stop',
          usage: { input: 5, output: 5, total: 10 },
        },
      ],
    ]);
    const chunks = await collect(streamChat(provider, [], []));

    expect(chunks.map(c => c.type)).toEqual(['text', 'text', 'done']);
    expect(chunks[0]).toEqual({ type: 'text', text: 'Hello ' });
    expect(chunks[1]).toEqual({ type: 'text', text: 'world' });

    const done = chunks[2];
    expect(done?.type).toBe('done');
    if (done?.type === 'done') {
      expect(done.finishReason).toBe('stop');
      expect(done.usage).toEqual({ input: 5, output: 5, total: 10 });
    }
  });
});

describe('P-136 stream: tool call merging', () => {
  it('merges split tool calls', async () => {
    // Two responses carry partial deltas for the same call id: the first has
    // only the name, the second adds the arguments and finishes with
    // tool_calls. The stream must merge them into ONE tool_call chunk.
    const provider = fakeProvider([
      [
        {
          content: '',
          toolCalls: [{ id: 'call_1', name: 'read_file', arguments: {} }],
          finishReason: 'stop',
          usage: { input: 1, output: 0, total: 1 },
        },
        {
          content: '',
          toolCalls: [{ id: 'call_1', name: 'read_file', arguments: { path: 'src/index.ts' } }],
          finishReason: 'tool_calls',
          usage: { input: 2, output: 1, total: 3 },
        },
      ],
    ]);
    const chunks = await collect(streamChat(provider, [], []));

    const toolCallChunks = chunks.filter(c => c.type === 'tool_call');
    expect(toolCallChunks).toHaveLength(1);
    const toolCallChunk = toolCallChunks[0];
    if (toolCallChunk?.type === 'tool_call') {
      expect(toolCallChunk.toolCall).toEqual({
        id: 'call_1',
        name: 'read_file',
        arguments: { path: 'src/index.ts' },
      });
    }

    const done = chunks.find(c => c.type === 'done');
    expect(done).toBeDefined();
    if (done?.type === 'done') {
      expect(done.finishReason).toBe('tool_calls');
      expect(done.usage).toEqual({ input: 2, output: 1, total: 3 });
    }
  });
});

describe('P-136 stream: onReasoning', () => {
  it('emits onReasoning per chunk', async () => {
    const provider = fakeProvider([
      [
        {
          content: 'hi',
          toolCalls: [],
          finishReason: 'stop',
          usage: { input: 1, output: 1, total: 2 },
        },
      ],
    ]);
    const seen: ReasoningChunk[] = [];
    const chunks = await collect(
      streamChat(provider, [], [], {
        onReasoning: r => {
          seen.push(r);
        },
      })
    );

    expect(seen).toEqual(chunks);
    expect(seen.length).toBeGreaterThanOrEqual(2); // text + done
  });
});

describe('P-136 stream: error handling', () => {
  it('yields single error chunk', async () => {
    const provider: ChatProvider = {
      name: 'boom',
      model: 'boom',
      provider: 'boom',
      id: 'boom',
      async *chat() {
        yield {
          content: 'partial answer',
          toolCalls: [],
          finishReason: 'stop',
          usage: { input: 1, output: 1, total: 2 },
        };
        throw new Error('provider exploded');
      },
      countTokens: () => 0,
      isRetryable: () => false,
    };
    const chunks = await collect(streamChat(provider, [], []));

    // Exactly one error chunk — yielded once, not once per input chunk.
    const errors = chunks.filter(c => c.type === 'error');
    expect(errors).toHaveLength(1);
    expect(chunks[chunks.length - 1]?.type).toBe('error');
    const errorChunk = errors[0];
    if (errorChunk?.type === 'error') {
      expect(errorChunk.error.message).toBe('provider exploded');
      expect(errorChunk.error.providerName).toBe('boom');
    }
  });
});

describe('P-136 stream: abort signal', () => {
  it('aborts via signal', async () => {
    const controller = new AbortController();
    controller.abort();
    const provider = fakeProvider([
      [
        {
          content: 'never delivered',
          toolCalls: [],
          finishReason: 'stop',
          usage: { input: 1, output: 1, total: 2 },
        },
      ],
    ]);
    const chunks = await collect(streamChat(provider, [], [], { signal: controller.signal }));

    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.type).toBe('error');
    if (chunks[0]?.type === 'error') {
      expect(chunks[0].error.message).toBe('Aborted');
    }
  });
});

describe('P-136 stream: toString', () => {
  it('streamChatToString concatenates', async () => {
    const provider = fakeProvider([
      [
        {
          content: 'Hello ',
          toolCalls: [],
          finishReason: 'stop',
          usage: { input: 1, output: 1, total: 2 },
        },
        {
          content: 'world',
          toolCalls: [],
          finishReason: 'stop',
          usage: { input: 1, output: 2, total: 3 },
        },
      ],
    ]);
    const text = await streamChatToString(provider, [], []);
    expect(text).toBe('Hello world');
  });
});
