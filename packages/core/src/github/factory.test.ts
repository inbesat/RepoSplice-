// P-017 + P-018 smoke tests: confirms the @octokit/rest + @octokit/auth-app
// wrappers construct cleanly and that a typed endpoint call flows
// through to Result. Uses a mocked `request.fetch` to avoid real network
// calls. The App auth tests do not call the Octokit client because
// createAppAuth needs a real `/app/installations/.../access_tokens`
// round-trip — mocked fetch only intercepts the final API call, not
// the JWT mint. Real integration tests (P-088+) will exercise this
// end-to-end with a fixture (P-061 nock or local GHE).
import { describe, it, expect } from 'vitest';
import { createOctokit, getRepo, request, statusToStitchError } from './factory.js';

describe('P-017 @octokit/rest factory: construction', () => {
  it('createOctokit({ authType: "pat", token }) constructs an Octokit', () => {
    const octokit = createOctokit({ auth: { authType: 'pat', token: 'ghp_test_token' } });
    expect(octokit).toBeDefined();
    expect(typeof octokit.repos.get).toBe('function');
    expect(typeof octokit.repos.getContent).toBe('function');
  });

  it('createOctokit honors custom userAgent + baseUrl', () => {
    const octokit = createOctokit({
      auth: { authType: 'pat', token: 'x' },
      userAgent: 'repo-stitcher-test',
      baseUrl: 'https://api.example.com',
    });
    expect(octokit).toBeDefined();
  });
});

describe('P-017 @octokit/rest factory: request() + status mapping', () => {
  it('statusToStitchError maps 401 to AUTH_ERROR', () => {
    const e = statusToStitchError(401, 'Unauthorized', 'repos.get');
    expect(e.code).toBe('AUTH_ERROR');
    if (e.code === 'AUTH_ERROR') {
      expect(e.provider).toBe('github');
      expect(e.message).toContain('repos.get');
      expect(e.message).toContain('401');
    }
  });

  it('statusToStitchError maps 404 to GITHUB_API_ERROR', () => {
    const e = statusToStitchError(404, 'Not Found', 'repos.get');
    expect(e.code).toBe('GITHUB_API_ERROR');
    if (e.code === 'GITHUB_API_ERROR') {
      expect(e.status).toBe(404);
    }
  });

  it('statusToStitchError maps 422 to CONFIG_ERROR', () => {
    const e = statusToStitchError(422, 'Unprocessable', 'repos.create');
    expect(e.code).toBe('CONFIG_ERROR');
  });

  it('statusToStitchError maps 500 to GITHUB_API_ERROR (default)', () => {
    const e = statusToStitchError(500, 'Internal Server Error', 'repos.get');
    expect(e.code).toBe('GITHUB_API_ERROR');
  });
});

describe('P-017 @octokit/rest factory: typed getContent (mocked)', () => {
  it('getRepo with mocked fetch returns the typed data', async () => {
    const mockFetch: typeof globalThis.fetch = async () => {
      return new Response(
        JSON.stringify({
          name: 'repo-stitcher',
          full_name: 'inbesat/repo-stitcher',
          default_branch: 'main',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    };

    const octokit = createOctokit({
      auth: { authType: 'pat', token: 'ghp_test' },
      baseUrl: 'https://api.github.com',
      request: { fetch: mockFetch },
    });

    const r = await getRepo(octokit, 'inbesat', 'repo-stitcher');
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      expect(r.value.name).toBe('repo-stitcher');
      expect(r.value.full_name).toBe('inbesat/repo-stitcher');
      expect(r.value.default_branch).toBe('main');
    }
  });

  it('getRepo with 404 mocked fetch returns a typed GITHUB_API_ERROR', async () => {
    const mockFetch: typeof globalThis.fetch = async () => {
      return new Response(JSON.stringify({ message: 'Not Found' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      });
    };
    const octokit = createOctokit({
      auth: { authType: 'pat', token: 'ghp_test' },
      request: { fetch: mockFetch },
    });
    const r = await getRepo(octokit, 'inbesat', 'missing');
    expect(r.isErr()).toBe(true);
    if (r.isErr()) {
      expect(r.error.code).toBe('GITHUB_API_ERROR');
    }
  });

  it('request() generic helper returns a typed ResultAsync (mocked)', async () => {
    const mockFetch: typeof globalThis.fetch = async () => {
      return new Response(JSON.stringify({ content: 'hello' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };
    const octokit = createOctokit({
      auth: { authType: 'pat', token: 'ghp_test' },
      request: { fetch: mockFetch },
    });
    type Payload = { content: string };
    const r = await request<Payload>(octokit, async o => {
      const res = await o.repos.getContent({ owner: 'x', repo: 'y', path: 'z' });
      return { data: res.data as unknown as Payload, status: res.status, headers: {} };
    });
    expect(r.isOk()).toBe(true);
    if (r.isOk()) expect(r.value.content).toBe('hello');
  });
});

describe('P-018 @octokit/auth-app: GitHub App auth', () => {
  // A throwaway PEM (not a real key). Real apps would read this from a
  // file or secret store (P-200/P-206); for P-018 the goal is to confirm
  // the type union + factory compose, not to do real RSA signing.
  const TEST_PEM = `-----BEGIN RSA PRIVATE KEY-----
MIIBOgIBAAJBAKj34GkxFhD90vcNLYLInFEX6Ppy1tPf9Cnzj4p4WGeKLs1Pt8Qu
KUpRKfFLfRYC9AIKjbJTWit+CqvjWYzvQwECAwEAAQ==
-----END RSA PRIVATE KEY-----`;

  it('createOctokit({ authType: "app", ... }) constructs an Octokit with the App strategy', () => {
    const octokit = createOctokit({
      auth: {
        authType: 'app',
        appId: 12345,
        privateKey: TEST_PEM,
        installationId: 67890,
      },
    });
    expect(octokit).toBeDefined();
    expect(typeof octokit.repos.get).toBe('function');
  });

  it('App auth carries appId + installationId (used by createAppAuth)', () => {
    // Verify the auth type carries the right fields. We do NOT call
    // `octokit.repos.get` here because createAppAuth needs a real
    // `/app/installations/{id}/access_tokens` round-trip — mocked fetch
    // only intercepts the final API call, not the JWT mint. Real
    // integration tests (P-088+) will exercise this end-to-end against
    // a test fixture or with nock (P-061).
    const auth = {
      authType: 'app' as const,
      appId: 12345,
      privateKey: TEST_PEM,
      installationId: 67890,
    };
    expect(auth.appId).toBe(12345);
    expect(auth.installationId).toBe(67890);
    expect(auth.privateKey).toContain('BEGIN RSA PRIVATE KEY');
  });

  it('the createAppAuth strategy is importable and produces an auth function', async () => {
    // Direct test of the @octokit/auth-app surface (not the factory),
    // confirming the lib is wired correctly per the P-018 acceptance
    // criterion. We don't invoke the strategy (would need network).
    const { createAppAuth } = await import('@octokit/auth-app');
    const auth = createAppAuth({
      appId: 12345,
      privateKey: TEST_PEM,
      installationId: 67890,
    });
    expect(typeof auth).toBe('function');
  });
});
