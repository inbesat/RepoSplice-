// GitHub GraphQL trees (P-097): deep trees in one v4 query, normalized
// to the P-090 shape for a transport-agnostic picker layer — over
// injected fakes (no network) plus nock proofs that the real Octokit
// satisfies the seam (method names AND wire shapes).

import { describe, it, expect, afterEach } from 'vitest';
import nock from 'nock';
import { cleanupHttpMocks } from '../../../test-utils/http.js';
import { createValidatedClient } from '../auth.js';
import { createRefCache } from '../../git/perf.js';
import { graphqlTree, buildTreeQuery, type GraphqlClient, type TreeNode } from '../graphql.js';

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

function blob(name: string, path: string, sha: string = SHA_A): Record<string, unknown> {
  return { name, path, oid: sha, type: 'blob' };
}

function subtree(
  name: string,
  path: string,
  entries: unknown[],
  sha: string = SHA_B
): Record<string, unknown> {
  return {
    name,
    path,
    oid: sha,
    type: 'tree',
    object: { entries },
  };
}

interface Call {
  kind: 'graphql' | 'commit' | 'repo' | 'tree';
  args: Record<string, unknown>;
}

/** Fake client serving scripted payloads while recording calls. */
function fakeClient(handler: (call: Call) => unknown): GraphqlClient {
  const wrap =
    (kind: Call['kind']) =>
    async (
      args?: Record<string, unknown>
    ): Promise<{ data: unknown; headers: unknown; status: number }> => {
      const out = handler({ kind, args: args ?? {} });
      if (out instanceof Error) throw out;
      return out as { data: unknown; headers: unknown; status: number };
    };
  return {
    // Real octokit.graphql resolves the DATA payload directly (probed) —
    // the fake unwraps identically so shapes never drift from reality.
    graphql: async (query: string, variables?: Record<string, unknown>) => {
      const out = handler({ kind: 'graphql', args: { query, variables: variables ?? {} } });
      if (out instanceof Error) throw out;
      return (out as { data: unknown }).data;
    },
    rest: {
      repos: {
        get: wrap('repo'),
        getCommit: wrap('commit'),
      },
      git: {
        getTree: wrap('tree'),
      },
    },
  };
}

function gqlOk(repository: unknown): unknown {
  return { data: { repository }, headers: {}, status: 200 };
}

function gqlError(errors: unknown): Error {
  // Real octokit THROWS on GraphQL errors with `.errors` attached.
  const error = new Error('GraphQL failed') as Error & { errors: unknown };
  error.errors = errors;
  return error;
}
function treeData(entries: unknown[]): unknown {
  return { object: { entries } };
}

// ─── queries ───────────────────────────────────────────────────────────

describe('queries', () => {
  it('builds exact single-level queries', () => {
    expect(buildTreeQuery(1)).toBe(
      'query ($owner: String!, $repo: String!, $expression: String!) { repository(owner: $owner, name: $repo) { object(expression: $expression) { ... on Tree { entries { name path oid type } } } } }'
    );
  });

  it('nests entries per depth level', () => {
    expect(buildTreeQuery(2)).toBe(
      'query ($owner: String!, $repo: String!, $expression: String!) { repository(owner: $owner, name: $repo) { object(expression: $expression) { ... on Tree { entries { name path oid type object { ... on Tree { entries { name path oid type } } } } } } } }'
    );
    const depth3 = buildTreeQuery(3);
    expect(depth3.match(/entries \{/g)).toHaveLength(3);
  });

  it('sends the query with variables in one call', async () => {
    const calls: Call[] = [];
    const client = fakeClient(call => {
      calls.push(call);
      return gqlOk(treeData([blob('a.txt', 'a.txt')]));
    });
    const result = await graphqlTree(client, 'o', 'r', { expression: 'main', depth: 2 });
    expect(result.isOk()).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.args).toMatchObject({
      query: buildTreeQuery(2),
      variables: { owner: 'o', repo: 'r', expression: 'main' },
    });
  });

  it('defaults expression and depth', async () => {
    const calls: Call[] = [];
    const client = fakeClient(call => {
      calls.push(call);
      return gqlOk(treeData([]));
    });
    const result = await graphqlTree(client, 'o', 'r', {});
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.flat).toEqual([]);
    expect(result.value.nested).toEqual([]);
    const variables = calls[0]?.args['variables'] as Record<string, unknown>;
    expect(variables).toMatchObject({ expression: 'HEAD' });
    expect(String(calls[0]?.args['query']).match(/entries \{/g)).toHaveLength(1);
  });

  it('validates shapes at the boundary', async () => {
    const client = fakeClient(() => gqlOk(treeData([])));
    for (const pending of [
      graphqlTree(client, '  ', 'r', {}),
      graphqlTree(client, 'o', '  ', {}),
      graphqlTree(client, 'o', 'r', { depth: 0 }),
      graphqlTree(client, 'o', 'r', { depth: 1.5 }),
      graphqlTree(client, 'o', 'r', { depth: 'deep' as unknown as number }),
      graphqlTree(client, 'o', 'r', { expression: '  ' }),
      graphqlTree(client, 'o', 'r', { ignore: 'x' as unknown as string[] }),
      graphqlTree(client, 'o', 'r', { ignore: [42] as unknown as string[] }),
      graphqlTree(client, 'o', 'r', { pruneDirs: 'x' as unknown as string[] }),
      graphqlTree(client, 'o', 'r', { pruneDirs: [42] as unknown as string[] }),
      graphqlTree(client, 'o', 'r', { maxEntries: 0 }),
      graphqlTree(client, 'o', 'r', {
        cache: null as unknown as ReturnType<typeof createRefCache<TreeNode[]>>,
      }),
      graphqlTree(null as unknown as GraphqlClient, 'o', 'r', {}),
      graphqlTree(undefined as unknown as GraphqlClient, 'o', 'r', {}),
    ]) {
      const resolved = await pending;
      expect(resolved.isErr()).toBe(true);
      if (resolved.isOk()) continue;
      expect(resolved.error.code).toBe('CONFIG_ERROR');
    }
  });
});

// ─── normalizes ────────────────────────────────────────────────────────

describe('normalizes', () => {
  it('flattens nested levels in walk order', async () => {
    const client = fakeClient(() =>
      gqlOk(
        treeData([
          subtree('src', 'src', [blob('a.ts', 'src/a.ts')]),
          blob('README.md', 'README.md'),
        ])
      )
    );
    const result = await graphqlTree(client, 'o', 'r', { expression: SHA_A, depth: 2 });
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    const flat: TreeNode[] = result.value.flat;
    expect(flat).toEqual([
      { path: 'src', type: 'tree', sha: SHA_B },
      { path: 'src/a.ts', type: 'blob', sha: SHA_A },
      { path: 'README.md', type: 'blob', sha: SHA_A },
    ]);
    expect(result.value.nested.map(entry => entry.name)).toEqual(['README.md', 'src']);
  });

  it('maps submodule commits and skips null objects', async () => {
    const client = fakeClient(() =>
      gqlOk(
        treeData([
          { name: 'dep', path: 'vendor/dep', oid: SHA_B, type: 'commit', object: null },
          { name: 'loose', path: 'loose.txt', oid: SHA_A, type: 'blob', object: null },
        ])
      )
    );
    const result = await graphqlTree(client, 'o', 'r', { expression: SHA_A, depth: 2 });
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.flat).toEqual([
      { path: 'vendor/dep', type: 'commit', sha: SHA_B },
      { path: 'loose.txt', type: 'blob', sha: SHA_A },
    ]);
  });

  it('applies ignore and prune filters post-fetch', async () => {
    const client = fakeClient(() =>
      gqlOk(
        treeData([
          blob('a.log', 'a.log'),
          blob('src/a.ts', 'src/a.ts'),
          blob('dist/o.js', 'dist/o.js'),
        ])
      )
    );
    const result = await graphqlTree(client, 'o', 'r', {
      expression: SHA_A,
      ignore: ['*.log'],
      pruneDirs: ['dist'],
    });
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.flat.map(node => node.path)).toEqual(['src/a.ts']);
  });

  it('enforces opt-in entry caps', async () => {
    const client = fakeClient(() =>
      gqlOk(treeData([blob('a.txt', 'a.txt'), blob('b.txt', 'b.txt')]))
    );
    const capped = await graphqlTree(client, 'o', 'r', { expression: SHA_A, maxEntries: 1 });
    expect(capped.isErr()).toBe(true);
    if (capped.isOk()) return;
    expect(capped.error.code).toBe('GITHUB_API_ERROR');
  });

  it('stops descending at the depth boundary', async () => {
    const client = fakeClient(() =>
      gqlOk(treeData([subtree('src', 'src', [blob('a.ts', 'src/a.ts')])]))
    );
    const result = await graphqlTree(client, 'o', 'r', { expression: SHA_A, depth: 1 });
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.flat.map(node => node.path)).toEqual(['src']);
    expect(result.value.nested).toHaveLength(1);
  });

  it('refuses malformed bodies fail-closed', async () => {
    for (const data of [42, { repository: 'x' }]) {
      const client = fakeClient(() => ({ data, headers: {}, status: 200 }));
      const result = await graphqlTree(client, 'o', 'r', { expression: SHA_A });
      expect(result.isErr()).toBe(true);
      if (result.isOk()) continue;
      expect(result.error.code).toBe('INTERNAL');
    }
  });

  it('refuses malformed entries fail-closed', async () => {
    for (const [entries, depth] of [
      [[{ name: 'a', path: 'a.txt', oid: 42, type: 'blob' }], 1],
      [[{ name: 'a', path: 'a.txt', oid: 'zzz', type: 'blob' }], 1],
      [[{ name: 'a', path: 'a.txt', oid: SHA_A, type: 'symlink' }], 1],
      [[{ name: 'a', path: '  ', oid: SHA_A, type: 'blob' }], 1],
      [[{ name: 'a', oid: SHA_A, type: 'blob' }], 1],
      // Nested objects only matter when the query descends into them.
      [[{ name: 'a', path: 'x', oid: SHA_A, type: 'tree', object: 42 }], 2],
      [[42], 1],
      ['not-an-array', 1],
    ] as Array<[unknown, number]>) {
      const client = fakeClient(() => gqlOk({ object: { entries } }));
      const result = await graphqlTree(client, 'o', 'r', { expression: SHA_A, depth });
      expect(result.isErr()).toBe(true);
      if (result.isOk()) continue;
      expect(result.error.code).toBe('INTERNAL');
    }
  });
});

// ─── rest fallback ─────────────────────────────────────────────────────

describe('rest fallback', () => {
  function restTree(): unknown {
    return {
      data: {
        sha: SHA_A,
        tree: [{ path: 'a.txt', mode: '100644', type: 'blob', sha: SHA_A }],
        truncated: false,
      },
      headers: {},
      status: 200,
    };
  }

  it('falls back on NOT_FOUND errors', async () => {
    const calls: Call[] = [];
    const client = fakeClient(call => {
      calls.push(call);
      if (call.kind === 'graphql') {
        throw gqlError([{ type: 'NOT_FOUND', message: 'Could not resolve' }]);
      }
      if (call.kind === 'commit') {
        return { data: { sha: SHA_A }, headers: {}, status: 200 };
      }
      return restTree();
    });
    const result = await graphqlTree(client, 'o', 'r', {
      expression: 'main',
      depth: 2,
      ignore: ['*.log'],
      pruneDirs: ['dist'],
      maxEntries: 100,
    });
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.flat).toEqual([{ path: 'a.txt', type: 'blob', sha: SHA_A }]);
    expect(calls.map(call => call.kind)).toEqual(['graphql', 'commit', 'tree']);
  });

  it('falls back on null repositories', async () => {
    const client = fakeClient(call => {
      if (call.kind === 'graphql') return gqlOk(null);
      if (call.kind === 'commit') return { data: { sha: SHA_A }, headers: {}, status: 200 };
      return restTree();
    });
    // Null repository with a working REST side still rescues (the REST
    // failure — unknown repo — is what surfaces, with its own message).
    const result = await graphqlTree(client, 'o', 'r', { expression: 'main' });
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.flat.map(node => node.path)).toEqual(['a.txt']);
  });

  it('falls back on null objects (empty or unknown refs)', async () => {
    const client = fakeClient(call => {
      if (call.kind === 'graphql') return gqlOk({ object: null });
      if (call.kind === 'commit') return { data: { sha: SHA_A }, headers: {}, status: 200 };
      return restTree();
    });
    const result = await graphqlTree(client, 'o', 'r', { expression: 'main' });
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.flat.map(node => node.path)).toEqual(['a.txt']);
  });

  it('falls back on cached paths too', async () => {
    const calls: Call[] = [];
    const client = fakeClient(call => {
      calls.push(call);
      if (call.kind === 'graphql') {
        throw gqlError([{ type: 'NOT_FOUND', message: 'gone' }]);
      }
      if (call.kind === 'commit') {
        return { data: { sha: SHA_A }, headers: {}, status: 200 };
      }
      return restTree();
    });
    const cache = createRefCache<TreeNode[]>();
    const result = await graphqlTree(client, 'o', 'r', { expression: 'main', cache });
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.flat.map(node => node.path)).toEqual(['a.txt']);
    expect(calls.map(call => call.kind)).toEqual(['commit', 'graphql', 'commit', 'tree']);
  });

  it('maps opaque GraphQL failures to the fallback message', async () => {
    const client = fakeClient(() => {
      throw gqlError([42]);
    });
    const result = await graphqlTree(client, 'o', 'r', { expression: SHA_A });
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GITHUB_API_ERROR');
    if (result.error.code !== 'GITHUB_API_ERROR') return;
    expect(result.error.message).toContain('GraphQL request failed');
    const unmessaged = fakeClient(() => {
      throw gqlError([{ type: 'WEIRD', message: 42 }]);
    });
    const unmessagedResult = await graphqlTree(unmessaged, 'o', 'r', { expression: SHA_A });
    expect(unmessagedResult.isErr()).toBe(true);
    if (unmessagedResult.isOk()) return;
    expect(unmessagedResult.error.code).toBe('GITHUB_API_ERROR');
    if (unmessagedResult.error.code !== 'GITHUB_API_ERROR') return;
    expect(unmessagedResult.error.message).toContain('GraphQL request failed');
  });
  it('propagates REST fallback failures', async () => {
    const client = fakeClient(call => {
      if (call.kind === 'graphql') {
        throw gqlError([{ type: 'NOT_FOUND', message: 'nope' }]);
      }
      throw reqError(404, 'not found');
    });
    const result = await graphqlTree(client, 'o', 'r', { expression: 'main' });
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GITHUB_API_ERROR');
  });
});

// ─── errors ────────────────────────────────────────────────────────────

describe('errors', () => {
  it('maps endpoint failures with operation context', async () => {
    for (const status of [401, 404, 500]) {
      const client = fakeClient(() => {
        throw reqError(status, `call failed ${status}`);
      });
      const result = await graphqlTree(client, 'o', 'r', { expression: SHA_A });
      expect(result.isErr()).toBe(true);
      if (result.isOk()) continue;
      if (status === 401) {
        expect(result.error.code).toBe('AUTH_ERROR');
        continue;
      }
      expect(result.error.code).toBe('GITHUB_API_ERROR');
    }
    const hung = fakeClient(() => {
      throw new Error('socket hang up');
    });
    const hungResult = await graphqlTree(hung, 'o', 'r', { expression: SHA_A });
    expect(hungResult.isErr()).toBe(true);
    if (hungResult.isOk()) return;
    expect(hungResult.error.code).toBe('GITHUB_API_ERROR');
    const resolved = fakeClient(() => ({ data: {}, headers: {}, status: 503 }));
    const resolvedResult = await graphqlTree(resolved, 'o', 'r', { expression: SHA_A });
    expect(resolvedResult.isErr()).toBe(true);
    if (resolvedResult.isOk()) return;
    expect(resolvedResult.error.code).toBe('GITHUB_API_ERROR');
    const primitive = {
      graphql: () => Promise.reject(),
      rest: {
        repos: {
          get: async () => ({ data: {}, headers: {}, status: 200 }),
          getCommit: async () => ({ data: {}, headers: {}, status: 200 }),
        },
        git: {
          getTree: async () => ({ data: {}, headers: {}, status: 200 }),
        },
      },
    };
    const prim = await graphqlTree(primitive as unknown as GraphqlClient, 'o', 'r', {
      expression: SHA_A,
    });
    expect(prim.isErr()).toBe(true);
    if (prim.isOk()) return;
    expect(prim.error.code).toBe('GITHUB_API_ERROR');
  });

  it('maps non-NOT_FOUND GraphQL errors without falling back', async () => {
    const client = fakeClient(() => {
      throw gqlError([{ type: 'RATE_LIMITED', message: 'slow down' }, 42]);
    });
    const result = await graphqlTree(client, 'o', 'r', { expression: SHA_A });
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GITHUB_API_ERROR');
    if (result.error.code !== 'GITHUB_API_ERROR') return;
    expect(result.error.message).toContain('slow down');
    const calls: Call[] = [];
    const counting = fakeClient(call => {
      calls.push(call);
      return {
        data: null,
        headers: {},
        status: 200,
        errors: [{ type: 'RATE_LIMITED', message: 'slow down' }],
      };
    });
    const counted = await graphqlTree(counting, 'o', 'r', { expression: SHA_A });
    expect(counted.isErr()).toBe(true);
    // Exactly one call: no REST fallback on non-NOT_FOUND errors.
    expect(calls).toHaveLength(1);
  });

  it('reads every rate-limit shape on GraphQL calls', async () => {
    const shaped = async (status: number, headers: unknown, message: string) => {
      const client = fakeClient(() => {
        const error = new Error(message) as Error & { status: number; headers: unknown };
        error.status = status;
        (error as { headers: unknown }).headers = headers;
        throw error;
      });
      return graphqlTree(client, 'o', 'r', { expression: SHA_A });
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
    const nestedResult = await graphqlTree(nested, 'o', 'r', { expression: SHA_A });
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
    const nulledResult = await graphqlTree(nulled, 'o', 'r', { expression: SHA_A });
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

// ─── cache ─────────────────────────────────────────────────────────────

describe('cache', () => {
  it('serves repeats without refetching', async () => {
    let resolves = 0;
    let fetches = 0;
    const client = fakeClient(call => {
      if (call.kind === 'commit') {
        resolves += 1;
        return { data: { sha: SHA_A }, headers: {}, status: 200 };
      }
      if (call.kind === 'graphql') {
        fetches += 1;
        return gqlOk(treeData([blob('a.txt', 'a.txt')]));
      }
      return { data: {}, headers: {}, status: 200 };
    });
    const cache = createRefCache<TreeNode[]>();
    const opts = { expression: 'main', cache } as const;
    const first = await graphqlTree(client, 'o', 'r', opts);
    expect(first.isOk()).toBe(true);
    const second = await graphqlTree(client, 'o', 'r', opts);
    expect(second.isOk()).toBe(true);
    // Resolve runs per call (cheap, keyed lookup); fetch runs once.
    expect(resolves).toBe(2);
    expect(fetches).toBe(1);
    if (first.isErr() || second.isErr()) return;
    expect(second.value.flat).toEqual(first.value.flat);
  });

  it('refetches when the ref moves', async () => {
    let resolve = SHA_A;
    const client = fakeClient(call => {
      if (call.kind === 'commit') return { data: { sha: resolve }, headers: {}, status: 200 };
      if (call.kind === 'graphql') {
        const name = resolve === SHA_A ? 'a.txt' : 'b.txt';
        return gqlOk(treeData([blob(name, name)]));
      }
      return { data: {}, headers: {}, status: 200 };
    });
    const cache = createRefCache<TreeNode[]>();
    const first = await graphqlTree(client, 'o', 'r', { expression: 'main', cache });
    expect(first.isOk() && first.value.flat.map(node => node.path)).toEqual(['a.txt']);
    resolve = SHA_B;
    const second = await graphqlTree(client, 'o', 'r', { expression: 'main', cache });
    expect(second.isOk() && second.value.flat.map(node => node.path)).toEqual(['b.txt']);
  });

  it('never caches failures', async () => {
    let calls = 0;
    const client = fakeClient(call => {
      if (call.kind === 'commit') return { data: { sha: SHA_A }, headers: {}, status: 200 };
      calls += 1;
      if (calls === 1) throw reqError(500, 'boom');
      return gqlOk(treeData([blob('a.txt', 'a.txt')]));
    });
    const cache = createRefCache<TreeNode[]>();
    const failed = await graphqlTree(client, 'o', 'r', { expression: 'main', cache });
    expect(failed.isErr()).toBe(true);
    const retried = await graphqlTree(client, 'o', 'r', { expression: 'main', cache });
    expect(retried.isOk()).toBe(true);
    expect(calls).toBe(2);
  });

  it('refuses unresolvable cache keys', async () => {
    const client = fakeClient(call => {
      if (call.kind === 'commit') throw reqError(404, 'nope');
      return gqlOk(treeData([]));
    });
    const cache = createRefCache<TreeNode[]>();
    const result = await graphqlTree(client, 'o', 'r', { expression: 'main', cache });
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GITHUB_API_ERROR');
  });

  it('skips resolution for SHA cache keys', async () => {
    const calls: Call[] = [];
    const client = fakeClient(call => {
      calls.push(call);
      return gqlOk(treeData([blob('a.txt', 'a.txt')]));
    });
    const cache = createRefCache<TreeNode[]>();
    const first = await graphqlTree(client, 'o', 'r', { expression: SHA_A, cache });
    expect(first.isOk()).toBe(true);
    const second = await graphqlTree(client, 'o', 'r', { expression: SHA_A, cache });
    expect(second.isOk()).toBe(true);
    // No commit calls at all: SHAs resolve locally.
    expect(calls.map(call => call.kind)).toEqual(['graphql']);
    if (first.isErr() || second.isErr()) return;
    expect(second.value.flat).toEqual(first.value.flat);
  });

  it('refuses malformed commit resolutions', async () => {
    for (const sha of ['short', 42]) {
      const client = fakeClient(call => {
        if (call.kind === 'commit') return { data: { sha }, headers: {}, status: 200 };
        return gqlOk(treeData([]));
      });
      const cache = createRefCache<TreeNode[]>();
      const result = await graphqlTree(client, 'o', 'r', { expression: 'main', cache });
      expect(result.isErr()).toBe(true);
      if (result.isOk()) continue;
      expect(result.error.code).toBe('INTERNAL');
    }
    const resolved = fakeClient(call => {
      if (call.kind === 'commit') return { data: {}, headers: {}, status: 500 };
      return gqlOk(treeData([]));
    });
    const cache = createRefCache<TreeNode[]>();
    const failed = await graphqlTree(resolved, 'o', 'r', { expression: 'main', cache });
    expect(failed.isErr()).toBe(true);
    if (failed.isOk()) return;
    expect(failed.error.code).toBe('GITHUB_API_ERROR');
  });
});

// ─── nock end to end ───────────────────────────────────────────────────

describe('nock end to end', () => {
  it('queries trees through real Octokit', async () => {
    const scope = nock('https://api.github.com')
      .post('/graphql', {
        query: buildTreeQuery(2),
        variables: { owner: 'o', repo: 'r', expression: 'main' },
      })
      .reply(200, {
        data: {
          repository: {
            object: {
              entries: [
                { name: 'src', path: 'src', oid: SHA_B, type: 'tree', object: { entries: [] } },
                { name: 'a.txt', path: 'a.txt', oid: SHA_A, type: 'blob' },
              ],
            },
          },
        },
      });
    const built = createValidatedClient({ auth: { authType: 'pat', token: 'ghp_test' } });
    if (built.isErr()) throw new Error('client construction failed');
    const result = await graphqlTree(built.value, 'o', 'r', { expression: 'main', depth: 2 });
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.flat.map(node => node.path)).toEqual(['src', 'a.txt']);
    expect(scope.isDone()).toBe(true);
  });

  it('falls back to REST on NOT_FOUND over the wire', async () => {
    const scope = nock('https://api.github.com')
      .post('/graphql')
      .reply(200, { errors: [{ type: 'NOT_FOUND', message: 'Could not resolve' }] })
      .get('/repos/o/r/commits/main')
      .reply(200, { sha: SHA_A })
      .get(`/repos/o/r/git/trees/${SHA_A}`)
      .query({ recursive: 'true' })
      .reply(200, {
        sha: SHA_A,
        truncated: false,
        tree: [{ path: 'a.txt', mode: '100644', type: 'blob', sha: SHA_A }],
      });
    const built = createValidatedClient({ auth: { authType: 'pat', token: 'ghp_test' } });
    if (built.isErr()) throw new Error('client construction failed');
    const result = await graphqlTree(built.value, 'o', 'r', { expression: 'main', depth: 2 });
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.flat.map(node => node.path)).toEqual(['a.txt']);
    expect(scope.isDone()).toBe(true);
  });
});
