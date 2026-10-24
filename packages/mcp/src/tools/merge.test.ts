// P-359 - unit tests for the MCP merge tools.
//
// The job provider is a PORT, so every case here is deterministic and offline:
// the fake provider stands in for the core job queue (P-239), which this lane
// cannot reach through the barrel (see ADR-168).

import { err, ok, type Result } from 'neverthrow';
import type { StitchError } from '@repo-stitcher/core';
import { describe, expect, it } from 'vitest';

import { toProgressNotification } from '../progress.js';
import { createMCPServer } from '../server.js';
import {
  configError,
  createMergeToolHandler,
  loadMergePorts,
  registerMergeTool,
  STITCH_MERGE_TOOL_NAME,
  type MergeJobListener,
  type MergeJobProgress,
  type MergeJobRequest,
  type MergeJobSnapshot,
  type MergePorts,
  type ProgressNotification,
} from './merge.js';
import {
  createCancelJobHandler,
  createJobStatusHandler,
  isTerminalStatus,
  registerJobStatusTools,
  STITCH_CANCEL_JOB_TOOL_NAME,
  STITCH_JOB_STATUS_TOOL_NAME,
} from './job-status.js';
import { createToolRegistry, type ToolHandler } from './registry.js';

type AnyResult = Result<Record<string, unknown>, StitchError>;

const PROGRESS: MergeJobProgress = { completed: 0, total: 3 };

interface FakeJobs {
  readonly ports: MergePorts;
  readonly created: MergeJobRequest[];
  readonly notifications: ProgressNotification[];
  subscribeCount(): number;
  releaseCount(): number;
  setStatus(snapshot: MergeJobSnapshot): void;
  push(snapshot: MergeJobSnapshot): void;
}

/** An in-memory stand-in for core's job queue: no git, no Docker, no AI. */
function createFakeJobs(): FakeJobs {
  const created: MergeJobRequest[] = [];
  const notifications: ProgressNotification[] = [];
  const listeners = new Set<MergeJobListener>();
  const snapshots = new Map<string, MergeJobSnapshot>();
  let subscribes = 0;
  let releases = 0;

  // `job-1` is seeded so a status poll does not need a preceding merge call.
  snapshots.set('job-1', { jobId: 'job-1', status: 'queued', progress: PROGRESS });

  const ports: MergePorts = {
    createJob: async request => {
      created.push(request);
      snapshots.set('job-1', { jobId: 'job-1', status: 'running', progress: PROGRESS });
      return ok({ jobId: 'job-1' });
    },
    getJob: async jobId => ok(snapshots.get(jobId)),
    cancelJob: async jobId => {
      const current = snapshots.get(jobId);
      if (current === undefined) return ok<MergeJobSnapshot | undefined, StitchError>(undefined);
      const cancelled: MergeJobSnapshot = { ...current, status: 'cancelled' };
      snapshots.set(jobId, cancelled);
      return ok(cancelled);
    },
    subscribe: async (_jobId, listener) => {
      subscribes += 1;
      listeners.add(listener);
      return ok(() => {
        releases += 1;
        listeners.delete(listener);
      });
    },
    notify: notification => {
      notifications.push(notification);
    },
  };

  return {
    ports,
    created,
    notifications,
    subscribeCount: () => subscribes,
    releaseCount: () => releases,
    setStatus: snapshot => {
      snapshots.set(snapshot.jobId, snapshot);
    },
    push: snapshot => {
      snapshots.set(snapshot.jobId, snapshot);
      for (const listener of [...listeners]) listener(snapshot);
    },
  };
}

async function callOk(handler: ToolHandler, args: Record<string, unknown>): Promise<AnyResult> {
  const outcome = (await handler(args)) as AnyResult;
  if (outcome.isErr()) throw new Error(`expected a payload, got ${outcome.error.code}`);
  return outcome;
}

async function callErr(handler: ToolHandler, args: Record<string, unknown>): Promise<StitchError> {
  const outcome = (await handler(args)) as AnyResult;
  if (outcome.isOk()) throw new Error('expected an error, got a payload');
  return outcome.error;
}

const MERGE_ARGS: Record<string, unknown> = {
  repo_a: 'https://example.invalid/a.git',
  repo_b: 'https://example.invalid/b.git',
  paths_a: ['src'],
  paths_b: ['src'],
};

describe('stitch_merge (P-359)', () => {
  it('creates a job and returns its identifier', async () => {
    const jobs = createFakeJobs();
    const payload = await callOk(createMergeToolHandler(jobs.ports), MERGE_ARGS);

    expect(payload._unsafeUnwrap()).toEqual({ job_id: 'job-1' });
    expect(jobs.created).toHaveLength(1);
    expect(jobs.created[0]?.repoA).toBe('https://example.invalid/a.git');
    expect(jobs.created[0]?.repoB).toBe('https://example.invalid/b.git');
    expect(jobs.created[0]?.pathsA).toEqual(['src']);
    expect(jobs.created[0]?.pathsB).toEqual(['src']);
  });

  it('refuses an input that cannot start a job', async () => {
    const handler = createMergeToolHandler(createFakeJobs().ports);

    for (const args of [
      { repo_b: MERGE_ARGS['repo_b'], paths_a: ['src'], paths_b: ['src'] },
      { repo_a: MERGE_ARGS['repo_a'], paths_a: ['src'], paths_b: ['src'] },
      { ...MERGE_ARGS, paths_a: 'src' },
      { ...MERGE_ARGS, paths_b: [1] },
      { ...MERGE_ARGS, options: 'nope' },
    ]) {
      expect((await callErr(handler, args)).code).toBe('CONFIG_ERROR');
    }
  });

  it('surfaces a provider failure', async () => {
    const jobs = createFakeJobs();
    const handler = createMergeToolHandler({
      ...jobs.ports,
      createJob: async () =>
        err(configError('mcp.core', 'no job api')) as Result<never, StitchError>,
    });

    expect((await callErr(handler, MERGE_ARGS)).code).toBe('CONFIG_ERROR');
  });

  it('refuses every call when the core barrel exposes no job API', async () => {
    const ports = await loadMergePorts();
    const refused = (await ports.createJob({
      repoA: 'a',
      repoB: 'b',
      pathsA: [],
      pathsB: [],
      options: {},
    })) as Result<unknown, StitchError>;

    expect(refused.isErr()).toBe(true);
    expect(refused._unsafeUnwrapErr()).toEqual({
      code: 'CONFIG_ERROR',
      field: 'mcp.core',
      message: expect.stringContaining('no job API'),
    });
    expect(() => ports.notify(toProgressNotification('tok-1', 1, 3))).not.toThrow();
  });
});

describe('stitch_job_status (P-359)', () => {
  it('reports the status and the progress of a known job', async () => {
    const jobs = createFakeJobs();
    jobs.setStatus({
      jobId: 'job-1',
      status: 'succeeded',
      progress: { completed: 3, total: 3, stage: 'provenance' },
      result: { commitTarget: '/tmp/c' },
    });

    const payload = await callOk(createJobStatusHandler(jobs.ports), { job_id: 'job-1' });
    expect(payload._unsafeUnwrap()).toEqual({
      status: 'succeeded',
      progress: { completed: 3, total: 3, stage: 'provenance' },
      result: { commitTarget: '/tmp/c' },
    });
    expect(jobs.subscribeCount()).toBe(0);
  });

  it('refuses an unknown job and a malformed job identifier', async () => {
    const handler = createJobStatusHandler(createFakeJobs().ports);

    expect(await callErr(handler, { job_id: 'nope' })).toEqual(
      expect.objectContaining({ code: 'CONFIG_ERROR', field: 'stitch_job_status.job_id' })
    );
    expect((await callErr(handler, {})).code).toBe('CONFIG_ERROR');
    expect((await callErr(handler, { job_id: 7 })).code).toBe('CONFIG_ERROR');
  });

  it('streams progress notifications until the job settles', async () => {
    const jobs = createFakeJobs();
    const payload = await callOk(createJobStatusHandler(jobs.ports), {
      job_id: 'job-1',
      progress_token: 'tok-1',
    });
    expect(payload._unsafeUnwrap()).toEqual(expect.objectContaining({ status: 'queued' }));
    expect(jobs.subscribeCount()).toBe(1);

    jobs.push({ jobId: 'job-1', status: 'running', progress: { completed: 1, total: 3 } });
    jobs.push({ jobId: 'job-1', status: 'succeeded', progress: { completed: 3, total: 3 } });
    jobs.push({ jobId: 'job-1', status: 'failed', progress: { completed: 3, total: 3 } });

    expect(jobs.notifications.map(entry => entry.params.progress)).toEqual([1, 3]);
    expect(jobs.notifications.map(entry => entry.params.total)).toEqual([3, 3]);
    expect(jobs.notifications.map(entry => entry.params.progressToken)).toEqual(['tok-1', 'tok-1']);
    expect(jobs.releaseCount()).toBe(1);
  });

  it('does not subscribe without a token or for a settled job', async () => {
    const jobs = createFakeJobs();
    await callOk(createJobStatusHandler(jobs.ports), { job_id: 'job-1' });
    expect(jobs.subscribeCount()).toBe(0);

    const settled = createFakeJobs();
    settled.setStatus({ jobId: 'job-1', status: 'cancelled', progress: PROGRESS });
    await callOk(createJobStatusHandler(settled.ports), {
      job_id: 'job-1',
      progress_token: 'tok-1',
    });
    expect(settled.subscribeCount()).toBe(0);
  });
});

describe('stitch_cancel_job (P-359)', () => {
  it('returns the cancelled snapshot', async () => {
    const jobs = createFakeJobs();
    const payload = await callOk(createCancelJobHandler(jobs.ports), { job_id: 'job-1' });

    expect(payload._unsafeUnwrap()).toEqual(
      expect.objectContaining({ status: 'cancelled', progress: PROGRESS })
    );
  });

  it('refuses an unknown job', async () => {
    const error = await callErr(createCancelJobHandler(createFakeJobs().ports), {
      job_id: 'nope',
    });
    expect(error).toEqual(
      expect.objectContaining({ code: 'CONFIG_ERROR', field: 'stitch_cancel_job.job_id' })
    );
  });
});

describe('merge tool helpers (P-359)', () => {
  it('classifies terminal statuses', () => {
    expect(isTerminalStatus('queued')).toBe(false);
    expect(isTerminalStatus('running')).toBe(false);
    expect(isTerminalStatus('succeeded')).toBe(true);
    expect(isTerminalStatus('failed')).toBe(true);
    expect(isTerminalStatus('cancelled')).toBe(true);
  });

  it('shapes an MCP progress notification', () => {
    expect(toProgressNotification(42, 2, 3, 'deps')).toEqual({
      jsonrpc: '2.0',
      method: 'notifications/progress',
      params: { progressToken: 42, progress: 2, total: 3, message: 'deps' },
    });
  });

  it('registers the three tools and serves them through the MCP server', async () => {
    const jobs = createFakeJobs();
    const registry = createToolRegistry();
    const merged = registerMergeTool(registry, jobs.ports);
    const jobTools = registerJobStatusTools(registry, jobs.ports);

    expect(merged._unsafeUnwrap()).toEqual([STITCH_MERGE_TOOL_NAME]);
    expect(jobTools._unsafeUnwrap()).toEqual([
      STITCH_JOB_STATUS_TOOL_NAME,
      STITCH_CANCEL_JOB_TOOL_NAME,
    ]);
    expect(registry.names()).toEqual([
      STITCH_CANCEL_JOB_TOOL_NAME,
      STITCH_JOB_STATUS_TOOL_NAME,
      STITCH_MERGE_TOOL_NAME,
    ]);

    const server = createMCPServer({ registry });
    const response = await server.handleFrame(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: STITCH_MERGE_TOOL_NAME, arguments: MERGE_ARGS },
      })
    );
    const result = (
      response as { result: { content: readonly { text: string }[]; isError: boolean } }
    ).result;
    expect(result.isError).toBe(false);
    expect(JSON.parse(result.content[0]?.text ?? '{}')).toEqual({ job_id: 'job-1' });
  });
});
