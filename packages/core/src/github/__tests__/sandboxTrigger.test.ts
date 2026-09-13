// GitHub Actions sandbox trigger (P-100): dispatch a build/verify
// workflow (repository or workflow dispatch) with an allowlisted,
// secret-free payload, then monitor the run via the P-095 relay into
// a P-176-shaped verdict — over injected fakes (no network) plus nock
// proofs that the real Octokit satisfies the seam (method names AND
// wire shapes).

import { describe, it, expect, afterEach } from 'vitest';
import nock from 'nock';
import { cleanupHttpMocks } from '../../../test-utils/http.js';
import { createValidatedClient } from '../auth.js';
import { triggerSandbox, monitorSandboxRun, type SandboxTriggerClient } from '../sandboxTrigger.js';

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

function okResponse(data: unknown, status = 200): unknown {
  return { data, headers: {}, status };
}

function runPayload(
  id: number,
  sha: string,
  status: string,
  conclusion: string | null,
  branch: string | null = 'main'
): Record<string, unknown> {
  return {
    id,
    head_sha: sha,
    head_branch: branch,
    status,
    conclusion,
    html_url: `https://github.com/o/r/actions/runs/${id}`,
  };
}

function listBody(runs: unknown[]): unknown {
  return okResponse({ total_count: runs.length, workflow_runs: runs });
}

interface Call {
  kind: 'dispatch' | 'workflowDispatch' | 'listRuns' | 'getRun';
  args: Record<string, unknown>;
}

/** Fake client serving scripted payloads while recording calls. */
function fakeClient(handler: (call: Call) => unknown): SandboxTriggerClient {
  const wrap =
    (kind: Call['kind']) =>
    async (
      args: Record<string, unknown>
    ): Promise<{
      data: unknown;
      headers: unknown;
      status: number;
    }> => {
      const out = handler({ kind, args: { ...args } });
      if (out instanceof Error) throw out;
      return out as { data: unknown; headers: unknown; status: number };
    };
  return {
    rest: {
      repos: {
        createDispatchEvent: wrap('dispatch'),
      },
      actions: {
        createWorkflowDispatch: wrap('workflowDispatch'),
        getWorkflowRun: wrap('getRun'),
        listWorkflowRunsForRepo: wrap('listRuns'),
      },
    },
  };
}

function baseTrigger(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sha: SHA_A,
    ecosystem: 'node',
    ref: 'main',
    jobId: 'job-1',
    ...overrides,
  };
}

async function triggerOk(client: SandboxTriggerClient, overrides: Record<string, unknown> = {}) {
  return triggerSandbox(client, 'o', 'r', {
    sha: SHA_A,
    ecosystem: 'node',
    ref: 'main',
    jobId: 'job-1',
    ...overrides,
  } as Parameters<typeof triggerSandbox>[3]);
}

// ─── spec-required ─────────────────────────────────────────────────────

describe('triggers', () => {
  it('dispatches', async () => {
    const seen: Call[] = [];
    const client = fakeClient(call => {
      seen.push(call);
      return okResponse({}, 204);
    });
    const result = await triggerOk(client, { timeoutMinutes: 30 });
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value).toEqual({
      owner: 'o',
      repo: 'r',
      dispatch: 'repository',
      sha: SHA_A,
      ref: 'main',
      ecosystem: 'node',
      jobId: 'job-1',
      timeoutMinutes: 30,
    });
    expect(seen).toHaveLength(1);
    // Allowlisted payload: exactly these fields, nothing else.
    expect(seen[0]?.args).toEqual({
      owner: 'o',
      repo: 'r',
      event_type: 'sandbox-run',
      client_payload: {
        sha: SHA_A,
        ecosystem: 'node',
        ref: 'main',
        job_id: 'job-1',
        timeout_minutes: 30,
      },
    });
  });

  it('dispatches minimal payloads without optional fields', async () => {
    const seen: Call[] = [];
    const client = fakeClient(call => {
      seen.push(call);
      return okResponse({}, 204);
    });
    const result = await triggerSandbox(client, 'o', 'r', {
      sha: SHA_A,
      ecosystem: 'node',
      jobId: 'job-1',
      clientPayload: { reason: 'verify' },
    });
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value).toEqual({
      owner: 'o',
      repo: 'r',
      dispatch: 'repository',
      sha: SHA_A,
      ecosystem: 'node',
      jobId: 'job-1',
    });
    expect(seen).toHaveLength(1);
    const args = seen[0]?.args as Record<string, unknown>;
    const payload = args.client_payload as Record<string, unknown>;
    expect(payload).toEqual({ sha: SHA_A, ecosystem: 'node', job_id: 'job-1', reason: 'verify' });
    expect('ref' in payload).toBe(false);
    expect('timeout_minutes' in payload).toBe(false);
  });

  it('dispatches workflows with string inputs', async () => {
    const seen: Call[] = [];
    const client = fakeClient(call => {
      seen.push(call);
      return okResponse({}, 204);
    });
    const result = await triggerOk(client, {
      dispatch: 'workflow',
      workflow: 'build.yml',
      timeoutMinutes: 30,
      inputs: { node_version: '22' },
    });
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.dispatch).toBe('workflow');
    expect(result.value.workflow).toBe('build.yml');
    expect(seen).toHaveLength(1);
    expect(seen[0]?.args).toEqual({
      owner: 'o',
      repo: 'r',
      workflow_id: 'build.yml',
      ref: 'main',
      inputs: {
        sha: SHA_A,
        ecosystem: 'node',
        job_id: 'job-1',
        timeout_minutes: '30',
        node_version: '22',
      },
    });
  });

  it('correlates', async () => {
    const client = fakeClient(call => {
      if (call.kind === 'listRuns') {
        return listBody([runPayload(101, SHA_A, 'completed', 'success')]);
      }
      return okResponse(runPayload(101, SHA_A, 'completed', 'success'));
    });
    const result = await monitorSandboxRun(client, 'o', 'r', SHA_A, { jobId: 'job-1' });
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    // The run found for the sha ties back to the dispatching job.
    expect(result.value.jobId).toBe('job-1');
    expect(result.value.runId).toBe(101);
    expect(result.value.sha).toBe(SHA_A);
    expect(result.value.url).toBe('https://github.com/o/r/actions/runs/101');
  });

  it('scopes the run search by branch', async () => {
    const seen: Call[] = [];
    const client = fakeClient(call => {
      seen.push(call);
      if (call.kind === 'listRuns') {
        return listBody([runPayload(101, SHA_A, 'completed', 'success', 'feature')]);
      }
      return okResponse(runPayload(101, SHA_A, 'completed', 'success', 'feature'));
    });
    const result = await monitorSandboxRun(client, 'o', 'r', SHA_A, {
      jobId: 'job-1',
      branch: 'feature',
    });
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.pass).toBe(true);
    expect(seen[0]?.args).toMatchObject({ branch: 'feature' });
  });

  it('maps result', async () => {
    const cases: Array<[string | null, string, boolean, boolean]> = [
      ['success', 'completed', true, true],
      ['failure', 'completed', true, false],
      ['timed_out', 'completed', true, false],
      ['cancelled', 'completed', true, false],
      ['action_required', 'completed', true, false],
      [null, 'in_progress', false, false],
    ];
    for (const [conclusion, status, completed, pass] of cases) {
      const client = fakeClient(call => {
        if (call.kind === 'listRuns') {
          return listBody([runPayload(101, SHA_A, status, conclusion)]);
        }
        return okResponse(runPayload(101, SHA_A, status, conclusion));
      });
      const result = await monitorSandboxRun(client, 'o', 'r', SHA_A, { jobId: 'job-1' });
      expect(result.isOk()).toBe(true);
      if (result.isErr()) continue;
      expect(result.value.completed).toBe(completed);
      expect(result.value.conclusion).toBe(conclusion);
      expect(result.value.pass).toBe(pass);
      // Single observations never claim flakiness: P-176 owns
      // repeat-based detection (checkFlaky), so this stays false here
      // and the field exists for its verdicts to flow through.
      expect(result.value.flaky).toBe(false);
    }
  });

  it('no secrets', async () => {
    const seen: Call[] = [];
    const client = fakeClient(call => {
      seen.push(call);
      return okResponse({}, 204);
    });
    // Secret-named keys refuse BEFORE any dispatch call.
    const viaInputs = await triggerOk(client, {
      dispatch: 'workflow',
      workflow: 'build.yml',
      inputs: { api_token: 'ghp_hidden' },
    });
    expect(viaInputs.isErr()).toBe(true);
    if (viaInputs.isOk()) return;
    expect(viaInputs.error.code).toBe('CONFIG_ERROR');
    if (viaInputs.error.code !== 'CONFIG_ERROR') return;
    expect(viaInputs.error.field).toBe('inputs');

    const viaPayload = await triggerOk(client, {
      clientPayload: { privateKey: '-----BEGIN-----' },
    });
    expect(viaPayload.isErr()).toBe(true);
    if (viaPayload.isOk()) return;
    expect(viaPayload.error.code).toBe('CONFIG_ERROR');
    if (viaPayload.error.code !== 'CONFIG_ERROR') return;
    expect(viaPayload.error.field).toBe('clientPayload');

    expect(seen).toHaveLength(0);
  });
});

// ─── backend selection ─────────────────────────────────────────────────

describe('selects backend', () => {
  it('refuses the unimplemented local backend loudly', async () => {
    const seen: Call[] = [];
    const client = fakeClient(call => {
      seen.push(call);
      return okResponse({}, 204);
    });
    const result = await triggerOk(client, { backend: 'local-docker' });
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('CONFIG_ERROR');
    if (result.error.code !== 'CONFIG_ERROR') return;
    expect(result.error.field).toBe('backend');
    expect(seen).toHaveLength(0);
  });
});

// ─── boundary ──────────────────────────────────────────────────────────

describe('boundary', () => {
  it('validates trigger shapes at the boundary', async () => {
    const client = fakeClient(() => okResponse({}, 204));
    const bad = {
      sha: 'main',
      ecosystem: '  ',
      ref: '  ',
      jobId: '  ',
      timeoutMinutes: 0,
      dispatch: 'push',
      workflow: '  ',
      backend: 'ci',
      inputs: { node_version: 22 },
    };
    const cases: Array<[Promise<unknown>, string]> = [
      [triggerSandbox(client, '  ', 'r', baseTrigger() as never), 'owner'],
      [triggerSandbox(client, 'o', '  ', baseTrigger() as never), 'repo'],
      [triggerOk(client, { sha: bad.sha }), 'sha'],
      [triggerOk(client, { ecosystem: bad.ecosystem }), 'ecosystem'],
      [triggerOk(client, { ref: bad.ref }), 'ref'],
      [triggerOk(client, { jobId: bad.jobId }), 'jobId'],
      [triggerOk(client, { timeoutMinutes: bad.timeoutMinutes }), 'timeoutMinutes'],
      [triggerOk(client, { timeoutMinutes: 1.5 }), 'timeoutMinutes'],
      [triggerOk(client, { dispatch: bad.dispatch }), 'dispatch'],
      [triggerOk(client, { dispatch: 'workflow' }), 'workflow'],
      [
        triggerOk(client, { dispatch: 'workflow', workflow: bad.workflow, ref: 'main' }),
        'workflow',
      ],
      [triggerOk(client, { dispatch: 'workflow', workflow: 'b.yml', ref: undefined }), 'ref'],
      [triggerOk(client, { backend: bad.backend }), 'backend'],
      [triggerOk(client, { eventType: '  ' }), 'eventType'],
      [triggerOk(client, { inputs: 'x' as never }), 'inputs'],
      [triggerSandbox(client, 'o', 'r', null as never), 'opts'],
      [
        triggerOk(client, {
          dispatch: 'workflow',
          workflow: 'b.yml',
          ref: 'main',
          inputs: bad.inputs as never,
        }),
        'inputs',
      ],
      [triggerOk(client, { clientPayload: ['x'] as never }), 'clientPayload'],
      [triggerSandbox(null as never, 'o', 'r', baseTrigger() as never), 'client'],
      [triggerSandbox(undefined as never, 'o', 'r', baseTrigger() as never), 'client'],
    ];
    for (const [pending, field] of cases) {
      const result = await pending;
      expect(result).toBeDefined();
      if (!(typeof result === 'object' && result !== null && 'isErr' in result)) {
        throw new Error('expected a Result');
      }
      const typed = result as { isErr(): boolean; error?: { code?: string; field?: string } };
      expect(typed.isErr()).toBe(true);
      expect(typed.error?.code).toBe('CONFIG_ERROR');
      expect(typed.error?.field).toBe(field);
    }
  });

  it('validates monitor shapes at the boundary', async () => {
    const client = fakeClient(() => listBody([]));
    const cases: Array<[Promise<unknown>, string]> = [
      [monitorSandboxRun(client, '  ', 'r', SHA_A, { jobId: 'j' }), 'owner'],
      [monitorSandboxRun(client, 'o', '  ', SHA_A, { jobId: 'j' }), 'repo'],
      [monitorSandboxRun(client, 'o', 'r', 'main', { jobId: 'j' }), 'sha'],
      [monitorSandboxRun(client, 'o', 'r', SHA_A, { jobId: '  ' }), 'jobId'],
      [monitorSandboxRun(client, 'o', 'r', SHA_A, { jobId: 'j', branch: '  ' }), 'branch'],
      [monitorSandboxRun(client, 'o', 'r', SHA_A, null as never), 'opts'],
      [monitorSandboxRun(null as never, 'o', 'r', SHA_A, { jobId: 'j' }), 'client'],
    ];
    for (const [pending, field] of cases) {
      const result = await pending;
      expect(result).toBeDefined();
      if (!(typeof result === 'object' && result !== null && 'isErr' in result)) {
        throw new Error('expected a Result');
      }
      const typed = result as { isErr(): boolean; error?: { code?: string; field?: string } };
      expect(typed.isErr()).toBe(true);
      expect(typed.error?.code).toBe('CONFIG_ERROR');
      expect(typed.error?.field).toBe(field);
    }
  });
});

// ─── errors ────────────────────────────────────────────────────────────

describe('errors', () => {
  it('maps dispatch failures to typed errors', async () => {
    const missing = fakeClient(() => ({ data: null, headers: {}, status: 404 }));
    const missingResult = await triggerOk(missing);
    expect(missingResult.isErr()).toBe(true);
    if (missingResult.isOk()) return;
    expect(missingResult.error.code).toBe('GITHUB_API_ERROR');
    if (missingResult.error.code !== 'GITHUB_API_ERROR') return;
    expect(missingResult.error.status).toBe(404);

    const denied = fakeClient(() => {
      throw reqError(401, 'Bad credentials');
    });
    const deniedResult = await triggerOk(denied);
    expect(deniedResult.isErr()).toBe(true);
    if (deniedResult.isOk()) return;
    expect(deniedResult.error.code).toBe('AUTH_ERROR');
    if (deniedResult.error.code !== 'AUTH_ERROR') return;
    expect(deniedResult.error.message).toContain('stitch login');

    const limited = fakeClient(() => {
      const error = reqError(403, 'API rate limit exceeded');
      (error as Error & { headers?: unknown }).headers = { 'x-ratelimit-remaining': '0' };
      throw error;
    });
    const limitedResult = await triggerOk(limited);
    expect(limitedResult.isErr()).toBe(true);
    if (limitedResult.isOk()) return;
    expect(limitedResult.error.code).toBe('GITHUB_API_ERROR');
    if (limitedResult.error.code !== 'GITHUB_API_ERROR') return;
    expect(limitedResult.error.message).toContain('rate limited');
  });

  it('maps workflow dispatch and plain failures', async () => {
    const failed = fakeClient(call => {
      if (call.kind === 'workflowDispatch') throw reqError(500, 'Server Error');
      return okResponse({}, 204);
    });
    const failedResult = await triggerOk(failed, {
      dispatch: 'workflow',
      workflow: 'build.yml',
    });
    expect(failedResult.isErr()).toBe(true);
    if (failedResult.isOk()) return;
    expect(failedResult.error.code).toBe('GITHUB_API_ERROR');
    if (failedResult.error.code !== 'GITHUB_API_ERROR') return;
    expect(failedResult.error.status).toBe(500);

    const plain = fakeClient(() => {
      throw new Error('socket hang up');
    });
    const plainResult = await triggerOk(plain);
    expect(plainResult.isErr()).toBe(true);
    if (plainResult.isOk()) return;
    expect(plainResult.error.code).toBe('GITHUB_API_ERROR');
    if (plainResult.error.code !== 'GITHUB_API_ERROR') return;
    expect(plainResult.error.status).toBe(0);
  });

  it('fails fast when no runs exist for the sha', async () => {
    const client = fakeClient(call => {
      if (call.kind === 'listRuns') return listBody([]);
      return okResponse(runPayload(101, SHA_A, 'completed', 'success'));
    });
    const result = await monitorSandboxRun(client, 'o', 'r', SHA_A, { jobId: 'job-1' });
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GITHUB_API_ERROR');
    if (result.error.code !== 'GITHUB_API_ERROR') return;
    expect(result.error.status).toBe(0);
    expect(result.error.message).toContain('no workflow runs');
  });

  it('refuses drifted and malformed runs instead of misattributing', async () => {
    const drifted = fakeClient(call => {
      if (call.kind === 'listRuns') {
        return listBody([runPayload(101, SHA_A, 'completed', 'success')]);
      }
      return okResponse(runPayload(101, SHA_B, 'completed', 'success'));
    });
    const driftedResult = await monitorSandboxRun(drifted, 'o', 'r', SHA_A, { jobId: 'job-1' });
    expect(driftedResult.isErr()).toBe(true);
    if (driftedResult.isOk()) return;
    expect(driftedResult.error.code).toBe('INTERNAL');

    const malformed = fakeClient(call => {
      if (call.kind === 'listRuns') return listBody([{ id: 'x' }]);
      return okResponse(runPayload(101, SHA_A, 'completed', 'success'));
    });
    const malformedResult = await monitorSandboxRun(malformed, 'o', 'r', SHA_A, {
      jobId: 'job-1',
    });
    expect(malformedResult.isErr()).toBe(true);
    if (malformedResult.isOk()) return;
    expect(malformedResult.error.code).toBe('INTERNAL');
  });

  it('maps relay failures to typed errors', async () => {
    const client = fakeClient(call => {
      if (call.kind === 'listRuns') {
        return listBody([runPayload(101, SHA_A, 'completed', 'success')]);
      }
      throw reqError(404, 'Not Found');
    });
    const result = await monitorSandboxRun(client, 'o', 'r', SHA_A, { jobId: 'job-1' });
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GITHUB_API_ERROR');
    if (result.error.code !== 'GITHUB_API_ERROR') return;
    expect(result.error.status).toBe(404);
  });
});

// ─── rate limit guidance ───────────────────────────────────────────────

describe('rate limit guidance', () => {
  async function limitedMessage(headers: unknown): Promise<string | null> {
    const client = fakeClient(() => {
      const error = reqError(429, 'Too Many Requests');
      (error as Error & { headers?: unknown }).headers = headers;
      throw error;
    });
    const result = await triggerOk(client);
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return null;
    expect(result.error.code).toBe('GITHUB_API_ERROR');
    if (result.error.code !== 'GITHUB_API_ERROR') return null;
    return result.error.message;
  }

  it('reports retry-after seconds when the server names them', async () => {
    const message = await limitedMessage({ 'retry-after': '45' });
    expect(message).toContain('retry after 45s');
  });

  it('falls back to the reset epoch when retry-after is absent', async () => {
    const reset = String(Math.floor(Date.now() / 1000) + 100);
    const message = await limitedMessage({ 'x-ratelimit-reset': reset });
    expect(message).toContain('retry after');
    expect(message).not.toContain('retry delay unknown');
  });

  it('ignores unparsable retry headers instead of failing', async () => {
    const garbage = await limitedMessage({ 'retry-after': 'soon' });
    expect(garbage).toContain('retry delay unknown');
    const badReset = await limitedMessage({ 'x-ratelimit-reset': 'not-a-number' });
    expect(badReset).toContain('retry delay unknown');
    const nonObject = await limitedMessage(42);
    expect(nonObject).toContain('retry delay unknown');
    const nulled = await limitedMessage(null);
    expect(nulled).toContain('retry delay unknown');
  });

  it('reads Headers instances through the getter', async () => {
    const message = await limitedMessage({
      get: (name: string) => (name === 'retry-after' ? '30' : null),
    });
    expect(message).toContain('retry after 30s');
  });

  it('treats non-string getter results as absent', async () => {
    const message = await limitedMessage({ get: () => 42 });
    expect(message).toContain('retry delay unknown');
  });

  it('matches rate limits by header and by message', async () => {
    const headered = fakeClient(() => {
      const error = reqError(403, 'Forbidden');
      (error as Error & { headers?: unknown }).headers = { 'x-ratelimit-remaining': '0' };
      throw error;
    });
    const headeredResult = await triggerOk(headered);
    expect(headeredResult.isErr()).toBe(true);
    if (headeredResult.isOk()) return;
    expect(headeredResult.error.code).toBe('GITHUB_API_ERROR');
    if (headeredResult.error.code !== 'GITHUB_API_ERROR') return;
    expect(headeredResult.error.message).toContain('rate limited');

    const messaged = fakeClient(() => {
      throw reqError(403, 'API rate limit exceeded for installation');
    });
    const messagedResult = await triggerOk(messaged);
    expect(messagedResult.isErr()).toBe(true);
    if (messagedResult.isOk()) return;
    expect(messagedResult.error.code).toBe('GITHUB_API_ERROR');
    if (messagedResult.error.code !== 'GITHUB_API_ERROR') return;
    expect(messagedResult.error.message).toContain('rate limited');
  });

  it('reads headers nested under response like real RequestErrors', async () => {
    const client = fakeClient(() => {
      const error = reqError(429, 'Too Many Requests') as Error & {
        response?: { headers?: unknown };
      };
      error.response = { headers: { 'retry-after': '12' } };
      throw error;
    });
    const result = await triggerOk(client);
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GITHUB_API_ERROR');
    if (result.error.code !== 'GITHUB_API_ERROR') return;
    expect(result.error.message).toContain('retry after 12s');
  });

  it('maps non-Error rejections without throwing', async () => {
    const thrown: SandboxTriggerClient = {
      rest: {
        repos: {
          createDispatchEvent: () => Promise.reject('boom'),
        },
        actions: {
          createWorkflowDispatch: () => Promise.reject('boom'),
          getWorkflowRun: () => Promise.reject('boom'),
          listWorkflowRunsForRepo: () => Promise.reject('boom'),
        },
      },
    };
    const result = await triggerOk(thrown);
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GITHUB_API_ERROR');
    if (result.error.code !== 'GITHUB_API_ERROR') return;
    expect(result.error.status).toBe(0);
  });
});

// ─── nock end to end ───────────────────────────────────────────────────

describe('nock end to end', () => {
  it('dispatches repository events through real Octokit', async () => {
    const scope = nock('https://api.github.com')
      .post('/repos/o/r/dispatches', {
        event_type: 'sandbox-run',
        client_payload: {
          sha: SHA_A,
          ecosystem: 'node',
          ref: 'main',
          job_id: 'job-1',
          timeout_minutes: 30,
        },
      })
      .reply(204);
    const built = createValidatedClient({ auth: { authType: 'pat', token: 'ghp_test' } });
    if (built.isErr()) throw new Error('client construction failed');
    const result = await triggerSandbox(built.value, 'o', 'r', {
      sha: SHA_A,
      ecosystem: 'node',
      ref: 'main',
      jobId: 'job-1',
      timeoutMinutes: 30,
    });
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.dispatch).toBe('repository');
    expect(scope.isDone()).toBe(true);
  });

  it('dispatches workflows through real Octokit', async () => {
    const scope = nock('https://api.github.com')
      .post('/repos/o/r/actions/workflows/build.yml/dispatches', {
        ref: 'main',
        inputs: { sha: SHA_A, ecosystem: 'node', job_id: 'job-1' },
      })
      .reply(204);
    const built = createValidatedClient({ auth: { authType: 'pat', token: 'ghp_test' } });
    if (built.isErr()) throw new Error('client construction failed');
    const result = await triggerSandbox(built.value, 'o', 'r', {
      sha: SHA_A,
      ecosystem: 'node',
      ref: 'main',
      jobId: 'job-1',
      dispatch: 'workflow',
      workflow: 'build.yml',
    });
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.workflow).toBe('build.yml');
    expect(scope.isDone()).toBe(true);
  });

  it('monitors runs through real Octokit', async () => {
    const scope = nock('https://api.github.com')
      .get('/repos/o/r/actions/runs')
      .query(true)
      .reply(200, {
        total_count: 1,
        workflow_runs: [runPayload(101, SHA_A, 'completed', 'success')],
      })
      .get('/repos/o/r/actions/runs/101')
      .reply(200, runPayload(101, SHA_A, 'completed', 'success'));
    const built = createValidatedClient({ auth: { authType: 'pat', token: 'ghp_test' } });
    if (built.isErr()) throw new Error('client construction failed');
    const result = await monitorSandboxRun(built.value, 'o', 'r', SHA_A, { jobId: 'job-1' });
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.pass).toBe(true);
    expect(result.value.jobId).toBe('job-1');
    expect(scope.isDone()).toBe(true);
  });
});
