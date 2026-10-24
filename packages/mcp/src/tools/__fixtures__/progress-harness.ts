// P-361 - the bun harness behind packages/mcp/test_progress.py.
//
// It drives the REAL `stitch_merge` and `stitch_job_status` handlers against an
// in-memory job provider, because the core barrel exports no job API (the job
// queue P-239 and the merge stage handlers stay inside core - ADR-168). The
// mandated ids therefore assert on the frames the tools actually emit rather
// than on a stub.

import { ok, type Result } from 'neverthrow';
import type { StitchError } from '@repo-stitcher/core';

import { createJobStatusHandler } from '../job-status.js';
import {
  createMergeToolHandler,
  type MergeJobListener,
  type MergeJobRequest,
  type MergeJobSnapshot,
  type MergePorts,
} from '../merge.js';
import type { ProgressNotification } from '../../progress.js';

const JOB_ID = 'job-1';
const TOKEN = 'tok-1';
const REPO_A = 'https://example.invalid/a.git';
const REPO_B = 'https://example.invalid/b.git';
const PATHS = ['src'];
const TOTAL = 100;

type AnyResult = Result<unknown, StitchError>;

interface Fake {
  readonly ports: MergePorts;
  readonly notifications: ProgressNotification[];
  subscribeCount(): number;
  releaseCount(): number;
  push(snapshot: MergeJobSnapshot): void;
}

/** An in-memory stand-in for core's job queue: no git, no Docker, no AI. */
function createFake(): Fake {
  const notifications: ProgressNotification[] = [];
  const listeners = new Set<MergeJobListener>();
  const snapshots = new Map<string, MergeJobSnapshot>();
  let subscribes = 0;
  let releases = 0;

  snapshots.set(JOB_ID, {
    jobId: JOB_ID,
    status: 'queued',
    progress: { completed: 0, total: TOTAL },
  });

  const ports: MergePorts = {
    createJob: async (_request: MergeJobRequest) => {
      snapshots.set(JOB_ID, {
        jobId: JOB_ID,
        status: 'running',
        progress: { completed: 0, total: TOTAL },
      });
      return ok({ jobId: JOB_ID });
    },
    getJob: async jobId => ok(snapshots.get(jobId)),
    cancelJob: async jobId => ok(snapshots.get(jobId)),
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
    notifications,
    subscribeCount: () => subscribes,
    releaseCount: () => releases,
    push: snapshot => {
      snapshots.set(snapshot.jobId, snapshot);
      for (const listener of [...listeners]) listener(snapshot);
    },
  };
}

/** One handler outcome, as a plain object the python side can read. */
function toReport(outcome: unknown): Record<string, unknown> {
  const result = outcome as AnyResult;
  if (!result.isErr()) return { ok: true, payload: result.value };
  const error: { readonly code: string; readonly field?: unknown; readonly message?: unknown } =
    result.error;
  return {
    ok: false,
    code: error.code,
    ...(typeof error.field === 'string' ? { field: error.field } : {}),
    ...(typeof error.message === 'string' ? { message: error.message } : {}),
  };
}

async function main(): Promise<void> {
  // 1. A progress token streams every snapshot the job provider publishes.
  const jobs = createFake();
  const merge = createMergeToolHandler(jobs.ports);
  const status = createJobStatusHandler(jobs.ports);

  const started = toReport(
    await merge({
      repo_a: REPO_A,
      repo_b: REPO_B,
      paths_a: PATHS,
      paths_b: PATHS,
      progress_token: TOKEN,
    })
  );
  jobs.push({ jobId: JOB_ID, status: 'running', progress: { completed: 40, total: TOTAL } });
  jobs.push({ jobId: JOB_ID, status: 'succeeded', progress: { completed: TOTAL, total: TOTAL } });

  const emitted = {
    ...started,
    subscriptions: jobs.subscribeCount(),
    releases: jobs.releaseCount(),
    methods: jobs.notifications.map(item => item.method),
    progresses: jobs.notifications.map(item => item.params.progress),
    totals: jobs.notifications.map(item => item.params.total),
    tokens: jobs.notifications.map(item => item.params.progressToken),
  };

  // 2. Completion lands on progress === total.
  const last = jobs.notifications[jobs.notifications.length - 1];
  const completion = {
    count: jobs.notifications.length,
    last_progress: last?.params.progress ?? null,
    last_total: last?.params.total ?? null,
    releases: jobs.releaseCount(),
    status: toReport(await status({ job_id: JOB_ID })),
  };

  // 3. No token: nothing is subscribed and polling still works.
  const plain = createFake();
  const plainMerge = createMergeToolHandler(plain.ports);
  const plainStatus = createJobStatusHandler(plain.ports);
  const plainStarted = toReport(
    await plainMerge({ repo_a: REPO_A, repo_b: REPO_B, paths_a: PATHS, paths_b: PATHS })
  );
  plain.push({ jobId: JOB_ID, status: 'running', progress: { completed: 25, total: TOTAL } });

  const backward = {
    ...plainStarted,
    subscriptions: plain.subscribeCount(),
    releases: plain.releaseCount(),
    notifications: plain.notifications.length,
    status: toReport(await plainStatus({ job_id: JOB_ID })),
  };

  // 4. A malformed token is refused on its own field.
  const bad = createFake();
  const badMerge = createMergeToolHandler(bad.ports);
  const refusal = toReport(
    await badMerge({
      repo_a: REPO_A,
      repo_b: REPO_B,
      paths_a: PATHS,
      paths_b: PATHS,
      progress_token: {},
    })
  );

  process.stdout.write(`PROGRESS ${JSON.stringify({ emitted, completion, backward, refusal })}\n`);
}

await main();
