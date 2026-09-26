// Streaming Support (P-136).
//
// Uniform streaming layer over any ChatProvider. Wraps provider.chat()
// into a normalized AsyncIterable<ReasoningChunk> that yields text,
// tool calls, done, and error chunks. Buffers partial tool calls across
// chunks, respects AbortSignal, and provides an onReasoning side channel.

import type {
  ChatMessage,
  ToolSchema,
  ReasoningChunk,
  ProviderError,
  ToolCall,
  TokenUsage,
} from './types.js';
import type { ChatProvider } from './provider.js';
import { asProviderError } from './provider.js';

const ZERO_USAGE: TokenUsage = { input: 0, output: 0, total: 0 };

function abortedError(providerName: string): ProviderError {
  return { kind: 'unknown', message: 'Aborted', providerName, retryable: false };
}

/**
 * Stream chat responses from a ChatProvider, yielding normalized
 * ReasoningChunk events for each text delta, tool call, completion, or error.
 *
 * @param provider - ChatProvider instance (must conform to ChatProvider contract)
 * @param messages - Conversation messages
 * @param tools - Tool schemas forwarded to the provider
 * @param opts - Options: onReasoning callback per chunk, AbortSignal for cancellation
 * @returns AsyncIterable yielding ReasoningChunk events
 */
export async function* streamChat(
  provider: ChatProvider,
  messages: ChatMessage[],
  tools: ToolSchema[],
  opts?: { onReasoning?: (chunk: ReasoningChunk) => void; signal?: AbortSignal }
): AsyncIterable<ReasoningChunk> {
  // Internal accumulator for partial tool calls across responses (merged by id)
  const toolAccumulator = new Map<string, ToolCall>();
  let finished = false;
  let lastStopUsage: TokenUsage = ZERO_USAGE;

  // Helper to emit a chunk via onReasoning and yield it
  function emit(chunk: ReasoningChunk): ReasoningChunk {
    if (opts?.onReasoning) opts.onReasoning(chunk);
    return chunk;
  }

  // Emit every merged tool call accumulated so far as a tool_call chunk.
  function* flushToolCalls(): Generator<ReasoningChunk> {
    for (const tc of toolAccumulator.values()) {
      yield emit({ type: 'tool_call', toolCall: tc });
    }
    toolAccumulator.clear();
  }

  // Check for abort before starting
  if (opts?.signal?.aborted) {
    yield emit({ type: 'error', error: abortedError(provider.name) });
    return;
  }

  // Set up abort listener
  const abortHandler = (): void => {
    // The per-iteration signal check below stops the stream; nothing to do here.
  };
  opts?.signal?.addEventListener('abort', abortHandler);

  try {
    const stream = provider.chat(messages, tools);
    for await (const response of stream) {
      // Check for abort
      if (opts?.signal?.aborted) {
        yield emit({ type: 'error', error: abortedError(provider.name) });
        return;
      }

      // Text delta
      if (response.content && response.content.length > 0) {
        yield emit({ type: 'text', text: response.content });
      }

      // Merge tool calls by id (P-132/P-133 normalize to complete ToolCalls
      // within one ChatResponse; deltas split across responses merge here).
      for (const tc of response.toolCalls ?? []) {
        const existing = toolAccumulator.get(tc.id);
        if (existing) {
          if (tc.name) existing.name = tc.name;
          if (tc.arguments && Object.keys(tc.arguments).length > 0) {
            existing.arguments = { ...existing.arguments, ...tc.arguments };
          }
        } else {
          toolAccumulator.set(tc.id, { id: tc.id, name: tc.name, arguments: { ...tc.arguments } });
        }
      }

      // Terminal non-stop reason (tool_calls / length / content_filter / error):
      // flush merged tool calls, yield done with this response's usage, stop.
      const finishReason = response.finishReason;
      if (finishReason && finishReason !== 'stop') {
        yield* flushToolCalls();
        yield emit({ type: 'done', finishReason, usage: response.usage });
        finished = true;
        break;
      }

      // 'stop' may be followed by more responses (providers that emit several
      // turns per chat call); keep the usage for the final done chunk.
      lastStopUsage = response.usage;
    }

    if (!finished) {
      yield* flushToolCalls();
      yield emit({ type: 'done', finishReason: 'stop', usage: lastStopUsage });
    }
  } catch (e) {
    // A provider may reject with an SDK Error or a bare ProviderError value
    // (that object IS the contract's error type) — `asProviderError` preserves
    // the real `kind`/`message` instead of degrading it to `[object Object]`.
    yield emit({ type: 'error', error: asProviderError(e, provider.name) });
  } finally {
    opts?.signal?.removeEventListener('abort', abortHandler);
  }
}

export async function streamChatToString(
  provider: ChatProvider,
  messages: ChatMessage[],
  tools: ToolSchema[],
  opts?: { signal?: AbortSignal }
): Promise<string> {
  let result = '';
  for await (const chunk of streamChat(provider, messages, tools, opts)) {
    if (chunk.type === 'text') result += chunk.text;
  }
  return result;
}
