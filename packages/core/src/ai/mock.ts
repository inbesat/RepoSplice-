// Mock Provider (P-144).
//
// Fully offline, deterministic ChatProvider for tests and dev flows.
// Scriptable behavior: plays back scripted text/tool_call/finish steps,
// throws configured ProviderError, echoes canned reply, or defaults to stop.
// Zero network I/O.

import type { ChatProvider } from './provider.js';
import type {
  ChatMessage,
  ChatOptions,
  ChatResponse,
  ProviderError,
  ToolSchema,
  ToolCall,
  FinishReason,
  TokenUsage,
} from './types.js';
import { isRetryableError } from './provider.js';

/**
 * Script step types for MockProvider.
 */
export type MockStep =
  | { kind: 'text'; text: string }
  | { kind: 'tool_call'; toolCall: ToolCall }
  | { kind: 'finish'; finishReason: FinishReason; usage?: TokenUsage };

/**
 * Configuration for MockProvider.
 */
export interface MockConfig {
  /** Scripted sequence of steps to play back. */
  script?: MockStep[];
  /** Error to throw on first chat() iteration. */
  failWith?: ProviderError;
  /** Canned reply content if no script provided. */
  echoContent?: string;
  /** Provider name (default 'mock'). */
  name?: string;
  /** Model id (default 'mock-model'). */
  model?: string;
}

/**
 * Offline, deterministic MockProvider implementing ChatProvider.
 */
export class MockProvider implements ChatProvider {
  readonly name: string;
  readonly model: string;
  readonly provider = 'mock';
  readonly id: string;

  /** Counter of chat() invocations. */
  calls = 0;

  /** Last messages passed to chat(). */
  lastMessages: ChatMessage[] = [];

  /** Last tools passed to chat(). */
  lastTools: ToolSchema[] = [];

  // Declared as `T | undefined` (not `?:`) so assignment under
  // exactOptionalPropertyTypes accepts an absent config value.
  #script: MockStep[];
  #failWith: ProviderError | undefined;
  #echoContent: string | undefined;

  constructor(config: MockConfig = {}) {
    this.name = config.name ?? 'mock';
    this.model = config.model ?? 'mock-model';
    this.id = this.name + '/' + this.model;
    this.#script = config.script ?? [];
    this.#failWith = config.failWith;
    this.#echoContent = config.echoContent;
  }

  async *chat(
    messages: ChatMessage[],
    tools?: ToolSchema[],
    _options?: ChatOptions
  ): AsyncIterable<ChatResponse> {
    this.calls++;
    this.lastMessages = messages;
    this.lastTools = tools ?? [];

    // If configured to fail, throw the ProviderError
    if (this.#failWith) {
      throw this.#failWith;
    }

    // If no script, yield single done with echoContent or empty
    if (this.#script.length === 0) {
      const content = this.#echoContent ?? '';
      yield {
        content,
        toolCalls: [],
        finishReason: 'stop',
        usage: { input: 0, output: 0, total: 0 },
      };
      return;
    }

    // Play back scripted steps
    let bufferedContent = '';
    const bufferedToolCalls: ToolCall[] = [];
    let finishReason: FinishReason = 'stop';
    let usage: TokenUsage = { input: 0, output: 0, total: 0 };
    let finished = false;

    for (const step of this.#script) {
      switch (step.kind) {
        case 'text':
          bufferedContent += step.text;
          break;
        case 'tool_call':
          bufferedToolCalls.push(step.toolCall);
          break;
        case 'finish':
          finishReason = step.finishReason;
          if (step.usage) usage = step.usage;
          finished = true;
          break;
      }
    }

    // Yield accumulated response
    yield {
      content: bufferedContent,
      toolCalls: bufferedToolCalls,
      finishReason: finished ? finishReason : 'stop',
      usage,
    };
  }

  countTokens(messages: ChatMessage[]): number {
    return messages.reduce((n, m) => n + Math.ceil(m.content.length / 4), 0);
  }

  isRetryable(err: ProviderError): boolean {
    return isRetryableError(err);
  }
}

/**
 * Factory function for creating MockProvider instances.
 * Used by registry.createProvider for provider 'mock'.
 */
export function createMockProvider(config: MockConfig = {}): MockProvider {
  return new MockProvider(config);
}

/**
 * Convenience: create a MockProvider that echoes given text once.
 * For dev flows and quick tests.
 */
export function mockScriptFromText(text: string): MockProvider {
  return new MockProvider({ echoContent: text });
}
