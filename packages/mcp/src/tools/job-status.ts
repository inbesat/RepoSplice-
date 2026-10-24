// P-359 - the job half of the merge tools.
//
// `stitch_job_status` reports where a merge job got to; `stitch_cancel_job`
// asks for it to stop. Both read the job through the same injected `MergePorts`
// as `stitch_merge`. The MCP `notifications/progress` payload and its bridge
// live in `progress.ts` (P-361), so the merge tool and the status tool cannot
// drift apart.

import { err, ok, type Result } from 'neverthrow';
import type { StitchError } from '@repo-stitcher/core';

import { createJobProgressBridge, isTerminalStatus } from '../progress.js';
import type { ToolDefinition, ToolHandler, ToolInputSchema, ToolRegistry } from './registry.js';
import { configError, type MergeJobSnapshot, type MergePorts } from './merge.js';

export { isTerminalStatus };

export const STITCH_JOB_STATUS_TOOL_NAME = 'stitch_job_status';
export const STITCH_CANCEL_JOB_TOOL_NAME = 'stitch_cancel_job';

function readJobId(
  args: Readonly<Record<string, unknown>>,
  field: string
): Result<string, StitchError> {
  const value = args['job_id'];
  if (typeof value !== 'string' || value.trim() === '') {
    return err(configError(field, 'a job id is required'));
  }
  return ok(value);
}

function readProgressToken(
  value: unknown,
  field: string
): Result<string | number | undefined, StitchError> {
  if (value === undefined || value === null) return ok(undefined);
  if (typeof value === 'string' || typeof value === 'number') return ok(value);
  return err(configError(field, 'the progress token must be a string or a number'));
}

/** The shape both job tools answer with. */
function toStatusOutput(snapshot: MergeJobSnapshot): Record<string, unknown> {
  return {
    status: snapshot.status,
    progress: snapshot.progress,
    ...(snapshot.result !== undefined ? { result: snapshot.result } : {}),
  };
}

export const STITCH_JOB_STATUS_INPUT_SCHEMA: ToolInputSchema = {
  type: 'object',
  properties: {
    job_id: { type: 'string', description: 'The job id that stitch_merge returned.' },
    progress_token: {
      type: ['string', 'number'],
      description: 'When present, live progress streams as notifications/progress under it.',
    },
  },
  required: ['job_id'],
  additionalProperties: false,
};

export const STITCH_JOB_STATUS_TOOL: ToolDefinition = {
  name: STITCH_JOB_STATUS_TOOL_NAME,
  description: 'Report a merge job status and progress; pass progress_token for live updates.',
  inputSchema: STITCH_JOB_STATUS_INPUT_SCHEMA,
};

export const STITCH_CANCEL_JOB_INPUT_SCHEMA: ToolInputSchema = {
  type: 'object',
  properties: {
    job_id: { type: 'string', description: 'The job id to cancel.' },
  },
  required: ['job_id'],
  additionalProperties: false,
};

export const STITCH_CANCEL_JOB_TOOL: ToolDefinition = {
  name: STITCH_CANCEL_JOB_TOOL_NAME,
  description: 'Cancel a merge job and report the status it settled at.',
  inputSchema: STITCH_CANCEL_JOB_INPUT_SCHEMA,
};

/**
 * Report a job's status.
 *
 * With a `progress_token` the job is also subscribed, and every later snapshot
 * is pushed as an MCP progress notification until the job settles.
 */
export function createJobStatusHandler(ports: MergePorts): ToolHandler {
  return async args => {
    const jobId = readJobId(args, 'stitch_job_status.job_id');
    if (jobId.isErr()) return err(jobId.error);
    const token = readProgressToken(args['progress_token'], 'stitch_job_status.progress_token');
    if (token.isErr()) return err(token.error);

    const found = await ports.getJob(jobId.value);
    if (found.isErr()) return err(found.error);
    const snapshot = found.value;
    if (snapshot === undefined) {
      return err(configError('stitch_job_status.job_id', `no job is known under ${jobId.value}`));
    }
    if (token.value !== undefined && !isTerminalStatus(snapshot.status)) {
      const bridge = createJobProgressBridge(ports, jobId.value, token.value);
      const subscribed = await ports.subscribe(jobId.value, bridge.listener);
      if (subscribed.isErr()) return err(subscribed.error);
      bridge.attach(subscribed.value);
    }
    return ok(toStatusOutput(snapshot));
  };
}

/** Ask for a job to stop and report the status it settled at. */
export function createCancelJobHandler(ports: MergePorts): ToolHandler {
  return async args => {
    const jobId = readJobId(args, 'stitch_cancel_job.job_id');
    if (jobId.isErr()) return err(jobId.error);
    const cancelled = await ports.cancelJob(jobId.value);
    if (cancelled.isErr()) return err(cancelled.error);
    const snapshot = cancelled.value;
    if (snapshot === undefined) {
      return err(configError('stitch_cancel_job.job_id', `no job is known under ${jobId.value}`));
    }
    return ok(toStatusOutput(snapshot));
  };
}

export function registerJobStatusTools(
  registry: ToolRegistry,
  ports: MergePorts
): Result<readonly string[], StitchError> {
  const status = registry.register(STITCH_JOB_STATUS_TOOL, createJobStatusHandler(ports));
  if (status.isErr()) return err(status.error);
  const cancel = registry.register(STITCH_CANCEL_JOB_TOOL, createCancelJobHandler(ports));
  if (cancel.isErr()) return err(cancel.error);
  return ok([STITCH_JOB_STATUS_TOOL_NAME, STITCH_CANCEL_JOB_TOOL_NAME]);
}
