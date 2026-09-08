import { describe, it, expect, afterEach } from 'vitest';
import { Octokit } from '@octokit/rest';
import { mockGet, mockPost, assertNoPending, cleanupHttpMocks } from '../../test-utils/http.js';

// Every test file using the http mocks restores the network afterwards:
// interceptors never leak into neighboring suites.
afterEach(() => {
  cleanupHttpMocks();
});

describe('http mocks (P-063 shared test-utils)', () => {
  it('mocks http', async () => {
    const getRepo = mockGet('https://api.github.com', '/repos/o/r', 200, {
      full_name: 'o/r',
    });
    const createIssue = mockPost('https://api.github.com', '/repos/o/r/issues', 201, {
      id: 7,
    });

    // Plain fetch hits the GET interceptor (no real network).
    const res = await fetch('https://api.github.com/repos/o/r');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ full_name: 'o/r' });
    expect(getRepo.isDone()).toBe(true);

    // Octokit hits the POST interceptor (same mechanism, richer client).
    const octokit = new Octokit({ auth: 'fake-token' });
    const issue = await octokit.rest.issues.create({ owner: 'o', repo: 'r', title: 't' });
    expect(issue.status).toBe(201);
    expect(issue.data.id).toBe(7);

    // Nothing left hanging: every declared mock was consumed.
    assertNoPending([getRepo, createIssue]);

    // The negative paths genuinely fail: an unhit mock is pending, and both
    // the scoped and the global assertions throw listing it.
    const stray = mockGet('https://api.github.com', '/never/hit', 200, {});
    expect(stray.isDone()).toBe(false);
    expect(stray.pending()).toHaveLength(1);
    expect(() => assertNoPending([stray])).toThrow(/not yet satisfied/);
    expect(() => assertNoPending()).toThrow(/never\/hit/);
  });
});
