// GitHub open-PR (P-094): the visible, reviewable deliverable of a
// merge — deterministic bodies from report/provenance/CREDITS sections,
// sandbox statuses posted ahead of creation, and idempotent skips when
// the head already has an open PR. Fakes below (no network) plus nock
// proofs that the real Octokit satisfies the seam.

import { describe, it, expect, afterEach } from 'vitest';
import nock from 'nock';
import { cleanupHttpMocks } from '../../../test-utils/http.js';
import { createValidatedClient } from '../auth.js';
import { openPR, buildPrBody, type PrClient, type OpenedPr } from '../pr.js';

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

interface Call {
  kind: 'create' | 'list' | 'status';
  args: Record<string, unknown>;
}

/** Fake client serving scripted payloads while recording calls. */
function fakeClient(handler: (call: Call) => unknown): PrClient {
  const wrap = (kind: Call['kind']) => async (args?: Record<string, unknown>) => {
    const out = handler({ kind, args: args ?? {} });
    if (out instanceof Error) throw out;
    return out as { data: unknown; headers: unknown; status: number };
  };
  return {
    rest: {
      repos: {
        getCommit: async () => ({ data: {}, headers: {}, status: 200 }),
        updateBranchProtection: async () => ({ data: {}, headers: {}, status: 200 }),
        createCommitStatus: wrap('status'),
      },
      git: {
        createRef: async () => ({ data: {}, headers: {}, status: 201 }),
        deleteRef: async () => ({ data: {}, headers: {}, status: 200 }),
      },
      pulls: {
        create: wrap('create'),
        list: wrap('list'),
      },
    },
  };
}

function prOk(overrides: Record<string, unknown> = {}): unknown {
  return {
    data: {
      number: 7,
      html_url: 'https://github.com/o/r/pull/7',
      head: { ref: 'feature', sha: SHA_A },
      state: 'open',
      ...overrides,
    },
    headers: {},
    status: 201,
  };
}

// ─── opens ─────────────────────────────────────────────────────────────

describe('opens', () => {
  it('creates PRs with exact argv and typed results', async () => {
    const calls: Call[] = [];
    const client = fakeClient(call => {
      calls.push(call);
      if (call.kind === 'list') return { data: [], headers: {}, status: 200 };
      if (call.kind === 'status') return { data: {}, headers: {}, status: 201 };
      return prOk();
    });
    const result = await openPR(client, 'o', 'r', {
      base: 'main',
      head: 'feature',
      title: 'Merge feature',
      body: 'custom body',
      draft: true,
    });
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    const opened: OpenedPr = result.value;
    expect(opened).toEqual({
      number: 7,
      url: 'https://github.com/o/r/pull/7',
      headSha: SHA_A,
      skipped: false,
    });
    expect(calls.map(call => call.kind)).toEqual(['list', 'create']);
    expect(calls[1]?.args).toEqual({
      owner: 'o',
      repo: 'r',
      title: 'Merge feature',
      head: 'feature',
      base: 'main',
      body: 'custom body',
      draft: true,
    });
  });

  it('defaults draft false and empty bodies', async () => {
    const calls: Call[] = [];
    const client = fakeClient(call => {
      calls.push(call);
      if (call.kind === 'list') return { data: [], headers: {}, status: 200 };
      return prOk();
    });
    const result = await openPR(client, 'o', 'r', {
      base: 'main',
      head: 'feature',
      title: 'T',
    });
    expect(result.isOk()).toBe(true);
    expect(calls[1]?.args).toMatchObject({ draft: false, body: '' });
  });

  it('qualifies bare heads with the owner for the filter', async () => {
    const calls: Call[] = [];
    const client = fakeClient(call => {
      calls.push(call);
      if (call.kind === 'list') return { data: [], headers: {}, status: 200 };
      return prOk();
    });
    const result = await openPR(client, 'o', 'r', { base: 'main', head: 'feature', title: 'T' });
    expect(result.isOk()).toBe(true);
    expect(calls[0]?.args).toMatchObject({ head: 'o:feature', state: 'open' });
    const prefixed = await openPR(client, 'o', 'r', {
      base: 'main',
      head: 'o:feature',
      title: 'T',
    });
    expect(prefixed.isOk()).toBe(true);
    expect(calls[2]?.args).toMatchObject({ head: 'o:feature' });
  });

  it('validates shapes at the boundary', async () => {
    const client = fakeClient(() => prOk());
    for (const pending of [
      openPR(client, '  ', 'r', { base: 'main', head: 'f', title: 'T' }),
      openPR(client, 'o', '  ', { base: 'main', head: 'f', title: 'T' }),
      openPR(client, 'o', 'r', { base: '  ', head: 'f', title: 'T' }),
      openPR(client, 'o', 'r', { base: 'my base', head: 'f', title: 'T' }),
      openPR(client, 'o', 'r', { base: 'main', head: '  ', title: 'T' }),
      openPR(client, 'o', 'r', { base: 'main', head: 'bad ref', title: 'T' }),
      openPR(client, 'o', 'r', { base: 'main', head: 'f', title: '  ' }),
      openPR(client, 'o', 'r', {
        base: 'main',
        head: 'f',
        title: 'T',
        draft: 'yes' as unknown as boolean,
      }),
      openPR(client, 'o', 'r', null as unknown as Parameters<typeof openPR>[3]),
      openPR(client, 'o', 'r', 'x' as unknown as Parameters<typeof openPR>[3]),
      openPR(null as unknown as PrClient, 'o', 'r', { base: 'main', head: 'f', title: 'T' }),
      openPR(undefined as unknown as PrClient, 'o', 'r', { base: 'main', head: 'f', title: 'T' }),
    ]) {
      const resolved = await pending;
      expect(resolved.isErr()).toBe(true);
      if (resolved.isOk()) continue;
      expect(resolved.error.code).toBe('CONFIG_ERROR');
    }
  });
});

// ─── bodies credits ────────────────────────────────────────────────────

describe('bodies credits', () => {
  it('builds deterministic bodies from sections', async () => {
    expect(
      buildPrBody({
        summary: 'Merge repo-a and repo-b.',
        credits: 'Co-Authored-By: Ada <ada@x.dev>',
        provenance: ['repo-a@abc', 'repo-b@def'],
      })
    ).toBe(
      'Merge repo-a and repo-b.\n\n## Credits\nCo-Authored-By: Ada <ada@x.dev>\n\n## Provenance\n- repo-a@abc\n- repo-b@def'
    );
    expect(buildPrBody({})).toBe('');
    expect(buildPrBody(null as unknown as Parameters<typeof buildPrBody>[0])).toBe('');
    // Lone sections keep their headers (consistent shape, never bare).
    expect(buildPrBody({ summary: '  ', credits: '', provenance: ['  ', 'x'] })).toBe(
      '## Provenance\n- x'
    );
  });

  it('builds bodies inline during open', async () => {
    const calls: Call[] = [];
    const client = fakeClient(call => {
      calls.push(call);
      if (call.kind === 'list') return { data: [], headers: {}, status: 200 };
      return prOk();
    });
    const result = await openPR(client, 'o', 'r', {
      base: 'main',
      head: 'feature',
      title: 'T',
      body: { summary: 'S', credits: 'C' },
    });
    expect(result.isOk()).toBe(true);
    expect(calls[1]?.args).toMatchObject({ body: 'S\n\n## Credits\nC' });
    const coerced = await openPR(client, 'o', 'r', {
      base: 'main',
      head: 'feature',
      title: 'T',
      body: 42 as unknown as string,
    });
    expect(coerced.isOk()).toBe(true);
    expect(calls[3]?.args).toMatchObject({ body: '' });
  });
});

// ─── posts status ──────────────────────────────────────────────────────

describe('posts status', () => {
  it('posts sandbox statuses before creating, in order', async () => {
    const calls: Call[] = [];
    const client = fakeClient(call => {
      calls.push(call);
      if (call.kind === 'list') return { data: [], headers: {}, status: 200 };
      if (call.kind === 'status') return { data: {}, headers: {}, status: 201 };
      return prOk();
    });
    const result = await openPR(
      client,
      'o',
      'r',
      { base: 'main', head: 'feature', title: 'T' },
      {
        status: {
          sha: SHA_A,
          context: 'stitch/sandbox',
          state: 'success',
          description: 'green',
          targetUrl: 'https://ci.example.com/1',
        },
      }
    );
    expect(result.isOk()).toBe(true);
    expect(calls.map(call => call.kind)).toEqual(['list', 'status', 'create']);
    expect(calls[1]?.args).toMatchObject({
      sha: SHA_A,
      state: 'success',
      context: 'stitch/sandbox',
      description: 'green',
      target_url: 'https://ci.example.com/1',
    });
  });

  it('aborts creation when the status post fails', async () => {
    const calls: Call[] = [];
    const client = fakeClient(call => {
      calls.push(call);
      if (call.kind === 'list') return { data: [], headers: {}, status: 200 };
      if (call.kind === 'status') throw reqError(401, 'denied');
      return prOk();
    });
    const result = await openPR(
      client,
      'o',
      'r',
      { base: 'main', head: 'feature', title: 'T' },
      { status: { sha: SHA_A, context: 'c', state: 'success' } }
    );
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('AUTH_ERROR');
    expect(calls.map(call => call.kind)).toEqual(['list', 'status']);
  });

  it('validates status shapes', async () => {
    const client = fakeClient(call => {
      if (call.kind === 'list') return { data: [], headers: {}, status: 200 };
      return prOk();
    });
    for (const status of [
      { sha: 'short', context: 'c', state: 'success' },
      { sha: SHA_A, context: 'c', state: 'bogus' },
      null,
      'x',
    ]) {
      const result = await openPR(
        client,
        'o',
        'r',
        { base: 'main', head: 'feature', title: 'T' },
        { status: status as never }
      );
      expect(result.isErr()).toBe(true);
      if (result.isOk()) continue;
      expect(result.error.code).toBe('CONFIG_ERROR');
    }
  });
});

// ─── skips existing ────────────────────────────────────────────────────

describe('skips existing', () => {
  it('returns the open PR without creating or posting', async () => {
    const calls: Call[] = [];
    const client = fakeClient(call => {
      calls.push(call);
      if (call.kind === 'list') {
        return {
          data: [
            {
              number: 9,
              html_url: 'https://github.com/o/r/pull/9',
              head: { ref: 'feature', sha: SHA_B },
              state: 'open',
            },
          ],
          headers: {},
          status: 200,
        };
      }
      throw new Error('must not fire');
    });
    const result = await openPR(
      client,
      'o',
      'r',
      { base: 'main', head: 'feature', title: 'T' },
      { status: { sha: SHA_B, context: 'c', state: 'success' } }
    );
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value).toEqual({
      number: 9,
      url: 'https://github.com/o/r/pull/9',
      headSha: SHA_B,
      skipped: true,
    });
    expect(calls.map(call => call.kind)).toEqual(['list']);
  });

  it('ignores closed decoys and other heads', async () => {
    const calls: Call[] = [];
    const client = fakeClient(call => {
      calls.push(call);
      if (call.kind === 'list') {
        return {
          data: [
            { number: 3, html_url: 'u3', head: { ref: 'feature', sha: SHA_A }, state: 'closed' },
            { number: 4, html_url: 'u4', head: { ref: 'other', sha: SHA_B }, state: 'open' },
          ],
          headers: {},
          status: 200,
        };
      }
      return prOk();
    });
    const result = await openPR(client, 'o', 'r', { base: 'main', head: 'feature', title: 'T' });
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.skipped).toBe(false);
    expect(result.value.number).toBe(7);
    expect(calls.map(call => call.kind)).toEqual(['list', 'create']);
  });

  it('converges duplicate races on ALREADY_EXISTS', async () => {
    const client = fakeClient(call => {
      if (call.kind === 'list') return { data: [], headers: {}, status: 200 };
      throw reqError(422, 'A pull request already exists for o:feature');
    });
    const result = await openPR(client, 'o', 'r', { base: 'main', head: 'feature', title: 'T' });
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GITHUB_API_ERROR');
    if (result.error.code !== 'GITHUB_API_ERROR') return;
    expect(result.error.status).toBe(422);
    expect(result.error.message).toContain('ALREADY_EXISTS');
    const validation = fakeClient(call => {
      if (call.kind === 'list') return { data: [], headers: {}, status: 200 };
      throw reqError(422, 'Validation Failed: base is bad');
    });
    const invalid = await openPR(validation, 'o', 'r', { base: 'main', head: 'f', title: 'T' });
    expect(invalid.isErr()).toBe(true);
    if (invalid.isOk()) return;
    expect(invalid.error.code).toBe('CONFIG_ERROR');
    if (invalid.error.code !== 'CONFIG_ERROR') return;
    expect(invalid.error.message).not.toContain('ALREADY_EXISTS');
  });

  it('maps resolved create failures', async () => {
    for (const status of [422, 500]) {
      const client = fakeClient(call => {
        if (call.kind === 'list') return { data: [], headers: {}, status: 200 };
        return { data: {}, headers: {}, status };
      });
      const result = await openPR(client, 'o', 'r', { base: 'main', head: 'f', title: 'T' });
      expect(result.isErr()).toBe(true);
      if (result.isOk()) continue;
      expect(result.error.code).toBe('GITHUB_API_ERROR');
      if (result.error.code !== 'GITHUB_API_ERROR') continue;
      if (status === 422) {
        expect(result.error.message).toContain('ALREADY_EXISTS');
      }
    }
    const resolvingList = fakeClient(() => ({ data: {}, headers: {}, status: 500 }));
    const listed = await openPR(resolvingList, 'o', 'r', { base: 'main', head: 'f', title: 'T' });
    expect(listed.isErr()).toBe(true);
    if (listed.isOk()) return;
    expect(listed.error.code).toBe('GITHUB_API_ERROR');
  });

  it('maps bare create rejections', async () => {
    const client = fakeClient(call => {
      if (call.kind === 'list') return { data: [], headers: {}, status: 200 };
      return Promise.reject();
    });
    const result = await openPR(client, 'o', 'r', { base: 'main', head: 'f', title: 'T' });
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GITHUB_API_ERROR');
  });
});

// ─── errors ────────────────────────────────────────────────────────────

describe('errors', () => {
  it('maps endpoint failures with operation context', async () => {
    const failingList = fakeClient(() => {
      throw reqError(500, 'boom');
    });
    const listed = await openPR(failingList, 'o', 'r', { base: 'main', head: 'f', title: 'T' });
    expect(listed.isErr()).toBe(true);
    if (listed.isOk()) return;
    expect(listed.error.code).toBe('GITHUB_API_ERROR');
    const denied = fakeClient(call => {
      if (call.kind === 'list') return { data: [], headers: {}, status: 200 };
      throw reqError(403, 'denied');
    });
    const createDenied = await openPR(denied, 'o', 'r', { base: 'main', head: 'f', title: 'T' });
    expect(createDenied.isErr()).toBe(true);
    if (createDenied.isOk()) return;
    expect(createDenied.error.code).toBe('AUTH_ERROR');
  });

  it('maps status-less throws, resolved non-2xx, and bare rejections', async () => {
    const hung = fakeClient(() => {
      throw new Error('socket hang up');
    });
    const hungResult = await openPR(hung, 'o', 'r', { base: 'main', head: 'f', title: 'T' });
    expect(hungResult.isErr()).toBe(true);
    if (hungResult.isOk()) return;
    expect(hungResult.error.code).toBe('GITHUB_API_ERROR');
    const resolved = fakeClient(() => ({ data: {}, headers: {}, status: 502 }));
    const resolvedResult = await openPR(resolved, 'o', 'r', {
      base: 'main',
      head: 'f',
      title: 'T',
    });
    expect(resolvedResult.isErr()).toBe(true);
    if (resolvedResult.isOk()) return;
    expect(resolvedResult.error.code).toBe('GITHUB_API_ERROR');
    const primitive: PrClient = {
      rest: {
        repos: {
          getCommit: async () => ({ data: {}, headers: {}, status: 200 }),
          updateBranchProtection: async () => ({ data: {}, headers: {}, status: 200 }),
          createCommitStatus: async () => ({ data: {}, headers: {}, status: 200 }),
        },
        git: {
          createRef: async () => ({ data: {}, headers: {}, status: 201 }),
          deleteRef: async () => ({ data: {}, headers: {}, status: 200 }),
        },
        pulls: {
          create: async () => ({ data: {}, headers: {}, status: 201 }),
          list: () => Promise.reject(),
        },
      },
    };
    const prim = await openPR(primitive, 'o', 'r', { base: 'main', head: 'f', title: 'T' });
    expect(prim.isErr()).toBe(true);
    if (prim.isOk()) return;
    expect(prim.error.code).toBe('GITHUB_API_ERROR');
  });

  it('refuses malformed payloads fail-closed', async () => {
    for (const data of [
      { number: 'seven', html_url: 'u', head: { ref: 'f', sha: SHA_A } },
      { number: 7, html_url: 'u', head: { ref: 'f', sha: 'short' } },
      { number: 7, html_url: 'u', head: { ref: '  ', sha: SHA_A } },
      { number: 7, html_url: 'u', head: {} },
      { number: 7, html_url: 'u', head: 'x' },
      { number: 7, html_url: 'u', head: null },
      { number: 7, html_url: 'u' },
      42,
    ]) {
      const client = fakeClient(call => {
        if (call.kind === 'list') return { data: [], headers: {}, status: 200 };
        return { data, headers: {}, status: 201 };
      });
      const result = await openPR(client, 'o', 'r', { base: 'main', head: 'f', title: 'T' });
      expect(result.isErr()).toBe(true);
      if (result.isOk()) continue;
      expect(result.error.code).toBe('INTERNAL');
    }
    const badList = fakeClient(() => ({ data: [{ number: 1 }], headers: {}, status: 200 }));
    const listed = await openPR(badList, 'o', 'r', { base: 'main', head: 'f', title: 'T' });
    expect(listed.isErr()).toBe(true);
    if (listed.isOk()) return;
    expect(listed.error.code).toBe('INTERNAL');
    const shapedList = fakeClient(() => ({ data: {}, headers: {}, status: 200 }));
    const shaped = await openPR(shapedList, 'o', 'r', { base: 'main', head: 'f', title: 'T' });
    expect(shaped.isErr()).toBe(true);
    if (shaped.isOk()) return;
    expect(shaped.error.code).toBe('INTERNAL');
    const createdClosed = fakeClient(call => {
      if (call.kind === 'list') return { data: [], headers: {}, status: 200 };
      return prOk({ state: 'closed' });
    });
    const closed = await openPR(createdClosed, 'o', 'r', { base: 'main', head: 'f', title: 'T' });
    expect(closed.isErr()).toBe(true);
    if (closed.isOk()) return;
    expect(closed.error.code).toBe('INTERNAL');
  });

  it('reads every rate-limit shape on PR calls', async () => {
    const shaped = async (status: number, headers: unknown, message: string) => {
      const client = fakeClient(() => {
        const error = new Error(message) as Error & { status: number; headers: unknown };
        error.status = status;
        (error as { headers: unknown }).headers = headers;
        throw error;
      });
      return openPR(client, 'o', 'r', { base: 'main', head: 'f', title: 'T' });
    };
    const direct = await shaped(429, { 'retry-after': '30' }, 'slow down');
    expect(direct.isErr()).toBe(true);
    if (direct.isOk()) return;
    expect(direct.error.code).toBe('GITHUB_API_ERROR');
    if (direct.error.code !== 'GITHUB_API_ERROR') return;
    expect(direct.error.message).toContain('retry after 30s');
    const inst = await shaped(429, new Headers({ 'retry-after': '45' }), 'slow down');
    expect(inst.isErr()).toBe(true);
    if (inst.isOk()) return;
    expect(inst.error.code).toBe('GITHUB_API_ERROR');
    if (inst.error.code !== 'GITHUB_API_ERROR') return;
    expect(inst.error.message).toContain('retry after 45s');
    for (const headers of [
      { 'retry-after': 'soon' },
      { 'retry-after': '-5' },
      { 'x-ratelimit-reset': 'soon' },
      {},
      new Headers(),
      undefined,
    ]) {
      const odd = await shaped(429, headers, 'API rate limit exceeded');
      expect(odd.isErr()).toBe(true);
      if (odd.isOk()) continue;
      expect(odd.error.code).toBe('GITHUB_API_ERROR');
      if (odd.error.code !== 'GITHUB_API_ERROR') continue;
      expect(odd.error.message).toContain('retry delay unknown');
    }
    const reset = String(Math.floor(Date.now() / 1000) + 60);
    const epoch = await shaped(429, { 'x-ratelimit-reset': reset }, 'slow down');
    expect(epoch.isErr()).toBe(true);
    if (epoch.isOk()) return;
    expect(epoch.error.code).toBe('GITHUB_API_ERROR');
    if (epoch.error.code !== 'GITHUB_API_ERROR') return;
    expect(epoch.error.message).toMatch(/retry after \d+s/);
    const remaining = await shaped(403, { 'x-ratelimit-remaining': '0' }, 'limited');
    expect(remaining.isErr()).toBe(true);
    if (remaining.isOk()) return;
    expect(remaining.error.code).toBe('GITHUB_API_ERROR');
    const nested = fakeClient(() => {
      const error = new Error('API rate limit exceeded') as Error & {
        status: number;
        response: { headers: Record<string, string> };
      };
      error.status = 403;
      error.response = { headers: { 'x-ratelimit-remaining': '0', 'retry-after': '75' } };
      throw error;
    });
    const nestedResult = await openPR(nested, 'o', 'r', { base: 'main', head: 'f', title: 'T' });
    expect(nestedResult.isErr()).toBe(true);
    if (nestedResult.isOk()) return;
    expect(nestedResult.error.code).toBe('GITHUB_API_ERROR');
    if (nestedResult.error.code !== 'GITHUB_API_ERROR') return;
    expect(nestedResult.error.message).toContain('retry after 75s');
    const nulled = fakeClient(() => {
      const error = new Error('API rate limit exceeded') as Error & {
        status: number;
        response: null;
      };
      error.status = 429;
      error.response = null;
      throw error;
    });
    const nulledResult = await openPR(nulled, 'o', 'r', { base: 'main', head: 'f', title: 'T' });
    expect(nulledResult.isErr()).toBe(true);
    if (nulledResult.isOk()) return;
    expect(nulledResult.error.code).toBe('GITHUB_API_ERROR');
    if (nulledResult.error.code !== 'GITHUB_API_ERROR') return;
    expect(nulledResult.error.message).toContain('retry delay unknown');
    const forbidden = await shaped(403, { 'x-ratelimit-remaining': '5' }, 'Forbidden');
    expect(forbidden.isErr()).toBe(true);
    if (forbidden.isOk()) return;
    expect(forbidden.error.code).toBe('AUTH_ERROR');
  });
});

// ─── nock end to end ───────────────────────────────────────────────────

describe('nock end to end', () => {
  it('opens PRs through real Octokit', async () => {
    const scope = nock('https://api.github.com')
      .get('/repos/o/r/pulls')
      .query({ head: 'o:feature', state: 'open', per_page: '30' })
      .reply(200, [])
      .post('/repos/o/r/pulls', {
        title: 'Merge feature',
        head: 'feature',
        base: 'main',
        body: '',
        draft: false,
      })
      .reply(201, {
        number: 7,
        html_url: 'https://github.com/o/r/pull/7',
        head: { ref: 'feature', sha: SHA_A },
      });
    const built = createValidatedClient({ auth: { authType: 'pat', token: 'ghp_test' } });
    if (built.isErr()) throw new Error('client construction failed');
    const result = await openPR(built.value, 'o', 'r', {
      base: 'main',
      head: 'feature',
      title: 'Merge feature',
    });
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.number).toBe(7);
    expect(scope.isDone()).toBe(true);
  });

  it('skips existing PRs without posting', async () => {
    const scope = nock('https://api.github.com')
      .get('/repos/o/r/pulls')
      .query({ head: 'o:feature', state: 'open', per_page: '30' })
      .reply(200, [
        {
          number: 9,
          html_url: 'https://github.com/o/r/pull/9',
          head: { ref: 'feature', sha: SHA_B },
          state: 'open',
        },
      ]);
    const built = createValidatedClient({ auth: { authType: 'pat', token: 'ghp_test' } });
    if (built.isErr()) throw new Error('client construction failed');
    const result = await openPR(built.value, 'o', 'r', {
      base: 'main',
      head: 'feature',
      title: 'T',
    });
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value).toEqual({
      number: 9,
      url: 'https://github.com/o/r/pull/9',
      headSha: SHA_B,
      skipped: true,
    });
    expect(scope.isDone()).toBe(true);
  });
});
