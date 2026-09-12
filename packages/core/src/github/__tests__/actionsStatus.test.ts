// GitHub Actions status (P-095): relay workflow runs as normalized
// events, verify webhook signatures, map delivery payloads, and
// correlate runs back to jobs — over injected fakes (no network) plus
// nock proofs that the real Octokit satisfies the seam.

import { describe, it, expect, afterEach } from 'vitest';
import nock from 'nock';
import { createHmac } from 'node:crypto';
import { cleanupHttpMocks } from '../../../test-utils/http.js';
import { createValidatedClient } from '../auth.js';
import {
  relayWorkflowRun,
  findRunsForSha,
  verifyWebhookSignature,
  mapWebhookEvent,
  correlateRunToJob,
  type ActionsClient,
  type WorkflowRunEvent,
} from '../actionsStatus.js';

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

function runPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 101,
    head_sha: SHA_A,
    head_branch: 'feature',
    status: 'completed',
    conclusion: 'success',
    html_url: 'https://github.com/o/r/actions/runs/101',
    ...overrides,
  };
}

interface Call {
  kind: 'run' | 'runs';
  args: Record<string, unknown>;
}

/** Fake client serving scripted payloads while recording calls. */
function fakeClient(handler: (call: Call) => unknown): ActionsClient {
  const wrap = (kind: Call['kind']) => async (args?: Record<string, unknown>) => {
    const out = handler({ kind, args: args ?? {} });
    if (out instanceof Error) throw out;
    return out as { data: unknown; headers: unknown; status: number };
  };
  return {
    rest: {
      actions: {
        getWorkflowRun: wrap('run'),
        listWorkflowRunsForRepo: wrap('runs'),
      },
    },
  };
}

// ─── polls maps ────────────────────────────────────────────────────────

describe('polls maps', () => {
  it('relays one run as a normalized event', async () => {
    const calls: Call[] = [];
    const client = fakeClient(call => {
      calls.push(call);
      return { data: runPayload(), headers: {}, status: 200 };
    });
    const result = await relayWorkflowRun(client, 'o', 'r', 101);
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    const event: WorkflowRunEvent = result.value;
    expect(event).toEqual({
      kind: 'workflow_run',
      runId: 101,
      headSha: SHA_A,
      headBranch: 'feature',
      status: 'completed',
      conclusion: 'success',
      url: 'https://github.com/o/r/actions/runs/101',
    });
    expect(calls).toEqual([{ kind: 'run', args: { owner: 'o', repo: 'r', run_id: 101 } }]);
  });

  it('carries null conclusions for in-flight runs', async () => {
    const client = fakeClient(() => ({
      data: runPayload({ status: 'in_progress', conclusion: null, head_branch: null }),
      headers: {},
      status: 200,
    }));
    const result = await relayWorkflowRun(client, 'o', 'r', 101);
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.conclusion).toBeNull();
    expect(result.value.headBranch).toBeNull();
    expect(result.value.status).toBe('in_progress');
  });

  it('finds runs for a head sha', async () => {
    const calls: Call[] = [];
    const client = fakeClient(call => {
      calls.push(call);
      return {
        data: {
          total_count: 3,
          workflow_runs: [
            runPayload({ id: 1 }),
            runPayload({ id: 2, head_sha: SHA_B }),
            runPayload({ id: 3 }),
          ],
        },
        headers: {},
        status: 200,
      };
    });
    const result = await findRunsForSha(client, 'o', 'r', SHA_A, { branch: 'feature' });
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.map(event => event.runId)).toEqual([1, 3]);
    expect(calls[0]?.args).toMatchObject({ branch: 'feature', per_page: 30 });
  });

  it('validates poll shapes at the boundary', async () => {
    const client = fakeClient(() => ({ data: runPayload(), headers: {}, status: 200 }));
    for (const pending of [
      relayWorkflowRun(client, '  ', 'r', 101),
      relayWorkflowRun(client, 'o', '  ', 101),
      relayWorkflowRun(client, 'o', 'r', 0),
      relayWorkflowRun(client, 'o', 'r', -2),
      relayWorkflowRun(client, 'o', 'r', 1.5),
      relayWorkflowRun(client, 'o', 'r', Number.NaN),
      relayWorkflowRun(client, 'o', 'r', '101' as unknown as number),
      relayWorkflowRun(null as unknown as ActionsClient, 'o', 'r', 101),
      relayWorkflowRun(undefined as unknown as ActionsClient, 'o', 'r', 101),
      findRunsForSha(client, 'o', 'r', 'zzz'),
      findRunsForSha(client, 'o', 'r', SHA_A, { perPage: 0 }),
      findRunsForSha(client, 'o', 'r', SHA_A, { perPage: 101 }),
      findRunsForSha(client, 'o', 'r', SHA_A, { branch: '  ' }),
    ]) {
      const resolved = await pending;
      expect(resolved.isErr()).toBe(true);
      if (resolved.isOk()) continue;
      expect(resolved.error.code).toBe('CONFIG_ERROR');
    }
  });

  it('refuses malformed runs fail-closed', async () => {
    for (const data of [
      { id: 'x', head_sha: SHA_A, status: 'completed', html_url: 'u' },
      { id: 1.5, head_sha: SHA_A, status: 'completed', html_url: 'u' },
      { id: 1, head_sha: 'short', status: 'completed', html_url: 'u' },
      { id: 1, head_sha: SHA_A, status: '  ', html_url: 'u' },
      { id: 1, head_sha: SHA_A, status: 'completed', html_url: 42 },
      42,
    ]) {
      const client = fakeClient(() => ({ data, headers: {}, status: 200 }));
      const result = await relayWorkflowRun(client, 'o', 'r', 101);
      expect(result.isErr()).toBe(true);
      if (result.isOk()) continue;
      expect(result.error.code).toBe('INTERNAL');
    }
    const badList = fakeClient(() => ({
      data: { workflow_runs: [{ id: 1 }] },
      headers: {},
      status: 200,
    }));
    const listed = await findRunsForSha(badList, 'o', 'r', SHA_A);
    expect(listed.isErr()).toBe(true);
    if (listed.isOk()) return;
    expect(listed.error.code).toBe('INTERNAL');
    const shaped = fakeClient(() => ({ data: {}, headers: {}, status: 200 }));
    const shapedResult = await findRunsForSha(shaped, 'o', 'r', SHA_A);
    expect(shapedResult.isErr()).toBe(true);
    if (shapedResult.isOk()) return;
    expect(shapedResult.error.code).toBe('INTERNAL');
    const nonObject = fakeClient(() => ({ data: 42, headers: {}, status: 200 }));
    const nonObjectResult = await findRunsForSha(nonObject, 'o', 'r', SHA_A);
    expect(nonObjectResult.isErr()).toBe(true);
    if (nonObjectResult.isOk()) return;
    expect(nonObjectResult.error.code).toBe('INTERNAL');
    const guardClient = fakeClient(() => ({ data: {}, headers: {}, status: 200 }));
    for (const pending of [
      findRunsForSha(null as unknown as ActionsClient, 'o', 'r', SHA_A),
      findRunsForSha(guardClient, '  ', 'r', SHA_A),
      findRunsForSha(guardClient, 'o', '  ', SHA_A),
    ]) {
      const resolved = await pending;
      expect(resolved.isErr()).toBe(true);
      if (resolved.isOk()) continue;
      expect(resolved.error.code).toBe('CONFIG_ERROR');
    }
  });
});

// ─── webhook verify ────────────────────────────────────────────────────

describe('webhook verify', () => {
  const SECRET = 'webhook-secret';
  const PAYLOAD = JSON.stringify({ action: 'completed' });

  function sign(secret: string, payload: string): string {
    return `sha256=${createHmac('sha256', secret).update(payload).digest('hex')}`;
  }

  it('accepts exact signatures only', () => {
    const good = sign(SECRET, PAYLOAD);
    expect(verifyWebhookSignature(SECRET, PAYLOAD, good)).toBe(true);
    expect(verifyWebhookSignature(SECRET, Buffer.from(PAYLOAD), good)).toBe(true);
  });

  it('rejects misuse shapes without throwing', () => {
    const good = sign(SECRET, PAYLOAD);
    expect(verifyWebhookSignature('', PAYLOAD, good)).toBe(false);
    expect(verifyWebhookSignature(42 as unknown as string, PAYLOAD, good)).toBe(false);
    expect(verifyWebhookSignature(SECRET, 42 as unknown as string, good)).toBe(false);
    expect(verifyWebhookSignature(SECRET, PAYLOAD, null)).toBe(false);
    expect(verifyWebhookSignature(SECRET, PAYLOAD, 42 as unknown as string)).toBe(false);
    expect(verifyWebhookSignature(SECRET, PAYLOAD, 'sha256=short')).toBe(false);
  });
});

// ─── spoof rejects ─────────────────────────────────────────────────────

describe('spoof rejects', () => {
  const SECRET = 'webhook-secret';

  function sign(secret: string, payload: string): string {
    return `sha256=${createHmac('sha256', secret).update(payload).digest('hex')}`;
  }

  it('rejects tampered payloads and wrong secrets', () => {
    const payload = JSON.stringify({ action: 'completed', conclusion: 'success' });
    const good = sign(SECRET, payload);
    expect(verifyWebhookSignature(SECRET, payload, good)).toBe(true);
    expect(verifyWebhookSignature(SECRET, payload + ' ', good)).toBe(false);
    expect(verifyWebhookSignature('other-secret', payload, good)).toBe(false);
    // Same length, wrong bytes: the timing-safe compare still refuses.
    const forged = `sha256=${'0'.repeat(64)}`;
    expect(verifyWebhookSignature(SECRET, payload, forged)).toBe(false);
  });

  it('maps deliveries only with valid signatures', async () => {
    const payload = {
      action: 'completed',
      workflow_run: { ...runPayload(), conclusion: 'failure' },
    };
    const raw = JSON.stringify(payload);
    const mapped = mapWebhookEvent('workflow_run', payload, sign(SECRET, raw), SECRET, raw);
    expect(mapped.isOk()).toBe(true);
    if (mapped.isErr()) return;
    expect(mapped.value.conclusion).toBe('failure');
    const spoofed = mapWebhookEvent('workflow_run', payload, sign('wrong', raw), SECRET, raw);
    expect(spoofed.isErr()).toBe(true);
    if (spoofed.isOk()) return;
    expect(spoofed.error.code).toBe('AUTH_ERROR');
  });

  it('maps check_run deliveries with check scope', async () => {
    const payload = {
      action: 'completed',
      check_run: {
        id: 555,
        head_sha: SHA_A,
        status: 'completed',
        conclusion: 'success',
        html_url: 'https://github.com/o/r/checks/555',
        check_suite: { head_branch: 'feature' },
      },
    };
    const raw = JSON.stringify(payload);
    const mapped = mapWebhookEvent('check_run', payload, sign(SECRET, raw), SECRET, raw);
    expect(mapped.isOk()).toBe(true);
    if (mapped.isErr()) return;
    expect(mapped.value).toMatchObject({
      kind: 'check_run',
      runId: 555,
      headSha: SHA_A,
      headBranch: 'feature',
    });
    const bare = mapWebhookEvent(
      'check_run',
      { check_run: { id: 1, head_sha: SHA_B, status: 'queued', conclusion: null, html_url: 'u' } },
      sign(SECRET, raw),
      SECRET,
      raw
    );
    expect(bare.isOk()).toBe(true);
    if (bare.isErr()) return;
    expect(bare.value.headBranch).toBeNull();
  });

  it('refuses unknown events and malformed deliveries', async () => {
    const raw = '{}';
    const sig = sign(SECRET, raw);
    for (const pending of [
      mapWebhookEvent('push', {}, sig, SECRET, raw),
      mapWebhookEvent('workflow_run', null, sig, SECRET, raw),
      mapWebhookEvent('workflow_run', { workflow_run: { id: 1 } }, sig, SECRET, raw),
      mapWebhookEvent('check_run', { check_run: { id: 'x' } }, sig, SECRET, raw),
      mapWebhookEvent('check_run', {}, sig, SECRET, raw),
    ]) {
      const resolved = await pending;
      expect(resolved.isErr()).toBe(true);
      if (resolved.isOk()) continue;
      expect(['CONFIG_ERROR', 'INTERNAL']).toContain(resolved.error.code);
    }
  });
});

// ─── correlates ────────────────────────────────────────────────────────

describe('correlates', () => {
  const EVENT: WorkflowRunEvent = {
    kind: 'workflow_run',
    runId: 101,
    headSha: SHA_A,
    headBranch: 'feature',
    status: 'completed',
    conclusion: 'success',
    url: 'https://github.com/o/r/actions/runs/101',
  };

  it('matches exact shas, preferring branch hits', () => {
    expect(correlateRunToJob(EVENT, [])).toBeNull();
    expect(correlateRunToJob(EVENT, [{ jobId: 'other', headSha: SHA_B }])).toBeNull();
    expect(
      correlateRunToJob(EVENT, [
        { jobId: 'stale', headSha: SHA_A, ref: 'old-branch' },
        { jobId: 'live', headSha: SHA_A, ref: 'feature' },
      ])
    ).toBe('live');
    expect(correlateRunToJob(EVENT, [{ jobId: 'only', headSha: SHA_A }])).toBe('only');
  });

  it('falls back to sha-only matching without branches', () => {
    const noBranch: WorkflowRunEvent = { ...EVENT, headBranch: null };
    expect(
      correlateRunToJob(noBranch, [
        { jobId: 'a', headSha: SHA_A, ref: 'x' },
        { jobId: 'b', headSha: SHA_A, ref: 'y' },
      ])
    ).toBe('a');
  });

  it('rejects misuse shapes', () => {
    expect(correlateRunToJob(null as unknown as WorkflowRunEvent, [])).toBeNull();
    expect(correlateRunToJob(EVENT, null as unknown as [])).toBeNull();
    expect(correlateRunToJob(EVENT, [{ jobId: 'x', headSha: 'short' }])).toBeNull();
    expect(
      correlateRunToJob({ ...EVENT, headSha: 'short' }, [{ jobId: 'x', headSha: SHA_A }])
    ).toBeNull();
    expect(
      correlateRunToJob(EVENT, [null, 'x'] as unknown as Array<{ jobId: string; headSha: string }>)
    ).toBeNull();
  });
});

// ─── errors ────────────────────────────────────────────────────────────

describe('errors', () => {
  it('maps endpoint failures with operation context', async () => {
    const failing = fakeClient(() => {
      throw reqError(500, 'boom');
    });
    const relayed = await relayWorkflowRun(failing, 'o', 'r', 101);
    expect(relayed.isErr()).toBe(true);
    if (relayed.isOk()) return;
    expect(relayed.error.code).toBe('GITHUB_API_ERROR');
    const denied = fakeClient(() => {
      throw reqError(401, 'denied');
    });
    const listed = await findRunsForSha(denied, 'o', 'r', SHA_A);
    expect(listed.isErr()).toBe(true);
    if (listed.isOk()) return;
    expect(listed.error.code).toBe('AUTH_ERROR');
    if (listed.error.code !== 'AUTH_ERROR') return;
    expect(listed.error.message).toContain('stitch login');
  });

  it('maps status-less throws, resolved non-2xx, and bare rejections', async () => {
    const hung = fakeClient(() => {
      throw new Error('socket hang up');
    });
    const hungResult = await relayWorkflowRun(hung, 'o', 'r', 101);
    expect(hungResult.isErr()).toBe(true);
    if (hungResult.isOk()) return;
    expect(hungResult.error.code).toBe('GITHUB_API_ERROR');
    const resolved = fakeClient(() => ({ data: {}, headers: {}, status: 503 }));
    const resolvedResult = await relayWorkflowRun(resolved, 'o', 'r', 101);
    expect(resolvedResult.isErr()).toBe(true);
    if (resolvedResult.isOk()) return;
    expect(resolvedResult.error.code).toBe('GITHUB_API_ERROR');
    const primitive: ActionsClient = {
      rest: {
        actions: {
          getWorkflowRun: () => Promise.reject(),
          listWorkflowRunsForRepo: async () => ({ data: {}, headers: {}, status: 200 }),
        },
      },
    };
    const prim = await relayWorkflowRun(primitive, 'o', 'r', 101);
    expect(prim.isErr()).toBe(true);
    if (prim.isOk()) return;
    expect(prim.error.code).toBe('GITHUB_API_ERROR');
  });

  it('reads every rate-limit shape on run calls', async () => {
    const shaped = async (status: number, headers: unknown, message: string) => {
      const client = fakeClient(() => {
        const error = new Error(message) as Error & { status: number; headers: unknown };
        error.status = status;
        (error as { headers: unknown }).headers = headers;
        throw error;
      });
      return relayWorkflowRun(client, 'o', 'r', 101);
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
    const nestedResult = await relayWorkflowRun(nested, 'o', 'r', 101);
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
    const nulledResult = await relayWorkflowRun(nulled, 'o', 'r', 101);
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
  it('relays real runs through real Octokit', async () => {
    const scope = nock('https://api.github.com').get('/repos/o/r/actions/runs/101').reply(200, {
      id: 101,
      head_sha: SHA_A,
      head_branch: 'feature',
      status: 'completed',
      conclusion: 'success',
      html_url: 'https://github.com/o/r/actions/runs/101',
    });
    const built = createValidatedClient({ auth: { authType: 'pat', token: 'ghp_test' } });
    if (built.isErr()) throw new Error('client construction failed');
    const result = await relayWorkflowRun(built.value, 'o', 'r', 101);
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.runId).toBe(101);
    expect(result.value.headSha).toBe(SHA_A);
    expect(scope.isDone()).toBe(true);
  });

  it('maps real 404s with operation context', async () => {
    nock('https://api.github.com').get('/repos/o/r/actions/runs/999').reply(404, {
      message: 'Not Found',
    });
    const built = createValidatedClient({ auth: { authType: 'pat', token: 'ghp_test' } });
    if (built.isErr()) throw new Error('client construction failed');
    const result = await relayWorkflowRun(built.value, 'o', 'r', 999);
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GITHUB_API_ERROR');
    if (result.error.code !== 'GITHUB_API_ERROR') return;
    expect(result.error.message).toContain('relayWorkflowRun');
  });
});
