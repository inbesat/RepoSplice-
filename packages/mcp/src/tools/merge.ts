// P-359 - the `stitch_merge` tool: start a merge from inside an MCP host.
//
// The merge itself belongs to core (P-238). No aradhy-lane driver wires the
// stage handlers — `packages/cli/src/commands/merge.ts` takes its pipeline by
// injection and is tested "with a fake pipeline" for exactly that reason — and
// the job queue that does own the wiring (P-239) is not re-exported by the core
// barrel. So the job capability arrives as a PORT here: the tools are real and
// fully exercised, and a host with no job API is told so plainly instead of
// being handed a merge that never runs (see ADR-168).

import { err, ok, type Result } from 'neverthrow';
import type { StitchError } from '@repo-stitcher/core';

import type { ToolDefinition, ToolHandler, ToolInputSchema, ToolRegistry } from './registry.js';

export const STITCH_MERGE_TOOL_NAME = 'stitch_merge';

/** The states a merge job moves through. */
export type MergeJobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

/** Where a job is. `total` stays 0 while the stage count is still unknown. */
export interface MergeJobProgress {
  readonly completed: number;
  readonly total: number;
  readonly stage?: string;
  readonly message?: string;
}

export interface MergeJobSnapshot {
  readonly jobId: string;
  readonly status: MergeJobStatus;
  readonly progress: MergeJobProgress;
  readonly result?: Readonly<Record<string, unknown>>;
}

export interface MergeJobListener {
  (snapshot: MergeJobSnapshot): void;
}

/** The standard merge config, the same one the CLI and the web wizard express. */
export interface MergeJobRequest {
  readonly repoA: string;
  readonly repoB: string;
  readonly pathsA: readonly string[];
  readonly pathsB: readonly string[];
  readonly options: Readonly<Record<string, unknown>>;
}

export interface MergeJobHandle {
  readonly jobId: string;
}

/** A progress notification, in the MCP `notifications/progress` shape. */
export interface ProgressNotification {
  readonly jsonrpc: '2.0';
  readonly method: 'notifications/progress';
  readonly params: {
    readonly progressToken: string | number;
    readonly jobId: string;
    readonly status: MergeJobStatus;
    readonly progress: MergeJobProgress;
  };
}

/**
 * Everything the merge tools need from the outside world.
 *
 * `getJob` and `cancelJob` resolve `undefined` for an unknown job, which the
 * handlers turn into a named `CONFIG_ERROR`. `notify` is the MCP notification
 * sink: a transport-backed writer in the server, a capturing array in the
 * harness.
 */
export interface MergePorts {
  readonly createJob: (request: MergeJobRequest) => Promise<Result<MergeJobHandle, StitchError>>;
  readonly getJob: (jobId: string) => Promise<Result<MergeJobSnapshot | undefined, StitchError>>;
  readonly cancelJob: (jobId: string) => Promise<Result<MergeJobSnapshot | undefined, StitchError>>;
  readonly subscribe: (
    jobId: string,
    listener: MergeJobListener
  ) => Promise<Result<() => void, StitchError>>;
  readonly notify: (notification: ProgressNotification) => void;
}

export const STITCH_MERGE_INPUT_SCHEMA: ToolInputSchema = {
  type: 'object',
  properties: {
    repo_a: {
      type: 'string',
      description: 'URL or local path of the first repository (A).',
    },
    repo_b: {
      type: 'string',
      description: 'URL or local path of the second repository (B).',
    },
    paths_a: {
      type: 'array',
      items: { type: 'string' },
      description: 'Repository-A paths to take. Omit to take the whole repository.',
    },
    paths_b: {
      type: 'array',
      items: { type: 'string' },
      description: 'Repository-B paths to take. Omit to take the whole repository.',
    },
    options: {
      type: 'object',
      description: 'Merge options (output directory, dry run, policy overrides). Passed through.',
    },
  },
  required: ['repo_a', 'repo_b'],
  additionalProperties: false,
};

export const STITCH_MERGE_TOOL: ToolDefinition = {
  name: STITCH_MERGE_TOOL_NAME,
  description:
    'Start a merge of two repositories and return its job id immediately; ' +
    'poll it with stitch_job_status.',
  inputSchema: STITCH_MERGE_INPUT_SCHEMA,
};

/** A human-readable form of an unknown throwable. */
export function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** The one error code this tool set constructs, on a field it names itself. */
export function configError(field: string, message: string): StitchError {
  return { code: 'CONFIG_ERROR', field, message };
}

function readRepo(value: unknown, field: string): Result<string, StitchError> {
  if (typeof value !== 'string' || value.trim() === '') {
    return err(configError(field, 'a non-empty repository URL or local path is required'));
  }
  return ok(value);
}

function readPaths(value: unknown, field: string): Result<readonly string[], StitchError> {
  if (value === undefined || value === null) return ok([]);
  if (!Array.isArray(value)) {
    return err(configError(field, 'a list of repository paths is required'));
  }
  const entries = value as readonly unknown[];
  const paths: string[] = [];
  for (const entry of entries) {
    if (typeof entry !== 'string' || entry.trim() === '') {
      return err(configError(field, 'every path must be a non-empty string'));
    }
    paths.push(entry);
  }
  return ok(paths);
}

function readOptions(value: unknown): Result<Readonly<Record<string, unknown>>, StitchError> {
  if (value === undefined || value === null) return ok({});
  if (typeof value !== 'object' || Array.isArray(value)) {
    return err(configError('stitch_merge.options', 'the merge options must be a JSON object'));
  }
  return ok(value as Readonly<Record<string, unknown>>);
}

/** Validate the `stitch_merge` arguments into the standard merge config. */
export function parseMergeInput(
  args: Readonly<Record<string, unknown>>
): Result<MergeJobRequest, StitchError> {
  const repoA = readRepo(args['repo_a'], 'stitch_merge.repo_a');
  if (repoA.isErr()) return err(repoA.error);
  const repoB = readRepo(args['repo_b'], 'stitch_merge.repo_b');
  if (repoB.isErr()) return err(repoB.error);
  const pathsA = readPaths(args['paths_a'], 'stitch_merge.paths_a');
  if (pathsA.isErr()) return err(pathsA.error);
  const pathsB = readPaths(args['paths_b'], 'stitch_merge.paths_b');
  if (pathsB.isErr()) return err(pathsB.error);
  const options = readOptions(args['options']);
  if (options.isErr()) return err(options.error);
  return ok({
    repoA: repoA.value,
    repoB: repoB.value,
    pathsA: pathsA.value,
    pathsB: pathsB.value,
    options: options.value,
  });
}

/** Start the job and hand the host its id; the merge runs in the background. */
export function createMergeToolHandler(ports: MergePorts): ToolHandler {
  return async args => {
    const parsed = parseMergeInput(args);
    if (parsed.isErr()) return err(parsed.error);
    const started = await ports.createJob(parsed.value);
    if (started.isErr()) return err(started.error);
    return ok({ job_id: started.value.jobId });
  };
}

export function registerMergeTool(
  registry: ToolRegistry,
  ports: MergePorts
): Result<readonly string[], StitchError> {
  const registered = registry.register(STITCH_MERGE_TOOL, createMergeToolHandler(ports));
  if (registered.isErr()) return err(registered.error);
  return ok([STITCH_MERGE_TOOL_NAME]);
}

/** Ports that refuse every call with the same honest reason. */
export function unavailableMergePorts(reason: StitchError): MergePorts {
  const refuse = async <T>(): Promise<Result<T, StitchError>> => err(reason);
  return {
    createJob: () => refuse<MergeJobHandle>(),
    getJob: () => refuse<MergeJobSnapshot | undefined>(),
    cancelJob: () => refuse<MergeJobSnapshot | undefined>(),
    subscribe: () => refuse<() => void>(),
    notify: () => undefined,
  };
}

/**
 * Assemble the real job ports from the core public barrel.
 *
 * The barrel exports `runPipeline`, but that is a composition contract: its
 * `handlers` map must be supplied by the driver, and the job queue that owns
 * that wiring (P-239) plus `jobs/cancel.ts` and `jobs/types.ts` are not
 * re-exported. A driver outside core therefore cannot start a merge, so this
 * returns ports that refuse with the reason rather than pretending to work.
 */
export async function loadMergePorts(): Promise<MergePorts> {
  let barrel: Record<string, unknown>;
  try {
    barrel = (await import('@repo-stitcher/core')) as unknown as Record<string, unknown>;
  } catch (cause) {
    return unavailableMergePorts(
      configError('mcp.core', `the core barrel could not be loaded: ${messageOf(cause)}`)
    );
  }
  if (typeof barrel['runPipeline'] !== 'function') {
    return unavailableMergePorts(configError('mcp.core', 'the core barrel is missing runPipeline'));
  }
  return unavailableMergePorts(
    configError(
      'mcp.core',
      'the core barrel exports runPipeline but no job API: the job queue (P-239) and the merge ' +
        'stage handlers stay inside core, so stitch_merge cannot start a merge job yet (ADR-168)'
    )
  );
}
