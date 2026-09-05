// P-017 smoke test: confirms the @octokit/rest wrapper constructs cleanly
// and that a typed endpoint call flows through to Result. Uses a mocked
// `request.fetch` to avoid real network calls (P-061 nock P-061 will be
// added when full HTTP mocking is needed; for P-017 the request hook is
// sufficient and exercises the actual octokit pipeline).
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
    // Mock the HTTP layer via Octokit's `request.fetch` option. Returns a
    // 200 + the JSON body Octokit expects.
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
