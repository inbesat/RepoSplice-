// GitHub repo license detection (P-098): declared license via the API,
// normalized to canonical SPDX with registry metadata — over injected
// fakes (no network) plus nock proofs that the real Octokit satisfies
// the seam (method name AND wire shape).

import { describe, it, expect, afterEach } from 'vitest';
import nock from 'nock';
import { cleanupHttpMocks } from '../../../test-utils/http.js';
import { createValidatedClient } from '../auth.js';
import { createRefCache } from '../../git/perf.js';
import { detectRepoLicense, type LicenseClient, type DetectedLicense } from '../license.js';

afterEach(() => {
  cleanupHttpMocks();
});

const SHA_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const SHA_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

function reqError(status: number, message: string): Error {
  const error = new Error(message) as Error & { status: number };
  error.status = status;
  return error;
}

function licenseEntry(spdxId: string): Record<string, unknown> {
  return {
    key: spdxId.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    name: `${spdxId} License`,
    spdx_id: spdxId,
    url: 'https://api.github.com/licenses/x',
    node_id: 'MDc6TGljZW5zZXg=',
  };
}

function licensePayload(spdxId: string | null): unknown {
  return {
    data: { license: spdxId === null ? null : licenseEntry(spdxId) },
    headers: {},
    status: 200,
  };
}

interface Call {
  kind: 'license';
  args: Record<string, unknown>;
}

/** Fake client serving scripted payloads while recording calls. */
function fakeClient(handler: (call: Call) => unknown): LicenseClient {
  return {
    rest: {
      licenses: {
        getForRepo: async (args: { owner: string; repo: string; ref?: string }) => {
          const out = handler({ kind: 'license', args: { ...args } });
          if (out instanceof Error) throw out;
          return out as { data: unknown; headers: unknown; status: number };
        },
      },
    },
  };
}

// ─── spec-required ─────────────────────────────────────────────────────

describe('detects', () => {
  it('known', async () => {
    const client = fakeClient(() => licensePayload('MIT'));
    const result = await detectRepoLicense(client, 'o', 'r');
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    // Registry metadata is canonical (not the api.github.com URL).
    expect(result.value).toEqual({
      spdxId: 'MIT',
      name: 'MIT License',
      url: 'https://opensource.org/license/mit/',
    });
  });

  it('unknown', async () => {
    // No license section at all.
    const missing = fakeClient(() => licensePayload(null));
    const missingResult = await detectRepoLicense(missing, 'o', 'r');
    expect(missingResult.isOk()).toBe(true);
    if (missingResult.isErr()) return;
    expect(missingResult.value).toEqual({});

    // GitHub's sentinel for "nothing detectable".
    const noassert = fakeClient(() => licensePayload('NOASSERTION'));
    const noassertResult = await detectRepoLicense(noassert, 'o', 'r');
    expect(noassertResult.isOk()).toBe(true);
    if (noassertResult.isErr()) return;
    expect(noassertResult.value).toEqual({});

    // Garbage that normalizes to UNKNOWN.
    const garbage = fakeClient(() => licensePayload('not-a-real-license-xyz'));
    const garbageResult = await detectRepoLicense(garbage, 'o', 'r');
    expect(garbageResult.isOk()).toBe(true);
    if (garbageResult.isErr()) return;
    expect(garbageResult.value).toEqual({});

    // Present license section with no usable id.
    const blank = fakeClient(() => ({
      data: { license: { key: 'other', name: 'Other', spdx_id: null } },
      headers: {},
      status: 200,
    }));
    const blankResult = await detectRepoLicense(blank, 'o', 'r');
    expect(blankResult.isOk()).toBe(true);
    if (blankResult.isErr()) return;
    expect(blankResult.value).toEqual({});
  });

  it('normalizes', async () => {
    const client = fakeClient(() => licensePayload('Apache 2.0'));
    const result = await detectRepoLicense(client, 'o', 'r');
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    // Fuzzy alias corrected, metadata from the canonical registry.
    expect(result.value).toEqual({
      spdxId: 'Apache-2.0',
      name: 'Apache License 2.0',
      url: 'https://www.apache.org/licenses/LICENSE-2.0',
    });
  });

  it('caches', async () => {
    let calls = 0;
    const client = fakeClient(() => {
      calls += 1;
      return licensePayload('MIT');
    });
    const cache = createRefCache<DetectedLicense>();

    const first = await detectRepoLicense(client, 'o', 'r', { sha: SHA_A, cache });
    expect(first.isOk()).toBe(true);
    expect(calls).toBe(1);

    // Same sha: served from cache, no second API hit.
    const second = await detectRepoLicense(client, 'o', 'r', { sha: SHA_A, cache });
    expect(second.isOk()).toBe(true);
    if (second.isErr()) return;
    expect(second.value).toEqual({
      spdxId: 'MIT',
      name: 'MIT License',
      url: 'https://opensource.org/license/mit/',
    });
    expect(calls).toBe(1);

    // Moved sha: refetch and overwrite.
    const third = await detectRepoLicense(client, 'o', 'r', { sha: SHA_B, cache });
    expect(third.isOk()).toBe(true);
    expect(calls).toBe(2);

    // No sha: uncached call, nothing stored.
    const apiOnly = fakeClient(() => licensePayload('MIT'));
    const uncached = await detectRepoLicense(apiOnly, 'o', 'r', { cache });
    expect(uncached.isOk()).toBe(true);
    expect(cache.size).toBe(2);
  });
});

// ─── ref passthrough ───────────────────────────────────────────────────

describe('ref', () => {
  it('passes ref through to the API', async () => {
    const seen: Record<string, unknown>[] = [];
    const client = fakeClient(call => {
      seen.push(call.args);
      return licensePayload('MIT');
    });
    const result = await detectRepoLicense(client, 'o', 'r', { ref: 'main' });
    expect(result.isOk()).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ owner: 'o', repo: 'r', ref: 'main' });
  });

  it('omits ref when absent', async () => {
    const seen: Record<string, unknown>[] = [];
    const client = fakeClient(call => {
      seen.push(call.args);
      return licensePayload('MIT');
    });
    const result = await detectRepoLicense(client, 'o', 'r');
    expect(result.isOk()).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0]).not.toHaveProperty('ref');
  });
});

// ─── boundary ──────────────────────────────────────────────────────────

describe('boundary', () => {
  it('validates shapes at the boundary', async () => {
    const client = fakeClient(() => licensePayload('MIT'));
    const cases: Array<[Promise<unknown>, string]> = [
      [detectRepoLicense(client, '  ', 'r'), 'owner'],
      [detectRepoLicense(client, 'o', '  '), 'repo'],
      [detectRepoLicense(client, 'o', 'r', { ref: '  ' }), 'ref'],
      [detectRepoLicense(client, 'o', 'r', { ref: 42 as unknown as string }), 'ref'],
      [detectRepoLicense(client, 'o', 'r', { sha: 'main' }), 'sha'],
      [detectRepoLicense(client, 'o', 'r', { sha: 42 as unknown as string }), 'sha'],
      [
        detectRepoLicense(client, 'o', 'r', {
          cache: null as unknown as ReturnType<typeof createRefCache<DetectedLicense>>,
        }),
        'cache',
      ],
      [detectRepoLicense(null as unknown as LicenseClient, 'o', 'r'), 'client'],
      [detectRepoLicense(undefined as unknown as LicenseClient, 'o', 'r'), 'client'],
    ];
    for (const [pending, field] of cases) {
      const result = await pending;
      expect(result).toBeDefined();
      if (!(typeof result === 'object' && result !== null && 'isErr' in result)) {
        throw new Error('expected a Result');
      }
      const typed = result as { isErr(): boolean; error?: { code?: string; field?: string } };
      expect(typed.isErr()).toBe(true);
      expect(typed.error?.code).toBe('CONFIG_ERROR');
      expect(typed.error?.field).toBe(field);
    }
  });
});

// ─── errors ────────────────────────────────────────────────────────────

describe('errors', () => {
  it('maps API failures to typed errors', async () => {
    const notFound = fakeClient(() => ({ data: null, headers: {}, status: 404 }));
    const missing = await detectRepoLicense(notFound, 'o', 'ghost');
    expect(missing.isErr()).toBe(true);
    if (missing.isOk()) return;
    expect(missing.error.code).toBe('GITHUB_API_ERROR');
    if (missing.error.code !== 'GITHUB_API_ERROR') return;
    expect(missing.error.status).toBe(404);

    const denied = fakeClient(() => {
      throw reqError(401, 'Bad credentials');
    });
    const deniedResult = await detectRepoLicense(denied, 'o', 'r');
    expect(deniedResult.isErr()).toBe(true);
    if (deniedResult.isOk()) return;
    expect(deniedResult.error.code).toBe('AUTH_ERROR');
    if (deniedResult.error.code !== 'AUTH_ERROR') return;
    expect(deniedResult.error.message).toContain('stitch login');

    const limited = fakeClient(() => {
      const error = reqError(403, 'API rate limit exceeded');
      (error as Error & { headers?: unknown }).headers = { 'x-ratelimit-remaining': '0' };
      throw error;
    });
    const limitedResult = await detectRepoLicense(limited, 'o', 'r');
    expect(limitedResult.isErr()).toBe(true);
    if (limitedResult.isOk()) return;
    expect(limitedResult.error.code).toBe('GITHUB_API_ERROR');
    if (limitedResult.error.code !== 'GITHUB_API_ERROR') return;
    expect(limitedResult.error.message).toContain('rate limited');

    const broken = fakeClient(() => {
      throw new Error('socket hang up');
    });
    const brokenResult = await detectRepoLicense(broken, 'o', 'r');
    expect(brokenResult.isErr()).toBe(true);
    if (brokenResult.isOk()) return;
    expect(brokenResult.error.code).toBe('GITHUB_API_ERROR');

    const thrownString: LicenseClient = {
      rest: {
        licenses: {
          getForRepo: () => Promise.reject('boom'),
        },
      },
    };
    const thrownResult = await detectRepoLicense(thrownString, 'o', 'r');
    expect(thrownResult.isErr()).toBe(true);
    if (thrownResult.isOk()) return;
    expect(thrownResult.error.code).toBe('GITHUB_API_ERROR');
    if (thrownResult.error.code !== 'GITHUB_API_ERROR') return;
    expect(thrownResult.error.status).toBe(0);
  });

  it('refuses malformed payloads instead of inventing licenses', async () => {
    const payloads: unknown[] = [
      { data: null, headers: {}, status: 200 },
      { data: { license: 'MIT' }, headers: {}, status: 200 },
      { data: { license: { spdx_id: 42 } }, headers: {}, status: 200 },
    ];
    for (const payload of payloads) {
      const client = fakeClient(() => payload);
      const result = await detectRepoLicense(client, 'o', 'r');
      expect(result.isErr()).toBe(true);
      if (result.isOk()) continue;
      expect(result.error.code).toBe('INTERNAL');
    }
  });
});

// ─── rate limit guidance ───────────────────────────────────────────────

describe('rate limit guidance', () => {
  async function limitedMessage(headers: unknown): Promise<string | null> {
    const client = fakeClient(() => {
      const error = reqError(429, 'Too Many Requests');
      (error as Error & { headers?: unknown }).headers = headers;
      throw error;
    });
    const result = await detectRepoLicense(client, 'o', 'r');
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return null;
    expect(result.error.code).toBe('GITHUB_API_ERROR');
    if (result.error.code !== 'GITHUB_API_ERROR') return null;
    return result.error.message;
  }

  it('reports retry-after seconds when the server names them', async () => {
    const message = await limitedMessage({ 'retry-after': '45' });
    expect(message).toContain('retry after 45s');
  });

  it('falls back to the reset epoch when retry-after is absent', async () => {
    const reset = String(Math.floor(Date.now() / 1000) + 100);
    const message = await limitedMessage({ 'x-ratelimit-reset': reset });
    expect(message).toContain('retry after');
    expect(message).not.toContain('retry delay unknown');
  });

  it('ignores unparsable retry headers instead of failing', async () => {
    const garbage = await limitedMessage({ 'retry-after': 'soon' });
    expect(garbage).toContain('retry delay unknown');
    const badReset = await limitedMessage({ 'x-ratelimit-reset': 'not-a-number' });
    expect(badReset).toContain('retry delay unknown');
    const nonObject = await limitedMessage(42);
    expect(nonObject).toContain('retry delay unknown');
  });

  it('reads Headers instances through the getter', async () => {
    const message = await limitedMessage({
      get: (name: string) => (name === 'retry-after' ? '30' : null),
    });
    expect(message).toContain('retry after 30s');
  });

  it('treats non-string getter results as absent', async () => {
    const message = await limitedMessage({ get: () => 42 });
    expect(message).toContain('retry delay unknown');
  });

  it('matches rate limits by message when headers are silent', async () => {
    const client = fakeClient(() => {
      throw reqError(403, 'API rate limit exceeded for installation');
    });
    const result = await detectRepoLicense(client, 'o', 'r');
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GITHUB_API_ERROR');
    if (result.error.code !== 'GITHUB_API_ERROR') return;
    expect(result.error.message).toContain('rate limited');
  });

  it('reads headers nested under response like real RequestErrors', async () => {
    const client = fakeClient(() => {
      const error = reqError(429, 'Too Many Requests') as Error & {
        response?: { headers?: unknown };
      };
      error.response = { headers: { 'retry-after': '12' } };
      throw error;
    });
    const result = await detectRepoLicense(client, 'o', 'r');
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GITHUB_API_ERROR');
    if (result.error.code !== 'GITHUB_API_ERROR') return;
    expect(result.error.message).toContain('retry after 12s');
  });
});

// ─── nock end to end ───────────────────────────────────────────────────

describe('nock end to end', () => {
  it('detects licenses through real Octokit', async () => {
    const scope = nock('https://api.github.com')
      .get('/repos/o/r/license')
      .reply(200, {
        license: {
          key: 'mit',
          name: 'MIT License',
          spdx_id: 'MIT',
          url: 'https://api.github.com/licenses/mit',
          node_id: 'MDc6TGljZW5zZW1pdA==',
        },
      });
    const built = createValidatedClient({ auth: { authType: 'pat', token: 'ghp_test' } });
    if (built.isErr()) throw new Error('client construction failed');
    const result = await detectRepoLicense(built.value, 'o', 'r');
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value).toEqual({
      spdxId: 'MIT',
      name: 'MIT License',
      url: 'https://opensource.org/license/mit/',
    });
    expect(scope.isDone()).toBe(true);
  });

  it('maps wire 404s through real Octokit', async () => {
    const scope = nock('https://api.github.com')
      .get('/repos/o/ghost/license')
      .reply(404, { message: 'Not Found' });
    const built = createValidatedClient({ auth: { authType: 'pat', token: 'ghp_test' } });
    if (built.isErr()) throw new Error('client construction failed');
    const result = await detectRepoLicense(built.value, 'o', 'ghost');
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GITHUB_API_ERROR');
    if (result.error.code !== 'GITHUB_API_ERROR') return;
    expect(result.error.status).toBe(404);
    expect(scope.isDone()).toBe(true);
  });
});
