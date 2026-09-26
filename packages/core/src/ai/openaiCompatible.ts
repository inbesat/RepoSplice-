// OpenAI-compatible chat provider (P-132).
//
// One class covering OpenRouter (primary), OpenAI, and Ollama by varying
// `baseUrl`/`apiKey`/`model` over the `openai` SDK transport (P-027).
// Implements the P-131 `ChatProvider` contract: streaming chat with
// tool-call delta buffering, finish-reason/usage normalization, typed
// `ProviderError`s, and a chars/4 token heuristic for pre-flight.
//
// `apiKey` is passed to the SDK client at construction and never logged:
// `chat` logs only provider/model/counts through the redacting `logger`
// (P-010 `redactPaths` covers `apiKey` at any depth as a backstop).

import type OpenAI from 'openai';
import { logger } from '../logger/index.js';
import {
  APIConnectionError,
  APIConnectionTimeoutError,
  AuthenticationError,
  BadRequestError,
  createOpenAICompatible,
  DEFAULT_BASE_URLS,
  PermissionDeniedError,
  RateLimitError,
  resolveBaseURL,
  UnprocessableEntityError,
} from './openai.js';
import type { OpenAICompatibleConfig } from './config.js';
import { isRetryableError, type ChatProvider } from './provider.js';
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

export interface SdkMessageToolCall {
  id: string;
  type: string;
  function: { name: string; arguments: string };
}

export interface SdkMessageTool {
  type: string;
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface SdkMessage {
  role: string;
  content: string;
  tool_calls?: SdkMessageToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface PortCreateArgs {
  model: string;
  messages: SdkMessage[];
  tools?: SdkMessageTool[];
  stream: boolean;
  max_tokens?: number;
  temperature?: number;
}

/** Narrow dependency-injection seam for the chat-completions resource. */
export interface ChatCompletionsPort {
  create(args: PortCreateArgs): Promise<unknown>;
}

interface SdkDeltaToolCall {
  index: number;
  id?: string;
  function?: { name?: string; arguments?: string };
}

interface SdkStreamChoice {
  delta: { content?: string | null; tool_calls?: SdkDeltaToolCall[] };
  finish_reason: string | null;
}

interface SdkUsageShape {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

interface SdkStreamChunk {
  choices: SdkStreamChoice[];
  usage?: SdkUsageShape | null;
}

const ZERO_USAGE: TokenUsage = { input: 0, output: 0, total: 0 };

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
  if (raw.trim().length === 0) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return isObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function normalizeFinishReason(value: string): FinishReason {
  switch (value) {
    case 'stop':
    case 'tool_calls':
    case 'length':
    case 'content_filter':
      return value;
    case 'function_call':
      return 'tool_calls';
    default:
      return 'error';
  }
}

function numField(obj: Record<string, unknown>, key: string): number | undefined {
  const value = obj[key];
  return typeof value === 'number' ? value : undefined;
}

function normalizeUsage(value: SdkUsageShape): TokenUsage {
  const input = value.prompt_tokens ?? 0;
  const output = value.completion_tokens ?? 0;
  return { input, output, total: value.total_tokens ?? input + output };
}

function toSdkUsage(raw: unknown): SdkUsageShape | null {
  if (!isObject(raw)) return null;
  const usage: SdkUsageShape = {};
  const prompt = numField(raw, 'prompt_tokens');
  const completion = numField(raw, 'completion_tokens');
  const total = numField(raw, 'total_tokens');
  if (prompt !== undefined) usage.prompt_tokens = prompt;
  if (completion !== undefined) usage.completion_tokens = completion;
  if (total !== undefined) usage.total_tokens = total;
  return usage;
}

function toSdkMessage(message: ChatMessage): SdkMessage {
  if (
    message.role === 'assistant' &&
    message.toolCalls !== undefined &&
    message.toolCalls.length > 0
  ) {
    return {
      role: 'assistant',
      content: message.content,
      tool_calls: message.toolCalls.map(t => ({
        id: t.id,
        type: 'function',
        function: { name: t.name, arguments: stringifyArguments(t.arguments) },
      })),
      ...(message.name !== undefined ? { name: message.name } : {}),
    };
  }
  if (message.role === 'tool') {
    return {
      role: 'tool',
      content: message.content,
      ...(message.toolCallId !== undefined ? { tool_call_id: message.toolCallId } : {}),
      ...(message.name !== undefined ? { name: message.name } : {}),
    };
  }
  return {
    role: message.role,
    content: message.content,
    ...(message.name !== undefined ? { name: message.name } : {}),
  };
}

function stringifyArguments(args: Record<string, unknown>): string {
  try {
    return JSON.stringify(args);
  } catch {
    return '{}';
  }
}

function toSdkTool(tool: ToolSchema): SdkMessageTool {
  return {
    type: 'function',
    function: { name: tool.name, description: tool.description, parameters: tool.parameters },
  };
}

function toStreamChunk(item: unknown): SdkStreamChunk | null {
  if (!isObject(item) || !Array.isArray(item.choices)) return null;
  const choices: SdkStreamChoice[] = [];
  for (const entry of item.choices) {
    if (!isObject(entry)) continue;
    const deltaRaw = isObject(entry.delta) ? entry.delta : {};
    const content = typeof deltaRaw.content === 'string' ? deltaRaw.content : null;
    const toolCalls: SdkDeltaToolCall[] = [];
    if (Array.isArray(deltaRaw.tool_calls)) {
      for (const t of deltaRaw.tool_calls) {
        if (!isObject(t)) continue;
        const index = typeof t.index === 'number' ? t.index : toolCalls.length;
        const fn = isObject(t.function) ? t.function : undefined;
        toolCalls.push({
          index,
          ...(typeof t.id === 'string' ? { id: t.id } : {}),
          ...(fn !== undefined
            ? {
                function: {
                  ...(typeof fn.name === 'string' ? { name: fn.name } : {}),
                  ...(typeof fn.arguments === 'string' ? { arguments: fn.arguments } : {}),
                },
              }
            : {}),
        });
      }
    }
    choices.push({
      delta: {
        ...(content !== null ? { content } : {}),
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      },
      finish_reason: typeof entry.finish_reason === 'string' ? entry.finish_reason : null,
    });
  }
  const usage = isObject(item.usage) ? toSdkUsage(item.usage) : null;
  return { choices, ...(usage !== null ? { usage } : {}) };
}

function completionToResponse(raw: unknown): ChatResponse {
  if (!isObject(raw) || !Array.isArray(raw.choices) || raw.choices.length === 0) {
    return { content: '', toolCalls: [], finishReason: 'error', usage: ZERO_USAGE };
  }
  const first = raw.choices[0];
  if (!isObject(first)) {
    return { content: '', toolCalls: [], finishReason: 'error', usage: ZERO_USAGE };
  }
  const message = isObject(first.message) ? first.message : {};
  const content = typeof message.content === 'string' ? message.content : '';
  const toolCalls: ToolCall[] = [];
  if (Array.isArray(message.tool_calls)) {
    for (const t of message.tool_calls) {
      if (!isObject(t) || typeof t.id !== 'string') continue;
      const fn = isObject(t.function) ? t.function : {};
      toolCalls.push({
        id: t.id,
        name: typeof fn.name === 'string' ? fn.name : '',
        arguments: parseToolArguments(typeof fn.arguments === 'string' ? fn.arguments : ''),
      });
    }
  }
  const usage = isObject(raw.usage) ? toSdkUsage(raw.usage) : null;
  return {
    content,
    toolCalls,
    finishReason:
      typeof first.finish_reason === 'string'
        ? normalizeFinishReason(first.finish_reason)
        : 'error',
    usage: usage !== null ? normalizeUsage(usage) : ZERO_USAGE,
  };
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (isObject(err) && typeof err.message === 'string') return err.message;
  return 'unknown error';
}

function errorStatus(err: unknown): number | undefined {
  if (!isObject(err)) return undefined;
  if (typeof err.status === 'number') return err.status;
  if (typeof err.statusCode === 'number') return err.statusCode;
  return undefined;
}

function errorCode(err: unknown): string {
  if (!isObject(err)) return '';
  return typeof err.code === 'string' ? err.code : '';
}

function errorType(err: unknown): string {
  if (!isObject(err)) return '';
  return typeof err.type === 'string' ? err.type : '';
}

function errorName(err: unknown): string {
  if (err instanceof Error) return err.name;
  if (isObject(err) && typeof err.name === 'string') return err.name;
  return '';
}

/**
 * Map an SDK/transport failure to a typed `ProviderError`.
 *
 * Shared by the provider (chat error path) and P-138 retry: `rate_limit`
 * (429), `timeout`, and `network` failures are `retryable`; `auth`
 * (401/403) and `invalid_request` (400/404/422) never are; 5xx maps to
 * `unknown` but stays retryable (transient server side — the one
 * deliberate exception to the P-131 `unknown`-means-no-retry default).
 */
export function mapSdkError(err: unknown, provider: string): ProviderError {
  const message = errorMessage(err);
  const status = errorStatus(err);
  const code = errorCode(err);
  const type = errorType(err);
  const name = errorName(err);
  const base = { message, providerName: provider };
  if (
    status === 429 ||
    err instanceof RateLimitError ||
    code === 'rate_limit_exceeded' ||
    type.includes('rate_limit')
  ) {
    return { ...base, kind: 'rate_limit', retryable: true };
  }
  if (
    status === 401 ||
    status === 403 ||
    err instanceof AuthenticationError ||
    err instanceof PermissionDeniedError ||
    name === 'AuthenticationError' ||
    code === 'invalid_api_key'
  ) {
    return { ...base, kind: 'auth', retryable: false };
  }
  if (
    err instanceof APIConnectionTimeoutError ||
    name === 'APIConnectionTimeoutError' ||
    code === 'ETIMEDOUT' ||
    /timed?\s?out/i.test(`${code} ${message}`)
  ) {
    return { ...base, kind: 'timeout', retryable: true };
  }
  if (
    err instanceof APIConnectionError ||
    name === 'APIConnectionError' ||
    ['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET', 'EPIPE'].includes(code) ||
    (name === 'TypeError' && /fetch|network|load failed/i.test(message))
  ) {
    return { ...base, kind: 'network', retryable: true };
  }
  if (
    status === 400 ||
    status === 404 ||
    status === 422 ||
    err instanceof BadRequestError ||
    err instanceof UnprocessableEntityError
  ) {
    return { ...base, kind: 'invalid_request', retryable: false };
  }
  if (status !== undefined && status >= 500) {
    return { ...base, kind: 'unknown', retryable: true };
  }
  return { ...base, kind: 'unknown', retryable: false };
}

type SdkCreateParam = Parameters<OpenAI['chat']['completions']['create']>[0];

function adaptSdkClient(client: OpenAI): ChatCompletionsPort {
  return {
    create: (args: PortCreateArgs): Promise<unknown> =>
      client.chat.completions.create(
        args as unknown as SdkCreateParam
      ) as unknown as Promise<unknown>,
  };
}

function failingPort(): ChatCompletionsPort {
  return {
    create: () => Promise.reject(new Error('openai client init failed')),
  };
}

export class OpenAICompatibleProvider implements ChatProvider {
  readonly name: string;
  readonly model: string;
  readonly provider: string;
  readonly id: string;
  readonly baseUrl: string;
  lastError: ProviderError | null = null;
  private readonly port: ChatCompletionsPort;

  constructor(config: OpenAICompatibleConfig, port?: ChatCompletionsPort) {
    this.provider = config.provider;
    this.model = config.model;
    this.name = `${config.provider}/${config.model}`;
    this.id = `openai-compatible/${config.provider}/${config.model}`;
    this.baseUrl = resolveBaseURL(config.provider, config.baseUrl) ?? DEFAULT_BASE_URLS.openai;
    if (port !== undefined) {
      this.port = port;
      return;
    }
    const built = createOpenAICompatible({
      provider: config.provider,
      apiKey: config.apiKey,
      model: config.model,
      baseURL: this.baseUrl,
      ...(config.defaultHeaders !== undefined ? { defaultHeaders: config.defaultHeaders } : {}),
    });
    if (built.isOk()) {
      this.port = adaptSdkClient(built.value.client);
      return;
    }
    this.port = failingPort();
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
      'openai-compatible chat start'
    );
    const sdkMessages = messages.map(toSdkMessage);
    const sdkTools = tools?.map(toSdkTool);
    const base = {
      model: this.model,
      messages: sdkMessages,
      ...(sdkTools !== undefined ? { tools: sdkTools } : {}),
      ...(options?.maxTokens !== undefined ? { max_tokens: options.maxTokens } : {}),
      ...(options?.temperature !== undefined ? { temperature: options.temperature } : {}),
    };
    try {
      if (options?.stream === false) {
        const raw = await this.port.create({ ...base, stream: false });
        yield completionToResponse(raw);
        return;
      }
      const raw = await this.port.create({ ...base, stream: true });
      const stream = asAsyncIterable(raw);
      if (stream === null) {
        yield this.reportError(new Error('chat completions port returned a non-iterable stream'));
        return;
      }
      yield* this.drainStream(stream);
    } catch (cause: unknown) {
      yield this.reportError(cause);
    }
  }

  countTokens(messages: ChatMessage[]): number {
    let chars = 0;
    for (const message of messages) chars += message.content.length;
    return Math.ceil(chars / 4);
  }

  isRetryable(err: ProviderError): boolean {
    return isRetryableError(err);
  }

  private reportError(cause: unknown): ChatResponse {
    const mapped = mapSdkError(cause, this.provider);
    this.lastError = mapped;
    logger.warn(
      { provider: this.provider, model: this.model, kind: mapped.kind, message: mapped.message },
      'openai-compatible chat failed'
    );
    return { content: '', toolCalls: [], finishReason: 'error', usage: ZERO_USAGE };
  }

  private async *drainStream(stream: AsyncIterable<unknown>): AsyncIterable<ChatResponse> {
    const buffers = new Map<number, { id: string; name: string; args: string }>();
    let finish: FinishReason = 'stop';
    let usage: TokenUsage = ZERO_USAGE;
    for await (const item of stream) {
      const chunk = toStreamChunk(item);
      if (chunk === null) continue;
      for (const choice of chunk.choices) {
        const text = choice.delta.content ?? '';
        if (text.length > 0) {
          yield { content: text, toolCalls: [], finishReason: 'stop', usage: ZERO_USAGE };
        }
        for (const tc of choice.delta.tool_calls ?? []) {
          const existing = buffers.get(tc.index);
          const buf = existing ?? { id: '', name: '', args: '' };
          if (tc.id !== undefined && tc.id.length > 0 && buf.id.length === 0) buf.id = tc.id;
          const fragName = tc.function?.name;
          if (fragName !== undefined && fragName.length > 0 && buf.name.length === 0) {
            buf.name = fragName;
          }
          buf.args += tc.function?.arguments ?? '';
          buffers.set(tc.index, buf);
        }
        if (choice.finish_reason !== null) finish = normalizeFinishReason(choice.finish_reason);
      }
      if (chunk.usage !== undefined && chunk.usage !== null) usage = normalizeUsage(chunk.usage);
    }
    const ordered = [...buffers.entries()].sort(([a], [b]) => a - b);
    const toolCalls: ToolCall[] = [];
    for (const [index, buf] of ordered) {
      if (buf.id.length === 0 && buf.name.length === 0) continue;
      toolCalls.push({
        id: buf.id.length > 0 ? buf.id : `call_${index}`,
        name: buf.name,
        arguments: parseToolArguments(buf.args),
      });
    }
    yield { content: '', toolCalls, finishReason: finish, usage };
  }
}
