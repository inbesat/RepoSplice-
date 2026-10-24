// P-359 - the bun harness behind `packages/mcp/test_merge.py`.
//
// The merge belongs to core (P-238) and no driver in this lane wires the stage
// handlers, so the merge tools take their job provider as an injected port. The
// harness therefore runs the REAL tool handlers, registry and server against an
// in-memory job provider: the wiring an MCP host would see, with no git, no
// Docker, no AI and no network. It also calls the DEFAULT provider once, to show
// it refuses honestly instead of faking a job.
//
// It prints exactly one `MERGE <json>` line for the python driver.

import { ok, type Result } from 'neverthrow';
import type { StitchError } from '@repo-stitcher/core';

import { createMCPServer, type MCPServer } from '../../server.js';
import { createToolRegistry } from '../registry.js';
import {
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
} from '../merge.js';
import {
  createCancelJobHandler,
  createJobStatusHandler,
  registerJobStatusTools,
  STITCH_CANCEL_JOB_TOOL_NAME,
  STITCH_JOB_STATUS_TOOL_NAME,
} from '../job-status.js';

type AnyResult = Result<unknown, StitchError>;

const JOB_ID = 'job-1';
const TOKEN = 'tok-1';
const REPO_A = 'https://example.invalid/a.git';
const REPO_B = 'https://example.invalid/b.git';
const PATHS = ['src'];
const PROGRESS: MergeJobProgress = { completed: 0, total: 3 };

interface FakeJobs {
  readonly ports: MergePorts;
  readonly created: MergeJobRequest[];
  readonly notifications: ProgressNotification[];
  subscribeCount(): number;
  releaseCount(): number;
  push(snapshot: MergeJobSnapshot): void;
}

function createFakeJobs(): FakeJobs {
  const snapshots = new Map<string, MergeJobSnapshot>();
  const listeners = new Set<MergeJobListener>();
  const created: MergeJobRequest[] = [];
  const notifications: ProgressNotification[] = [];
  let subscribes = 0;
  let releases = 0;
  const ports: MergePorts = {
    createJob: async request => {
      created.push(request);
      snapshots.set(JOB_ID, { jobId: JOB_ID, status: 'running', progress: PROGRESS });
      return ok({ jobId: JOB_ID });
    },
    getJob: async jobId => ok(snapshots.get(jobId)),
    cancelJob: async jobId => {
      const current = snapshots.get(jobId);
      if (current === undefined) return ok(undefined);
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
    push: snapshot => {
      snapshots.set(snapshot.jobId, snapshot);
      for (const listener of [...listeners]) listener(snapshot);
    },
  };
}

interface CallOutcome {
  readonly isError: boolean;
  readonly text: string;
}

async function call(
  server: MCPServer,
  name: string,
  args: Readonly<Record<string, unknown>>
): Promise<CallOutcome> {
  const response = await server.handleFrame(
    JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: args },
    })
  );
  const result = (
    response as { result: { content: readonly { text: string }[]; isError: boolean } }
  ).result;
  return { isError: result.isError, text: result.content[0]?.text ?? '{}' };
}

/** What an MCP host observes: the payload, or the failure message. */
function driven(outcome: CallOutcome): Record<string, unknown> {
  if (outcome.isError) return { ok: false, message: outcome.text };
  return { ok: true, payload: JSON.parse(outcome.text) as Record<string, unknown> };
}

/** What the handler returns, so the error code and field stay observable. */
function handlerOutcome(outcome: AnyResult): Record<string, unknown> {
  if (outcome.isErr()) {
    const error = outcome.error as { code: string; field?: string; message?: string };
    return {
      ok: false,
      code: error.code,
      ...(error.field !== undefined ? { field: error.field } : {}),
      ...(error.message !== undefined ? { message: error.message } : {}),
    };
  }
  return { ok: true, payload: outcome.value };
}

async function main(): Promise<void> {
  const jobs = createFakeJobs();
  const registry = createToolRegistry();
  registerMergeTool(registry, jobs.ports);
  registerJobStatusTools(registry, jobs.ports);
  const server = createMCPServer({ registry });

  // 1. stitch_merge hands back the job id immediately.
  const merged = await call(server, STITCH_MERGE_TOOL_NAME, {
    repo_a: REPO_A,
    repo_b: REPO_B,
    paths_a: PATHS,
    paths_b: PATHS,
  });

  // 2. stitch_job_status reads the current snapshot.
  const status = await call(server, STITCH_JOB_STATUS_TOOL_NAME, { job_id: JOB_ID });

  // 3. a token subscribes, and the bridge streams until the job settles.
  const subscribed = await call(server, STITCH_JOB_STATUS_TOOL_NAME, {
    job_id: JOB_ID,
    progress_token: TOKEN,
  });
  jobs.push({
    jobId: JOB_ID,
    status: 'running',
    progress: { completed: 1, total: 3, stage: 'deps' },
  });
  jobs.push({ jobId: JOB_ID, status: 'succeeded', progress: { completed: 3, total: 3 } });
  jobs.push({ jobId: JOB_ID, status: 'failed', progress: { completed: 3, total: 3 } });

  // 4. stitch_cancel_job cancels the job.
  const cancelled = await call(server, STITCH_CANCEL_JOB_TOOL_NAME, { job_id: JOB_ID });

  // 5. the refusal paths, read off the handlers so the field stays visible.
  const statusHandler = createJobStatusHandler(jobs.ports);
  const cancelHandler = createCancelJobHandler(jobs.ports);
  const mergeHandler = createMergeToolHandler(jobs.ports);
  const unknownStatus = handlerOutcome((await statusHandler({ job_id: 'missing' })) as AnyResult);
  const unknownCancel = handlerOutcome((await cancelHandler({ job_id: 'missing' })) as AnyResult);
  const noSource = handlerOutcome((await mergeHandler({ repo_b: REPO_B })) as AnyResult);

  // 6. the DEFAULT provider, which has no core job API to talk to.
  const unavailable = await loadMergePorts();
  const refusal = handlerOutcome(
    (await unavailable.createJob({
      repoA: REPO_A,
      repoB: REPO_B,
      pathsA: PATHS,
      pathsB: PATHS,
      options: {},
    })) as AnyResult
  );

  const first = jobs.created[0];
  process.stdout.write(
    `MERGE ${JSON.stringify({
      merge: driven(merged),
      created:
        first === undefined
          ? null
          : {
              repo_a: first.repoA,
              repo_b: first.repoB,
              paths_a: first.pathsA,
              paths_b: first.pathsB,
            },
      status: driven(status),
      status_unknown: unknownStatus,
      progress: {
        ...driven(subscribed),
        subscriptions: jobs.subscribeCount(),
        releases: jobs.releaseCount(),
        methods: jobs.notifications.map(item => item.method),
        progresses: jobs.notifications.map(item => item.params.progress),
        totals: jobs.notifications.map(item => item.params.total),
        tokens: jobs.notifications.map(item => item.params.progressToken),
        messages: jobs.notifications.map(item => item.params.message ?? null),
      },
      cancel: driven(cancelled),
      cancel_unknown: unknownCancel,
      no_source: noSource,
      refusal,
    })}\n`
  );
}

await main();
