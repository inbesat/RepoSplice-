// GitHub repo tree (P-090): single-call recursive trees normalized to
// flat + nested shapes, ref→SHA resolution, sha-keyed caching, and
// ignore/prune filtering — all over injected fakes (no network) plus
// nock proofs that the real Octokit satisfies the seam.

import { describe, it, expect, afterEach } from 'vitest';
import nock from 'nock';
import { cleanupHttpMocks } from '../../../test-utils/http.js';
import { createValidatedClient } from '../auth.js';
import { createRefCache } from '../../git/perf.js';
import { getRepoTree, buildNestedTree, type TreeClient, type TreeNode } from '../tree.js';

afterEach(() => {
  cleanupHttpMocks();
});

const SHA_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const SHA_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

function blob(path: string, sha: string = SHA_A, size = 10): Record<string, unknown> {
  return { path, mode: '100644', type: 'blob', sha, size };
}

function tree(path: string, sha: string = SHA_B): Record<string, unknown> {
  return { path, mode: '040000', type: 'tree', sha };
}

function submodule(path: string): Record<string, unknown> {
  return { path, mode: '160000', type: 'commit', sha: SHA_B };
}

interface Call {
  kind: 'repo' | 'commit' | 'tree';
  args: Record<string, unknown>;
}

/** Fake client serving scripted payloads while recording calls. */
function fakeClient(handler: (call: Call) => unknown): TreeClient {
  const wrap = (kind: Call['kind']) => async (args: Record<string, unknown>) => {
    const out = handler({ kind, args });
    if (out instanceof Error) throw out;
    return out as { data: unknown; headers: unknown; status: number };
  };
  return {
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

function treeOk(tree: unknown, truncated = false): unknown {
  return { data: { sha: SHA_A, tree, truncated }, headers: {}, status: 200 };
}

function commitOk(sha: string = SHA_A): unknown {
  return { data: { sha }, headers: {}, status: 200 };
}

function repoOk(defaultBranch: string | null = 'main'): unknown {
  return { data: { default_branch: defaultBranch }, headers: {}, status: 200 };
}

function reqError(status: number, message: string): Error {
  const error = new Error(message) as Error & { status: number };
  error.status = status;
  return error;
}

// ─── recursive ─────────────────────────────────────────────────────────

describe('recursive', () => {
  const NODES = [
    tree('src'),
    blob('src/a.ts'),
    blob('src/nested/b.ts'),
    tree('lib'),
    blob('README.md'),
    submodule('vendor/dep'),
  ];

  it('fetches one recursive call and normalizes flat nodes', async () => {
    const calls: Call[] = [];
    const client = fakeClient(call => {
      calls.push(call);
      return treeOk(NODES);
    });
    const result = await getRepoTree(client, 'octocat', 'repo', { ref: SHA_A });
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      kind: 'tree',
      args: { owner: 'octocat', repo: 'repo', tree_sha: SHA_A, recursive: 'true' },
    });
    expect(result.value.flat).toEqual([
      { path: 'src', type: 'tree', sha: SHA_B },
      { path: 'src/a.ts', type: 'blob', sha: SHA_A, size: 10 },
      { path: 'src/nested/b.ts', type: 'blob', sha: SHA_A, size: 10 },
      { path: 'lib', type: 'tree', sha: SHA_B },
      { path: 'README.md', type: 'blob', sha: SHA_A, size: 10 },
      { path: 'vendor/dep', type: 'commit', sha: SHA_B },
    ]);
  });

  it('resolves branch refs through getCommit, SHAs direct', async () => {
    const calls: Call[] = [];
    const client = fakeClient(call => {
      calls.push(call);
      if (call.kind === 'commit') return commitOk(SHA_B);
      return treeOk([blob('a.txt')]);
    });
    const result = await getRepoTree(client, 'octocat', 'repo', { ref: 'main' });
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(calls.map(call => call.kind)).toEqual(['commit', 'tree']);
    expect(calls[1]?.args).toMatchObject({ tree_sha: SHA_B });
    const directCalls: Call[] = [];
    const direct = fakeClient(call => {
      directCalls.push(call);
      return treeOk([blob('a.txt')]);
    });
    const directResult = await getRepoTree(direct, 'octocat', 'repo', { ref: SHA_A });
    expect(directResult.isOk()).toBe(true);
    expect(directCalls.map(call => call.kind)).toEqual(['tree']);
  });

  it('falls back to the default branch, refusing empty repos', async () => {
    const calls: Call[] = [];
    const client = fakeClient(call => {
      calls.push(call);
      if (call.kind === 'repo') return repoOk('develop');
      if (call.kind === 'commit') return commitOk();
      return treeOk([blob('a.txt')]);
    });
    const result = await getRepoTree(client, 'octocat', 'repo', {});
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(calls.map(call => call.kind)).toEqual(['repo', 'commit', 'tree']);
    const empty = fakeClient(call => (call.kind === 'repo' ? repoOk(null) : treeOk([])));
    const emptyResult = await getRepoTree(empty, 'octocat', 'repo', {});
    expect(emptyResult.isErr()).toBe(true);
    if (emptyResult.isOk()) return;
    expect(emptyResult.error.code).toBe('CONFIG_ERROR');
  });

  it('fetches top-level only when recursive is false', async () => {
    const calls: Call[] = [];
    const client = fakeClient(call => {
      calls.push(call);
      return treeOk([tree('src'), blob('README.md')]);
    });
    const result = await getRepoTree(client, 'octocat', 'repo', {
      ref: SHA_A,
      recursive: false,
    });
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(calls[0]?.args).not.toHaveProperty('recursive');
    expect(result.value.flat.map(node => node.path)).toEqual(['src', 'README.md']);
  });

  it('validates entry shapes at the boundary', async () => {
    const bad = fakeClient(() => treeOk([{ path: 'x' }]));
    const badOwner = await getRepoTree(bad, '  ', 'r', { ref: SHA_A });
    expect(badOwner.isErr()).toBe(true);
    if (badOwner.isOk()) return;
    expect(badOwner.error.code).toBe('CONFIG_ERROR');
    if (badOwner.error.code !== 'CONFIG_ERROR') return;
    expect(badOwner.error.message).toContain('owner');
    const badEntry = await getRepoTree(bad, 'o', 'r', { ref: SHA_A });
    expect(badEntry.isErr()).toBe(true);
    if (badEntry.isOk()) return;
    expect(badEntry.error.code).toBe('INTERNAL');
  });

  it('rejects misuse shapes at the boundary', async () => {
    const client = fakeClient(() => treeOk([]));
    const bad = [
      getRepoTree(client, 'o', '  ', { ref: SHA_A }),
      getRepoTree(client, 'o', 'r', { ref: '  ' }),
      getRepoTree(client, 'o', 'r', { ref: SHA_A, recursive: 'yes' as unknown as boolean }),
      getRepoTree(client, 'o', 'r', { ref: SHA_A, ignore: 'x' as unknown as string[] }),
      getRepoTree(client, 'o', 'r', {
        ref: SHA_A,
        cache: null as unknown as ReturnType<typeof createRefCache<TreeNode[]>>,
      }),
      getRepoTree(null as unknown as TreeClient, 'o', 'r', { ref: SHA_A }),
      getRepoTree(undefined as unknown as TreeClient, 'o', 'r', { ref: SHA_A }),
    ];
    for (const pending of bad) {
      const resolved = await pending;
      expect(resolved.isErr()).toBe(true);
      if (resolved.isOk()) continue;
      expect(resolved.error.code).toBe('CONFIG_ERROR');
    }
  });
});

// ─── nests ─────────────────────────────────────────────────────────────

describe('nests', () => {
  it('builds sorted nested trees with implicit dirs', () => {
    const flat: TreeNode[] = [
      { path: 'b.txt', type: 'blob', sha: SHA_A },
      { path: 'src/nested/deep.ts', type: 'blob', sha: SHA_A },
      { path: 'src/a.ts', type: 'blob', sha: SHA_A },
      { path: 'vendor/dep', type: 'commit', sha: SHA_B },
    ];
    const nested = buildNestedTree(flat);
    expect(nested.map(entry => entry.name)).toEqual(['b.txt', 'src', 'vendor']);
    const src = nested.find(entry => entry.name === 'src');
    if (src === undefined || src.kind !== 'dir' || src.children === undefined) {
      throw new Error('src dir missing');
    }
    // Implicit `nested` dir carries no sha of its own.
    expect(src.children.map(entry => entry.name)).toEqual(['a.ts', 'nested']);
    const deep = src.children.find(entry => entry.name === 'nested');
    if (deep === undefined || deep.kind !== 'dir' || deep.children === undefined) {
      throw new Error('nested dir missing');
    }
    expect(deep.sha).toBe('');
    expect(deep.children.map(entry => entry.name)).toEqual(['deep.ts']);
    const vendor = nested.find(entry => entry.name === 'vendor');
    if (vendor === undefined || vendor.kind !== 'dir' || vendor.children === undefined) {
      throw new Error('vendor dir missing');
    }
    const dep = vendor.children.find(entry => entry.name === 'dep');
    expect(dep?.kind).toBe('submodule');
  });

  it('keeps explicit dir shas and file sizes', () => {
    const nested = buildNestedTree([
      { path: 'src', type: 'tree', sha: SHA_B },
      { path: 'src/a.ts', type: 'blob', sha: SHA_A, size: 42 },
    ]);
    const src = nested.find(entry => entry.name === 'src');
    expect(src?.sha).toBe(SHA_B);
    const file = src?.kind === 'dir' ? src.children?.[0] : undefined;
    expect(file).toMatchObject({ name: 'a.ts', kind: 'file', size: 42 });
  });

  it('lists explicit empty dirs with no children', () => {
    const nested = buildNestedTree([{ path: 'empty', type: 'tree', sha: SHA_B }]);
    expect(nested).toEqual([
      { name: 'empty', path: 'empty', kind: 'dir', sha: SHA_B, children: [] },
    ]);
  });

  it('returns nested trees from getRepoTree', async () => {
    const client = fakeClient(() => treeOk([tree('src'), blob('src/a.ts')]));
    const result = await getRepoTree(client, 'o', 'r', { ref: SHA_A });
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.nested.map(entry => entry.name)).toEqual(['src']);
  });
});

// ─── cache skips ───────────────────────────────────────────────────────

describe('cache skips', () => {
  it('serves repeat refs without refetching', async () => {
    let fetches = 0;
    const client = fakeClient(call => {
      if (call.kind === 'tree') fetches += 1;
      return treeOk([blob('a.txt')]);
    });
    const cache = createRefCache<TreeNode[]>();
    const opts = { ref: SHA_A, cache } as const;
    const first = await getRepoTree(client, 'o', 'r', opts);
    expect(first.isOk()).toBe(true);
    const second = await getRepoTree(client, 'o', 'r', opts);
    expect(second.isOk()).toBe(true);
    expect(fetches).toBe(1);
    if (first.isErr() || second.isErr()) return;
    expect(second.value.flat).toEqual(first.value.flat);
  });

  it('refetches when the ref moves', async () => {
    let resolve = SHA_A;
    let fetches = 0;
    const client = fakeClient(call => {
      if (call.kind === 'commit') return commitOk(resolve);
      if (call.kind === 'tree') {
        fetches += 1;
        return treeOk([blob(resolve === SHA_A ? 'a.txt' : 'b.txt')]);
      }
      return repoOk();
    });
    const cache = createRefCache<TreeNode[]>();
    const first = await getRepoTree(client, 'o', 'r', { ref: 'main', cache });
    expect(first.isOk() && first.value.flat.map(node => node.path)).toEqual(['a.txt']);
    resolve = SHA_B;
    const second = await getRepoTree(client, 'o', 'r', { ref: 'main', cache });
    expect(second.isOk() && second.value.flat.map(node => node.path)).toEqual(['b.txt']);
    expect(fetches).toBe(2);
  });

  it('never caches failures', async () => {
    let calls = 0;
    const client = fakeClient(() => {
      calls += 1;
      if (calls === 1) {
        const error = new Error('boom') as Error & { status: number };
        error.status = 500;
        throw error;
      }
      return treeOk([blob('a.txt')]);
    });
    const cache = createRefCache<TreeNode[]>();
    const failed = await getRepoTree(client, 'o', 'r', { ref: SHA_A, cache });
    expect(failed.isErr()).toBe(true);
    const retried = await getRepoTree(client, 'o', 'r', { ref: SHA_A, cache });
    expect(retried.isOk()).toBe(true);
    expect(calls).toBe(2);
  });

  it('filters after the cache so keys stay filter-free', async () => {
    let fetches = 0;
    const client = fakeClient(call => {
      if (call.kind === 'tree') {
        fetches += 1;
        return treeOk([blob('a.log'), blob('b.txt')]);
      }
      return repoOk();
    });
    const cache = createRefCache<TreeNode[]>();
    const unfiltered = await getRepoTree(client, 'o', 'r', { ref: SHA_A, cache });
    expect(unfiltered.isOk() && unfiltered.value.flat).toHaveLength(2);
    const filtered = await getRepoTree(client, 'o', 'r', {
      ref: SHA_A,
      cache,
      ignore: ['*.log'],
    });
    expect(filtered.isOk() && filtered.value.flat.map(node => node.path)).toEqual(['b.txt']);
    expect(fetches).toBe(1);
  });
});

// ─── large tree ────────────────────────────────────────────────────────

describe('large tree', () => {
  it('refuses server-truncated trees instead of serving partials', async () => {
    const client = fakeClient(() => treeOk([blob('a.txt')], true));
    const result = await getRepoTree(client, 'o', 'r', { ref: SHA_A });
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GITHUB_API_ERROR');
    if (result.error.code !== 'GITHUB_API_ERROR') return;
    expect(result.error.message).toContain('truncated');
  });

  it('enforces opt-in entry caps', async () => {
    const nodes = [blob('a.txt'), blob('b.txt'), blob('c.txt')];
    const client = fakeClient(() => treeOk(nodes));
    const capped = await getRepoTree(client, 'o', 'r', { ref: SHA_A, maxEntries: 2 });
    expect(capped.isErr()).toBe(true);
    if (capped.isOk()) return;
    expect(capped.error.code).toBe('GITHUB_API_ERROR');
    if (capped.error.code !== 'GITHUB_API_ERROR') return;
    expect(capped.error.message).toContain('maxEntries');
    const roomy = await getRepoTree(client, 'o', 'r', { ref: SHA_A, maxEntries: 3 });
    expect(roomy.isOk()).toBe(true);
  });

  it('prunes deferred content dirs by prefix', async () => {
    const client = fakeClient(() =>
      treeOk([blob('src/a.ts'), blob('assets/big.png'), blob('assets/nested/deep.jpg')])
    );
    const result = await getRepoTree(client, 'o', 'r', {
      ref: SHA_A,
      pruneDirs: ['assets/'],
    });
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.flat.map(node => node.path)).toEqual(['src/a.ts']);
  });

  it('rejects bad maxEntries and prune shapes', async () => {
    const client = fakeClient(() => treeOk([]));
    for (const opts of [
      { maxEntries: 0 },
      { maxEntries: 1.5 },
      { pruneDirs: ['  '] },
      { pruneDirs: [42] as unknown as string[] },
      { ignore: [42] as unknown as string[] },
    ]) {
      const result = await getRepoTree(client, 'o', 'r', { ref: SHA_A, ...opts });
      expect(result.isErr()).toBe(true);
      if (result.isOk()) continue;
      expect(result.error.code).toBe('CONFIG_ERROR');
    }
    const nonArray = await getRepoTree(client, 'o', 'r', {
      ref: SHA_A,
      pruneDirs: 'assets' as unknown as string[],
    });
    expect(nonArray.isErr()).toBe(true);
  });
});

// ─── errors ────────────────────────────────────────────────────────────

describe('rate limited', () => {
  function limitedTree(
    status: number,
    headers: Record<string, string> | Headers,
    message = 'API rate limit exceeded'
  ): TreeClient {
    return fakeClient(call => {
      if (call.kind !== 'tree') return treeOk([]);
      const error = new Error(message) as Error & {
        status: number;
        headers: Record<string, string> | Headers;
      };
      error.status = status;
      error.headers = headers;
      throw error;
    });
  }

  it('surfaces retry-after from direct and Headers bags', async () => {
    const direct = await getRepoTree(limitedTree(429, { 'retry-after': '120' }), 'o', 'r', {
      ref: SHA_A,
    });
    expect(direct.isErr()).toBe(true);
    if (direct.isOk()) return;
    expect(direct.error.code).toBe('GITHUB_API_ERROR');
    if (direct.error.code !== 'GITHUB_API_ERROR') return;
    expect(direct.error.message).toContain('retry after 120s');
    expect(direct.error.message).not.toContain('stitch login');
    const inst = await getRepoTree(
      limitedTree(429, new Headers({ 'retry-after': '45' })),
      'o',
      'r',
      {
        ref: SHA_A,
      }
    );
    expect(inst.isErr()).toBe(true);
    if (inst.isOk()) return;
    expect(inst.error.code).toBe('GITHUB_API_ERROR');
    if (inst.error.code !== 'GITHUB_API_ERROR') return;
    expect(inst.error.message).toContain('retry after 45s');
  });

  it('reads remaining-zero and odd retry values', async () => {
    const zero = await getRepoTree(limitedTree(403, { 'x-ratelimit-remaining': '0' }), 'o', 'r', {
      ref: SHA_A,
    });
    expect(zero.isErr()).toBe(true);
    if (zero.isOk()) return;
    expect(zero.error.code).toBe('GITHUB_API_ERROR');
    for (const headers of [
      { 'retry-after': 'soon' },
      { 'retry-after': '-5' },
      { 'x-ratelimit-reset': 'soon' },
      {},
    ]) {
      const odd = await getRepoTree(limitedTree(429, headers), 'o', 'r', { ref: SHA_A });
      expect(odd.isErr()).toBe(true);
      if (odd.isOk()) continue;
      expect(odd.error.code).toBe('GITHUB_API_ERROR');
      if (odd.error.code !== 'GITHUB_API_ERROR') continue;
      expect(odd.error.message).toContain('retry delay unknown');
    }
    const reset = String(Math.floor(Date.now() / 1000) + 60);
    const epoch = await getRepoTree(limitedTree(429, { 'x-ratelimit-reset': reset }), 'o', 'r', {
      ref: SHA_A,
    });
    expect(epoch.isErr()).toBe(true);
    if (epoch.isOk()) return;
    expect(epoch.error.code).toBe('GITHUB_API_ERROR');
    if (epoch.error.code !== 'GITHUB_API_ERROR') return;
    expect(epoch.error.message).toMatch(/retry after \d+s/);
    const keyless = await getRepoTree(limitedTree(403, new Headers()), 'o', 'r', { ref: SHA_A });
    expect(keyless.isErr()).toBe(true);
    if (keyless.isOk()) return;
    expect(keyless.error.code).toBe('GITHUB_API_ERROR');
    if (keyless.error.code !== 'GITHUB_API_ERROR') return;
    expect(keyless.error.message).toContain('retry delay unknown');
  });

  it('keeps non-rate 403s on the auth path', async () => {
    const forbidden = fakeClient(call => {
      if (call.kind !== 'tree') return treeOk([]);
      const error = new Error('Forbidden') as Error & { status: number };
      error.status = 403;
      throw error;
    });
    const result = await getRepoTree(forbidden, 'o', 'r', { ref: SHA_A });
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('AUTH_ERROR');
    if (result.error.code !== 'AUTH_ERROR') return;
    expect(result.error.message).toContain('stitch login');
  });
});

describe('errors', () => {
  it('maps endpoint failures with operation context', async () => {
    const cases = [
      // ref omitted so the repo call actually fires.
      { kind: 'repo' as const, status: 401, opts: {} },
      { kind: 'commit' as const, status: 404, opts: { ref: 'main' } },
      { kind: 'tree' as const, status: 500, opts: { ref: SHA_A } },
    ];
    for (const { kind, status, opts } of cases) {
      const client = fakeClient(call => {
        if (call.kind === kind) throw reqError(status, `call failed ${status}`);
        if (call.kind === 'repo') return repoOk();
        if (call.kind === 'commit') return commitOk();
        return treeOk([]);
      });
      const result = await getRepoTree(client, 'o', 'r', opts);
      expect(result.isErr()).toBe(true);
      if (result.isOk()) continue;
      if (status === 401) {
        expect(result.error.code).toBe('AUTH_ERROR');
        continue;
      }
      expect(result.error.code).toBe('GITHUB_API_ERROR');
    }
  });

  it('maps status-less throws and resolved non-2xx', async () => {
    const hung = fakeClient(() => {
      throw new Error('socket hang up');
    });
    const hungResult = await getRepoTree(hung, 'o', 'r', { ref: SHA_A });
    expect(hungResult.isErr()).toBe(true);
    if (hungResult.isOk()) return;
    expect(hungResult.error.code).toBe('GITHUB_API_ERROR');
    const rejected: TreeClient = {
      rest: {
        repos: {
          get: async () => ({ data: {}, headers: {}, status: 200 }),
          getCommit: async () => ({ data: {}, headers: {}, status: 200 }),
        },
        git: {
          getTree: async () => ({ data: {}, headers: {}, status: 502 }),
        },
      },
    };
    const resolved = await getRepoTree(rejected, 'o', 'r', { ref: SHA_A });
    expect(resolved.isErr()).toBe(true);
    if (resolved.isOk()) return;
    expect(resolved.error.code).toBe('GITHUB_API_ERROR');
    const primitive: TreeClient = {
      rest: {
        repos: {
          get: async () => ({ data: {}, headers: {}, status: 200 }),
          // Bare rejection (no throw statement): the non-Error mapping arm.
          getCommit: () => Promise.reject(),
        },
        git: {
          getTree: async () => ({ data: {}, headers: {}, status: 200 }),
        },
      },
    };
    const prim = await getRepoTree(primitive, 'o', 'r', { ref: 'branchless' });
    expect(prim.isErr()).toBe(true);
    if (prim.isOk()) return;
    expect(prim.error.code).toBe('GITHUB_API_ERROR');
  });

  it('refuses malformed resolutions fail-closed', async () => {
    const noSha = fakeClient(call => {
      if (call.kind === 'commit') return commitOk('short');
      return treeOk([]);
    });
    const result = await getRepoTree(noSha, 'o', 'r', { ref: 'main' });
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('INTERNAL');
    const noBranch = fakeClient(call => {
      if (call.kind === 'repo') return repoOk('');
      return treeOk([]);
    });
    const branchless = await getRepoTree(noBranch, 'o', 'r', {});
    expect(branchless.isErr()).toBe(true);
    if (branchless.isOk()) return;
    expect(branchless.error.code).toBe('CONFIG_ERROR');
  });

  it('refuses malformed trees fail-closed', async () => {
    for (const tree of [
      [{ path: 'a.txt', type: 'blob', sha: 42 }],
      [{ path: 'a.txt', type: 'symlink', sha: SHA_A }],
      [{ path: 'a.txt', type: 'blob', sha: SHA_A, size: 'big' }],
      [{ type: 'blob', sha: SHA_A }],
      [42],
      'not-an-array',
    ]) {
      const client = fakeClient(() => treeOk(tree));
      const result = await getRepoTree(client, 'o', 'r', { ref: SHA_A });
      expect(result.isErr()).toBe(true);
      if (result.isOk()) continue;
      expect(result.error.code).toBe('INTERNAL');
    }
  });

  it('refuses malformed bodies fail-closed', async () => {
    for (const data of [42, { sha: 'xyz', tree: [], truncated: false }]) {
      const client = fakeClient(() => ({ data, headers: {}, status: 200 }));
      const result = await getRepoTree(client, 'o', 'r', { ref: SHA_A });
      expect(result.isErr()).toBe(true);
      if (result.isOk()) continue;
      expect(result.error.code).toBe('INTERNAL');
    }
  });
});

// ─── nock end to end ───────────────────────────────────────────────────

describe('nock end to end', () => {
  it('resolves branches and fetches recursive trees through real Octokit', async () => {
    const scope = nock('https://api.github.com')
      .get('/repos/octocat/repo/commits/main')
      .reply(200, { sha: SHA_A })
      .get('/repos/octocat/repo/git/trees/' + SHA_A)
      .query({ recursive: 'true' })
      .reply(200, {
        sha: SHA_A,
        truncated: false,
        tree: [
          { path: 'src', mode: '040000', type: 'tree', sha: SHA_B },
          { path: 'src/a.ts', mode: '100644', type: 'blob', sha: SHA_A, size: 3 },
        ],
      });
    const built = createValidatedClient({ auth: { authType: 'pat', token: 'ghp_test' } });
    if (built.isErr()) throw new Error('client construction failed');
    const result = await getRepoTree(built.value, 'octocat', 'repo', { ref: 'main' });
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.flat).toEqual([
      { path: 'src', type: 'tree', sha: SHA_B },
      { path: 'src/a.ts', type: 'blob', sha: SHA_A, size: 3 },
    ]);
    expect(scope.isDone()).toBe(true);
  });

  it('maps real 404s with operation context', async () => {
    nock('https://api.github.com').get('/repos/octocat/missing/commits/main').reply(404, {
      message: 'Not Found',
    });
    const built = createValidatedClient({ auth: { authType: 'pat', token: 'ghp_test' } });
    if (built.isErr()) throw new Error('client construction failed');
    const result = await getRepoTree(built.value, 'octocat', 'missing', { ref: 'main' });
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GITHUB_API_ERROR');
    if (result.error.code !== 'GITHUB_API_ERROR') return;
    expect(result.error.message).toContain('getRepoTree');
  });
});
