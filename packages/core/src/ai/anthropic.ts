// Thin Result-returning wrapper around `@anthropic-ai/sdk` (P-028).
//
// The Anthropic SDK is the second of two transport layers backing the
// `ChatProvider` interface (P-131). Unlike OpenRouter/OpenAI/Ollama
// (P-027), Anthropic has its own non-OpenAI-compatible message/tool
// protocol (`tool_use` content blocks, `system` as a separate field,
// `anthropic-version` header). The conversion lives in P-133
// `AnthropicProvider`; this phase just exposes the typed client and
// the SDK error classes for the P-133 error-mapping pass.
//
// `createAnthropicClient(opts)` returns the typed `Anthropic` client
// (or an `INTERNAL` err if the SDK itself throws — which cannot happen
// with valid options but is the safe contract). The full provider
// class (tool_use ↔ ToolCall conversion, stop_reason normalization,
// error → StitchError mapping) is the job of P-133.
//
// `apiKey` validation is the caller's job (P-134 reads from
// `config.ai.providers`).

import Anthropic, {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIPromise,
  AnthropicError,
  AuthenticationError,
  BadRequestError,
  ConflictError,
  InternalServerError,
  NotFoundError,
  PermissionDeniedError,
  RateLimitError,
  RetryableError,
  UnprocessableEntityError,
  type ClientOptions,
} from '@anthropic-ai/sdk';
import { ok, err, type Result } from 'neverthrow';
import { type StitchError } from '../result/index.js';

/** Known Anthropic-compatible provider ids with default base URLs. */
export type AnthropicProviderId = 'anthropic';

/** Default base URL for Anthropic's public API. Exposed for P-134 wiring. */
export const ANTHROPIC_DEFAULT_BASE_URL = 'https://api.anthropic.com';

/** All currently-supported provider ids (a single-element set today). */
export const ANTHROPIC_DEFAULT_BASE_URLS: Readonly<Record<AnthropicProviderId, string>> = {
  anthropic: ANTHROPIC_DEFAULT_BASE_URL,
};

/**
 * Options for the Anthropic client factory.
 *
 * `provider` is the logical id used to pick a default `baseURL`. The
 * SDK itself defaults to `https://api.anthropic.com` (or
 * `process.env.ANTHROPIC_BASE_URL`), so this wrapper mirrors that
 * default and lets the caller override it for proxies / Azure
 * Anthropic endpoints (future).
 *
 * `defaultHeaders` is passed straight to the SDK; the Anthropic API
 * itself doesn't read custom headers, but proxies (P-301) and
 * observability hooks may.
 */
export interface AnthropicClientOptions {
  provider: AnthropicProviderId | string;
  apiKey: string;
  model: string;
  baseURL?: string;
  defaultHeaders?: Record<string, string>;
  /** Per-request `timeout` (ms). Forwarded to `ClientOptions.timeout`. */
  timeoutMs?: number;
  /** `maxRetries` (SDK handles 429/5xx). Default: 2. */
  maxRetries?: number;
  /**
   * Custom `fetch` implementation. Forwarded to the SDK's
   * `ClientOptions.fetch` for testability (P-028 smoke test) and for
   * runtime proxying (P-301).
   */
  fetch?: ClientOptions['fetch'];
}

/**
 * What we hand back. The full `Anthropic` instance (typed) is the
 * deliverable; we tag it with `provider` and `model` so consumers
 * downstream don't have to thread those separately.
 */
export interface AnthropicClient {
  provider: string;
  model: string;
  client: Anthropic;
}

/**
 * Resolve the base URL for a provider id. Returns `undefined` if the
 * provider is unknown AND no explicit `baseURL` was passed; in that
 * case the SDK will use its own default (`api.anthropic.com` or
 * `process.env.ANTHROPIC_BASE_URL`), which is the right behavior.
 */
export function resolveAnthropicBaseURL(provider: string, baseURL?: string): string | undefined {
  if (baseURL !== undefined && baseURL.length > 0) return baseURL;
  if (provider in ANTHROPIC_DEFAULT_BASE_URLS) {
    return ANTHROPIC_DEFAULT_BASE_URLS[provider as AnthropicProviderId];
  }
  return undefined;
}

/**
 * Create an `Anthropic` client configured for the chosen provider.
 *
 * Returns ok(client) on success, or err(INTERNAL) only if the SDK
 * itself throws during construction (which is a true bug — the SDK
 * is permissive about its options).
 */
export function createAnthropicClient(
  options: AnthropicClientOptions
): Result<AnthropicClient, StitchError> {
  const clientOptions: ClientOptions = {
    apiKey: options.apiKey,
    ...(options.defaultHeaders !== undefined ? { defaultHeaders: options.defaultHeaders } : {}),
  };
  const resolvedBase = resolveAnthropicBaseURL(options.provider, options.baseURL);
  if (resolvedBase !== undefined) clientOptions.baseURL = resolvedBase;
  if (options.timeoutMs !== undefined) clientOptions.timeout = options.timeoutMs;
  if (options.maxRetries !== undefined) clientOptions.maxRetries = options.maxRetries;
  if (options.fetch !== undefined) clientOptions.fetch = options.fetch;
  try {
    const client = new Anthropic(clientOptions);
    return ok({ provider: options.provider, model: options.model, client });
  } catch (cause: unknown) {
    const detail = cause instanceof Error ? cause.message : 'unknown anthropic init error';
    return err({
      code: 'INTERNAL',
      message: `anthropic init failed for ${options.provider}: ${detail}`,
    });
  }
}

// Narrow re-exports of the SDK types/classes that downstream code needs.
// Keeping them re-exported from one place lets cli/web depend on the core
// barrel alone (AGENTS import rule: no reaching into vendor packages).
export {
  Anthropic,
  AnthropicError,
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
  RetryableError,
  UnprocessableEntityError,
  APIPromise,
};
export type { ClientOptions };
