// GitHub auth (P-088): validated client construction (PAT + App),
// config-sourced credentials, scope-gated validation, and secret hygiene.
// Unit surface runs on injected fakes (no network); two nock tests prove
// the real Octokit path end to end (header parsing + error mapping).

import { describe, it, expect, afterEach } from 'vitest';
import nock from 'nock';
import { Octokit } from '@octokit/rest';
import { cleanupHttpMocks } from '../../../test-utils/http.js';
import type { GitHubConfig } from '../../config/schema.js';
import type { OctokitFactoryOptions } from '../factory.js';
import {
  createValidatedClient,
  resolveAuth,
  clientFromConfig,
  validateAuth,
  type AuthClient,
  type AuthContext,
} from '../auth.js';

afterEach(() => {
  cleanupHttpMocks();
});

const SENTINEL_TOKEN = 'ghp_sentinel_TOKEN_abc123';
const APP_KEY = [
  '-----BEGIN RSA PRIVATE KEY-----',
  'MIIEpAIBAAKCAQEA0fake0key0for0tests0only0not0real0material0here0',
  '-----END RSA PRIVATE KEY-----',
].join('\n');

function patOpts(token: string = SENTINEL_TOKEN): OctokitFactoryOptions {
  return { auth: { authType: 'pat', token } };
}

function appOpts(): OctokitFactoryOptions {
  return {
    auth: { authType: 'app', appId: 123, privateKey: APP_KEY, installationId: 456 },
  };
}

/** Fake endpoint resolving one response (data/headers/status). */
function fakeClient(response: { data: unknown; headers?: unknown; status?: number }): AuthClient {
  return {
    rest: {
      users: {
        getAuthenticated: async () => ({
          data: response.data,
          headers: response.headers ?? {},
          status: response.status ?? 200,
        }),
      },
    },
  };
}

/** Fake endpoint rejecting like Octokit's RequestError. */
function failingClient(status: number, message: string): AuthClient {
  return {
    rest: {
      users: {
        getAuthenticated: async () => {
          const error = new Error(message) as Error & { status: number };
          error.status = status;
          throw error;
        },
      },
    },
  };
}

const USER = { login: 'octocat', id: 1, type: 'User' };

// ─── createValidatedClient ─────────────────────────────────────────────

describe('pat client', () => {
  it('builds a real Octokit for a present token', () => {
    const built = createValidatedClient(patOpts());
    expect(built.isOk()).toBe(true);
    if (built.isErr()) return;
    expect(built.value).toBeInstanceOf(Octokit);
  });

  it('rejects blank tokens without echoing secrets', () => {
    for (const token of ['', '   ']) {
      const built = createValidatedClient(patOpts(token));
      expect(built.isErr()).toBe(true);
      if (built.isOk()) continue;
      expect(built.error.code).toBe('CONFIG_ERROR');
      if (built.error.code !== 'CONFIG_ERROR') continue;
      expect(built.error.field).toBe('auth.token');
      expect(built.error.message).toContain('stitch login');
      expect(built.error.message).not.toContain(token.trim() === '' ? 'SENTINEL-NEVER' : token);
    }
  });

  it('rejects malformed base URLs', () => {
    for (const baseUrl of ['::not-a-url::', 'ftp://files.example.com/x']) {
      const built = createValidatedClient({ ...patOpts(), baseUrl });
      expect(built.isErr()).toBe(true);
      if (built.isOk()) continue;
      expect(built.error.code).toBe('CONFIG_ERROR');
      if (built.error.code !== 'CONFIG_ERROR') continue;
      expect(built.error.field).toBe('baseUrl');
    }
    const ghe = createValidatedClient({ ...patOpts(), baseUrl: 'https://ghe.example.com/api' });
    expect(ghe.isOk()).toBe(true);
  });

  it('rejects unknown auth kinds', () => {
    const built = createValidatedClient({
      auth: { authType: 'oauth' } as unknown as { authType: 'pat'; token: string },
    });
    expect(built.isErr()).toBe(true);
    if (built.isOk()) return;
    expect(built.error.code).toBe('CONFIG_ERROR');
    if (built.error.code !== 'CONFIG_ERROR') return;
    expect(built.error.field).toBe('auth.authType');
  });

  it('rejects missing auth blocks and unusable options', () => {
    for (const opts of [
      { auth: undefined },
      { auth: null },
    ] as unknown as OctokitFactoryOptions[]) {
      const built = createValidatedClient(opts);
      expect(built.isErr()).toBe(true);
      if (built.isOk()) continue;
      expect(built.error.code).toBe('CONFIG_ERROR');
    }
    const broken = createValidatedClient(null as unknown as OctokitFactoryOptions);
    expect(broken.isErr()).toBe(true);
    if (broken.isOk()) return;
    expect(broken.error.code).toBe('INTERNAL');
  });
});

describe('app client', () => {
  it('builds a real Octokit without network', () => {
    const built = createValidatedClient(appOpts());
    expect(built.isOk()).toBe(true);
    if (built.isErr()) return;
    expect(built.value).toBeInstanceOf(Octokit);
  });

  it('rejects bad app fields without echoing the key', () => {
    const cases: Array<{ opts: OctokitFactoryOptions; field: string }> = [
      {
        opts: { auth: { authType: 'app', appId: 0, privateKey: APP_KEY, installationId: 1 } },
        field: 'auth.appId',
      },
      {
        opts: { auth: { authType: 'app', appId: 1.5, privateKey: APP_KEY, installationId: 1 } },
        field: 'auth.appId',
      },
      {
        opts: { auth: { authType: 'app', appId: 1, privateKey: 'not-a-pem', installationId: 1 } },
        field: 'auth.privateKey',
      },
      {
        opts: { auth: { authType: 'app', appId: 1, privateKey: '  ', installationId: 1 } },
        field: 'auth.privateKey',
      },
      {
        opts: { auth: { authType: 'app', appId: 1, privateKey: APP_KEY, installationId: -2 } },
        field: 'auth.installationId',
      },
      {
        opts: { auth: { authType: 'app', appId: 1, privateKey: APP_KEY, installationId: 1.5 } },
        field: 'auth.installationId',
      },
    ];
    for (const { opts, field } of cases) {
      const built = createValidatedClient(opts);
      expect(built.isErr()).toBe(true);
      if (built.isOk()) continue;
      expect(built.error.code).toBe('CONFIG_ERROR');
      if (built.error.code !== 'CONFIG_ERROR') continue;
      expect(built.error.field).toBe(field);
      expect(built.error.message).not.toContain('fake0key0');
    }
  });
});

// ─── resolveAuth / clientFromConfig ────────────────────────────────────

describe('config-sourced credentials', () => {
  it('resolves PAT auth from config', () => {
    const cfg: GitHubConfig = { authType: 'pat', token: SENTINEL_TOKEN };
    const resolved = resolveAuth(cfg);
    expect(resolved.isOk()).toBe(true);
    if (resolved.isErr()) return;
    expect(resolved.value).toEqual({ authType: 'pat', token: SENTINEL_TOKEN });
  });

  it('refuses missing PAT tokens with the login hint', () => {
    for (const cfg of [
      { authType: 'pat' },
      { authType: 'pat', token: '  ' },
      { authType: 'pat', token: 42 },
    ] as unknown as GitHubConfig[]) {
      const resolved = resolveAuth(cfg);
      expect(resolved.isErr()).toBe(true);
      if (resolved.isOk()) continue;
      expect(resolved.error.code).toBe('CONFIG_ERROR');
      if (resolved.error.code !== 'CONFIG_ERROR') continue;
      expect(resolved.error.message).toContain('stitch login');
    }
  });

  it('resolves App auth with an injected key', () => {
    const cfg: GitHubConfig = { authType: 'app', appId: 7, installationId: 9 };
    const resolved = resolveAuth(cfg, { privateKey: APP_KEY });
    expect(resolved.isOk()).toBe(true);
    if (resolved.isErr()) return;
    expect(resolved.value).toEqual({
      authType: 'app',
      appId: 7,
      privateKey: APP_KEY,
      installationId: 9,
    });
  });

  it('refuses App auth without key material or ids', () => {
    const noKey = resolveAuth({ authType: 'app', appId: 7, installationId: 9 });
    expect(noKey.isErr()).toBe(true);
    if (noKey.isOk()) return;
    expect(noKey.error.code).toBe('CONFIG_ERROR');
    const badIds = [
      { authType: 'app' },
      { authType: 'app', appId: 1.5, installationId: 9 },
      { authType: 'app', appId: 0, installationId: 9 },
      { authType: 'app', appId: 7, installationId: 1.5 },
      { authType: 'app', appId: 7, installationId: 0 },
    ] as GitHubConfig[];
    for (const cfg of badIds) {
      const bad = resolveAuth(cfg, { privateKey: APP_KEY });
      expect(bad.isErr()).toBe(true);
      if (bad.isOk()) continue;
      expect(bad.error.code).toBe('CONFIG_ERROR');
    }
    const junkKey = resolveAuth(
      { authType: 'app', appId: 7, installationId: 9 },
      { privateKey: 'junk' }
    );
    expect(junkKey.isErr()).toBe(true);
    for (const missing of [null, undefined] as unknown as GitHubConfig[]) {
      const gone = resolveAuth(missing);
      expect(gone.isErr()).toBe(true);
      if (gone.isOk()) continue;
      expect(gone.error.code).toBe('CONFIG_ERROR');
    }
  });

  it('rejects unknown config auth kinds', () => {
    const resolved = resolveAuth({ authType: 'oauth' } as unknown as GitHubConfig);
    expect(resolved.isErr()).toBe(true);
    if (resolved.isOk()) return;
    expect(resolved.error.code).toBe('CONFIG_ERROR');
    if (resolved.error.code !== 'CONFIG_ERROR') return;
    expect(resolved.error.field).toBe('github.authType');
  });

  it('builds end to end from config', () => {
    const built = clientFromConfig({ authType: 'pat', token: SENTINEL_TOKEN });
    expect(built.isOk()).toBe(true);
    if (built.isErr()) return;
    expect(built.value).toBeInstanceOf(Octokit);
    const bad = clientFromConfig({ authType: 'pat' });
    expect(bad.isErr()).toBe(true);
    const ghe = clientFromConfig(
      { authType: 'pat', token: SENTINEL_TOKEN },
      {},
      { baseUrl: 'https://ghe.example.com/api', userAgent: 'stitch-test' }
    );
    expect(ghe.isOk()).toBe(true);
  });
});

// ─── validateAuth ──────────────────────────────────────────────────────

describe('validates scopes', () => {
  it('accepts read with any authenticated identity', async () => {
    const bare = await validateAuth(fakeClient({ data: USER }));
    expect(bare.isOk()).toBe(true);
    for (const context of ['read', undefined] as (AuthContext | undefined)[]) {
      const result = await validateAuth(
        fakeClient({ data: USER }),
        context === undefined ? {} : { context }
      );
      expect(result.isOk()).toBe(true);
      if (result.isErr()) continue;
      expect(result.value.login).toBe('octocat');
      expect(result.value.scopes).toEqual([]);
    }
  });

  it('gates write on repo scopes for PATs', async () => {
    const headers = { 'x-oauth-scopes': 'repo, user' };
    const okResult = await validateAuth(fakeClient({ data: USER, headers }), {
      context: 'write',
    });
    expect(okResult.isOk()).toBe(true);
    if (okResult.isErr()) return;
    expect(okResult.value.scopes).toEqual(['repo', 'user']);
    const publicRepo = await validateAuth(
      fakeClient({ data: USER, headers: { 'x-oauth-scopes': 'public_repo' } }),
      { context: 'write' }
    );
    expect(publicRepo.isOk()).toBe(true);
    const weak = await validateAuth(
      fakeClient({ data: USER, headers: { 'x-oauth-scopes': 'gist, user' } }),
      { context: 'write' }
    );
    expect(weak.isErr()).toBe(true);
    if (weak.isOk()) return;
    expect(weak.error.code).toBe('AUTH_ERROR');
    if (weak.error.code !== 'AUTH_ERROR') return;
    expect(weak.error.message).toContain("'repo'");
    expect(weak.error.message).toContain('stitch login');
  });

  it('trusts App tokens past scope checks (permissions enforced server-side)', async () => {
    // App installation tokens carry no x-oauth-scopes header: GitHub
    // enforces their permissions per call, so validation passes here and
    // any 403 later maps with the login hint.
    const result = await validateAuth(fakeClient({ data: { ...USER, type: 'Bot' } }), {
      context: 'write',
    });
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.type).toBe('Bot');
  });

  it('reads Headers-instance shapes', async () => {
    const headers = new Headers({ 'X-OAuth-Scopes': 'repo' });
    const result = await validateAuth(fakeClient({ data: USER, headers }), {
      context: 'write',
    });
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.scopes).toEqual(['repo']);
  });

  it('treats odd header shapes as scopeless', async () => {
    for (const headers of ['nope', { 'x-oauth-scopes': 42 }, { get: () => 42 }]) {
      const result = await validateAuth(fakeClient({ data: USER, headers }), {});
      expect(result.isOk()).toBe(true);
      if (result.isErr()) continue;
      expect(result.value.scopes).toEqual([]);
    }
  });

  it('rejects unknown contexts', async () => {
    const result = await validateAuth(fakeClient({ data: USER }), {
      context: 'admin' as AuthContext,
    });
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('CONFIG_ERROR');
  });

  it('refuses malformed user payloads fail-closed', async () => {
    for (const data of [
      null,
      'nope',
      {},
      { login: 'x' },
      { login: '' },
      { login: 'x', id: '1', type: 'User' },
      { login: 'x', id: 1.5, type: 'User' },
      { login: 'x', id: 1 },
      { login: 'x', id: 1, type: '' },
    ]) {
      const result = await validateAuth(fakeClient({ data }), {});
      expect(result.isErr()).toBe(true);
      if (result.isOk()) continue;
      expect(result.error.code).toBe('INTERNAL');
    }
  });

  it('treats non-2xx resolutions as mapped failures', async () => {
    const result = await validateAuth(fakeClient({ data: null, status: 500 }), {});
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GITHUB_API_ERROR');
  });
});

// ─── redaction + error mapping ─────────────────────────────────────────

describe('redacts token', () => {
  it('never embeds the token in any error message', async () => {
    const denied = await validateAuth(failingClient(401, 'Requires authentication'), {});
    expect(denied.isErr()).toBe(true);
    if (denied.isOk()) return;
    // The sentinel only exists in this file, never in the module: any
    // interpolation leak would surface here by construction.
    const message =
      denied.error.code === 'AUTH_ERROR' || denied.error.code === 'GITHUB_API_ERROR'
        ? denied.error.message
        : '';
    expect(message).not.toContain('ghp_sentinel');
  });

  it('validates over real Octokit through nock (PAT scopes header)', async () => {
    const scope = nock('https://api.github.com')
      .get('/user')
      .reply(200, USER, { 'x-oauth-scopes': 'repo, workflow' });
    const built = createValidatedClient(patOpts());
    if (built.isErr()) throw new Error('client construction failed');
    const result = await validateAuth(built.value, { context: 'write' });
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.login).toBe('octocat');
    expect(result.value.scopes).toEqual(['repo', 'workflow']);
    expect(scope.isDone()).toBe(true);
  });
});

describe('maps errors', () => {
  it('maps 401/403 with the login hint', async () => {
    for (const status of [401, 403]) {
      const result = await validateAuth(failingClient(status, `call failed ${status}`), {});
      expect(result.isErr()).toBe(true);
      if (result.isOk()) continue;
      expect(result.error.code).toBe('AUTH_ERROR');
      if (result.error.code !== 'AUTH_ERROR') continue;
      expect(result.error.message).toContain('stitch login');
    }
  });

  it('maps 404 and server failures without the auth hint', async () => {
    const missing = await validateAuth(failingClient(404, 'not found'), {});
    expect(missing.isErr()).toBe(true);
    if (missing.isOk()) return;
    expect(missing.error.code).toBe('GITHUB_API_ERROR');
    if (missing.error.code !== 'GITHUB_API_ERROR') return;
    expect(missing.error.message).not.toContain('stitch login');
    const broken = await validateAuth(failingClient(500, 'boom'), {});
    expect(broken.isErr()).toBe(true);
    if (broken.isOk()) return;
    expect(broken.error.code).toBe('GITHUB_API_ERROR');
  });

  it('maps status-less failures to a typed error', async () => {
    const client: AuthClient = {
      rest: {
        users: {
          getAuthenticated: async () => {
            throw new Error('socket hang up');
          },
        },
      },
    };
    const result = await validateAuth(client, {});
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GITHUB_API_ERROR');
    const primitive: AuthClient = {
      rest: {
        // Rejects with undefined (no throw statement): exercises the
        // non-Error mapping arm without tripping no-throw-literal.
        users: {
          getAuthenticated: () => Promise.reject(),
        },
      },
    };
    const prim = await validateAuth(primitive, {});
    expect(prim.isErr()).toBe(true);
    if (prim.isOk()) return;
    expect(prim.error.code).toBe('GITHUB_API_ERROR');
  });

  it('maps nock 401s through real Octokit', async () => {
    nock('https://api.github.com').get('/user').reply(401, { message: 'Bad credentials' });
    const built = createValidatedClient(patOpts());
    if (built.isErr()) throw new Error('client construction failed');
    const result = await validateAuth(built.value, {});
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('AUTH_ERROR');
    if (result.error.code !== 'AUTH_ERROR') return;
    expect(result.error.message).toContain('stitch login');
  });
});
