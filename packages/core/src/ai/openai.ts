// Thin Result-returning wrapper around the `openai` SDK (P-027).
//
// The `openai@7` SDK is the universal transport for OpenAI-compatible
// chat-completions endpoints: OpenRouter (primary), OpenAI, and Ollama
// (local). One factory, three backends, by varying `baseURL`.
//
// `createOpenAICompatible(opts)` returns the typed `OpenAI` client
// (or an `INTERNAL` err if the SDK itself throws — which cannot happen
// with valid options but is the safe contract). The full provider
// class (streaming, tool-call buffering, finish-reason normalization,
// error mapping) is the job of P-132 `OpenAICompatibleProvider`.
//
// Default `baseURL` per `provider` (P-132/P-287 plan):
//   - `openrouter` → `https://openrouter.ai/api/v1`
//   - `openai`     → `https://api.openai.com/v1`
//   - `ollama`     → `http://localhost:11434/v1`
//
// Re-exports of `OpenAI`, `ClientOptions`, and the SDK error classes
// are kept narrow — consumers (P-132, P-138) only need the constructor
// and the chat-completions resource.

import OpenAI, {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIPromise,
  AuthenticationError,
  BadRequestError,
  ConflictError,
  InternalServerError,
  NotFoundError,
  PermissionDeniedError,
  RateLimitError,
  UnprocessableEntityError,
  type ClientOptions,
} from 'openai';
import { ok, err, type Result } from 'neverthrow';
import { type StitchError } from '../result/index.js';

/** Known OpenAI-compatible provider ids with default base URLs. */
export type OpenAICompatibleProvider = 'openrouter' | 'openai' | 'ollama';

/**
 * Options for the OpenAI-compatible client factory.
 *
 * `provider` is the logical id used to pick a default `baseURL`.
 * `baseURL` always wins over the per-provider default when set,
 * which is how Ollama's custom port (P-301) and OpenAI's Azure
 * variant get expressed.
 *
 * `defaultHeaders` is passed straight to the SDK; OpenRouter uses it
 * to attach `HTTP-Referer` + `X-Title` for dashboard attribution
 * without the wrapper hardcoding them.
 */
export interface OpenAICompatibleOptions {
  provider: OpenAICompatibleProvider | string;
  apiKey: string;
  model: string;
  baseURL?: string;
  defaultHeaders?: Record<string, string>;
  /** Per-request `timeout` (ms). Forwarded to `ClientOptions.timeout`. */
  timeoutMs?: number;
  /** `maxRetries` (SDK handles 429/5xx). Default: 2. */
  maxRetries?: number;
  /**
   * Custom `fetch` implementation. Forwarded to the SDK's `ClientOptions.fetch`
   * for testability (P-027 smoke test) and for runtime proxying (P-301).
   */
  fetch?: ClientOptions['fetch'];
}

/**
 * What we hand back. The full `OpenAI` instance (typed) is the deliverable;
 * we tag it with `provider` and `model` so consumers downstream don't have
 * to thread those separately. `client` is a `Pick` of the SDK surface we
 * actually use today (chat-completions + types); expand as P-132 grows.
 */
export interface OpenAICompatibleClient {
  provider: string;
  model: string;
  client: OpenAI;
}

/** Default base URL per known provider. Exported for P-134 registry wiring. */
export const DEFAULT_BASE_URLS: Readonly<Record<OpenAICompatibleProvider, string>> = {
  openrouter: 'https://openrouter.ai/api/v1',
  openai: 'https://api.openai.com/v1',
  ollama: 'http://localhost:11434/v1',
};

/**
 * Resolve the base URL for a provider id. Returns `undefined` if the
 * provider is unknown AND no explicit `baseURL` was passed; in that
 * case the SDK will use its own default (`api.openai.com/v1`), which
 * is the right behavior for the OpenAI id with no override.
 */
export function resolveBaseURL(provider: string, baseURL?: string): string | undefined {
  if (baseURL !== undefined && baseURL.length > 0) return baseURL;
  if (provider in DEFAULT_BASE_URLS) {
    return DEFAULT_BASE_URLS[provider as OpenAICompatibleProvider];
  }
  return undefined;
}

/**
 * Create an `OpenAI` client configured for the chosen provider.
 *
 * Returns ok(client) on success, or err(INTERNAL) only if the SDK
 * itself throws during construction (which is a true bug — the SDK
 * is permissive about its options). Validation of `apiKey` is the
 * caller's job (P-134 registry reads from `config.ai.providers`).
 */
export function createOpenAICompatible(
  options: OpenAICompatibleOptions
): Result<OpenAICompatibleClient, StitchError> {
  const clientOptions: ClientOptions = {
    apiKey: options.apiKey,
    ...(options.defaultHeaders !== undefined ? { defaultHeaders: options.defaultHeaders } : {}),
  };
  const resolvedBase = resolveBaseURL(options.provider, options.baseURL);
  if (resolvedBase !== undefined) clientOptions.baseURL = resolvedBase;
  if (options.timeoutMs !== undefined) clientOptions.timeout = options.timeoutMs;
  if (options.maxRetries !== undefined) clientOptions.maxRetries = options.maxRetries;
  if (options.fetch !== undefined) clientOptions.fetch = options.fetch;
  try {
    const client = new OpenAI(clientOptions);
    return ok({ provider: options.provider, model: options.model, client });
  } catch (cause: unknown) {
    const detail = cause instanceof Error ? cause.message : 'unknown openai init error';
    return err({
      code: 'INTERNAL',
      message: `openai init failed for ${options.provider}: ${detail}`,
    });
  }
}

// Narrow re-exports of the SDK types/classes that downstream code needs.
// Keeping them re-exported from one place lets cli/web depend on the core
// barrel alone (AGENTS import rule: no reaching into vendor packages).
export {
  OpenAI,
  type ClientOptions,
  APIPromise,
  // Error class re-exports for P-132 (error → ProviderError mapping).
  APIError,
  APIConnectionError,
  APIConnectionTimeoutError,
  AuthenticationError,
  BadRequestError,
  ConflictError,
  InternalServerError,
  NotFoundError,
  PermissionDeniedError,
  RateLimitError,
  UnprocessableEntityError,
};
