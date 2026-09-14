// GitHub epic consolidation (P-101): the whole P-088–P-100 flow
// through ONE shared mock — auth, list, tree, content, license, fork,
// trigger, monitor — proving the narrow seams compose, plus the
// cross-cutting edge matrix (auth, rate-limit, not-found, pagination).

import { describe, it, expect, afterEach } from 'vitest';
import { cleanupHttpMocks } from '../../../test-utils/http.js';
import {
  mockOctokit,
  reqError,
  fixtureRepoItem,
  fixtureLicensePayload,
  fixtureRun,
  fixtureRunList,
  SHA_A,
  SHA_B,
  type MockCall,
} from '../../../test-utils/githubMock.js';
import { validateAuth } from '../auth.js';
import { listRepos } from '../list.js';
import { getRepoTree } from '../tree.js';
import { getFileContent } from '../content.js';
import { detectRepoLicense } from '../license.js';
import { ensureFork, forkPrHead } from '../fork.js';
import { triggerSandbox, monitorSandboxRun } from '../sandboxTrigger.js';

afterEach(() => {
  cleanupHttpMocks();
});

const BLOB_B64 = 'aGVsbG8gd29ybGQ='; // 'hello world'

function treeBody(): unknown {
  return {
    data: {
      sha: SHA_A,
      truncated: false,
      tree: [{ path: 'a.txt', mode: '100644', type: 'blob', sha: SHA_A }],
    },
    headers: {},
    status: 200,
  };
}

function blobBody(): unknown {
  return {
    data: { type: 'file', sha: SHA_A, size: 11, content: BLOB_B64, encoding: 'base64' },
    headers: {},
    status: 200,
  };
}

/** One mock scripting the full stitch flow for o/r at SHA_A. */
function epicMock(): ReturnType<typeof mockOctokit> {
  return mockOctokit(call => {
    switch (call.method) {
      case 'getAuthenticated':
        return {
          data: { login: 'octo', id: 1, type: 'User' },
          headers: { 'x-oauth-scopes': 'repo' },
          status: 200,
        };
      case 'listForAuthenticatedUser':
        return { data: [fixtureRepoItem('o', 'r')], headers: {}, status: 200 };
      case 'getCommit':
        return { data: { sha: SHA_A }, headers: {}, status: 200 };
      case 'getTree':
        return treeBody();
      case 'getContent':
        return blobBody();
      case 'getForRepo':
        return fixtureLicensePayload('MIT');
      case 'get':
        if ((call.args.owner as string) === 'o') {
          return {
            data: {
              name: 'r',
              full_name: 'o/r',
              default_branch: 'main',
              permissions: { admin: false, maintain: false, push: false, pull: true },
            },
            headers: {},
            status: 200,
          };
        }
        return {
          data: { name: 'r', full_name: 'me/r', owner: { login: 'me' } },
          headers: {},
          status: 200,
        };
      case 'createFork':
        return {
          data: { name: 'r', full_name: 'me/r', owner: { login: 'me' } },
          headers: {},
          status: 202,
        };
      case 'createDispatchEvent':
        return { data: {}, headers: {}, status: 204 };
      case 'listWorkflowRunsForRepo':
        return fixtureRunList([fixtureRun(101, SHA_A, 'completed', 'success')]);
      case 'getWorkflowRun':
        return {
          data: fixtureRun(101, SHA_A, 'completed', 'success'),
          headers: {},
          status: 200,
        };
      default:
        throw new Error(`unscripted mock call: ${call.namespace}.${call.method}`);
    }
  });
}

// ─── consolidated flow ─────────────────────────────────────────────────

describe('epic flow', () => {
  it('stitches the epic through one mock', async () => {
    const client = epicMock();

    const authed = await validateAuth(client, { context: 'write' });
    expect(authed.isOk()).toBe(true);
    if (authed.isErr()) return;
    expect(authed.value.login).toBe('octo');
    expect(authed.value.scopes).toContain('repo');

    const listed = await listRepos(client, {});
    expect(listed.isOk()).toBe(true);
    if (listed.isErr()) return;
    expect(listed.value.map(item => item.fullName)).toEqual(['o/r']);

    const tree = await getRepoTree(client, 'o', 'r', { ref: 'main' });
    expect(tree.isOk()).toBe(true);
    if (tree.isErr()) return;
    expect(tree.value.flat.map(node => node.path)).toEqual(['a.txt']);

    const blob = await getFileContent(client, 'o', 'r', 'a.txt', { ref: SHA_A });
    expect(blob.isOk()).toBe(true);
    if (blob.isErr()) return;
    expect(blob.value.content).toBe('hello world');

    const license = await detectRepoLicense(client, 'o', 'r');
    expect(license.isOk()).toBe(true);
    if (license.isErr()) return;
    expect(license.value.spdxId).toBe('MIT');

    const fork = await ensureFork(client, 'o', 'r', { pollIntervalMs: 0 });
    expect(fork.isOk()).toBe(true);
    if (fork.isErr()) return;
    expect(fork.value.forked).toBe(true);
    expect(fork.value.owner).toBe('me');

    const head = forkPrHead(fork.value.owner, 'feature');
    expect(head.isOk()).toBe(true);
    if (head.isErr()) return;
    expect(head.value).toBe('me:feature');

    const dispatched = await triggerSandbox(client, 'o', 'r', {
      sha: SHA_A,
      ecosystem: 'node',
      ref: 'main',
      jobId: 'job-1',
    });
    expect(dispatched.isOk()).toBe(true);
    if (dispatched.isErr()) return;
    expect(dispatched.value.jobId).toBe('job-1');

    const verdict = await monitorSandboxRun(client, 'o', 'r', SHA_A, { jobId: 'job-1' });
    expect(verdict.isOk()).toBe(true);
    if (verdict.isErr()) return;
    expect(verdict.value.pass).toBe(true);
    expect(verdict.value.jobId).toBe('job-1');

    // Every hop rode the same mock: the seams compose end to end.
    const methods = client.calls.map(call => `${call.namespace}.${call.method}`);
    for (const hop of [
      'users.getAuthenticated',
      'repos.listForAuthenticatedUser',
      'repos.getCommit',
      'git.getTree',
      'repos.getContent',
      'licenses.getForRepo',
      'repos.get',
      'repos.createFork',
      'repos.createDispatchEvent',
      'actions.listWorkflowRunsForRepo',
      'actions.getWorkflowRun',
    ]) {
      expect(methods).toContain(hop);
    }
  });
});

// ─── edge matrix ───────────────────────────────────────────────────────

describe('edge matrix', () => {
  it('refuses bad credentials across the epic', async () => {
    const denied = mockOctokit(() => {
      throw reqError(401, 'Bad credentials');
    });
    const authed = await validateAuth(denied, {});
    expect(authed.isErr()).toBe(true);
    if (authed.isOk()) return;
    expect(authed.error.code).toBe('AUTH_FAILED');

    const tree = await getRepoTree(denied, 'o', 'r', { ref: SHA_A });
    expect(tree.isErr()).toBe(true);
    if (tree.isOk()) return;
    expect(tree.error.code).toBe('AUTH_FAILED');
    if (tree.error.code !== 'AUTH_FAILED') return;
    expect(tree.error.message).toContain('stitch login');
  });

  it('surfaces rate limits with retry guidance', async () => {
    const limited = mockOctokit(call => {
      if (call.method === 'getCommit') {
        return { data: { sha: SHA_A }, headers: {}, status: 200 };
      }
      const error = reqError(429, 'Too Many Requests');
      (error as Error & { headers?: unknown }).headers = { 'retry-after': '45' };
      throw error;
    });
    const tree = await getRepoTree(limited, 'o', 'r', { ref: 'main' });
    expect(tree.isErr()).toBe(true);
    if (tree.isOk()) return;
    expect(tree.error.code).toBe('RATE_LIMIT');
    if (tree.error.code !== 'RATE_LIMIT') return;
    expect(tree.error.message).toContain('retry after 45s');
  });

  it('maps missing resources to 404s', async () => {
    const missing = mockOctokit(call => {
      if (call.method === 'getCommit') {
        return { data: { sha: SHA_A }, headers: {}, status: 200 };
      }
      if (call.method === 'getContent') {
        return { data: { message: 'Not Found' }, headers: {}, status: 404 };
      }
      return { data: { message: 'Not Found' }, headers: {}, status: 404 };
    });
    const blob = await getFileContent(missing, 'o', 'ghost', 'a.txt', { ref: SHA_A });
    expect(blob.isErr()).toBe(true);
    if (blob.isOk()) return;
    expect(blob.error.code).toBe('NOT_FOUND');
    if (blob.error.code !== 'NOT_FOUND') return;
    expect(blob.error.status).toBe(404);

    const fork = await ensureFork(missing, 'o', 'ghost', { pollIntervalMs: 0 });
    expect(fork.isErr()).toBe(true);
    if (fork.isOk()) return;
    expect(fork.error.code).toBe('NOT_FOUND');
    if (fork.error.code !== 'NOT_FOUND') return;
    expect(fork.error.status).toBe(404);
  });

  it('pages short lists to exhaustion', async () => {
    const pages: MockCall[] = [];
    const client = mockOctokit(call => {
      pages.push(call);
      const page = (call.args.page as number) ?? 1;
      const items =
        page === 1
          ? [fixtureRepoItem('o', 'a'), fixtureRepoItem('o', 'b')]
          : [fixtureRepoItem('o', 'c')];
      return { data: items, headers: {}, status: 200 };
    });
    const listed = await listRepos(client, { perPage: 2 });
    expect(listed.isOk()).toBe(true);
    if (listed.isErr()) return;
    expect(listed.value.map(item => item.name)).toEqual(['a', 'b', 'c']);
    expect(pages).toHaveLength(2);
  });

  it('keeps SHA_B fixtures distinct from SHA_A', async () => {
    expect(SHA_B).not.toBe(SHA_A);
    const client = mockOctokit(call => {
      if (call.method === 'getCommit') {
        return { data: { sha: SHA_B }, headers: {}, status: 200 };
      }
      return treeBody();
    });
    const tree = await getRepoTree(client, 'o', 'r', { ref: 'main' });
    expect(tree.isOk()).toBe(true);
  });
});
