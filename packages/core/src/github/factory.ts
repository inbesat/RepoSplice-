// Thin typed wrapper around `@octokit/rest` so every later P-088+ module
// imports a stable, Result-returning surface (P-011 contract) instead of
// the raw lib. The wrapper:
//   - supports PAT auth in P-017
//   - will support GitHub App auth in P-018 (composes @octokit/auth-app)
//   - returns Result<T, StitchError> from a typed `request` helper
//   - exposes the raw Octokit instance for advanced callers that need
//     streaming or paginated access
//
// Auth flow:
//   - P-017 (now): `createOctokit({ authType: 'pat', token })` → standard PAT
//   - P-018 (next): adds `authType: 'app'` with createAppAuth

import { Octokit } from '@octokit/rest';
import { createAppAuth } from '@octokit/auth-app';
import { ok, err, ResultAsync } from 'neverthrow';
import { fromInternalPromise, type StitchError } from '../result/index.js';

export interface OctokitPatAuth {
  authType: 'pat';
  token: string;
}

export interface OctokitAppAuth {
  authType: 'app';
  /** GitHub App ID (P-009 already validates this is set when authType='app'). */
  appId: number;
  /** PEM-encoded RSA private key for the App. */
  privateKey: string;
  /** Installation ID whose token we want. */
  installationId: number;
}

export type OctokitAuth = OctokitPatAuth | OctokitAppAuth;

export interface OctokitFactoryOptions {
  auth: OctokitAuth;
  /**
   * Override the base URL (e.g. for GHE on-prem or test fixtures).
   * Default: https://api.github.com
   */
  baseUrl?: string;
  /**
   * User agent string (GitHub requires a UA on all calls).
   * Default: 'repo-stitcher'
   */
  userAgent?: string;
  /**
   * Optional custom request hooks (P-096 rate-limit backoff lives here).
   * Use this in tests to inject a mocked fetch.
   */
  request?: { fetch?: typeof globalThis.fetch };
}

/**
 * Build an authenticated Octokit client from the project config (P-009).
 * Use this in every later P-088+ module instead of `new Octokit()` directly.
 */
export function createOctokit(opts: OctokitFactoryOptions): Octokit {
  const { auth, baseUrl, userAgent = 'repo-stitcher', request } = opts;
  const octokitOptions: Record<string, unknown> = {
    userAgent,
    ...(baseUrl !== undefined ? { baseUrl } : {}),
    ...(request !== undefined ? { request } : {}),
  };
  if (auth.authType === 'pat') {
    octokitOptions.auth = auth.token;
  } else {
    // GitHub App flow: @octokit/auth-app mints installation tokens
    // automatically. The private key never leaves this process.
    octokitOptions.authStrategy = createAppAuth;
    octokitOptions.auth = {
      appId: auth.appId,
      privateKey: auth.privateKey,
      installationId: auth.installationId,
    };
  }
  return new Octokit(octokitOptions as ConstructorParameters<typeof Octokit>[0]);
}

// ─── High-level Result-returning helpers (Phase 0 surface) ────────────────
// P-088+ modules should add their own typed wrappers (auth.ts, repos.ts,
// etc.). For now we ship the minimal surface P-017 needs to prove the
// integration works and the factory produces a usable client.

/**
 * Type-safe wrapper around any Octokit REST endpoint call. Returns a
 * ResultAsync so callers can compose with the rest of the Result chain
 * (P-011 contract).
 *
 * Example:
 *   const r = await request(octokit, c => c.repos.get({owner, repo}));
 *   if (r.isOk()) console.log(r.value.data.default_branch);
 */
export function request<T>(
  octokit: Octokit,
  fn: (o: Octokit) => Promise<{ data: T; status: number; headers: Record<string, string> }>
): ResultAsync<T, StitchError> {
  return fromInternalPromise(fn(octokit), 'octokit.request').map(res => res.data);
}

/**
 * Convert an Octokit response.status to a typed StitchError. Used by
 * helpers that want to map non-2xx to typed failures (P-011 contract).
 */
export function statusToStitchError(
  status: number,
  statusText: string,
  context: string
): StitchError {
  // 401/403: auth; 404: not found; 422: validation; >=500: server.
  if (status === 401 || status === 403) {
    return {
      code: 'AUTH_ERROR',
      provider: 'github',
      message: `${context}: ${status} ${statusText}`,
    };
  }
  if (status === 404) {
    return {
      code: 'GITHUB_API_ERROR',
      status,
      message: `${context}: ${status} ${statusText}`,
    };
  }
  if (status === 422) {
    return {
      code: 'CONFIG_ERROR',
      field: 'github',
      message: `${context}: ${status} ${statusText} (validation failure)`,
    };
  }
  return {
    code: 'GITHUB_API_ERROR',
    status,
    message: `${context}: ${status} ${statusText}`,
  };
}

/**
 * Typed `repos.get` helper. Used by P-089/P-091 (tree/file fetch).
 * Demonstrates the request+map pattern; the real P-088+ surface will
 * extend this for every endpoint.
 *
 * Implementation note: Octokit v22 throws a `RequestError` on non-2xx by
 * default. We catch it explicitly so the status is mapped to a typed
 * StitchError (per the P-011 contract) rather than becoming an
 * opaque INTERNAL rejection.
 */
export function getRepo(
  octokit: Octokit,
  owner: string,
  repo: string
): ResultAsync<{ name: string; full_name: string; default_branch: string }, StitchError> {
  const context = `repos.get(${owner}/${repo})`;
  const promise = (async () => {
    try {
      // Octokit v22 throws on non-2xx; reach for the low-level `request()`
      // and trust the typed response shape.
      const res = await octokit.request('GET /repos/{owner}/{repo}', { owner, repo });
      return {
        status: res.status,
        data: res.data as unknown as { name: string; full_name: string; default_branch: string },
      };
    } catch (e) {
      // Octokit throws RequestError with .status on non-2xx
      const status =
        typeof e === 'object' && e !== null && 'status' in e
          ? Number((e as { status: unknown }).status)
          : 0;
      return {
        status,
        data: null as unknown as { name: string; full_name: string; default_branch: string },
      };
    }
  })();
  return fromInternalPromise(promise, context).andThen(res => {
    if (res.status >= 400) {
      return err(statusToStitchError(res.status, '', context));
    }
    return ok({
      name: res.data.name,
      full_name: res.data.full_name,
      default_branch: res.data.default_branch,
    });
  });
}
