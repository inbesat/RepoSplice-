// GitHub branches (P-093): remote branch lifecycle mirroring the local
// twin (P-080) — create/delete/rename via git refs, protections with
// the force-push guard carried over from P-078, and commit statuses
// feeding the merge gate (P-094). Fakes below (no network) plus nock
// proofs that the real Octokit satisfies the seam.

import { describe, it, expect, afterEach } from 'vitest';
import nock from 'nock';
import type { Result } from 'neverthrow';
import type { StitchError } from '../../result/index.js';
import { cleanupHttpMocks } from '../../../test-utils/http.js';
import { createValidatedClient } from '../auth.js';
import {
  createBranch,
  deleteBranch,
  renameBranch,
  protectBranch,
  setStatus,
  type BranchClient,
  type ProtectionRules,
} from '../branches.js';

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
  kind: 'ref' | 'commit' | 'protect' | 'status';
  args: Record<string, unknown>;
}

/** Fake client serving scripted payloads while recording calls. */
function fakeClient(handler: (call: Call) => unknown): BranchClient {
  const wrap = (kind: Call['kind']) => async (args?: Record<string, unknown>) => {
    const out = handler({ kind, args: args ?? {} });
    if (out instanceof Error) throw out;
    return out as { data: unknown; headers: unknown; status: number };
  };
  return {
    rest: {
      repos: {
        getCommit: wrap('commit'),
        updateBranchProtection: wrap('protect'),
        createCommitStatus: wrap('status'),
      },
      git: {
        createRef: wrap('ref'),
        deleteRef: wrap('ref'),
      },
    },
  };
}

function refOk(ref = 'refs/heads/feature', sha: string = SHA_A): unknown {
  return { data: { ref, object: { sha } }, headers: {}, status: 201 };
}

function commitOk(sha: string = SHA_A): unknown {
  return { data: { sha }, headers: {}, status: 200 };
}

// ─── create ────────────────────────────────────────────────────────────

describe('create', () => {
  it('creates refs from SHAs in one call', async () => {
    const calls: Call[] = [];
    const client = fakeClient(call => {
      calls.push(call);
      return refOk();
    });
    const result = await createBranch(client, 'o', 'r', 'feature', SHA_A);
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value).toEqual({ ref: 'refs/heads/feature', sha: SHA_A });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      kind: 'ref',
      args: { owner: 'o', repo: 'r', ref: 'refs/heads/feature', sha: SHA_A },
    });
  });

  it('resolves branch fromRefs through getCommit', async () => {
    const calls: Call[] = [];
    const client = fakeClient(call => {
      calls.push(call);
      if (call.kind === 'commit') return commitOk(SHA_B);
      return refOk('refs/heads/feature', SHA_B);
    });
    const result = await createBranch(client, 'o', 'r', 'feature', 'main');
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.sha).toBe(SHA_B);
    expect(calls.map(call => call.kind)).toEqual(['commit', 'ref']);
  });

  it('maps existing branches to ALREADY_EXISTS', async () => {
    const client = fakeClient(call => {
      if (call.kind === 'commit') return commitOk();
      throw reqError(422, 'Reference already exists');
    });
    const result = await createBranch(client, 'o', 'r', 'feature', SHA_A);
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GITHUB_API_ERROR');
    if (result.error.code !== 'GITHUB_API_ERROR') return;
    expect(result.error.status).toBe(422);
    expect(result.error.message).toContain('ALREADY_EXISTS');
    expect(result.error.message).toContain('feature');
  });

  it('rejects bad names and shapes at the boundary', async () => {
    const client = fakeClient(() => refOk());
    for (const name of [
      '  ',
      'has space',
      'a..b',
      'we@{ird',
      'a^b',
      'a:b',
      'a?b',
      'a*b',
      'a[b',
      'back\\slash',
      '/leading',
      'trailing/',
      'ends.lock',
    ]) {
      const result = await createBranch(client, 'o', 'r', name, SHA_A);
      expect(result.isErr()).toBe(true);
      if (result.isOk()) continue;
      expect(result.error.code).toBe('CONFIG_ERROR');
    }
    for (const pending of [
      createBranch(client, '  ', 'r', 'feature', SHA_A),
      createBranch(client, 'o', '  ', 'feature', SHA_A),
      createBranch(client, 'o', 'r', 'feature', '  '),
      createBranch(null as unknown as BranchClient, 'o', 'r', 'feature', SHA_A),
      createBranch(undefined as unknown as BranchClient, 'o', 'r', 'feature', SHA_A),
    ]) {
      const resolved = await pending;
      expect(resolved.isErr()).toBe(true);
      if (resolved.isOk()) continue;
      expect(resolved.error.code).toBe('CONFIG_ERROR');
    }
  });
});

// ─── protect ───────────────────────────────────────────────────────────

describe('protect', () => {
  const RULES: ProtectionRules = {
    requiredStatusChecks: { strict: true, contexts: ['ci/build'] },
    enforceAdmins: true,
  };

  it('sends snake_case protection payloads', async () => {
    const calls: Call[] = [];
    const client = fakeClient(call => {
      calls.push(call);
      return { data: {}, headers: {}, status: 200 };
    });
    const result = await protectBranch(client, 'o', 'r', 'main', RULES);
    expect(result.isOk()).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      kind: 'protect',
      args: {
        owner: 'o',
        repo: 'r',
        branch: 'main',
        required_status_checks: { strict: true, contexts: ['ci/build'] },
        enforce_admins: true,
        allow_force_pushes: false,
        allow_deletions: false,
        required_linear_history: false,
        required_conversation_resolution: false,
        required_pull_request_reviews: null,
        restrictions: null,
      },
    });
  });

  it('passes explicit non-force options through', async () => {
    const calls: Call[] = [];
    const client = fakeClient(call => {
      calls.push(call);
      return { data: {}, headers: {}, status: 200 };
    });
    const result = await protectBranch(
      client,
      'o',
      'r',
      'main',
      {
        requiredStatusChecks: null,
        enforceAdmins: false,
        allowDeletions: true,
        requiredLinearHistory: true,
        requiredConversationResolution: true,
      },
      {}
    );
    expect(result.isOk()).toBe(true);
    expect(calls[0]?.args).toMatchObject({
      required_status_checks: null,
      enforce_admins: false,
      allow_deletions: true,
      required_linear_history: true,
      required_conversation_resolution: true,
    });
  });

  it('maps resolved non-2xx on creation', async () => {
    for (const status of [422, 500]) {
      const client = fakeClient(() => ({ data: {}, headers: {}, status }));
      const result = await createBranch(client, 'o', 'r', 'f', SHA_A);
      expect(result.isErr()).toBe(true);
      if (result.isOk()) continue;
      expect(result.error.code).toBe('GITHUB_API_ERROR');
      if (result.error.code !== 'GITHUB_API_ERROR') continue;
      if (status === 422) {
        expect(result.error.message).toContain('ALREADY_EXISTS');
      }
    }
  });

  it('rejects poorly shaped rules blocks', async () => {
    const client = fakeClient(() => ({ data: {}, headers: {}, status: 200 }));
    for (const rules of [null, 42, 'strict'] as unknown as ProtectionRules[]) {
      const result = await protectBranch(client, 'o', 'r', 'main', rules);
      expect(result.isErr()).toBe(true);
      if (result.isOk()) continue;
      expect(result.error.code).toBe('CONFIG_ERROR');
    }
    const badFlag = await protectBranch(client, 'o', 'r', 'main', {
      allowForcePushes: 42,
    } as unknown as ProtectionRules);
    expect(badFlag.isErr()).toBe(true);
    const noClient = await protectBranch(null as unknown as BranchClient, 'o', 'r', 'main', {});
    expect(noClient.isErr()).toBe(true);
    const noOwner = await protectBranch(client, '  ', 'r', 'main', {});
    expect(noOwner.isErr()).toBe(true);
  });

  it('validates rule shapes at the boundary', async () => {
    const client = fakeClient(() => ({ data: {}, headers: {}, status: 200 }));
    for (const rules of [
      { requiredStatusChecks: { strict: 'yes', contexts: [] } },
      { requiredStatusChecks: { strict: true, contexts: ['  '] } },
      { requiredStatusChecks: { strict: true, contexts: 'ci' } },
      { requiredStatusChecks: 42 },
      { enforceAdmins: 'yes' },
      { allowDeletions: 1 },
      { requiredLinearHistory: null },
      { requiredConversationResolution: {} },
    ] as unknown as ProtectionRules[]) {
      const result = await protectBranch(client, 'o', 'r', 'main', rules);
      expect(result.isErr()).toBe(true);
      if (result.isOk()) continue;
      expect(result.error.code).toBe('CONFIG_ERROR');
    }
    const blankBranch = await protectBranch(client, 'o', 'r', '  ', RULES);
    expect(blankBranch.isErr()).toBe(true);
  });
});

// ─── status ────────────────────────────────────────────────────────────

describe('status', () => {
  it('posts commit statuses with exact argv', async () => {
    const calls: Call[] = [];
    const client = fakeClient(call => {
      calls.push(call);
      return { data: {}, headers: {}, status: 201 };
    });
    for (const state of ['error', 'failure', 'pending', 'success'] as const) {
      const result = await setStatus(client, 'o', 'r', SHA_A, {
        context: 'stitch/sandbox',
        state,
        description: 'sandbox verdict',
        targetUrl: 'https://ci.example.com/1',
      });
      expect(result.isOk()).toBe(true);
    }
    expect(calls).toHaveLength(4);
    expect(calls[0]?.args).toMatchObject({
      owner: 'o',
      repo: 'r',
      sha: SHA_A,
      state: 'error',
      context: 'stitch/sandbox',
      description: 'sandbox verdict',
      target_url: 'https://ci.example.com/1',
    });
  });

  it('rejects bad status shapes at the boundary', async () => {
    const client = fakeClient(() => ({ data: {}, headers: {}, status: 201 }));
    for (const pending of [
      setStatus(client, '  ', 'r', SHA_A, { context: 'c', state: 'success' }),
      setStatus(client, 'o', '  ', SHA_A, { context: 'c', state: 'success' }),
      setStatus(client, 'o', 'r', SHA_A, null as unknown as Parameters<typeof setStatus>[4]),
      setStatus(client, 'o', 'r', 'short', { context: 'c', state: 'success' }),
      setStatus(client, 'o', 'r', SHA_A, { context: '  ', state: 'success' }),
      setStatus(client, 'o', 'r', SHA_A, { context: 'c', state: 'unknown' as 'success' }),
      setStatus(client, 'o', 'r', SHA_A, {
        context: 'c',
        state: 'success',
        description: 42 as unknown as string,
      }),
      setStatus(client, 'o', 'r', SHA_A, {
        context: 'c',
        state: 'success',
        targetUrl: 42 as unknown as string,
      }),
      setStatus(null as unknown as BranchClient, 'o', 'r', SHA_A, {
        context: 'c',
        state: 'success',
      }),
    ]) {
      const resolved = await pending;
      expect(resolved.isErr()).toBe(true);
      if (resolved.isOk()) continue;
      expect(resolved.error.code).toBe('CONFIG_ERROR');
    }
  });
});

// ─── force push denied ─────────────────────────────────────────────────

describe('force push denied', () => {
  it('refuses force-push protection without explicit authorization', async () => {
    let calls = 0;
    const client = fakeClient(() => {
      calls += 1;
      return { data: {}, headers: {}, status: 200 };
    });
    const refused = await protectBranch(client, 'o', 'r', 'main', { allowForcePushes: true }, {});
    expect(refused.isErr()).toBe(true);
    if (refused.isOk()) return;
    expect(refused.error.code).toBe('CONFIG_ERROR');
    if (refused.error.code !== 'CONFIG_ERROR') return;
    expect(refused.error.message).toContain('allowForce');
    expect(calls).toBe(0);
    const allowed = await protectBranch(
      client,
      'o',
      'r',
      'main',
      { allowForcePushes: true },
      { allowForce: true }
    );
    expect(allowed.isOk()).toBe(true);
    expect(calls).toBe(1);
  });
});

// ─── delete + rename ───────────────────────────────────────────────────

describe('delete and rename', () => {
  it('deletes refs by short name', async () => {
    const calls: Call[] = [];
    const client = fakeClient(call => {
      calls.push(call);
      return { data: {}, headers: {}, status: 204 };
    });
    const result = await deleteBranch(client, 'o', 'r', 'feature/x');
    expect(result.isOk()).toBe(true);
    expect(calls).toEqual([
      { kind: 'ref', args: { owner: 'o', repo: 'r', ref: 'heads/feature/x' } },
    ]);
  });

  it('maps missing branches loudly', async () => {
    const client = fakeClient(() => {
      throw reqError(404, 'Not Found');
    });
    const result = await deleteBranch(client, 'o', 'r', 'ghost');
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GITHUB_API_ERROR');
  });

  it('validates delete shapes', async () => {
    const client = fakeClient(() => ({ data: {}, headers: {}, status: 204 }));
    for (const pending of [
      deleteBranch(null as unknown as BranchClient, 'o', 'r', 'f'),
      deleteBranch(client, '  ', 'r', 'f'),
      deleteBranch(client, 'o', '  ', 'f'),
      deleteBranch(client, 'o', 'r', '  '),
      deleteBranch(client, 'o', 'r', 'bad name!'),
    ]) {
      const resolved = await pending;
      expect(resolved.isErr()).toBe(true);
      if (resolved.isOk()) continue;
      expect(resolved.error.code).toBe('CONFIG_ERROR');
    }
  });

  it('renames via create plus delete in order', async () => {
    const calls: Call[] = [];
    const client = fakeClient(call => {
      calls.push(call);
      if (call.kind === 'commit') return commitOk(SHA_B);
      if (call.args['ref'] === 'refs/heads/new') return refOk('refs/heads/new', SHA_B);
      return { data: {}, headers: {}, status: 204 };
    });
    const result = await renameBranch(client, 'o', 'r', 'old', 'new');
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value).toEqual({ ref: 'refs/heads/new', sha: SHA_B });
    expect(calls.map(call => call.kind)).toEqual(['commit', 'ref', 'ref']);
  });

  it('reports which rename step failed', async () => {
    const failingCreate = fakeClient(call => {
      if (call.kind === 'commit') return commitOk();
      if (typeof call.args['ref'] === 'string' && call.args['ref'].startsWith('refs/heads/')) {
        throw reqError(422, 'Reference already exists');
      }
      return { data: {}, headers: {}, status: 204 };
    });
    const createFailed = await renameBranch(failingCreate, 'o', 'r', 'old', 'new');
    expect(createFailed.isErr()).toBe(true);
    if (createFailed.isOk()) return;
    expect(createFailed.error.code).toBe('GITHUB_API_ERROR');
    if (createFailed.error.code !== 'GITHUB_API_ERROR') return;
    expect(createFailed.error.message).toContain('create');
    const failingDelete = fakeClient(call => {
      if (call.kind === 'commit') return commitOk();
      if (typeof call.args['ref'] === 'string' && !call.args['ref'].startsWith('refs/')) {
        throw reqError(500, 'boom');
      }
      return refOk('refs/heads/new');
    });
    const deleteFailed = await renameBranch(failingDelete, 'o', 'r', 'old', 'new');
    expect(deleteFailed.isErr()).toBe(true);
    if (deleteFailed.isOk()) return;
    expect(deleteFailed.error.code).toBe('GITHUB_API_ERROR');
    if (deleteFailed.error.code !== 'GITHUB_API_ERROR') return;
    expect(deleteFailed.error.message).toContain('delete');
  });

  it('validates rename shapes', async () => {
    const c = fakeClient(() => refOk());
    for (const pending of [
      renameBranch(null as unknown as BranchClient, 'o', 'r', 'old', 'new'),
      renameBranch(c, '  ', 'r', 'old', 'new'),
      renameBranch(c, 'o', '  ', 'old', 'new'),
      renameBranch(c, 'o', 'r', '  ', 'new'),
      renameBranch(c, 'o', 'r', 'old', 'bad name!'),
      renameBranch(c, 'o', 'r', 'old', 'old'),
    ]) {
      const resolved = await pending;
      expect(resolved.isErr()).toBe(true);
      if (resolved.isOk()) continue;
      expect(resolved.error.code).toBe('CONFIG_ERROR');
    }
  });

  it('fails rename resolution before mutating', async () => {
    const client = fakeClient(() => {
      throw reqError(404, 'nope');
    });
    const result = await renameBranch(client, 'o', 'r', 'old', 'new');
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GITHUB_API_ERROR');
  });

  it('covers rename create-step failures', async () => {
    const throwing = fakeClient(call => {
      if (call.kind === 'commit') return commitOk();
      throw reqError(500, 'boom');
    });
    const thrown = await renameBranch(throwing, 'o', 'r', 'old', 'new');
    expect(thrown.isErr()).toBe(true);
    if (thrown.isOk()) return;
    expect(thrown.error.code).toBe('GITHUB_API_ERROR');
    if (thrown.error.code !== 'GITHUB_API_ERROR') return;
    expect(thrown.error.message).toContain('create');
    for (const status of [422, 500]) {
      const resolving = fakeClient(call => {
        if (call.kind === 'commit') return commitOk();
        return { data: {}, headers: {}, status };
      });
      const result = await renameBranch(resolving, 'o', 'r', 'old', 'new');
      expect(result.isErr()).toBe(true);
      if (result.isOk()) continue;
      expect(result.error.code).toBe('GITHUB_API_ERROR');
    }
    const malformed = fakeClient(call => {
      if (call.kind === 'commit') return commitOk();
      return refOk('refs/heads/new', 'short');
    });
    const bad = await renameBranch(malformed, 'o', 'r', 'old', 'new');
    expect(bad.isErr()).toBe(true);
    if (bad.isOk()) return;
    expect(bad.error.code).toBe('INTERNAL');
  });
});

// ─── errors ────────────────────────────────────────────────────────────

describe('errors', () => {
  it('maps endpoint failures with operation context', async () => {
    const cases: Array<{ status: number; call: () => Promise<Result<unknown, StitchError>> }> = [
      {
        status: 500,
        call: () =>
          createBranch(
            fakeClient(() => {
              throw reqError(500, 'boom');
            }),
            'o',
            'r',
            'f',
            SHA_A
          ),
      },
      {
        status: 404,
        call: () =>
          createBranch(
            fakeClient(call => {
              if (call.kind === 'commit') throw reqError(404, 'nope');
              return refOk();
            }),
            'o',
            'r',
            'f',
            'main'
          ),
      },
      {
        status: 403,
        call: () =>
          protectBranch(
            fakeClient(() => {
              throw reqError(403, 'denied');
            }),
            'o',
            'r',
            'main',
            {}
          ),
      },
      {
        status: 401,
        call: () =>
          setStatus(
            fakeClient(() => {
              throw reqError(401, 'denied');
            }),
            'o',
            'r',
            SHA_A,
            { context: 'c', state: 'success' }
          ),
      },
    ];
    for (const { status, call } of cases) {
      const result: Result<unknown, StitchError> = await call();
      expect(result.isErr()).toBe(true);
      if (result.isOk()) continue;
      if (status === 403 || status === 401) {
        expect(result.error.code).toBe('AUTH_ERROR');
        continue;
      }
      expect(result.error.code).toBe('GITHUB_API_ERROR');
    }
  });

  it('maps status-less throws, resolved non-2xx, and bare rejections', async () => {
    const hung = fakeClient(() => {
      throw new Error('socket hang up');
    });
    const hungResult = await createBranch(hung, 'o', 'r', 'f', SHA_A);
    expect(hungResult.isErr()).toBe(true);
    if (hungResult.isOk()) return;
    expect(hungResult.error.code).toBe('GITHUB_API_ERROR');
    const resolved = fakeClient(() => ({ data: {}, headers: {}, status: 503 }));
    const resolvedResult = await deleteBranch(resolved, 'o', 'r', 'f');
    expect(resolvedResult.isErr()).toBe(true);
    if (resolvedResult.isOk()) return;
    expect(resolvedResult.error.code).toBe('GITHUB_API_ERROR');
    const primitive: BranchClient = {
      rest: {
        repos: {
          getCommit: async () => ({ data: {}, headers: {}, status: 200 }),
          updateBranchProtection: async () => ({ data: {}, headers: {}, status: 200 }),
          createCommitStatus: async () => ({ data: {}, headers: {}, status: 200 }),
        },
        git: {
          createRef: () => Promise.reject(),
          deleteRef: async () => ({ data: {}, headers: {}, status: 200 }),
        },
      },
    };
    const prim = await createBranch(primitive, 'o', 'r', 'f', SHA_A);
    expect(prim.isErr()).toBe(true);
    if (prim.isOk()) return;
    expect(prim.error.code).toBe('GITHUB_API_ERROR');
  });

  it('refuses malformed payloads fail-closed', async () => {
    for (const data of [
      { ref: 42, object: { sha: SHA_A } },
      { ref: 'refs/heads/f', object: { sha: 'short' } },
      { ref: 'refs/heads/f', object: {} },
      { ref: 'refs/heads/f', object: 42 },
      { ref: 'refs/heads/f' },
      42,
    ]) {
      const client = fakeClient(() => ({ data, headers: {}, status: 201 }));
      const result = await createBranch(client, 'o', 'r', 'f', SHA_A);
      expect(result.isErr()).toBe(true);
      if (result.isOk()) continue;
      expect(result.error.code).toBe('INTERNAL');
    }
    const badCommit = fakeClient(call => {
      if (call.kind === 'commit') return { data: { sha: 'short' }, headers: {}, status: 200 };
      return refOk();
    });
    const badSha = await createBranch(badCommit, 'o', 'r', 'f', 'main');
    expect(badSha.isErr()).toBe(true);
    if (badSha.isOk()) return;
    expect(badSha.error.code).toBe('INTERNAL');
  });

  it('reads every rate-limit shape on branch calls', async () => {
    const shaped = async (status: number, headers: unknown, message: string) => {
      const client = fakeClient(() => {
        const error = new Error(message) as Error & { status: number; headers: unknown };
        error.status = status;
        (error as { headers: unknown }).headers = headers;
        throw error;
      });
      return deleteBranch(client, 'o', 'r', 'f');
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
    const nestedResult = await deleteBranch(nested, 'o', 'r', 'f');
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
    const nulledResult = await deleteBranch(nulled, 'o', 'r', 'f');
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
  it('creates refs and protections through real Octokit', async () => {
    const scope = nock('https://api.github.com')
      .post('/repos/o/r/git/refs', { ref: 'refs/heads/feature', sha: SHA_A })
      .reply(201, { ref: 'refs/heads/feature', object: { sha: SHA_A } })
      .put('/repos/o/r/branches/main/protection', {
        required_status_checks: { strict: true, contexts: ['ci/build'] },
        enforce_admins: true,
        allow_force_pushes: false,
        allow_deletions: false,
        required_linear_history: false,
        required_conversation_resolution: false,
        required_pull_request_reviews: null,
        restrictions: null,
      })
      .reply(200, {});
    const built = createValidatedClient({ auth: { authType: 'pat', token: 'ghp_test' } });
    if (built.isErr()) throw new Error('client construction failed');
    const created = await createBranch(built.value, 'o', 'r', 'feature', SHA_A);
    expect(created.isOk()).toBe(true);
    if (created.isErr()) return;
    expect(created.value).toEqual({ ref: 'refs/heads/feature', sha: SHA_A });
    const protected_ = await protectBranch(built.value, 'o', 'r', 'main', {
      requiredStatusChecks: { strict: true, contexts: ['ci/build'] },
      enforceAdmins: true,
    });
    expect(protected_.isOk()).toBe(true);
    expect(scope.isDone()).toBe(true);
  });

  it('maps real 404s with operation context', async () => {
    nock('https://api.github.com').delete('/repos/o/r/git/refs/heads/ghost').reply(404, {
      message: 'Not Found',
    });
    const built = createValidatedClient({ auth: { authType: 'pat', token: 'ghp_test' } });
    if (built.isErr()) throw new Error('client construction failed');
    const result = await deleteBranch(built.value, 'o', 'r', 'ghost');
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GITHUB_API_ERROR');
    if (result.error.code !== 'GITHUB_API_ERROR') return;
    expect(result.error.message).toContain('deleteBranch');
  });
});
