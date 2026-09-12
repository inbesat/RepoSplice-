// GitHub auth (P-088): the credential foundation of the GitHub epic.
// `resolveAuth` reads credentials off the validated config (P-009);
// `createValidatedClient` boundary-checks everything the raw factory
// trusts (blank tokens, bad ids, non-PEM keys, malformed base URLs) and
// never echoes secrets; `validateAuth` proves the token against
// `users.getAuthenticated()` and gates write contexts on repo scopes;
// `clientFromConfig` composes all three for P-089+ callers.
//
// Verified behavior (probed, do not assume otherwise):
// - `new Octokit({ auth: token })` and the createAppAuth strategy build
//   without network (App installation tokens mint lazily per call).
// - PAT responses carry `x-oauth-scopes` (lowercase, comma-joined);
//   App installation tokens carry NO scopes header — their permissions
//   are enforced server-side per call, so write validation trusts them
//   here and any later 403 maps with the login hint.
// - Octokit v22 throws RequestError (`.status`) on non-2xx; header bags
//   arrive as plain objects (nock-proven) but Headers instances are
//   accepted too.
// - `users.getAuthenticated` never returns the token: error and success
//   shapes are screened by test (sentinel assertion).
//
// Safety contract:
// - Secrets travel in options/headers only: no error message, log field,
//   or refusal text ever interpolates a token or key (only presence,
//   field names, and the `stitch login` hint).
// - Misuse is CONFIG_ERROR; auth failures are AUTH_ERROR with the login
//   hint (P-203 owns future taxonomy — factory precedent); malformed
//   payloads are INTERNAL fail-closed (never invent an identity).
// - The narrow AuthClient seam keeps tests off real network (P-069
//   CloneGit precedent: structural, no casts, no full-Octokit fakes).
//
// Seams and future phases:
// - P-200/P-206 own the secret store: App keys arrive injected (they
//   will source `privateKeyPath`); config already carries the fields.
// - P-092/P-294 consume the write context; P-096 owns retry/timeout
//   (no fake progress or timeout surface here).

import { Octokit } from '@octokit/rest';
import { ok, err, type Result } from 'neverthrow';
import type { StitchError } from '../result/index.js';
import type { GitHubConfig } from '../config/schema.js';
import { createOctokit, statusToStitchError, type OctokitFactoryOptions } from './factory.js';

/** Operation context: read (any identity) vs write (repo scopes). */
export type AuthContext = 'read' | 'write';

export interface ValidateAuthOpts {
  /** Default: 'read'. Unknown values refuse (CONFIG). */
  context?: AuthContext;
}

/** Proven identity plus the scopes GitHub reported (possibly none). */
export interface AuthenticatedUser {
  login: string;
  id: number;
  type: string;
  scopes: string[];
}

/** Narrow endpoint seam (real Octokit satisfies this structurally). */
export interface AuthEndpoint {
  getAuthenticated(): Promise<{ data: unknown; headers: unknown; status: number }>;
}

/** Narrow client seam (no full-Octokit fakes in tests). */
export interface AuthClient {
  rest: { users: AuthEndpoint };
}

/** Write contexts require one of these PAT scopes. */
const WRITE_SCOPES = ['repo', 'public_repo'];

const LOGIN_HINT = 'run `stitch login` or check token scopes';

function invalid(field: string, message: string): Result<never, StitchError> {
  return err({ code: 'CONFIG_ERROR', field, message });
}

function internalError(op: string, cause: unknown): StitchError {
  const detail = cause instanceof Error ? cause.message : String(cause);
  return {
    code: 'INTERNAL',
    message: `${op}: ${detail}`,
    ...(cause instanceof Error ? { cause } : {}),
  };
}

/** Non-blank string (type predicate so callers narrow safely). */
function isNonBlankString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/**
 * Validated client construction over the raw factory (P-017/P-018):
 * every field the factory trusts is checked here first. Secrets are
 * never echoed — refusals name fields, never values.
 */
export function createValidatedClient(opts: OctokitFactoryOptions): Result<Octokit, StitchError> {
  const op = 'createValidatedClient';
  try {
    const auth = opts.auth;
    if (auth === undefined || auth === null) {
      return invalid('auth', `${op}: auth is required`);
    }
    if (auth.authType === 'pat') {
      if (!isNonBlankString(auth.token)) {
        return invalid('auth.token', `${op}: PAT token is required (${LOGIN_HINT})`);
      }
    } else if (auth.authType === 'app') {
      if (!Number.isInteger(auth.appId) || auth.appId < 1) {
        return invalid('auth.appId', `${op}: appId must be a positive integer`);
      }
      if (!isNonBlankString(auth.privateKey) || !auth.privateKey.startsWith('-----BEGIN')) {
        return invalid('auth.privateKey', `${op}: privateKey must be PEM-encoded`);
      }
      if (!Number.isInteger(auth.installationId) || auth.installationId < 1) {
        return invalid('auth.installationId', `${op}: installationId must be a positive integer`);
      }
    } else {
      const kind = (auth as { authType?: unknown }).authType;
      return invalid('auth.authType', `${op}: unknown authType ${JSON.stringify(kind)}`);
    }
    if (opts.baseUrl !== undefined) {
      let protocol: string;
      try {
        protocol = new URL(opts.baseUrl).protocol;
      } catch {
        return invalid('baseUrl', `${op}: baseUrl must be a valid http(s) URL`);
      }
      if (protocol !== 'http:' && protocol !== 'https:') {
        return invalid('baseUrl', `${op}: baseUrl must be a valid http(s) URL`);
      }
    }
    return ok(createOctokit(opts));
  } catch (cause: unknown) {
    return err(internalError(op, cause));
  }
}

export interface ResolveAuthSecrets {
  /**
   * App private-key material (P-206 will source `privateKeyPath` from the
   * secret store; until then callers inject it).
   */
  privateKey?: string;
}

/**
 * Pure credential resolution off the validated config (P-009): PAT needs
 * its token, App needs ids plus injected key material. Presence (not
 * origin) is checked — P-200/P-206 own where secrets live.
 */
export function resolveAuth(
  github: GitHubConfig,
  secrets: ResolveAuthSecrets = {}
): Result<OctokitFactoryOptions['auth'], StitchError> {
  const op = 'resolveAuth';
  if (github === undefined || github === null) {
    return invalid('github', `${op}: github config is required`);
  }
  if (github.authType === 'pat') {
    if (!isNonBlankString(github.token)) {
      return invalid(
        'github.token',
        `${op}: authType "pat" requires a token (${LOGIN_HINT}; set github.token or GITHUB_TOKEN)`
      );
    }
    return ok({ authType: 'pat', token: github.token });
  }
  if (github.authType === 'app') {
    const appId = github.appId;
    if (typeof appId !== 'number' || !Number.isInteger(appId) || appId < 1) {
      return invalid('github.appId', `${op}: authType "app" requires a positive integer appId`);
    }
    const installationId = github.installationId;
    if (
      typeof installationId !== 'number' ||
      !Number.isInteger(installationId) ||
      installationId < 1
    ) {
      return invalid(
        'github.installationId',
        `${op}: authType "app" requires a positive integer installationId`
      );
    }
    const privateKey = secrets.privateKey;
    if (!isNonBlankString(privateKey) || !privateKey.startsWith('-----BEGIN')) {
      return invalid(
        'privateKey',
        `${op}: authType "app" requires PEM key material (P-206 will source privateKeyPath)`
      );
    }
    return ok({ authType: 'app', appId, privateKey, installationId });
  }
  const kind = (github as { authType?: unknown }).authType;
  return invalid('github.authType', `${op}: unknown authType ${JSON.stringify(kind)}`);
}

export interface ClientFromConfigOpts {
  baseUrl?: string;
  userAgent?: string;
}

/**
 * One-call client from config (what P-089+ modules use): resolve
 * credentials, then build the validated client.
 */
export function clientFromConfig(
  github: GitHubConfig,
  secrets: ResolveAuthSecrets = {},
  clientOpts: ClientFromConfigOpts = {}
): Result<Octokit, StitchError> {
  const auth = resolveAuth(github, secrets);
  if (auth.isErr()) return err(auth.error);
  return createValidatedClient({
    auth: auth.value,
    ...(clientOpts.baseUrl !== undefined ? { baseUrl: clientOpts.baseUrl } : {}),
    ...(clientOpts.userAgent !== undefined ? { userAgent: clientOpts.userAgent } : {}),
  });
}

/** Thrown-error to typed error: status when present, typed fallbacks. */
function mapThrown(error: unknown, op: string): StitchError {
  if (error instanceof Error) {
    const rec = error as { status?: unknown };
    if (typeof rec.status === 'number') {
      return mapStatus(rec.status, error.message, op);
    }
    return {
      code: 'GITHUB_API_ERROR',
      status: 0,
      message: `${op} failed: ${error.message}`,
    };
  }
  return {
    code: 'GITHUB_API_ERROR',
    status: 0,
    message: `${op} failed: ${String(error)}`,
  };
}

/** Status mapping reuses the factory taxonomy, enriched with the hint. */
function mapStatus(status: number, statusText: string, op: string): StitchError {
  const base = statusToStitchError(status, statusText, op);
  if (base.code !== 'AUTH_ERROR') return base;
  return { ...base, message: `${base.message} (${LOGIN_HINT})` };
}

/** Case-tolerant single-header read (plain bags and Headers instances). */
function headerValue(headers: unknown, name: string): string | undefined {
  if (typeof headers !== 'object' || headers === null) return undefined;
  const rec = headers as Record<string, unknown>;
  const direct = rec[name];
  if (typeof direct === 'string') return direct;
  const getter = rec['get'];
  if (typeof getter === 'function') {
    const out = (getter as (headerName: string) => unknown).call(rec, name);
    return typeof out === 'string' ? out : undefined;
  }
  return undefined;
}

function parseScopes(headers: unknown): string[] {
  const raw = headerValue(headers, 'x-oauth-scopes');
  if (raw === undefined) return [];
  return raw
    .split(',')
    .map(part => part.trim())
    .filter(part => part !== '');
}

function parseUser(
  data: unknown,
  op: string
): Result<{ login: string; id: number; type: string }, StitchError> {
  if (typeof data !== 'object' || data === null) {
    return err(internalError(op, 'malformed user payload (not an object)'));
  }
  const rec = data as { login?: unknown; id?: unknown; type?: unknown };
  if (!isNonBlankString(rec.login)) {
    return err(internalError(op, 'malformed user payload (login)'));
  }
  if (typeof rec.id !== 'number' || !Number.isInteger(rec.id)) {
    return err(internalError(op, 'malformed user payload (id)'));
  }
  if (!isNonBlankString(rec.type)) {
    return err(internalError(op, 'malformed user payload (type)'));
  }
  return ok({ login: rec.login, id: rec.id, type: rec.type });
}

/**
 * Prove the token against `users.getAuthenticated()` and gate the
 * operation context: read passes any identity; write needs a repo scope
 * on PATs (scope header present). App tokens carry no scopes header —
 * GitHub enforces their permissions per call, so they pass here and any
 * later 403 maps with the login hint.
 */
export async function validateAuth(
  client: AuthClient,
  opts: ValidateAuthOpts = {}
): Promise<Result<AuthenticatedUser, StitchError>> {
  const op = 'validateAuth';
  const context = opts.context ?? 'read';
  if (context !== 'read' && context !== 'write') {
    return invalid('context', `${op}: unknown auth context ${JSON.stringify(context)}`);
  }
  let response: { data: unknown; headers: unknown; status: number };
  try {
    response = await client.rest.users.getAuthenticated();
  } catch (error: unknown) {
    return err(mapThrown(error, op));
  }
  if (response.status >= 400) {
    return err(mapStatus(response.status, '', op));
  }
  const user = parseUser(response.data, op);
  if (user.isErr()) return err(user.error);
  const scopes = parseScopes(response.headers);
  if (
    context === 'write' &&
    scopes.length > 0 &&
    !scopes.some(scope => WRITE_SCOPES.includes(scope))
  ) {
    return err({
      code: 'AUTH_ERROR',
      provider: 'github',
      message: `${op}: write operations require the 'repo' scope (found: ${scopes.join(', ')}) (${LOGIN_HINT})`,
    });
  }
  return ok({ login: user.value.login, id: user.value.id, type: user.value.type, scopes });
}
