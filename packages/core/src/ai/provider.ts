// ChatProvider contract (P-131).
//
// The single interface every AI backend implements (OpenRouter/OpenAI/Ollama
// via P-132, Anthropic via P-133, mocks in tests). Agent logic (tool loop
// P-140, streaming P-136) talks only to this surface so providers stay
// swappable at runtime (P-146) and retry/backoff (P-138) stays uniform.
//
// Interface-only phase: no SDK imports, no network calls, no API keys.
// Concrete backends: OpenRouter (`openai` SDK), Anthropic
// (`@anthropic-ai/sdk`), Ollama (OpenAI-compatible base URL).

import type { ChatMessage, ChatOptions, ChatResponse, ProviderError, ToolSchema } from './types.js';

export interface ChatProvider {
  readonly name: string;
  readonly model: string;
  readonly provider: string;
  readonly id: string;
  chat(
    messages: ChatMessage[],
    tools?: ToolSchema[],
    options?: ChatOptions
  ): AsyncIterable<ChatResponse>;
  countTokens(messages: ChatMessage[]): number;
  isRetryable(err: ProviderError): boolean;
}

/**
 * Default `isRetryable` semantics shared by every provider (P-138 retry).
 *
 * - `rate_limit` / `timeout` / `network` → retryable (transient).
 * - `auth` / `invalid_request` → never retryable (caller must fix
 *   credentials or the request shape; retrying is a busy loop).
 * - `unknown` → not retryable unless the implementation knows better
 *   (conservative: surface to the caller instead of hammering).
 *
 * Provider `isRetryable` methods should delegate here unless they have
 * backend-specific knowledge (e.g. Ollama local 500s during model load
 * that deserve one retry — document any deviation at the call site).
 */
export function isRetryableError(err: ProviderError): boolean {
  return err.retryable;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

/**
 * Normalize whatever a provider rejected with into a `ProviderError`.
 *
 * A provider may throw an SDK `Error` OR a bare `ProviderError` value (that
 * object IS the `ChatProvider` contract's error type, and `MockProvider` throws
 * it directly). Without this, a thrown contract object degrades to
 * `kind:'unknown'` with the message `[object Object]`, which loses the real
 * retry classification and the P-145 audit row's fidelity.
 *
 * @param value - The caught value
 * @param providerName - Fallback provider name when the value omits one
 */
export function asProviderError(value: unknown, providerName: string): ProviderError {
  if (
    isRecord(value) &&
    typeof value.message === 'string' &&
    typeof value.kind === 'string' &&
    typeof value.retryable === 'boolean'
  ) {
    const candidate = value as unknown as ProviderError;
    return {
      ...candidate,
      providerName:
        typeof candidate.providerName === 'string' && candidate.providerName.length > 0
          ? candidate.providerName
          : providerName,
    };
  }
  return {
    kind: 'unknown',
    message: value instanceof Error ? value.message : String(value),
    providerName,
    retryable: false,
  };
}

/**
 * Runtime contract guard for the provider registry (P-134).
 *
 * Validates that `impl` quacks like a `ChatProvider` (all members present
 * with the right shapes). Returns void on success; throws a descriptive
 * `Error` on the first mismatch so misconfigured providers fail fast at
 * registration time instead of mid-loop in P-140.
 *
 * NOTE (guardrail conflict, blueprint wins): the phase mandates the
 * `conformsToChatProvider(impl): void` signature, so rejection is a
 * thrown `Error` (never a `throw` literal — `no-throw-literal` clean),
 * matching the P-129 `getScanner` registry precedent. Pipeline code
 * (P-140+) must validate once at the boundary and use `Result` after.
 */
export function conformsToChatProvider(impl: unknown): void {
  if (!isRecord(impl)) {
    throw new Error('conformsToChatProvider: provider must be an object');
  }
  for (const field of ['name', 'model', 'provider', 'id'] as const) {
    const value = impl[field];
    if (typeof value !== 'string' || value.length === 0) {
      throw new Error(`conformsToChatProvider: provider.${field} must be a non-empty string`);
    }
  }
  for (const method of ['chat', 'countTokens', 'isRetryable'] as const) {
    if (typeof impl[method] !== 'function') {
      throw new Error(`conformsToChatProvider: provider.${method} must be a function`);
    }
  }
}
