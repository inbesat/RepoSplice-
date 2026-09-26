// Anthropic provider (P-133).
//
// Wraps `@anthropic-ai/sdk` (P-028) and implements the P-131 `ChatProvider`
// contract. Converts internal `ChatMessage`/`ToolSchema` ↔ Anthropic block
// format, streams `tool_use` partial JSON, normalizes `stop_reason`/`usage`,
// and surfaces typed `ProviderError`s via shared `mapSdkError`.
//
// `apiKey` never logged (redacted by `logger`).

import type Anthropic from '@anthropic-ai/sdk';
import { logger } from '../logger/index.js';
import { createAnthropicClient } from './anthropic.js';
import { mapSdkError } from './openaiCompatible.js';
import { isRetryableError, type ChatProvider } from './provider.js';
import type { AnthropicConfig } from './config.js';
import type {
  ChatMessage,
  ChatOptions,
  ChatResponse,
  FinishReason,
  ProviderError,
  TokenUsage,
  ToolCall,
  ToolSchema,
} from './types.js';

const ANTHROPIC_DEFAULT_MAX_TOKENS = 4096;
const ZERO_USAGE: TokenUsage = { input: 0, output: 0, total: 0 };

/**
 * Arguments accepted by the injected `messages.create` port. The test
 * suite (and future test doubles) implement this shape; `| undefined` on
 * the optional fields satisfies `exactOptionalPropertyTypes` when the
 * provider forwards `system`/`tools` straight through.
 */
export interface AnthropicCreateArgs {
  model: string;
  max_tokens: number;
  system?: string | undefined;
  messages: unknown[];
  tools?: unknown[] | undefined;
  stream: boolean;
}

/**
 * Transport seam: the real client adapts `Anthropic.messages.create`,
 * tests inject a fake that plays back scripted chunks. Keeps the provider
 * fully offline-testable (P-133 "Tested offline via injected fake client").
 */
export interface AnthropicMessagesPort {
  create: (args: AnthropicCreateArgs) => Promise<unknown>;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function asAsyncIterable(value: unknown): AsyncIterable<unknown> | null {
  if (typeof value === 'object' && value !== null) {
    const slot = (value as Record<symbol, unknown>)[Symbol.asyncIterator];
    if (typeof slot === 'function') return value as AsyncIterable<unknown>;
  }
  return null;
}

function parseToolArguments(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (isObject(parsed)) return parsed;
    return {};
  } catch {
    return {};
  }
}

function normalizeFinishReason(stopReason: string): FinishReason {
  switch (stopReason) {
    case 'end_turn':
    case 'stop_sequence':
      return 'stop';
    case 'tool_use':
      return 'tool_calls';
    case 'max_tokens':
      return 'length';
    case 'refusal':
      return 'content_filter';
    default:
      return 'stop';
  }
}

function numField(value: Record<string, unknown>, key: string): number | undefined {
  const raw = value[key];
  return typeof raw === 'number' ? raw : undefined;
}

/** Anthropic `{input_tokens, output_tokens}` → internal `TokenUsage`. */
function normalizeUsage(value: Record<string, unknown>): TokenUsage {
  const input = numField(value, 'input_tokens') ?? 0;
  const output = numField(value, 'output_tokens') ?? 0;
  return { input, output, total: input + output };
}

/**
 * Anthropic splits usage across stream events: `message_start` carries
 * `input_tokens`, `message_delta` carries the cumulative `output_tokens`.
 * Merge each incoming snapshot over the current one, preferring any
 * non-zero field so partial events don't zero out earlier data.
 */
function mergeUsage(current: TokenUsage, incoming: Record<string, unknown>): TokenUsage {
  const u = normalizeUsage(incoming);
  const input = u.input > 0 ? u.input : current.input;
  const output = u.output > 0 ? u.output : current.output;
  return { input, output, total: input + output };
}

type SdkCreateParam = Parameters<Anthropic['messages']['create']>[0];

function adaptSdkClient(client: Anthropic): AnthropicMessagesPort {
  return {
    create: (args: AnthropicCreateArgs): Promise<unknown> =>
      client.messages.create(args as unknown as SdkCreateParam) as unknown as Promise<unknown>,
  };
}

function failingPort(): AnthropicMessagesPort {
  return {
    create: () => Promise.reject(new Error('anthropic client init failed')),
  };
}

export class AnthropicProvider implements ChatProvider {
  readonly name: string;
  readonly model: string;
  readonly provider: string;
  readonly id: string;
  /** Last mapped error from a failed `chat` call; null until one fails. */
  lastError: ProviderError | null = null;

  private readonly client: AnthropicMessagesPort;
  private readonly maxTokens: number;

  constructor(config: AnthropicConfig, port?: AnthropicMessagesPort) {
    this.provider = 'anthropic';
    this.model = config.model;
    this.name = `anthropic/${config.model}`;
    this.id = `anthropic/${config.model}`;
    this.maxTokens = config.maxTokens ?? ANTHROPIC_DEFAULT_MAX_TOKENS;
    if (port !== undefined) {
      this.client = port;
      return;
    }
    const built = createAnthropicClient({
      provider: 'anthropic',
      apiKey: config.apiKey,
      model: config.model,
      ...(config.baseUrl !== undefined ? { baseURL: config.baseUrl } : {}),
    });
    if (built.isOk()) {
      this.client = adaptSdkClient(built.value.client);
      return;
    }
    this.client = failingPort();
  }

  async *chat(
    messages: ChatMessage[],
    tools?: ToolSchema[],
    options?: ChatOptions
  ): AsyncIterable<ChatResponse> {
    this.lastError = null;
    logger.debug(
      {
        provider: this.provider,
        model: this.model,
        messageCount: messages.length,
        toolCount: tools?.length ?? 0,
        stream: options?.stream !== false,
      },
      'anthropic chat start'
    );
    const { messages: anthMessages, system } = this.toAnthropicMessages(messages);
    const anthTools = tools?.map(this.toAnthropicTool.bind(this));
    try {
      const stream = options?.stream !== false;
      const args: AnthropicCreateArgs = {
        model: this.model,
        max_tokens: this.maxTokens,
        system,
        messages: anthMessages,
        tools: anthTools,
        stream,
      };
      if (!stream) {
        const raw = await this.client.create(args);
        yield this.completionToResponse(raw);
        return;
      }
      const raw = await this.client.create(args);
      const iter = asAsyncIterable(raw);
      if (iter === null) {
        yield this.reportError(new Error('messages.create stream returned a non-iterable'));
        return;
      }
      yield* this.drainStream(iter);
    } catch (cause: unknown) {
      yield this.reportError(cause);
    }
  }

  countTokens(messages: ChatMessage[]): number {
    // Heuristic consistent with P-132: ~4 chars per token.
    const chars = messages.reduce(
      (sum, message) => sum + (typeof message.content === 'string' ? message.content.length : 0),
      0
    );
    return Math.ceil(chars / 4);
  }

  isRetryable(err: ProviderError): boolean {
    return isRetryableError(err);
  }

  private toAnthropicMessage(message: ChatMessage): unknown | null {
    if (message.role === 'system') return null;
    if (message.role === 'assistant' && message.toolCalls && message.toolCalls.length > 0) {
      const blocks: unknown[] = [];
      if (message.content && message.content.length > 0) {
        blocks.push({ type: 'text', text: message.content });
      }
      for (const call of message.toolCalls) {
        blocks.push({
          type: 'tool_use',
          id: call.id,
          name: call.name,
          input: call.arguments,
        });
      }
      return { role: 'assistant', content: blocks };
    }
    if (message.role === 'tool') {
      return {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: message.toolCallId ?? '',
            content: message.content,
            is_error: false,
          },
        ],
      };
    }
    return { role: message.role, content: message.content };
  }

  private toAnthropicMessages(messages: ChatMessage[]): {
    messages: unknown[];
    system: string | undefined;
  } {
    const anthMessages: unknown[] = [];
    const systemParts: string[] = [];
    for (const message of messages) {
      if (message.role === 'system') {
        systemParts.push(message.content);
        continue;
      }
      const m = this.toAnthropicMessage(message);
      if (m !== null) anthMessages.push(m);
    }
    const system = systemParts.join('\n');
    return { messages: anthMessages, system: system || undefined };
  }

  private toAnthropicTool(tool: ToolSchema): {
    name: string;
    description: string;
    input_schema: Record<string, unknown>;
  } {
    return {
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters as unknown as Record<string, unknown>,
    };
  }

  private reportError(cause: unknown): ChatResponse {
    const mapped = mapSdkError(cause, this.provider);
    this.lastError = mapped;
    logger.warn(
      {
        provider: this.provider,
        model: this.model,
        kind: mapped.kind,
        message: mapped.message,
      },
      'anthropic chat failed'
    );
    return { content: '', toolCalls: [], finishReason: 'error', usage: ZERO_USAGE };
  }

  /**
   * Non-streaming path: `messages.create` already returned a complete
   * Anthropic Message — flatten its content blocks into one response.
   */
  private completionToResponse(raw: unknown): ChatResponse {
    const obj = isObject(raw) ? raw : {};
    let content = '';
    const toolCalls: ToolCall[] = [];
    if (Array.isArray(obj.content)) {
      for (const block of obj.content) {
        if (!isObject(block)) continue;
        if (block.type === 'text' && typeof block.text === 'string') {
          content += block.text;
        } else if (block.type === 'tool_use') {
          toolCalls.push({
            id: typeof block.id === 'string' ? block.id : `call_${toolCalls.length}`,
            name: typeof block.name === 'string' ? block.name : '',
            arguments: isObject(block.input) ? block.input : {},
          });
        }
      }
    }
    const stop = typeof obj.stop_reason === 'string' ? obj.stop_reason : 'end_turn';
    const usage = isObject(obj.usage) ? normalizeUsage(obj.usage) : ZERO_USAGE;
    return {
      content,
      toolCalls,
      finishReason: normalizeFinishReason(stop),
      usage,
    };
  }

  private async *drainStream(
    stream: AsyncIterable<unknown>
  ): AsyncGenerator<ChatResponse, void, unknown> {
    let finish: FinishReason = 'stop';
    let usage: TokenUsage = { input: 0, output: 0, total: 0 };
    const buffers = new Map<number, { id: string; name: string; args: string }>();
    for await (const item of stream) {
      if (!isObject(item)) continue;
      const itemObj = item;
      if (itemObj.type === 'content_block_delta') {
        const delta = isObject(itemObj.delta) ? itemObj.delta : {};
        if (delta.type === 'text_delta' && typeof delta.text === 'string') {
          if (delta.text.length > 0) {
            yield { content: delta.text, toolCalls: [], finishReason: 'stop', usage: ZERO_USAGE };
          }
        }
        if (delta.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
          const idx = typeof itemObj.index === 'number' ? itemObj.index : 0;
          const existing = buffers.get(idx) ?? { id: '', name: '', args: '' };
          existing.args += delta.partial_json;
          buffers.set(idx, existing);
        }
      } else if (itemObj.type === 'content_block_start') {
        const contentBlock = isObject(itemObj.content_block) ? itemObj.content_block : {};
        if (contentBlock.type === 'tool_use') {
          const idx = typeof itemObj.index === 'number' ? itemObj.index : 0;
          const existing = buffers.get(idx) ?? { id: '', name: '', args: '' };
          if (typeof contentBlock.id === 'string') existing.id = contentBlock.id;
          if (typeof contentBlock.name === 'string') existing.name = contentBlock.name;
          buffers.set(idx, existing);
        }
      } else if (itemObj.type === 'message_delta') {
        const delta = isObject(itemObj.delta) ? itemObj.delta : {};
        if (isObject(itemObj.usage)) {
          usage = mergeUsage(usage, itemObj.usage);
        }
        if (typeof delta.stop_reason === 'string') {
          finish = normalizeFinishReason(delta.stop_reason);
        }
      } else if (itemObj.type === 'message_start') {
        const message = isObject(itemObj.message) ? itemObj.message : {};
        if (isObject(message.usage)) {
          usage = mergeUsage(usage, message.usage);
        }
      }
    }
    const toolCalls: ToolCall[] = [];
    for (const [, buf] of [...buffers.entries()].sort(([a], [b]) => a - b)) {
      toolCalls.push({
        id: buf.id,
        name: buf.name,
        arguments: parseToolArguments(buf.args),
      });
    }
    if (toolCalls.length > 0) finish = 'tool_calls';
    yield { content: '', toolCalls, finishReason: finish, usage };
  }
}
