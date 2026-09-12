// GitHub create-repo (P-092): child-repo creation with availability
// pre-checks, org/user variants, and idempotent resume — over injected
// fakes (no network) plus nock proofs that the real Octokit satisfies
// the seam.

import { describe, it, expect, afterEach } from 'vitest';
import nock from 'nock';
import { cleanupHttpMocks } from '../../../test-utils/http.js';
import { createValidatedClient } from '../auth.js';
import { createRepoC, type CreateClient, type CreatedRepo } from '../create.js';

afterEach(() => {
  cleanupHttpMocks();
});

const CREATED = {
  full_name: 'octocat/child',
  ssh_url: 'git@github.com:octocat/child.git',
  html_url: 'https://github.com/octocat/child',
  default_branch: 'main',
};

function reqError(status: number, message: string): Error {
  const error = new Error(message) as Error & { status: number };
  error.status = status;
  return error;
}

interface Call {
  kind: 'me' | 'get' | 'createUser' | 'createOrg';
  args: Record<string, unknown>;
}

function meOk(): unknown {
  return { data: { login: 'octocat', id: 1, type: 'User' }, headers: {}, status: 200 };
}

/** Fake client serving scripted payloads while recording calls. */
function fakeClient(handler: (call: Call) => unknown): CreateClient {
  const wrap =
    (kind: Call['kind']) =>
    async (
      args?: Record<string, unknown>
    ): Promise<{
      data: unknown;
      headers: unknown;
      status: number;
    }> => {
      const out = handler({ kind, args: args ?? {} });
      if (out instanceof Error) throw out;
      return out as { data: unknown; headers: unknown; status: number };
    };
  return {
    rest: {
      repos: {
        get: wrap('get'),
        createForAuthenticatedUser: wrap('createUser'),
        createInOrg: wrap('createOrg'),
      },
      users: {
        getAuthenticated: wrap('me'),
      },
    },
  };
}

function createdOk(overrides: Record<string, unknown> = {}): unknown {
  return { data: { ...CREATED, ...overrides }, headers: {}, status: 201 };
}

function gottenOk(overrides: Record<string, unknown> = {}): unknown {
  return { data: { ...CREATED, ...overrides }, headers: {}, status: 200 };
}

function notFound(): Error {
  return reqError(404, 'Not Found');
}

// ─── creates ───────────────────────────────────────────────────────────

describe('creates', () => {
  it('creates user repos with safe defaults', async () => {
    const calls: Call[] = [];
    const client = fakeClient(call => {
      calls.push(call);
      if (call.kind === 'me') return meOk();
      if (call.kind === 'get') throw notFound();
      return createdOk();
    });
    const result = await createRepoC(client, { name: 'child' });
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value).toEqual({
      fullName: 'octocat/child',
      sshUrl: 'git@github.com:octocat/child.git',
      htmlUrl: 'https://github.com/octocat/child',
      defaultBranch: 'main',
    });
    expect(calls.map(call => call.kind)).toEqual(['me', 'get', 'createUser']);
    expect(calls[2]?.args).toMatchObject({ name: 'child', private: true });
  });

  it('passes description and license templates through', async () => {
    const calls: Call[] = [];
    const client = fakeClient(call => {
      calls.push(call);
      if (call.kind === 'me') return meOk();
      if (call.kind === 'get') throw notFound();
      return createdOk();
    });
    const result = await createRepoC(client, {
      name: 'child',
      description: 'stitched child',
      licenseTemplate: 'mit',
      private: false,
    });
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(calls[2]?.args).toMatchObject({
      description: 'stitched child',
      license_template: 'mit',
      private: false,
    });
  });

  it('validates names and option shapes at the boundary', async () => {
    const client = fakeClient(() => createdOk());
    for (const opts of [
      { name: '  ' },
      { name: 'bad name!' },
      { name: 'x'.repeat(101) },
      { name: 'child', owner: '  ' },
      { name: 'child', private: 'yes' },
      { name: 'child', createIfMissing: 1 },
      { name: 'child', description: 42 },
      { name: 'child', licenseTemplate: 42 },
    ]) {
      const result = await createRepoC(
        client,
        opts as unknown as Parameters<typeof createRepoC>[1]
      );
      expect(result.isErr()).toBe(true);
      if (result.isOk()) continue;
      expect(result.error.code).toBe('CONFIG_ERROR');
    }
    for (const badClient of [null, undefined] as unknown as CreateClient[]) {
      const result = await createRepoC(badClient, { name: 'child' });
      expect(result.isErr()).toBe(true);
      if (result.isOk()) continue;
      expect(result.error.code).toBe('CONFIG_ERROR');
    }
    for (const badSpec of [null, 'x'] as unknown as Parameters<typeof createRepoC>[1][]) {
      const result = await createRepoC(client, badSpec);
      expect(result.isErr()).toBe(true);
      if (result.isOk()) continue;
      expect(result.error.code).toBe('CONFIG_ERROR');
    }
  });
});

// ─── exists errors ─────────────────────────────────────────────────────

describe('exists errors', () => {
  it('refuses existing names without the resume flag', async () => {
    const calls: Call[] = [];
    const client = fakeClient(call => {
      calls.push(call);
      if (call.kind === 'me') return meOk();
      if (call.kind === 'get') return gottenOk();
      throw new Error('create must not fire');
    });
    const result = await createRepoC(client, { name: 'child' });
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GITHUB_API_ERROR');
    if (result.error.code !== 'GITHUB_API_ERROR') return;
    expect(result.error.status).toBe(422);
    expect(result.error.message).toContain('ALREADY_EXISTS');
    expect(result.error.message).toContain('octocat/child');
    expect(calls.map(call => call.kind)).toEqual(['me', 'get']);
  });

  it('maps server-side 422 races to the same shape', async () => {
    const client = fakeClient(call => {
      if (call.kind === 'me') return meOk();
      if (call.kind === 'get') throw notFound();
      const error = reqError(422, 'name already exists on this account');
      throw error;
    });
    const result = await createRepoC(client, { name: 'child' });
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GITHUB_API_ERROR');
    if (result.error.code !== 'GITHUB_API_ERROR') return;
    expect(result.error.status).toBe(422);
    expect(result.error.message).toContain('ALREADY_EXISTS');
  });

  it('resumes existing repos under the flag without creating', async () => {
    const calls: Call[] = [];
    const client = fakeClient(call => {
      calls.push(call);
      if (call.kind === 'me') return meOk();
      if (call.kind === 'get') return gottenOk({ default_branch: 'develop' });
      throw new Error('create must not fire');
    });
    const result = await createRepoC(client, { name: 'child', createIfMissing: true });
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value).toMatchObject({
      fullName: 'octocat/child',
      defaultBranch: 'develop',
    });
    expect(calls.map(call => call.kind)).toEqual(['me', 'get']);
  });

  it('fails closed when availability cannot be verified', async () => {
    const client = fakeClient(call => {
      if (call.kind === 'me') return meOk();
      throw reqError(500, 'boom');
    });
    const result = await createRepoC(client, { name: 'child' });
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GITHUB_API_ERROR');
  });

  it('refuses failed and malformed identity resolutions', async () => {
    const failing = fakeClient(call => {
      if (call.kind === 'me') throw reqError(500, 'boom');
      return gottenOk();
    });
    const failed = await createRepoC(failing, { name: 'child' });
    expect(failed.isErr()).toBe(true);
    if (failed.isOk()) return;
    expect(failed.error.code).toBe('GITHUB_API_ERROR');
    const malformed = fakeClient(call => {
      if (call.kind === 'me') return { data: {}, headers: {}, status: 200 };
      return gottenOk();
    });
    const bad = await createRepoC(malformed, { name: 'child' });
    expect(bad.isErr()).toBe(true);
    if (bad.isOk()) return;
    expect(bad.error.code).toBe('INTERNAL');
  });

  it('refuses malformed payloads fail-closed', async () => {
    for (const data of [
      { full_name: 42, ssh_url: 's', html_url: 'h', default_branch: 'main' },
      { full_name: 'o/c', html_url: 'h', default_branch: 'main' },
      { full_name: 'o/c', ssh_url: 's', default_branch: 'main' },
      { ssh_url: 's', html_url: 'h' },
      42,
    ]) {
      const client = fakeClient(call => {
        if (call.kind === 'me') return meOk();
        if (call.kind === 'get') throw notFound();
        return { data, headers: {}, status: 201 };
      });
      const result = await createRepoC(client, { name: 'child' });
      expect(result.isErr()).toBe(true);
      if (result.isOk()) continue;
      expect(result.error.code).toBe('INTERNAL');
    }
    // Non-string default branches coerce to null (informational, not
    // identity) rather than failing the whole creation.
    const coerced = fakeClient(call => {
      if (call.kind === 'me') return meOk();
      if (call.kind === 'get') throw notFound();
      return {
        data: { full_name: 'o/c', ssh_url: 's', html_url: 'h', default_branch: 42 },
        headers: {},
        status: 201,
      };
    });
    const coercedResult = await createRepoC(coerced, { name: 'child' });
    expect(coercedResult.isOk()).toBe(true);
    if (coercedResult.isOk()) {
      expect(coercedResult.value.defaultBranch).toBeNull();
    }
  });
});

// ─── org ───────────────────────────────────────────────────────────────

describe('org', () => {
  it('creates in orgs through the org variant', async () => {
    const calls: Call[] = [];
    const client = fakeClient(call => {
      calls.push(call);
      if (call.kind === 'me') return meOk();
      if (call.kind === 'get') throw notFound();
      return createdOk({ full_name: 'acme/child' });
    });
    const result = await createRepoC(client, {
      owner: 'acme',
      name: 'child',
      description: 'org child',
      licenseTemplate: 'apache-2.0',
    });
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.fullName).toBe('acme/child');
    expect(calls.map(call => call.kind)).toEqual(['get', 'createOrg']);
    expect(calls[1]?.args).toMatchObject({
      org: 'acme',
      name: 'child',
      description: 'org child',
      license_template: 'apache-2.0',
    });
  });

  it('creates plain org repos without optionals', async () => {
    const calls: Call[] = [];
    const client = fakeClient(call => {
      calls.push(call);
      if (call.kind === 'me') return meOk();
      if (call.kind === 'get') throw notFound();
      return createdOk({ full_name: 'acme/plain' });
    });
    const result = await createRepoC(client, { owner: 'acme', name: 'plain' });
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.fullName).toBe('acme/plain');
    expect(calls[1]?.args).toEqual({ org: 'acme', name: 'plain', private: true });
  });

  it('checks availability under the org namespace', async () => {
    const calls: Call[] = [];
    const client = fakeClient(call => {
      calls.push(call);
      if (call.kind === 'me') return meOk();
      if (call.kind === 'get') return gottenOk({ full_name: 'acme/child' });
      throw new Error('create must not fire');
    });
    const result = await createRepoC(client, { owner: 'acme', name: 'child' });
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GITHUB_API_ERROR');
    if (result.error.code !== 'GITHUB_API_ERROR') return;
    expect(result.error.message).toContain('acme/child');
    expect(calls[0]?.args).toMatchObject({ owner: 'acme', repo: 'child' });
  });
});

// ─── rbac deny ─────────────────────────────────────────────────────────

describe('rbac deny', () => {
  it('maps forbidden creates with the login hint', async () => {
    const client = fakeClient(call => {
      if (call.kind === 'me') return meOk();
      if (call.kind === 'get') throw notFound();
      throw reqError(403, 'Resource not accessible by integration');
    });
    const result = await createRepoC(client, { name: 'child' });
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('AUTH_ERROR');
    if (result.error.code !== 'AUTH_ERROR') return;
    expect(result.error.message).toContain('stitch login');
  });

  it('maps unauthenticated creates', async () => {
    const client = fakeClient(call => {
      if (call.kind === 'me') return meOk();
      if (call.kind === 'get') throw notFound();
      throw reqError(401, 'Requires authentication');
    });
    const result = await createRepoC(client, { name: 'child' });
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('AUTH_ERROR');
  });

  it('maps status-less throws and resolved non-2xx', async () => {
    const hung = fakeClient(call => {
      if (call.kind === 'me') return meOk();
      throw new Error('socket hang up');
    });
    const hungResult = await createRepoC(hung, { name: 'child' });
    expect(hungResult.isErr()).toBe(true);
    if (hungResult.isOk()) return;
    expect(hungResult.error.code).toBe('GITHUB_API_ERROR');
    const resolved = fakeClient(call => {
      if (call.kind === 'me') return meOk();
      return { data: {}, headers: {}, status: 503 };
    });
    const resolvedResult = await createRepoC(resolved, { name: 'x' });
    expect(resolvedResult.isErr()).toBe(true);
  });

  it('rejects non-Error throws as typed failures', async () => {
    const c: CreateClient = {
      rest: {
        repos: {
          get: () => Promise.reject(),
          createForAuthenticatedUser: async () => ({ data: {}, headers: {}, status: 200 }),
          createInOrg: async () => ({ data: {}, headers: {}, status: 200 }),
        },
        users: {
          getAuthenticated: async () => ({
            data: { login: 'octocat' },
            headers: {},
            status: 200,
          }),
        },
      },
    };
    // get rejects bare: availability fails closed before any create.
    const result = await createRepoC(c, { name: 'child' });
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GITHUB_API_ERROR');
  });

  it('covers the create-step failure arms', async () => {
    const throwing: CreateClient = {
      rest: {
        repos: {
          get: async () => {
            throw reqError(404, 'Not Found');
          },
          createForAuthenticatedUser: () => Promise.reject(),
          createInOrg: async () => ({ data: {}, headers: {}, status: 200 }),
        },
        users: {
          getAuthenticated: async () => ({
            data: { login: 'octocat' },
            headers: {},
            status: 200,
          }),
        },
      },
    };
    const bare = await createRepoC(throwing, { name: 'child' });
    expect(bare.isErr()).toBe(true);
    if (bare.isOk()) return;
    expect(bare.error.code).toBe('GITHUB_API_ERROR');
    for (const status of [422, 500]) {
      const resolving: CreateClient = {
        rest: {
          repos: {
            get: async () => {
              throw reqError(404, 'Not Found');
            },
            createForAuthenticatedUser: async () => ({ data: {}, headers: {}, status }),
            createInOrg: async () => ({ data: {}, headers: {}, status: 200 }),
          },
          users: {
            getAuthenticated: async () => ({
              data: { login: 'octocat' },
              headers: {},
              status: 200,
            }),
          },
        },
      };
      const result = await createRepoC(resolving, { name: 'child' });
      expect(result.isErr()).toBe(true);
      if (result.isOk()) continue;
      expect(result.error.code).toBe('GITHUB_API_ERROR');
      if (result.error.code !== 'GITHUB_API_ERROR') continue;
      if (status === 422) {
        expect(result.error.message).toContain('ALREADY_EXISTS');
      }
    }
  });
});

// ─── nock end to end ───────────────────────────────────────────────────

describe('rate limited', () => {
  function limitedCreate(
    status: number,
    headers: unknown,
    message = 'API rate limit exceeded'
  ): CreateClient {
    return fakeClient(call => {
      if (call.kind === 'me') return meOk();
      if (call.kind === 'get') throw notFound();
      const error = new Error(message) as Error & { status: number; headers: unknown };
      error.status = status;
      (error as { headers: unknown }).headers = headers;
      throw error;
    });
  }

  it('surfaces retry guidance from every header shape', async () => {
    const direct = await createRepoC(limitedCreate(429, { 'retry-after': '90' }), {
      name: 'child',
    });
    expect(direct.isErr()).toBe(true);
    if (direct.isOk()) return;
    expect(direct.error.code).toBe('GITHUB_API_ERROR');
    if (direct.error.code !== 'GITHUB_API_ERROR') return;
    expect(direct.error.message).toContain('retry after 90s');
    const inst = await createRepoC(limitedCreate(429, new Headers({ 'retry-after': '45' })), {
      name: 'child',
    });
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
      const odd = await createRepoC(limitedCreate(429, headers), { name: 'child' });
      expect(odd.isErr()).toBe(true);
      if (odd.isOk()) continue;
      expect(odd.error.code).toBe('GITHUB_API_ERROR');
      if (odd.error.code !== 'GITHUB_API_ERROR') continue;
      expect(odd.error.message).toContain('retry delay unknown');
    }
    const reset = String(Math.floor(Date.now() / 1000) + 60);
    const epoch = await createRepoC(limitedCreate(429, { 'x-ratelimit-reset': reset }), {
      name: 'child',
    });
    expect(epoch.isErr()).toBe(true);
    if (epoch.isOk()) return;
    expect(epoch.error.code).toBe('GITHUB_API_ERROR');
    if (epoch.error.code !== 'GITHUB_API_ERROR') return;
    expect(epoch.error.message).toMatch(/retry after \d+s/);
    const bare = await createRepoC(limitedCreate(429, undefined), { name: 'child' });
    expect(bare.isErr()).toBe(true);
    if (bare.isOk()) return;
    expect(bare.error.code).toBe('GITHUB_API_ERROR');
  });

  it('keeps non-rate 403s on the auth path', async () => {
    const forbidden = await createRepoC(
      limitedCreate(403, { 'x-ratelimit-remaining': '5' }, 'Forbidden'),
      { name: 'child' }
    );
    expect(forbidden.isErr()).toBe(true);
    if (forbidden.isOk()) return;
    expect(forbidden.error.code).toBe('AUTH_ERROR');
    if (forbidden.error.code !== 'AUTH_ERROR') return;
    expect(forbidden.error.message).toContain('stitch login');
    const zero = await createRepoC(limitedCreate(403, { 'x-ratelimit-remaining': '0' }), {
      name: 'child',
    });
    expect(zero.isErr()).toBe(true);
    if (zero.isOk()) return;
    expect(zero.error.code).toBe('GITHUB_API_ERROR');
    if (zero.error.code !== 'GITHUB_API_ERROR') return;
    expect(zero.error.message).toContain('retry delay unknown');
  });
});

describe('nock end to end', () => {
  it('checks then creates user repos through real Octokit', async () => {
    const scope = nock('https://api.github.com')
      .get('/user')
      .reply(200, { login: 'octocat', id: 1, type: 'User' })
      .get('/repos/octocat/child')
      .reply(404, { message: 'Not Found' })
      .post('/user/repos', body => (body as Record<string, unknown>)['name'] === 'child')
      .reply(201, { ...CREATED });
    const built = createValidatedClient({ auth: { authType: 'pat', token: 'ghp_test' } });
    if (built.isErr()) throw new Error('client construction failed');
    const result = await createRepoC(built.value, { name: 'child' });
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    const created: CreatedRepo = result.value;
    expect(created.fullName).toBe('octocat/child');
    expect(created.sshUrl).toBe('git@github.com:octocat/child.git');
    expect(scope.isDone()).toBe(true);
  });

  it('resumes existing repos without posting', async () => {
    const scope = nock('https://api.github.com')
      .get('/user')
      .reply(200, { login: 'octocat', id: 1, type: 'User' })
      .get('/repos/octocat/child')
      .reply(200, { ...CREATED });
    const built = createValidatedClient({ auth: { authType: 'pat', token: 'ghp_test' } });
    if (built.isErr()) throw new Error('client construction failed');
    const result = await createRepoC(built.value, { name: 'child', createIfMissing: true });
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.fullName).toBe('octocat/child');
    expect(scope.isDone()).toBe(true);
  });
});
