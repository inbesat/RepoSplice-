// GitHub error mapping (P-102): every Octokit failure shape maps to one
// stable StitchError code + an actionable hint (+ repo/scope for the UI)
// without throwing. Pure unit surface — no network, no fakes, no nock:
// the mapper is synchronous and total over unknown inputs.
import { describe, expect, it } from 'vitest';
import {
  GITHUB_CONFLICT_HINT,
  GITHUB_LOGIN_HINT,
  GITHUB_NETWORK_HINT,
  mapGitHubError,
  mapGitHubStatus,
  rateLimitExhausted,
  type GitHubErrorContext,
} from '../errors.js';

const CTX: GitHubErrorContext = { operation: 'probeOp' };

/** RequestError shape: status plus headers on the error itself. */
function thrown(status: number, message: string, headers?: unknown): Error {
  const error = new Error(message) as Error & { status: number; headers?: unknown };
  error.status = status;
  if (headers !== undefined) error.headers = headers;
  return error;
}

/** RequestError shape: headers nested under `response` (real Octokit). */
function nested(status: number, message: string, headers: unknown): Error {
  const error = new Error(message) as Error & {
    status: number;
    response: { headers: unknown };
  };
  error.status = status;
  error.response = { headers };
  return error;
}

describe('mapGitHubError', () => {
  it('401', () => {
    const ctx: GitHubErrorContext = { operation: 'probeOp', repo: 'o/r', scope: 'repo' };
    const mapped = mapGitHubError(thrown(401, 'Bad credentials'), ctx);
    expect(mapped.code).toBe('AUTH_FAILED');
    if (mapped.code !== 'AUTH_FAILED') return;
    expect(mapped.provider).toBe('github');
    expect(mapped.message).toContain('401');
    expect(mapped.message).toContain(GITHUB_LOGIN_HINT);
    expect(mapped.hint).toBe(GITHUB_LOGIN_HINT);
    expect(mapped.repo).toBe('o/r');
    expect(mapped.scope).toBe('repo');
    const resolved = mapGitHubStatus(401, 'Unauthorized', CTX);
    expect(resolved.code).toBe('AUTH_FAILED');
    if (resolved.code !== 'AUTH_FAILED') return;
    expect(resolved.message).toContain(GITHUB_LOGIN_HINT);
    expect(resolved.hint).toBe(GITHUB_LOGIN_HINT);
  });

  it('rate limit', () => {
    const direct = mapGitHubError(thrown(429, 'slow down', { 'retry-after': '30' }), CTX);
    expect(direct.code).toBe('RATE_LIMIT');
    if (direct.code !== 'RATE_LIMIT') return;
    expect(direct.status).toBe(429);
    expect(direct.message).toContain('retry after 30s');
    expect(direct.hint).toContain('30');
    const remaining = mapGitHubError(thrown(403, 'limited', { 'x-ratelimit-remaining': '0' }), CTX);
    expect(remaining.code).toBe('RATE_LIMIT');
    const bare = mapGitHubError(thrown(403, 'API rate limit exceeded'), CTX);
    expect(bare.code).toBe('RATE_LIMIT');
    if (bare.code !== 'RATE_LIMIT') return;
    expect(bare.message).toContain('retry delay unknown');
    expect(bare.hint).toBeTruthy();
    const epoch = mapGitHubError(
      thrown(429, 'slow down', {
        'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 60),
      }),
      CTX
    );
    expect(epoch.code).toBe('RATE_LIMIT');
    if (epoch.code !== 'RATE_LIMIT') return;
    expect(epoch.message).toMatch(/retry after \d+s/);
    const transport = mapGitHubError(
      nested(403, 'API rate limit exceeded', {
        'x-ratelimit-remaining': '0',
        'retry-after': '75',
      }),
      CTX
    );
    expect(transport.code).toBe('RATE_LIMIT');
    if (transport.code !== 'RATE_LIMIT') return;
    expect(transport.message).toContain('retry after 75s');
    // A hostile headers bag (throwing getter) still maps without throwing.
    const hostile = mapGitHubError(
      thrown(429, 'API rate limit exceeded', {
        get: () => {
          throw new Error('headers unavailable');
        },
      }),
      CTX
    );
    expect(hostile.code).toBe('RATE_LIMIT');
    if (hostile.code !== 'RATE_LIMIT') return;
    expect(hostile.message).toContain('retry delay unknown');
    // Exhaustion (P-096 terminal) carries the stable code + attempts.
    const exhausted = rateLimitExhausted('withRateLimit', 429, 2);
    expect(exhausted.code).toBe('RATE_LIMIT');
    expect(exhausted.status).toBe(429);
    expect(exhausted.message).toContain('2 attempts');
    expect(exhausted.message).toContain('budget exhausted');
    expect(exhausted.hint).toBeTruthy();
  });

  it('404', () => {
    const ctx: GitHubErrorContext = { operation: 'probeOp', repo: 'o/r' };
    const mapped = mapGitHubError(thrown(404, 'Not Found'), ctx);
    expect(mapped.code).toBe('NOT_FOUND');
    if (mapped.code !== 'NOT_FOUND') return;
    expect(mapped.status).toBe(404);
    expect(mapped.message).toContain('404');
    expect(mapped.hint).toBeTruthy();
    expect(mapped.repo).toBe('o/r');
    const resolved = mapGitHubStatus(404, '', CTX);
    expect(resolved.code).toBe('NOT_FOUND');
    if (resolved.code !== 'NOT_FOUND') return;
    expect(resolved.status).toBe(404);
    expect(resolved.hint).toBeTruthy();
  });

  it('network', () => {
    const shapes: unknown[] = [
      new TypeError('fetch failed'),
      new Error('socket hang up'),
      new Error('read ECONNRESET'),
      Object.assign(new Error('aborted'), { name: 'AbortError' }),
      Object.assign(new Error('connect ECONNREFUSED 140.82.112.6:443'), {
        code: 'ECONNREFUSED',
      }),
      Object.assign(new Error('getaddrinfo ENOTFOUND api.github.com'), {
        code: 'ENOTFOUND',
      }),
    ];
    for (const shape of shapes) {
      const mapped = mapGitHubError(shape, CTX);
      expect(mapped.code).toBe('NETWORK');
      if (mapped.code !== 'NETWORK') continue;
      expect(mapped.message).toContain('probeOp');
      expect(mapped.hint).toBe(GITHUB_NETWORK_HINT);
    }
    // No network signal and no status: generic, never NETWORK.
    const plain = mapGitHubError(new Error('boom'), CTX);
    expect(plain.code).toBe('GITHUB_API_ERROR');
    if (plain.code !== 'GITHUB_API_ERROR') return;
    expect(plain.status).toBe(0);
  });

  it('generic', () => {
    const server = mapGitHubError(thrown(503, 'Service Unavailable'), CTX);
    expect(server.code).toBe('GITHUB_API_ERROR');
    if (server.code !== 'GITHUB_API_ERROR') return;
    expect(server.status).toBe(503);
    // The factory taxonomy is preserved: 422 stays a config error.
    const invalid = mapGitHubStatus(422, 'Validation Failed', CTX);
    expect(invalid.code).toBe('CONFIG_ERROR');
    const primitive = mapGitHubError('nope', CTX);
    expect(primitive.code).toBe('GITHUB_API_ERROR');
    if (primitive.code !== 'GITHUB_API_ERROR') return;
    expect(primitive.status).toBe(0);
    expect(primitive.message).toContain('nope');
    const nothing = mapGitHubError(undefined, CTX);
    expect(nothing.code).toBe('GITHUB_API_ERROR');
    // Resolved statuses without throw context keep the plain taxonomy:
    // a resolved 429 is a server error, not a parsed rate signal.
    const resolved = mapGitHubStatus(429, 'Too Many Requests', CTX);
    expect(resolved.code).toBe('GITHUB_API_ERROR');
    if (resolved.code !== 'GITHUB_API_ERROR') return;
    expect(resolved.status).toBe(429);
  });

  it('403 forbidden', () => {
    const mapped = mapGitHubError(thrown(403, 'Forbidden', { 'x-ratelimit-remaining': '5' }), CTX);
    expect(mapped.code).toBe('FORBIDDEN');
    if (mapped.code !== 'FORBIDDEN') return;
    expect(mapped.provider).toBe('github');
    expect(mapped.message).toContain('403');
    expect(mapped.message).toContain(GITHUB_LOGIN_HINT);
    expect(mapped.hint).toBe(GITHUB_LOGIN_HINT);
    const resolved = mapGitHubStatus(403, 'Forbidden', CTX);
    expect(resolved.code).toBe('FORBIDDEN');
    if (resolved.code !== 'FORBIDDEN') return;
    expect(resolved.hint).toBe(GITHUB_LOGIN_HINT);
  });

  it('409 conflict hint', () => {
    const mapped = mapGitHubError(thrown(409, 'Conflict'), CTX);
    expect(mapped.code).toBe('GITHUB_API_ERROR');
    if (mapped.code !== 'GITHUB_API_ERROR') return;
    expect(mapped.status).toBe(409);
    expect(mapped.message).toContain(GITHUB_CONFLICT_HINT);
    expect(mapped.hint).toBe(GITHUB_CONFLICT_HINT);
    const resolved = mapGitHubStatus(409, 'Conflict', CTX);
    expect(resolved.code).toBe('GITHUB_API_ERROR');
    if (resolved.code !== 'GITHUB_API_ERROR') return;
    expect(resolved.message).toContain(GITHUB_CONFLICT_HINT);
  });
});
