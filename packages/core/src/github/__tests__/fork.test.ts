// GitHub fork support (P-099): provision a fork when the upstream is
// not writable, then route push/PR through it — over injected fakes
// (no network) plus nock proofs that the real Octokit satisfies the
// seam (method names AND wire shapes).

import { describe, it, expect, afterEach } from 'vitest';
import nock from 'nock';
import { cleanupHttpMocks } from '../../../test-utils/http.js';
import { mockOctokit, reqError, okResponse, SHA_A, SHA_B } from '../../../test-utils/githubMock.js';
import { createValidatedClient } from '../auth.js';
import { createRefCache } from '../../git/perf.js';
import { ensureFork, forkPrHead, type ForkClient, type ForkInfo } from '../fork.js';

afterEach(() => {
  cleanupHttpMocks();
});

/** repos.get payload with explicit push permission. */
function repoPayload(push: boolean, defaultBranch: string | null = 'main'): unknown {
  return okResponse({
    name: 'r',
    full_name: 'o/r',
    default_branch: defaultBranch,
    permissions: { admin: false, maintain: false, push, triage: false, pull: true },
  });
}

function forkPayload(owner: string, repo: string): unknown {
  return {
    data: { name: repo, full_name: `${owner}/${repo}`, owner: { login: owner } },
    headers: {},
    status: 202,
  };
}

interface Call {
  kind: 'get' | 'createFork';
  args: Record<string, unknown>;
}

/** Suite-local kind view over the shared mock's Octokit method names. */
const KIND_BY_METHOD: Record<string, Call['kind']> = {
  get: 'get',
  createFork: 'createFork',
};

/** Fake client serving scripted payloads while recording calls. */
function fakeClient(handler: (call: Call) => unknown): ForkClient {
  return mockOctokit(call =>
    handler({ kind: KIND_BY_METHOD[call.method] as Call['kind'], args: call.args })
  );
}

// ─── spec-required ─────────────────────────────────────────────────────

describe('ensures', () => {
  it('creates waits', async () => {
    const calls: Call[] = [];
    let forkReads = 0;
    const client = fakeClient(call => {
      calls.push(call);
      if (call.kind === 'get' && call.args.owner === 'o') return repoPayload(false);
      if (call.kind === 'createFork') return forkPayload('me', 'r');
      forkReads += 1;
      if (forkReads === 1) return { data: { message: 'Not Found' }, headers: {}, status: 404 };
      return okResponse({ name: 'r', full_name: 'me/r', owner: { login: 'me' } });
    });
    const result = await ensureFork(client, 'o', 'r', { pollIntervalMs: 0 });
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value).toEqual({
      owner: 'me',
      repo: 'r',
      fullName: 'me/r',
      forked: true,
      created: true,
      upstream: { owner: 'o', repo: 'r', defaultBranch: 'main' },
    });
    expect(calls.map(call => call.kind)).toEqual(['get', 'createFork', 'get', 'get']);
    expect(forkReads).toBe(2);
  });

  it('reuses', async () => {
    let calls = 0;
    const client = fakeClient(() => {
      calls += 1;
      return repoPayload(false);
    });
    const cached: ForkInfo = {
      owner: 'me',
      repo: 'r',
      fullName: 'me/r',
      forked: true,
      created: true,
      upstream: { owner: 'o', repo: 'r', defaultBranch: 'main' },
    };
    const cache = createRefCache<ForkInfo>();
    cache.set('o/r@' + SHA_A + '/fork', SHA_A, cached);
    const result = await ensureFork(client, 'o', 'r', { upstreamSha: SHA_A, cache });
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value).toEqual(cached);
    expect(calls).toBe(0);
  });

  it('pr from fork', async () => {
    // Cross-fork head format (P-094 consumes `owner:branch` as head).
    const head = forkPrHead('me', 'feature');
    expect(head.isOk()).toBe(true);
    if (head.isErr()) return;
    expect(head.value).toBe('me:feature');

    // The fork result carries the upstream base side for the same PR.
    const client = fakeClient(call => {
      if (call.kind === 'get' && call.args.owner === 'o') return repoPayload(false);
      if (call.kind === 'createFork') return forkPayload('me', 'r');
      return okResponse({ name: 'r', full_name: 'me/r', owner: { login: 'me' } });
    });
    const ensured = await ensureFork(client, 'o', 'r', { pollIntervalMs: 0 });
    expect(ensured.isOk()).toBe(true);
    if (ensured.isErr()) return;
    expect(ensured.value.upstream).toEqual({ owner: 'o', repo: 'r', defaultBranch: 'main' });
    const routed = forkPrHead(ensured.value.owner, 'feature');
    expect(routed.isOk()).toBe(true);
    if (routed.isErr()) return;
    expect(routed.value).toBe('me:feature');
  });

  it('rbac deny', async () => {
    // Explicit refusal after the writability check (P-093 allowForce
    // precedent: necessity is evaluated first, the permit gates the
    // action) — the fork itself is never attempted.
    const refusedCalls: Call[] = [];
    const refused = fakeClient(call => {
      refusedCalls.push(call);
      return repoPayload(false);
    });
    const denied = await ensureFork(refused, 'o', 'r', { allowFork: false });
    expect(denied.isErr()).toBe(true);
    if (denied.isOk()) return;
    expect(denied.error.code).toBe('CONFIG_ERROR');
    if (denied.error.code !== 'CONFIG_ERROR') return;
    expect(denied.error.field).toBe('allowFork');
    expect(denied.error.message).toContain('allowFork');
    expect(refusedCalls.map(call => call.kind)).toEqual(['get']);

    // Server gate: 403 on createFork maps to AUTH_ERROR with the hint.
    const gated = fakeClient(call => {
      if (call.kind === 'get') return repoPayload(false);
      throw reqError(403, 'Forbidden');
    });
    const gatedResult = await ensureFork(gated, 'o', 'r', { pollIntervalMs: 0 });
    expect(gatedResult.isErr()).toBe(true);
    if (gatedResult.isOk()) return;
    expect(gatedResult.error.code).toBe('AUTH_ERROR');
    if (gatedResult.error.code !== 'AUTH_ERROR') return;
    expect(gatedResult.error.message).toContain('stitch login');
  });
});

// ─── short-circuit ─────────────────────────────────────────────────────

describe('short circuits', () => {
  it('pushes upstream directly when writable', async () => {
    const calls: Call[] = [];
    const client = fakeClient(call => {
      calls.push(call);
      return repoPayload(true);
    });
    const result = await ensureFork(client, 'o', 'r');
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value).toEqual({
      owner: 'o',
      repo: 'r',
      fullName: 'o/r',
      forked: false,
      created: false,
    });
    expect(calls.map(call => call.kind)).toEqual(['get']);
  });

  it('forks when permissions are absent (fail closed)', async () => {
    const calls: Call[] = [];
    const client = fakeClient(call => {
      calls.push(call);
      if (call.kind === 'get' && call.args.owner === 'o') {
        return okResponse({ name: 'r', full_name: 'o/r', default_branch: 'main' });
      }
      if (call.kind === 'createFork') return forkPayload('me', 'r');
      return okResponse({ name: 'r', full_name: 'me/r', owner: { login: 'me' } });
    });
    const result = await ensureFork(client, 'o', 'r', { pollIntervalMs: 0 });
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.forked).toBe(true);
    expect(result.value.owner).toBe('me');
    expect(calls.map(call => call.kind)).toEqual(['get', 'createFork', 'get']);
  });
});

// ─── boundary ──────────────────────────────────────────────────────────

describe('boundary', () => {
  it('validates shapes at the boundary', async () => {
    const client = fakeClient(() => repoPayload(false));
    const cases: Array<[Promise<unknown>, string]> = [
      [ensureFork(client, '  ', 'r'), 'owner'],
      [ensureFork(client, 'o', '  '), 'repo'],
      [ensureFork(client, 'o', 'r', { upstreamSha: 'main' }), 'upstreamSha'],
      [ensureFork(client, 'o', 'r', { upstreamSha: 42 as unknown as string }), 'upstreamSha'],
      [
        ensureFork(client, 'o', 'r', {
          cache: null as unknown as ReturnType<typeof createRefCache<ForkInfo>>,
        }),
        'cache',
      ],
      [ensureFork(client, 'o', 'r', { allowFork: 'yes' as unknown as boolean }), 'allowFork'],
      [ensureFork(client, 'o', 'r', { pollAttempts: 0 }), 'pollAttempts'],
      [ensureFork(client, 'o', 'r', { pollAttempts: 1.5 }), 'pollAttempts'],
      [ensureFork(client, 'o', 'r', { pollIntervalMs: -1 }), 'pollIntervalMs'],
      [ensureFork(null as unknown as ForkClient, 'o', 'r'), 'client'],
      [ensureFork(undefined as unknown as ForkClient, 'o', 'r'), 'client'],
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

  it('validates forkPrHead shapes', async () => {
    const cases: Array<[string, string]> = [
      ['  ', 'feature'],
      ['me', '  '],
      ['me:other', 'feature'],
      ['me', 'a:b'],
      ['me/x', 'feature'],
    ];
    for (const [owner, branch] of cases) {
      const result = forkPrHead(owner, branch);
      expect(result.isErr()).toBe(true);
      if (result.isOk()) continue;
      expect(result.error.code).toBe('CONFIG_ERROR');
    }
  });
});

// ─── errors ────────────────────────────────────────────────────────────

describe('errors', () => {
  it('maps upstream failures to typed errors', async () => {
    const missing = fakeClient(() => ({ data: null, headers: {}, status: 404 }));
    const missingResult = await ensureFork(missing, 'o', 'ghost');
    expect(missingResult.isErr()).toBe(true);
    if (missingResult.isOk()) return;
    expect(missingResult.error.code).toBe('GITHUB_API_ERROR');
    if (missingResult.error.code !== 'GITHUB_API_ERROR') return;
    expect(missingResult.error.status).toBe(404);

    const broken = fakeClient(() => {
      throw new Error('socket hang up');
    });
    const brokenResult = await ensureFork(broken, 'o', 'r');
    expect(brokenResult.isErr()).toBe(true);
    if (brokenResult.isOk()) return;
    expect(brokenResult.error.code).toBe('GITHUB_API_ERROR');
  });

  it('refuses malformed payloads instead of inventing forks', async () => {
    const payloads: unknown[] = [
      { data: null, headers: {}, status: 200 },
      {
        data: { name: 'r', full_name: 'o/r', default_branch: 'main', permissions: 'all' },
        headers: {},
        status: 200,
      },
    ];
    for (const payload of payloads) {
      const client = fakeClient(() => payload);
      const result = await ensureFork(client, 'o', 'r');
      expect(result.isErr()).toBe(true);
      if (result.isOk()) continue;
      expect(result.error.code).toBe('INTERNAL');
    }
  });

  it('refuses malformed fork payloads', async () => {
    const payloads: unknown[] = [
      {
        data: { name: 'r', full_name: 'me/r', owner: { login: '  ' } },
        headers: {},
        status: 202,
      },
      {
        data: { name: '  ', full_name: 'me/r', owner: { login: 'me' } },
        headers: {},
        status: 202,
      },
      {
        data: { name: 'r', full_name: 'me/r' },
        headers: {},
        status: 202,
      },
    ];
    for (const payload of payloads) {
      const client = fakeClient(call => {
        if (call.kind === 'get') return repoPayload(false);
        return payload;
      });
      const result = await ensureFork(client, 'o', 'r', { pollIntervalMs: 0 });
      expect(result.isErr()).toBe(true);
      if (result.isOk()) continue;
      expect(result.error.code).toBe('INTERNAL');
    }
  });

  it('treats thrown 404s as not-ready during polling', async () => {
    // Real Octokit throws RequestError on non-2xx while fakes resolve
    // statuses — the poll loop accepts both shapes for "not ready yet".
    let reads = 0;
    const client = fakeClient(call => {
      if (call.kind === 'get' && call.args.owner === 'o') return repoPayload(false);
      if (call.kind === 'createFork') return forkPayload('me', 'r');
      reads += 1;
      if (reads === 1) throw reqError(404, 'Not Found');
      return okResponse({ name: 'r', full_name: 'me/r', owner: { login: 'me' } });
    });
    const result = await ensureFork(client, 'o', 'r', { pollIntervalMs: 0 });
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.created).toBe(true);
    expect(reads).toBe(2);
  });
  it('fails fast when the fork never becomes ready', async () => {
    let reads = 0;
    const client = fakeClient(call => {
      if (call.kind === 'get' && call.args.owner === 'o') return repoPayload(false);
      if (call.kind === 'createFork') return forkPayload('me', 'r');
      reads += 1;
      return { data: { message: 'Not Found' }, headers: {}, status: 404 };
    });
    const result = await ensureFork(client, 'o', 'r', { pollAttempts: 3, pollIntervalMs: 0 });
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GITHUB_API_ERROR');
    if (result.error.code !== 'GITHUB_API_ERROR') return;
    expect(result.error.message).toContain('not ready after 3 polls');
    expect(reads).toBe(3);
  });

  it('fails fast on poll errors that are not 404', async () => {
    const thrown = fakeClient(call => {
      if (call.kind === 'get' && call.args.owner === 'o') return repoPayload(false);
      if (call.kind === 'createFork') return forkPayload('me', 'r');
      throw reqError(500, 'Server Error');
    });
    const thrownResult = await ensureFork(thrown, 'o', 'r', { pollIntervalMs: 0 });
    expect(thrownResult.isErr()).toBe(true);
    if (thrownResult.isOk()) return;
    expect(thrownResult.error.code).toBe('GITHUB_API_ERROR');
    if (thrownResult.error.code !== 'GITHUB_API_ERROR') return;
    expect(thrownResult.error.status).toBe(500);

    const resolved = fakeClient(call => {
      if (call.kind === 'get' && call.args.owner === 'o') return repoPayload(false);
      if (call.kind === 'createFork') return forkPayload('me', 'r');
      return { data: { message: 'Forbidden' }, headers: {}, status: 403 };
    });
    const resolvedResult = await ensureFork(resolved, 'o', 'r', { pollIntervalMs: 0 });
    expect(resolvedResult.isErr()).toBe(true);
    if (resolvedResult.isOk()) return;
    expect(resolvedResult.error.code).toBe('AUTH_ERROR');
  });

  it('maps createFork failures without polling', async () => {
    const rejected = fakeClient(call => {
      if (call.kind === 'get') return repoPayload(false);
      return { data: { message: 'Validation Failed' }, headers: {}, status: 422 };
    });
    const rejectedResult = await ensureFork(rejected, 'o', 'r', { pollIntervalMs: 0 });
    expect(rejectedResult.isErr()).toBe(true);
    if (rejectedResult.isOk()) return;
    expect(rejectedResult.error.code).toBe('CONFIG_ERROR');

    const empty = fakeClient(call => {
      if (call.kind === 'get') return repoPayload(false);
      return { data: null, headers: {}, status: 202 };
    });
    const emptyResult = await ensureFork(empty, 'o', 'r', { pollIntervalMs: 0 });
    expect(emptyResult.isErr()).toBe(true);
    if (emptyResult.isOk()) return;
    expect(emptyResult.error.code).toBe('INTERNAL');
  });
});

// ─── flows ─────────────────────────────────────────────────────────────

describe('flows', () => {
  it('omits the upstream branch when the API reports none', async () => {
    const client = fakeClient(call => {
      if (call.kind === 'get' && call.args.owner === 'o') return repoPayload(false, null);
      if (call.kind === 'createFork') return forkPayload('me', 'r');
      return okResponse({ name: 'r', full_name: 'me/r', owner: { login: 'me' } });
    });
    const result = await ensureFork(client, 'o', 'r', { pollIntervalMs: 0 });
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.upstream).toEqual({ owner: 'o', repo: 'r' });
  });

  it('uses default polling when not configured', async () => {
    const client = fakeClient(call => {
      if (call.kind === 'get' && call.args.owner === 'o') return repoPayload(false);
      if (call.kind === 'createFork') return forkPayload('me', 'r');
      return okResponse({ name: 'r', full_name: 'me/r', owner: { login: 'me' } });
    });
    const result = await ensureFork(client, 'o', 'r');
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.created).toBe(true);
  });

  it('caches the direct path and the fork path alike', async () => {
    let calls = 0;
    const writable = fakeClient(() => {
      calls += 1;
      return repoPayload(true);
    });
    const directCache = createRefCache<ForkInfo>();
    const first = await ensureFork(writable, 'o', 'r', { upstreamSha: SHA_A, cache: directCache });
    expect(first.isOk()).toBe(true);
    expect(calls).toBe(1);
    const second = await ensureFork(writable, 'o', 'r', { upstreamSha: SHA_A, cache: directCache });
    expect(second.isOk()).toBe(true);
    expect(calls).toBe(1);

    // Stale entry (another sha stored) refetches instead of serving.
    const forkCache = createRefCache<ForkInfo>();
    forkCache.set(`o/r@${SHA_A}/fork`, SHA_B, {
      owner: 'me',
      repo: 'r',
      fullName: 'me/r',
      forked: true,
      created: true,
    });
    let forkCalls = 0;
    const forking = fakeClient(call => {
      forkCalls += 1;
      if (call.kind === 'get' && call.args.owner === 'o') return repoPayload(false);
      if (call.kind === 'createFork') return forkPayload('me', 'r');
      return okResponse({ name: 'r', full_name: 'me/r', owner: { login: 'me' } });
    });
    const fresh = await ensureFork(forking, 'o', 'r', {
      upstreamSha: SHA_A,
      cache: forkCache,
      pollIntervalMs: 0,
    });
    expect(fresh.isOk()).toBe(true);
    if (fresh.isErr()) return;
    expect(fresh.value.forked).toBe(true);
    expect(forkCalls).toBe(3);
    // The flow stored its own record: the next call is free.
    const replay = await ensureFork(forking, 'o', 'r', { upstreamSha: SHA_A, cache: forkCache });
    expect(replay.isOk()).toBe(true);
    expect(forkCalls).toBe(3);
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
    const result = await ensureFork(client, 'o', 'r');
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
    const nulled = await limitedMessage(null);
    expect(nulled).toContain('retry delay unknown');
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

  it('matches rate limits by header and by message', async () => {
    const headered = fakeClient(() => {
      const error = reqError(403, 'Forbidden');
      (error as Error & { headers?: unknown }).headers = { 'x-ratelimit-remaining': '0' };
      throw error;
    });
    const headeredResult = await ensureFork(headered, 'o', 'r');
    expect(headeredResult.isErr()).toBe(true);
    if (headeredResult.isOk()) return;
    expect(headeredResult.error.code).toBe('GITHUB_API_ERROR');
    if (headeredResult.error.code !== 'GITHUB_API_ERROR') return;
    expect(headeredResult.error.message).toContain('rate limited');

    const messaged = fakeClient(() => {
      throw reqError(403, 'API rate limit exceeded for installation');
    });
    const messagedResult = await ensureFork(messaged, 'o', 'r');
    expect(messagedResult.isErr()).toBe(true);
    if (messagedResult.isOk()) return;
    expect(messagedResult.error.code).toBe('GITHUB_API_ERROR');
    if (messagedResult.error.code !== 'GITHUB_API_ERROR') return;
    expect(messagedResult.error.message).toContain('rate limited');
  });

  it('reads headers nested under response like real RequestErrors', async () => {
    const client = fakeClient(() => {
      const error = reqError(429, 'Too Many Requests') as Error & {
        response?: { headers?: unknown };
      };
      error.response = { headers: { 'retry-after': '12' } };
      throw error;
    });
    const result = await ensureFork(client, 'o', 'r');
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GITHUB_API_ERROR');
    if (result.error.code !== 'GITHUB_API_ERROR') return;
    expect(result.error.message).toContain('retry after 12s');
  });

  it('maps non-Error rejections without throwing', async () => {
    const thrown: ForkClient = {
      rest: {
        repos: {
          get: () => Promise.reject('boom'),
          createFork: () => Promise.reject('boom'),
        },
      },
    };
    const result = await ensureFork(thrown, 'o', 'r');
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GITHUB_API_ERROR');
    if (result.error.code !== 'GITHUB_API_ERROR') return;
    expect(result.error.status).toBe(0);
  });
});

// ─── nock end to end ───────────────────────────────────────────────────

describe('nock end to end', () => {
  it('creates and waits through real Octokit', async () => {
    const scope = nock('https://api.github.com')
      .get('/repos/o/r')
      .reply(200, {
        name: 'r',
        full_name: 'o/r',
        default_branch: 'main',
        permissions: { admin: false, maintain: false, push: false, triage: false, pull: true },
      })
      .post('/repos/o/r/forks')
      .reply(202, { name: 'r', full_name: 'me/r', owner: { login: 'me' } })
      .get('/repos/me/r')
      .reply(404, { message: 'Not Found' })
      .get('/repos/me/r')
      .reply(200, { name: 'r', full_name: 'me/r', owner: { login: 'me' } });
    const built = createValidatedClient({ auth: { authType: 'pat', token: 'ghp_test' } });
    if (built.isErr()) throw new Error('client construction failed');
    const result = await ensureFork(built.value, 'o', 'r', { pollIntervalMs: 0 });
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value).toEqual({
      owner: 'me',
      repo: 'r',
      fullName: 'me/r',
      forked: true,
      created: true,
      upstream: { owner: 'o', repo: 'r', defaultBranch: 'main' },
    });
    expect(scope.isDone()).toBe(true);
  });

  it('short-circuits writable upstreams through real Octokit', async () => {
    const scope = nock('https://api.github.com')
      .get('/repos/o/r')
      .reply(200, {
        name: 'r',
        full_name: 'o/r',
        default_branch: 'main',
        permissions: { admin: false, maintain: false, push: true, triage: false, pull: true },
      });
    const built = createValidatedClient({ auth: { authType: 'pat', token: 'ghp_test' } });
    if (built.isErr()) throw new Error('client construction failed');
    const result = await ensureFork(built.value, 'o', 'r');
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.forked).toBe(false);
    expect(result.value.owner).toBe('o');
    expect(scope.isDone()).toBe(true);
  });
});
