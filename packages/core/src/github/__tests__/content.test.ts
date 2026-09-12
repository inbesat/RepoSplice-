// GitHub file content (P-091): single and bounded-batch blob fetch with
// base64 decode, binary flagging, SHA-keyed caching, and opt-in
// truncation — over injected fakes (no network) plus nock proofs that
// the real Octokit satisfies the seam.

import { describe, it, expect, afterEach } from 'vitest';
import nock from 'nock';
import { cleanupHttpMocks } from '../../../test-utils/http.js';
import { createValidatedClient } from '../auth.js';
import { createRefCache } from '../../git/perf.js';
import {
  getFileContent,
  getFileContentsBatch,
  type ContentClient,
  type BlobContent,
} from '../content.js';

afterEach(() => {
  cleanupHttpMocks();
});

const SHA_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const SHA_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const BLOB_SHA = 'cccccccccccccccccccccccccccccccccccccccc';

function b64(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64');
}

function fileOk(overrides: Record<string, unknown> = {}): unknown {
  return {
    data: {
      type: 'file',
      path: 'a.txt',
      sha: BLOB_SHA,
      size: 11,
      content: b64('hello world'),
      encoding: 'base64',
      ...overrides,
    },
    headers: {},
    status: 200,
  };
}

function commitOk(sha: string = SHA_A): unknown {
  return { data: { sha }, headers: {}, status: 200 };
}

function reqError(status: number, message: string): Error {
  const error = new Error(message) as Error & { status: number };
  error.status = status;
  return error;
}

interface Call {
  kind: 'content' | 'commit' | 'repo';
  args: Record<string, unknown>;
}

/** Fake client serving scripted payloads while recording calls. */
function fakeClient(handler: (call: Call) => unknown): ContentClient {
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
        getContent: wrap('content'),
      },
    },
  };
}

// ─── single ────────────────────────────────────────────────────────────

describe('single', () => {
  it('decodes base64 blobs with metadata', async () => {
    const calls: Call[] = [];
    const client = fakeClient(call => {
      calls.push(call);
      return fileOk();
    });
    const result = await getFileContent(client, 'o', 'r', 'a.txt', { ref: SHA_A });
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value).toEqual({
      path: 'a.txt',
      sha: BLOB_SHA,
      size: 11,
      encoding: 'utf-8',
      content: 'hello world',
      binary: false,
      truncated: false,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      kind: 'content',
      args: { owner: 'o', repo: 'r', path: 'a.txt', ref: SHA_A },
    });
  });

  it('resolves branch refs once per call', async () => {
    const calls: Call[] = [];
    const client = fakeClient(call => {
      calls.push(call);
      if (call.kind === 'commit') return commitOk(SHA_B);
      return fileOk();
    });
    const result = await getFileContent(client, 'o', 'r', 'a.txt', { ref: 'main' });
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(calls.map(call => call.kind)).toEqual(['commit', 'content']);
    expect(calls[1]?.args).toMatchObject({ ref: SHA_B });
  });

  it('falls back to the default branch, refusing empty repos', async () => {
    const calls: Call[] = [];
    const client = fakeClient(call => {
      calls.push(call);
      if (call.kind === 'repo') {
        return { data: { default_branch: 'develop' }, headers: {}, status: 200 };
      }
      if (call.kind === 'commit') return commitOk();
      return fileOk();
    });
    const result = await getFileContent(client, 'o', 'r', 'a.txt', {});
    expect(result.isOk()).toBe(true);
    expect(calls.map(call => call.kind)).toEqual(['repo', 'commit', 'content']);
    const empty = fakeClient(call =>
      call.kind === 'repo' ? { data: { default_branch: null }, headers: {}, status: 200 } : fileOk()
    );
    const emptyResult = await getFileContent(empty, 'o', 'r', 'a.txt', {});
    expect(emptyResult.isErr()).toBe(true);
    if (emptyResult.isOk()) return;
    expect(emptyResult.error.code).toBe('CONFIG_ERROR');
  });

  it('rejects non-file paths with guidance', async () => {
    for (const [kind, data] of [
      ['dir', [{ path: 'a.txt' }]],
      ['symlink', { type: 'symlink', target: 'b.txt' }],
      ['submodule', { type: 'submodule', sha: SHA_A }],
      ['unexpected type', { type: 'weird', sha: SHA_A }],
      ['unexpected type', { sha: SHA_A }],
    ] as const) {
      const client = fakeClient(() => ({ data, headers: {}, status: 200 }));
      const result = await getFileContent(client, 'o', 'r', 'a.txt', { ref: SHA_A });
      expect(result.isErr()).toBe(true);
      if (result.isOk()) continue;
      expect(result.error.code).toBe('CONFIG_ERROR');
      if (result.error.code !== 'CONFIG_ERROR') continue;
      expect(result.error.message).toContain(kind === 'dir' ? 'directory' : kind);
    }
  });

  it('errors cleanly when GitHub withholds content', async () => {
    for (const content of [undefined, null]) {
      const client = fakeClient(() => fileOk({ content, encoding: 'none', size: 2_000_000 }));
      const result = await getFileContent(client, 'o', 'r', 'big.bin', { ref: SHA_A });
      expect(result.isErr()).toBe(true);
      if (result.isOk()) continue;
      expect(result.error.code).toBe('GITHUB_API_ERROR');
      if (result.error.code !== 'GITHUB_API_ERROR') continue;
      expect(result.error.message).toContain('blob');
    }
  });

  it('refuses malformed blobs fail-closed', async () => {
    for (const data of [
      { type: 'file', path: 'a.txt', sha: 42, size: 1, content: b64('x'), encoding: 'base64' },
      { type: 'file', path: 'a.txt', sha: 'zzz', size: 1, content: b64('x'), encoding: 'base64' },
      {
        type: 'file',
        path: 'a.txt',
        sha: BLOB_SHA,
        size: 'big',
        content: b64('x'),
        encoding: 'base64',
      },
      {
        type: 'file',
        path: 'a.txt',
        sha: BLOB_SHA,
        size: 1.5,
        content: b64('x'),
        encoding: 'base64',
      },
      {
        type: 'file',
        path: 'a.txt',
        sha: BLOB_SHA,
        size: -1,
        content: b64('x'),
        encoding: 'base64',
      },
      { type: 'file', path: 'a.txt', sha: BLOB_SHA, size: 1, content: b64('x'), encoding: 'rot13' },
      { type: 'file', path: 'a.txt', sha: BLOB_SHA, size: 1, content: 42, encoding: 'base64' },
      42,
    ]) {
      const client = fakeClient(() => ({ data, headers: {}, status: 200 }));
      const result = await getFileContent(client, 'o', 'r', 'a.txt', { ref: SHA_A });
      expect(result.isErr()).toBe(true);
      if (result.isOk()) continue;
      expect(result.error.code).toBe('INTERNAL');
    }
  });

  it('validates entry shapes at the boundary', async () => {
    const client = fakeClient(() => fileOk());
    for (const pending of [
      getFileContent(client, '  ', 'r', 'a.txt', { ref: SHA_A }),
      getFileContent(client, 'o', '  ', 'a.txt', { ref: SHA_A }),
      getFileContent(client, 'o', 'r', '  ', { ref: SHA_A }),
      getFileContent(client, 'o', 'r', 'a.txt', { ref: '  ' }),
      getFileContent(client, 'o', 'r', 'a.txt', { maxBytes: 0 }),
      getFileContent(client, 'o', 'r', 'a.txt', { binaryExts: 'x' as unknown as string[] }),
      getFileContent(client, 'o', 'r', 'a.txt', { binaryExts: [42] as unknown as string[] }),
      getFileContent(client, 'o', 'r', 'a.txt', {
        ref: SHA_A,
        cache: null as unknown as ReturnType<typeof createRefCache<BlobContent>>,
      }),
      getFileContent(null as unknown as ContentClient, 'o', 'r', 'a.txt', { ref: SHA_A }),
      getFileContent(undefined as unknown as ContentClient, 'o', 'r', 'a.txt', { ref: SHA_A }),
    ]) {
      const resolved = await pending;
      expect(resolved.isErr()).toBe(true);
      if (resolved.isOk()) continue;
      expect(resolved.error.code).toBe('CONFIG_ERROR');
    }
  });
});

// ─── batch ─────────────────────────────────────────────────────────────

describe('batch', () => {
  it('fetches bounded-parallel with input-ordered maps', async () => {
    let inFlight = 0;
    let peak = 0;
    const seen: string[] = [];
    const client = fakeClient(call => {
      if (call.kind !== 'content') return commitOk();
      const path = String(call.args['path']);
      seen.push(path);
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      return new Promise(resolve => {
        setTimeout(
          () => {
            inFlight -= 1;
            resolve(fileOk({ path, content: b64(`content of ${path}`), size: path.length }));
          },
          path === 'slow.txt' ? 20 : 0
        );
      });
    });
    const result = await getFileContentsBatch(
      client,
      { owner: 'o', repo: 'r', ref: SHA_A, paths: ['slow.txt', 'a.txt', 'b.txt'] },
      { concurrency: 2 }
    );
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(peak).toBeLessThanOrEqual(2);
    expect([...result.value.keys()]).toEqual(['slow.txt', 'a.txt', 'b.txt']);
    expect(result.value.get('a.txt')?.content).toBe('content of a.txt');
    expect(seen).toHaveLength(3);
  });

  it('fails deterministically on the first input-ordered error', async () => {
    const client = fakeClient(call => {
      if (call.kind !== 'content') return commitOk();
      if (call.args['path'] === 'bad.txt') throw reqError(404, 'not found');
      return fileOk({ path: String(call.args['path']) });
    });
    const result = await getFileContentsBatch(
      client,
      { owner: 'o', repo: 'r', ref: SHA_A, paths: ['good.txt', 'bad.txt'] },
      {}
    );
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GITHUB_API_ERROR');
  });

  it('resolves the ref once per batch, not per path', async () => {
    const kinds: Call['kind'][] = [];
    const client = fakeClient(call => {
      kinds.push(call.kind);
      if (call.kind === 'commit') return commitOk(SHA_B);
      return fileOk({ path: String(call.args['path']) });
    });
    const result = await getFileContentsBatch(
      client,
      { owner: 'o', repo: 'r', ref: 'main', paths: ['a.txt', 'b.txt'] },
      {}
    );
    expect(result.isOk()).toBe(true);
    expect(kinds.filter(kind => kind === 'commit')).toHaveLength(1);
    expect(kinds.filter(kind => kind === 'content')).toHaveLength(2);
  });

  it('rejects batch misuse before spawning', async () => {
    const client = fakeClient(() => fileOk());
    const cases: Array<{ spec: unknown; opts: Record<string, unknown> }> = [
      { spec: { owner: 'o', repo: 'r', ref: SHA_A, paths: [] }, opts: {} },
      { spec: { owner: 'o', repo: 'r', ref: SHA_A, paths: 'x' }, opts: {} },
      { spec: { owner: 'o', repo: 'r', ref: SHA_A, paths: ['  '] }, opts: {} },
      { spec: { owner: 'o', repo: 'r', ref: SHA_A, paths: [42] }, opts: {} },
      { spec: { owner: '  ', repo: 'r', ref: SHA_A, paths: ['a.txt'] }, opts: {} },
      { spec: { owner: 'o', repo: '  ', ref: SHA_A, paths: ['a.txt'] }, opts: {} },
      { spec: { owner: 'o', repo: 'r', ref: SHA_A, paths: ['a.txt'] }, opts: { concurrency: 0 } },
      { spec: { owner: 'o', repo: 'r', ref: '  ', paths: ['a.txt'] }, opts: {} },
      { spec: { owner: 'o', repo: 'r', ref: SHA_A, paths: ['a.txt'] }, opts: { maxBytes: 0 } },
      { spec: 'x', opts: {} },
      { spec: null, opts: {} },
    ];
    for (const { spec, opts } of cases) {
      const result = await getFileContentsBatch(
        client,
        spec as unknown as Parameters<typeof getFileContentsBatch>[1],
        opts
      );
      expect(result.isErr()).toBe(true);
      if (result.isOk()) continue;
      expect(result.error.code).toBe('CONFIG_ERROR');
    }
    const missing = await getFileContentsBatch(null as unknown as ContentClient, {
      owner: 'o',
      repo: 'r',
      ref: SHA_A,
      paths: ['a.txt'],
    });
    expect(missing.isErr()).toBe(true);
  });

  it('fails batches on unresolvable refs', async () => {
    const failing = fakeClient(() => {
      throw reqError(404, 'not found');
    });
    const result = await getFileContentsBatch(
      failing,
      { owner: 'o', repo: 'r', ref: 'main', paths: ['a.txt'] },
      {}
    );
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GITHUB_API_ERROR');
  });

  it('resolves default branches once per batch', async () => {
    const kinds: Call['kind'][] = [];
    const client = fakeClient(call => {
      kinds.push(call.kind);
      if (call.kind === 'repo') {
        return { data: { default_branch: 'main' }, headers: {}, status: 200 };
      }
      if (call.kind === 'commit') return commitOk(SHA_B);
      return fileOk({ path: String(call.args['path']) });
    });
    const result = await getFileContentsBatch(
      client,
      { owner: 'o', repo: 'r', paths: ['a.txt', 'b.txt'] },
      {}
    );
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.size).toBe(2);
    expect(kinds.filter(kind => kind === 'repo')).toHaveLength(1);
    expect(kinds.filter(kind => kind === 'commit')).toHaveLength(1);
    expect(kinds.filter(kind => kind === 'content')).toHaveLength(2);
  });

  it('surfaces cached fetch failures deterministically', async () => {
    const client = fakeClient(call => {
      if (call.kind !== 'content') return commitOk();
      if (call.args['path'] === 'bad.txt') throw reqError(404, 'not found');
      return fileOk({ path: String(call.args['path']) });
    });
    const cache = createRefCache<BlobContent>();
    const spec = { owner: 'o', repo: 'r', ref: SHA_A, paths: ['good.txt', 'bad.txt'] } as const;
    const result = await getFileContentsBatch(client, spec, { cache });
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GITHUB_API_ERROR');
  });
});

// ─── binary skip ───────────────────────────────────────────────────────

describe('binary skip', () => {
  const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.from('rest')]);

  it('flags NUL-bearing blobs without shipping bytes', async () => {
    const payload = Buffer.concat([Buffer.from('ab'), Buffer.from([0]), Buffer.from('cd')]);
    const client = fakeClient(() =>
      fileOk({ path: 'img.dat', content: payload.toString('base64'), size: payload.length })
    );
    const result = await getFileContent(client, 'o', 'r', 'img.dat', { ref: SHA_A });
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.binary).toBe(true);
    expect(result.value.content).toBe('');
    expect(result.value.truncated).toBe(false);
  });

  it('flags known binary extensions pre-sniff', async () => {
    const client = fakeClient(() => fileOk({ path: 'img.png', content: b64('text-not-nul') }));
    const result = await getFileContent(client, 'o', 'r', 'img.png', {
      ref: SHA_A,
      binaryExts: ['.png'],
    });
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.binary).toBe(true);
    const text = await getFileContent(client, 'o', 'r', 'doc.txt', {
      ref: SHA_A,
      binaryExts: ['.png'],
    });
    expect(text.isOk() && text.value.binary).toBe(false);
  });

  it('keeps binary flags through batches', async () => {
    const client = fakeClient(call => {
      if (call.kind !== 'content') return commitOk();
      const path = String(call.args['path']);
      if (path.endsWith('.bin')) {
        return fileOk({ path, content: PNG.toString('base64'), size: PNG.length });
      }
      return fileOk({ path, content: b64('text') });
    });
    const result = await getFileContentsBatch(
      client,
      { owner: 'o', repo: 'r', ref: SHA_A, paths: ['a.bin', 'b.txt'] },
      { binaryExts: ['.bin'] }
    );
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.get('a.bin')).toMatchObject({ binary: true, content: '' });
    expect(result.value.get('b.txt')).toMatchObject({ binary: false, content: 'text' });
  });
});

// ─── cache ─────────────────────────────────────────────────────────────

describe('cache', () => {
  it('serves repeats without refetching', async () => {
    let fetches = 0;
    const client = fakeClient(call => {
      if (call.kind === 'content') fetches += 1;
      return fileOk();
    });
    const cache = createRefCache<BlobContent>();
    const opts = { ref: SHA_A, cache } as const;
    const first = await getFileContent(client, 'o', 'r', 'a.txt', opts);
    expect(first.isOk()).toBe(true);
    const second = await getFileContent(client, 'o', 'r', 'a.txt', opts);
    expect(second.isOk()).toBe(true);
    expect(fetches).toBe(1);
    if (first.isErr() || second.isErr()) return;
    expect(second.value).toEqual(first.value);
  });

  it('keys entries by path under one sha', async () => {
    const seen: string[] = [];
    const client = fakeClient(call => {
      if (call.kind !== 'content') return commitOk();
      const path = String(call.args['path']);
      seen.push(path);
      return fileOk({ path, content: b64(`c:${path}`) });
    });
    const cache = createRefCache<BlobContent>();
    const batch = { owner: 'o', repo: 'r', ref: SHA_A, paths: ['a.txt', 'b.txt'] } as const;
    const first = await getFileContentsBatch(client, batch, { cache });
    expect(first.isOk()).toBe(true);
    const second = await getFileContentsBatch(client, batch, { cache });
    expect(second.isOk()).toBe(true);
    expect(seen).toHaveLength(2);
    if (second.isErr()) return;
    expect(second.value.get('b.txt')?.content).toBe('c:b.txt');
  });

  it('never caches failures', async () => {
    let calls = 0;
    const client = fakeClient(() => {
      calls += 1;
      if (calls === 1) throw reqError(500, 'boom');
      return fileOk();
    });
    const cache = createRefCache<BlobContent>();
    const failed = await getFileContent(client, 'o', 'r', 'a.txt', { ref: SHA_A, cache });
    expect(failed.isErr()).toBe(true);
    const retried = await getFileContent(client, 'o', 'r', 'a.txt', { ref: SHA_A, cache });
    expect(retried.isOk()).toBe(true);
    expect(calls).toBe(2);
  });
});

// ─── throttle ──────────────────────────────────────────────────────────

describe('throttle', () => {
  it('caps in-flight batch work', async () => {
    let inFlight = 0;
    let peak = 0;
    const client = fakeClient(call => {
      if (call.kind !== 'content') return commitOk();
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      return new Promise(resolve => {
        setTimeout(() => {
          inFlight -= 1;
          resolve(fileOk({ path: String(call.args['path']) }));
        }, 10);
      });
    });
    const result = await getFileContentsBatch(
      client,
      { owner: 'o', repo: 'r', ref: SHA_A, paths: ['a.txt', 'b.txt', 'c.txt', 'd.txt'] },
      { concurrency: 2 }
    );
    expect(result.isOk()).toBe(true);
    expect(peak).toBeLessThanOrEqual(2);
    expect(peak).toBeGreaterThan(1);
  });

  it('truncates oversized blobs per maxBytes', async () => {
    const big = 'x'.repeat(100);
    const client = fakeClient(() => fileOk({ content: b64(big), size: big.length }));
    const result = await getFileContent(client, 'o', 'r', 'big.txt', { ref: SHA_A, maxBytes: 10 });
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.content).toBe('x'.repeat(10));
    expect(result.value.truncated).toBe(true);
    expect(result.value.size).toBe(big.length);
    const roomy = await getFileContent(client, 'o', 'r', 'big.txt', { ref: SHA_A, maxBytes: 100 });
    expect(roomy.isOk() && roomy.value.truncated).toBe(false);
  });

  it('maps rate limits with retry guidance', async () => {
    const limited = fakeClient(() => {
      const error = new Error('API rate limit exceeded') as Error & {
        status: number;
        response: { headers: Record<string, string> };
      };
      error.status = 403;
      error.response = { headers: { 'x-ratelimit-remaining': '0', 'retry-after': '60' } };
      throw error;
    });
    const result = await getFileContent(limited, 'o', 'r', 'a.txt', { ref: SHA_A });
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GITHUB_API_ERROR');
    if (result.error.code !== 'GITHUB_API_ERROR') return;
    expect(result.error.message).toContain('retry after 60s');
    const nulled = fakeClient(() => {
      const error = new Error('API rate limit exceeded') as Error & {
        status: number;
        response: null;
      };
      error.status = 429;
      error.response = null;
      throw error;
    });
    const nulledResult = await getFileContent(nulled, 'o', 'r', 'a.txt', { ref: SHA_A });
    expect(nulledResult.isErr()).toBe(true);
    if (nulledResult.isOk()) return;
    expect(nulledResult.error.code).toBe('GITHUB_API_ERROR');
    if (nulledResult.error.code !== 'GITHUB_API_ERROR') return;
    expect(nulledResult.error.message).toContain('retry delay unknown');
  });

  it('reads every rate-limit shape on blob calls', async () => {
    const shaped = async (status: number, headers: unknown, message: string) => {
      const client = fakeClient(() => {
        const error = new Error(message) as Error & { status: number; headers: unknown };
        error.status = status;
        (error as { headers: unknown }).headers = headers;
        throw error;
      });
      return getFileContent(client, 'o', 'r', 'a.txt', { ref: SHA_A });
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
    const bare = await shaped(429, undefined, 'API rate limit exceeded');
    expect(bare.isErr()).toBe(true);
    if (bare.isOk()) return;
    expect(bare.error.code).toBe('GITHUB_API_ERROR');
    const forbidden = await shaped(403, { 'x-ratelimit-remaining': '5' }, 'Forbidden');
    expect(forbidden.isErr()).toBe(true);
    if (forbidden.isOk()) return;
    expect(forbidden.error.code).toBe('AUTH_ERROR');
    if (forbidden.error.code !== 'AUTH_ERROR') return;
    expect(forbidden.error.message).toContain('stitch login');
  });

  it('maps auth and transport failures', async () => {
    const cases = [
      { status: 401, ref: SHA_A },
      { status: 404, ref: 'main' },
      { status: 500, ref: SHA_A },
    ] as const;
    for (const { status, ref } of cases) {
      const failing = fakeClient(call => {
        if (call.kind === 'commit' && ref !== SHA_A) return commitOk();
        throw reqError(status, `call failed ${status}`);
      });
      const result = await getFileContent(failing, 'o', 'r', 'a.txt', { ref });
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
    const hungResult = await getFileContent(hung, 'o', 'r', 'a.txt', { ref: SHA_A });
    expect(hungResult.isErr()).toBe(true);
    if (hungResult.isOk()) return;
    expect(hungResult.error.code).toBe('GITHUB_API_ERROR');
  });

  it('maps resolved non-2xx and bare rejections', async () => {
    const resolved = fakeClient(() => ({ data: {}, headers: {}, status: 503 }));
    const resolvedResult = await getFileContent(resolved, 'o', 'r', 'a.txt', { ref: SHA_A });
    expect(resolvedResult.isErr()).toBe(true);
    if (resolvedResult.isOk()) return;
    expect(resolvedResult.error.code).toBe('GITHUB_API_ERROR');
    const primitive: ContentClient = {
      rest: {
        repos: {
          get: async () => ({ data: {}, headers: {}, status: 200 }),
          getCommit: () => Promise.reject(),
          getContent: async () => ({ data: {}, headers: {}, status: 200 }),
        },
      },
    };
    const prim = await getFileContent(primitive, 'o', 'r', 'a.txt', { ref: 'branchless' });
    expect(prim.isErr()).toBe(true);
    if (prim.isOk()) return;
    expect(prim.error.code).toBe('GITHUB_API_ERROR');
  });

  it('refuses failed and malformed resolutions', async () => {
    const repoFail = fakeClient(() => {
      throw reqError(500, 'boom');
    });
    const failed = await getFileContent(repoFail, 'o', 'r', 'a.txt', {});
    expect(failed.isErr()).toBe(true);
    if (failed.isOk()) return;
    expect(failed.error.code).toBe('GITHUB_API_ERROR');
    for (const sha of ['short', 42]) {
      const malformed = fakeClient(call => {
        if (call.kind === 'commit') return commitOk(sha as string);
        return fileOk();
      });
      const result = await getFileContent(malformed, 'o', 'r', 'a.txt', { ref: 'main' });
      expect(result.isErr()).toBe(true);
      if (result.isOk()) continue;
      expect(result.error.code).toBe('INTERNAL');
    }
  });
});

// ─── nock end to end ───────────────────────────────────────────────────

describe('nock end to end', () => {
  it('fetches real blobs through real Octokit', async () => {
    const scope = nock('https://api.github.com')
      .get('/repos/octocat/repo/contents/a.txt')
      .query({ ref: SHA_A })
      .reply(200, {
        type: 'file',
        path: 'a.txt',
        sha: BLOB_SHA,
        size: 11,
        content: b64('hello world'),
        encoding: 'base64',
      });
    const built = createValidatedClient({ auth: { authType: 'pat', token: 'ghp_test' } });
    if (built.isErr()) throw new Error('client construction failed');
    const result = await getFileContent(built.value, 'octocat', 'repo', 'a.txt', { ref: SHA_A });
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.content).toBe('hello world');
    expect(scope.isDone()).toBe(true);
  });

  it('resolves branch refs over the wire', async () => {
    const scope = nock('https://api.github.com')
      .get('/repos/octocat/repo/commits/main')
      .reply(200, { sha: SHA_B })
      .get('/repos/octocat/repo/contents/a.txt')
      .query({ ref: SHA_B })
      .reply(200, {
        type: 'file',
        path: 'a.txt',
        sha: BLOB_SHA,
        size: 11,
        content: b64('hello world'),
        encoding: 'base64',
      });
    const built = createValidatedClient({ auth: { authType: 'pat', token: 'ghp_test' } });
    if (built.isErr()) throw new Error('client construction failed');
    const result = await getFileContent(built.value, 'octocat', 'repo', 'a.txt', { ref: 'main' });
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.sha).toBe(BLOB_SHA);
    expect(scope.isDone()).toBe(true);
  });
});
