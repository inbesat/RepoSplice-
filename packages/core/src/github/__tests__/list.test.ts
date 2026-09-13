// GitHub list/search (P-089): paginated repo enumeration and search over
// injected fakes (no network) plus nock end-to-end proofs that the real
// Octokit satisfies the narrow seam and paginates by the short-page rule.

import { describe, it, expect, afterEach } from 'vitest';
import nock from 'nock';
import { cleanupHttpMocks } from '../../../test-utils/http.js';
import { mockOctokit, reqError } from '../../../test-utils/githubMock.js';
import { createValidatedClient } from '../auth.js';
import { listRepos, searchRepos, type RepoClient, type RepoSummary } from '../list.js';

afterEach(() => {
  cleanupHttpMocks();
});

function repo(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'repo',
    full_name: 'octocat/repo',
    owner: { login: 'octocat' },
    default_branch: 'main',
    private: false,
    license: { key: 'mit', spdx_id: 'MIT' },
    ...overrides,
  };
}

/** Scripted list+search endpoints over the shared mock (pages/payloads in order). */
function scripted(opts: {
  pages?: unknown[][];
  payloads?: unknown[];
  calls?: Array<Record<string, unknown>>;
  throwList?: Error;
}): RepoClient {
  let n = 0;
  let m = 0;
  return mockOctokit(call => {
    if (call.method === 'listForAuthenticatedUser') {
      opts.calls?.push({ ...call.args });
      if (opts.throwList !== undefined) throw opts.throwList;
      const page = opts.pages?.[n] ?? [];
      n += 1;
      return { data: page, headers: {}, status: 200 };
    }
    opts.calls?.push({ ...call.args });
    const payloads = opts.payloads ?? [];
    const payload = payloads[m] ?? payloads[payloads.length - 1];
    m += 1;
    return { data: payload, headers: {}, status: 200 };
  });
}

function throwingList(status: number, message: string): RepoClient {
  return scripted({ throwList: reqError(status, message) });
}

// ─── listRepos ─────────────────────────────────────────────────────────

describe('paginates', () => {
  it('walks pages until a short page, preserving order', async () => {
    const calls: Array<Record<string, unknown>> = [];
    const c = scripted({
      pages: [
        [repo({ name: 'a' }), repo({ name: 'b' })],
        [repo({ name: 'c' }), repo({ name: 'd' })],
        [repo({ name: 'e' })],
      ],
      calls,
    });
    const result = await listRepos(c, { perPage: 2 });
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.map(r => r.name)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(calls.map(call => call['page'])).toEqual([1, 2, 3]);
    expect(calls[0]).toMatchObject({ per_page: 2 });
  });

  it('stops one page past exact multiples', async () => {
    const calls: Array<Record<string, unknown>> = [];
    const c = scripted({
      pages: [[repo({ name: 'a' }), repo({ name: 'b' })], []],
      calls,
    });
    const result = await listRepos(c, { perPage: 2 });
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value).toHaveLength(2);
    expect(calls).toHaveLength(2);
  });

  it('honors maxPages', async () => {
    const full = [repo({ name: 'a' }), repo({ name: 'b' })];
    const c = scripted({ pages: [full, full, full] });
    const result = await listRepos(c, { perPage: 2, maxPages: 2 });
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value).toHaveLength(4);
  });

  it('passes visibility and sort through', async () => {
    const calls: Array<Record<string, unknown>> = [];
    const c = scripted({ pages: [[]], calls });
    const result = await listRepos(c, { visibility: 'private', sort: 'updated' });
    expect(result.isOk()).toBe(true);
    expect(calls[0]).toMatchObject({ visibility: 'private', sort: 'updated', per_page: 30 });
  });

  it('rejects misuse at the boundary', async () => {
    const c = scripted({ pages: [[]] });
    const bad = [
      listRepos(c, { perPage: 0 }),
      listRepos(c, { perPage: 101 }),
      listRepos(c, { perPage: 1.5 }),
      listRepos(c, { maxPages: 0 }),
      listRepos(c, { visibility: 'everyone' as 'public' }),
      listRepos(c, { sort: 'stars' as 'created' }),
    ];
    for (const pending of bad) {
      const resolved = await pending;
      expect(resolved.isErr()).toBe(true);
      if (resolved.isOk()) continue;
      expect(resolved.error.code).toBe('CONFIG_ERROR');
    }
    const missing = await listRepos(null as unknown as RepoClient, {});
    expect(missing.isErr()).toBe(true);
    if (missing.isOk()) return;
    expect(missing.error.code).toBe('CONFIG_ERROR');
  });
});

// ─── searchRepos ───────────────────────────────────────────────────────

describe('searches', () => {
  function payload(items: unknown[], total = items.length, incomplete = false): unknown {
    return { total_count: total, incomplete_results: incomplete, items };
  }

  it('surfaces total, incompleteness and matches', async () => {
    const c = scripted({
      pages: [[]],
      payloads: [payload([repo({ name: 'hit', private: true })], 27, true)],
    });
    const result = await searchRepos(c, 'stitch language:typescript');
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.total).toBe(27);
    expect(result.value.incomplete).toBe(true);
    expect(result.value.items).toHaveLength(1);
    expect(result.value.items[0]).toMatchObject({
      owner: 'octocat',
      name: 'hit',
      fullName: 'octocat/repo',
      defaultBranch: 'main',
      private: true,
      license: 'MIT',
    });
  });

  it('maps license fallbacks and empty defaults', async () => {
    const c = scripted({
      pages: [[]],
      payloads: [
        payload([
          repo({ name: 'a', license: { key: 'other', spdx_id: null } }),
          repo({ name: 'b', license: null, default_branch: null }),
          repo({ name: 'c', license: {} }),
        ]),
      ],
    });
    const result = await searchRepos(c, 'x');
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    const byName = new Map(result.value.items.map(item => [item.name, item]));
    expect(byName.get('a')?.license).toBe('other');
    expect(byName.get('b')?.license).toBeUndefined();
    expect(byName.get('b')?.defaultBranch).toBeNull();
    expect(byName.get('c')?.license).toBeUndefined();
  });

  it('paginates search across maxPages', async () => {
    const calls: Array<Record<string, unknown>> = [];
    const page = (n: string): unknown => payload([repo({ name: n })], 3);
    const c = scripted({ pages: [[]], payloads: [page('a'), page('b')], calls });
    const result = await searchRepos(c, 'x', { perPage: 1, maxPages: 2 });
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.items.map(item => item.name)).toEqual(['a', 'b']);
    expect(result.value.total).toBe(3);
    expect(calls.map(call => call['page'])).toEqual([1, 2]);
    expect(calls[0]).toMatchObject({ q: 'x', per_page: 1 });
  });

  it('rejects blank queries and bad paging', async () => {
    const c = scripted({ pages: [[]] });
    for (const result of [
      searchRepos(c, '  '),
      searchRepos(c, 'x', { perPage: 0 }),
      searchRepos(c, 'x', { maxPages: -1 }),
    ]) {
      const resolved = await result;
      expect(resolved.isErr()).toBe(true);
      if (resolved.isOk()) continue;
      expect(resolved.error.code).toBe('CONFIG_ERROR');
    }
  });

  it('refuses malformed payloads fail-closed', async () => {
    for (const bad of [
      { total_count: 1, incomplete_results: false, items: 'nope' },
      { total_count: 'many', incomplete_results: false, items: [] },
      payload([repo({ name: 42 })]),
      payload([{ name: 'x' }]),
      payload([repo({ owner: 'x' })]),
      payload([repo({ owner: null })]),
      payload([repo({ owner: { login: '' } })]),
      payload([repo({ default_branch: 42 })]),
      payload([repo({ full_name: 42 })]),
      payload([repo({ private: 'yes' })]),
      payload([repo({ license: 'MIT' })]),
      payload([42]),
      42,
    ]) {
      const single = scripted({ pages: [[]], payloads: [bad] });
      const result = await searchRepos(single, 'x');
      expect(result.isErr()).toBe(true);
      if (result.isOk()) continue;
      expect(result.error.code).toBe('INTERNAL');
    }
    const badItems: unknown[][] = [
      [repo({ owner: {} })],
      [repo({ default_branch: 42 })],
      [repo({ license: 'MIT' })],
      [42],
    ];
    for (const items of badItems) {
      const listed = await listRepos(scripted({ pages: [items] }), { perPage: 10 });
      expect(listed.isErr()).toBe(true);
      if (listed.isOk()) continue;
      expect(listed.error.code).toBe('INTERNAL');
    }
  });

  it('maps resolved failures without throwing', async () => {
    const failed = await listRepos(
      mockOctokit(() => ({ data: [], headers: {}, status: 500 })),
      {}
    );
    expect(failed.isErr()).toBe(true);
    if (failed.isOk()) return;
    expect(failed.error.code).toBe('GITHUB_API_ERROR');
    const shapelessResult = await listRepos(
      mockOctokit(() => ({ data: {}, headers: {}, status: 200 })),
      {}
    );
    expect(shapelessResult.isErr()).toBe(true);
    if (shapelessResult.isOk()) return;
    expect(shapelessResult.error.code).toBe('INTERNAL');
  });

  it('rejects missing clients on both entries', async () => {
    const missing = await searchRepos(undefined as unknown as RepoClient, 'x');
    expect(missing.isErr()).toBe(true);
    if (missing.isOk()) return;
    expect(missing.error.code).toBe('CONFIG_ERROR');
  });

  it('runs bare calls on defaults', async () => {
    const listCalls: Array<Record<string, unknown>> = [];
    const listed = await listRepos(scripted({ pages: [[]], calls: listCalls }));
    expect(listed.isOk()).toBe(true);
    expect(listCalls[0]).toMatchObject({ per_page: 30, page: 1 });
    const searchCalls: Array<Record<string, unknown>> = [];
    const searched = await searchRepos(
      scripted({
        pages: [[]],
        payloads: [{ total_count: 0, incomplete_results: false, items: [] }],
        calls: searchCalls,
      }),
      'x'
    );
    expect(searched.isOk()).toBe(true);
    expect(searchCalls[0]).toMatchObject({ q: 'x', per_page: 30, page: 1 });
  });
});

// ─── rate limits ───────────────────────────────────────────────────────

describe('rate limited', () => {
  function limited(status: number, headers: Record<string, string>): RepoClient {
    return mockOctokit(call => {
      if (call.method !== 'listForAuthenticatedUser') {
        return { data: [], headers: {}, status: 200 };
      }
      const error = new Error(
        status === 429 ? 'API rate limit exceeded' : 'API rate limit exceeded for user'
      ) as Error & { status: number; response?: { headers: Record<string, string> } };
      error.status = status;
      error.response = { headers };
      throw error;
    });
  }

  it('surfaces retry-after from the header contract', async () => {
    const result = await listRepos(
      limited(403, { 'x-ratelimit-remaining': '0', 'retry-after': '120' }),
      {}
    );
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GITHUB_API_ERROR');
    if (result.error.code !== 'GITHUB_API_ERROR') return;
    expect(result.error.message).toContain('retry after 120s');
    expect(result.error.message).not.toContain('stitch login');
  });

  it('falls back to the reset epoch when no retry-after ships', async () => {
    const reset = String(Math.floor(Date.now() / 1000) + 60);
    const result = await listRepos(limited(429, { 'x-ratelimit-reset': reset }), {});
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GITHUB_API_ERROR');
    if (result.error.code !== 'GITHUB_API_ERROR') return;
    expect(result.error.message).toMatch(/retry after \d+s/);
  });

  it('treats message-only rate limits as limited', async () => {
    const bare: RepoClient = mockOctokit(call => {
      if (call.method !== 'listForAuthenticatedUser') {
        return { data: [], headers: {}, status: 200 };
      }
      const error = new Error('API rate limit exceeded for installation') as Error & {
        status: number;
      };
      error.status = 403;
      throw error;
    });
    const result = await listRepos(bare, {});
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GITHUB_API_ERROR');
  });

  it('reads direct header bags and odd retry values', async () => {
    const direct: RepoClient = mockOctokit(call => {
      if (call.method !== 'listForAuthenticatedUser') {
        return { data: [], headers: {}, status: 200 };
      }
      const error = new Error('slow down') as Error & {
        status: number;
        headers: Record<string, string>;
      };
      error.status = 429;
      error.headers = { 'retry-after': '30' };
      throw error;
    });
    const result = await listRepos(direct, {});
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GITHUB_API_ERROR');
    if (result.error.code !== 'GITHUB_API_ERROR') return;
    expect(result.error.message).toContain('retry after 30s');
    for (const headers of [
      { 'retry-after': 'soon' },
      { 'retry-after': '-5' },
      { 'x-ratelimit-reset': 'soon' },
    ]) {
      const odd: RepoClient = mockOctokit(call => {
        if (call.method !== 'listForAuthenticatedUser') {
          return { data: [], headers: {}, status: 200 };
        }
        const error = new Error('slow down') as Error & {
          status: number;
          headers: Record<string, string>;
        };
        error.status = 429;
        error.headers = headers;
        throw error;
      });
      const oddResult = await listRepos(odd, {});
      expect(oddResult.isErr()).toBe(true);
      if (oddResult.isOk()) continue;
      expect(oddResult.error.code).toBe('GITHUB_API_ERROR');
      if (oddResult.error.code !== 'GITHUB_API_ERROR') continue;
      expect(oddResult.error.message).toContain('retry delay unknown');
    }
  });

  it('reads Headers instances on the rate path', async () => {
    const headed: RepoClient = mockOctokit(call => {
      if (call.method !== 'listForAuthenticatedUser') {
        return { data: [], headers: {}, status: 200 };
      }
      const error = new Error('slow down') as Error & {
        status: number;
        headers: Headers;
      };
      error.status = 429;
      error.headers = new Headers({ 'retry-after': '45' });
      throw error;
    });
    const result = await listRepos(headed, {});
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GITHUB_API_ERROR');
    if (result.error.code !== 'GITHUB_API_ERROR') return;
    expect(result.error.message).toContain('retry after 45s');
    const keyless: RepoClient = mockOctokit(call => {
      if (call.method !== 'listForAuthenticatedUser') {
        return { data: [], headers: {}, status: 200 };
      }
      const error = new Error('API rate limit exceeded') as Error & {
        status: number;
        headers: Headers;
      };
      error.status = 403;
      error.headers = new Headers();
      throw error;
    });
    const keylessResult = await listRepos(keyless, {});
    expect(keylessResult.isErr()).toBe(true);
    if (keylessResult.isOk()) return;
    expect(keylessResult.error.code).toBe('GITHUB_API_ERROR');
    if (keylessResult.error.code !== 'GITHUB_API_ERROR') return;
    // get() returns null for the missing key: delay genuinely unknown.
    expect(keylessResult.error.message).toContain('retry delay unknown');
  });

  it('keeps non-rate 403s on the auth path', async () => {
    const forbidden: RepoClient = mockOctokit(call => {
      if (call.method !== 'listForAuthenticatedUser') {
        return { data: [], headers: {}, status: 200 };
      }
      const error = new Error('Forbidden') as Error & {
        status: number;
        response?: { headers: Record<string, string> };
      };
      error.status = 403;
      error.response = { headers: { 'x-ratelimit-remaining': '5' } };
      throw error;
    });
    const result = await listRepos(forbidden, {});
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('AUTH_ERROR');
    if (result.error.code !== 'AUTH_ERROR') return;
    expect(result.error.message).toContain('stitch login');
  });
});

// ─── error maps ────────────────────────────────────────────────────────

describe('error maps', () => {
  it('maps auth failures with the login hint', async () => {
    for (const status of [401, 403]) {
      const c = throwingList(status, `call failed ${status}`);
      const result = await listRepos(c, {});
      expect(result.isErr()).toBe(true);
      if (result.isOk()) continue;
      expect(result.error.code).toBe('AUTH_ERROR');
      if (result.error.code !== 'AUTH_ERROR') continue;
      expect(result.error.message).toContain('stitch login');
    }
  });

  it('maps transport failures without auth flavor', async () => {
    const cases: Array<{ status: number; code: 'GITHUB_API_ERROR' }> = [
      { status: 404, code: 'GITHUB_API_ERROR' },
      { status: 500, code: 'GITHUB_API_ERROR' },
    ];
    for (const { status } of cases) {
      const c = throwingList(status, `call failed ${status}`);
      const result = await listRepos(c, {});
      expect(result.isErr()).toBe(true);
      if (result.isOk()) continue;
      expect(result.error.code).toBe('GITHUB_API_ERROR');
      if (result.error.code !== 'GITHUB_API_ERROR') continue;
      expect(result.error.message).not.toContain('stitch login');
    }
    const hung: RepoClient = mockOctokit(() => {
      throw new Error('socket hang up');
    });
    const hungResult = await listRepos(hung, {});
    expect(hungResult.isErr()).toBe(true);
    if (hungResult.isOk()) return;
    expect(hungResult.error.code).toBe('GITHUB_API_ERROR');
  });

  it('attributes the failing search page', async () => {
    const flaky: RepoClient = mockOctokit(call => {
      if (call.namespace === 'search') {
        const params = call.args;
        if (params['page'] === 2) {
          const error = new Error('boom') as Error & { status: number };
          error.status = 500;
          throw error;
        }
        return {
          data: { total_count: 2, incomplete_results: false, items: [repo({ name: 'a' })] },
          headers: {},
          status: 200,
        };
      }
      return { data: [], headers: {}, status: 200 };
    });
    const result = await searchRepos(flaky, 'x', { perPage: 1 });
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GITHUB_API_ERROR');
    if (result.error.code !== 'GITHUB_API_ERROR') return;
    expect(result.error.message).toContain('page 2');
    const resolved: RepoClient = mockOctokit(call => {
      if (call.namespace === 'search') {
        return { data: [], headers: {}, status: 502 };
      }
      return { data: [], headers: {}, status: 200 };
    });
    const resolvedResult = await searchRepos(resolved, 'x');
    expect(resolvedResult.isErr()).toBe(true);
    if (resolvedResult.isOk()) return;
    expect(resolvedResult.error.code).toBe('GITHUB_API_ERROR');
  });

  it('attributes the failing page', async () => {
    const calls: Array<Record<string, unknown>> = [];
    const flaky: RepoClient = mockOctokit(call => {
      if (call.method !== 'listForAuthenticatedUser') {
        return { data: [], headers: {}, status: 200 };
      }
      calls.push({ ...call.args });
      if (calls.length === 2) {
        const error = new Error('boom') as Error & { status: number };
        error.status = 500;
        throw error;
      }
      return { data: [repo({ name: 'a' }), repo({ name: 'b' })], headers: {}, status: 200 };
    });
    const result = await listRepos(flaky, { perPage: 2 });
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GITHUB_API_ERROR');
    if (result.error.code !== 'GITHUB_API_ERROR') return;
    expect(result.error.message).toContain('page 2');
  });

  it('rejects non-Error throws as typed failures', async () => {
    const c: RepoClient = mockOctokit(() => Promise.reject());
    const result = await listRepos(c, {});
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GITHUB_API_ERROR');
  });
});

// ─── nock end to end ───────────────────────────────────────────────────

describe('nock end to end', () => {
  it('paginates real Octokit list calls by the short-page rule', async () => {
    const page1 = [repo({ name: 'a' }), repo({ name: 'b' })];
    const page2 = [repo({ name: 'c' })];
    const scope = nock('https://api.github.com')
      .get('/user/repos')
      .query({ per_page: '2', page: '1' })
      .reply(200, page1)
      .get('/user/repos')
      .query({ per_page: '2', page: '2' })
      .reply(200, page2);
    const built = createValidatedClient({ auth: { authType: 'pat', token: 'ghp_test' } });
    if (built.isErr()) throw new Error('client construction failed');
    const result = await listRepos(built.value, { perPage: 2 });
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.map((item: RepoSummary) => item.name)).toEqual(['a', 'b', 'c']);
    expect(scope.isDone()).toBe(true);
  });

  it('searches through real Octokit with totals', async () => {
    const scope = nock('https://api.github.com')
      .get('/search/repositories')
      .query({ q: 'stitch', per_page: '30', page: '1' })
      .reply(200, { total_count: 1, incomplete_results: false, items: [repo({ name: 'hit' })] });
    const built = createValidatedClient({ auth: { authType: 'pat', token: 'ghp_test' } });
    if (built.isErr()) throw new Error('client construction failed');
    const result = await searchRepos(built.value, 'stitch');
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.total).toBe(1);
    expect(result.value.items.map(item => item.name)).toEqual(['hit']);
    expect(scope.isDone()).toBe(true);
  });
});
