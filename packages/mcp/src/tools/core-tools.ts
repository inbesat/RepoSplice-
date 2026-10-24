// P-357 - the core-API tools.
//
// The MCP boundary receives arbitrary JSON, so each tool's handler passes the
// arguments straight to its port and lets core validate them: this module never
// re-implements a core decision, it only names one. The ports are injectable
// (the P-348 precedent) so the tools are testable without a real repository,
// and `loadCoreToolPorts` binds them to the PUBLIC BARREL - never to
// `core/src/*` internals.
//
// The spec names six tools. Four of them map onto API the barrel really
// exports; the job-lifecycle pair has NO public core API yet, so it is listed
// as deferred rather than faked (see ADR-166).

import { err, ok, type Result } from 'neverthrow';
import type { StitchError } from '@repo-stitcher/core';
import type { ToolDefinition, ToolRegistry } from './registry.js';

/** A core function called by the MCP boundary (arguments are unvalidated JSON). */
export type CoreToolCallable = (...args: readonly unknown[]) => unknown;

export interface CoreToolPorts {
  readonly mergeManifests: CoreToolCallable;
  readonly scanLicenses: CoreToolCallable;
  readonly runSandboxBuild: CoreToolCallable;
  readonly subscribeJobEvents: CoreToolCallable;
  readonly runPipeline: CoreToolCallable;
}

/** The tool names whose core API the public barrel exports today. */
export const CORE_TOOL_NAMES = [
  'merge_manifests',
  'scan_licenses',
  'run_sandbox_build',
  'subscribe_job_events',
  'run_pipeline',
] as const;

export type CoreToolName = (typeof CORE_TOOL_NAMES)[number];

/** The barrel export each tool binds to. */
const TOOL_BARREL_EXPORTS: Readonly<Record<CoreToolName, string>> = {
  merge_manifests: 'unionManifests',
  scan_licenses: 'scanDeclared',
  run_sandbox_build: 'runVerification',
  subscribe_job_events: 'bus',
  run_pipeline: 'runPipeline',
};

/**
 * The tools the spec names that have no public core API yet.
 *
 * A missing API is never invented: the scaffold lists the gap instead.
 */
export const DEFERRED_CORE_TOOLS = [
  {
    name: 'create_stitch_job',
    reason: 'the public core barrel exports no job-creation API (only jobs/jobConfig.js types)',
  },
  {
    name: 'get_job_status',
    reason: 'the public core barrel exports no job-status API (only jobs/jobConfig.js types)',
  },
] as const;

const TOOL_DEFINITIONS: Readonly<Record<CoreToolName, ToolDefinition>> = {
  merge_manifests: {
    name: 'merge_manifests',
    description: 'Merge the parsed dependency manifests of every source into one union.',
    inputSchema: {
      type: 'object',
      properties: { manifests: { type: 'array', items: { type: 'object' } } },
      required: ['manifests'],
    },
  },
  scan_licenses: {
    name: 'scan_licenses',
    description: 'Scan the declared dependency licenses and report the policy verdict.',
    inputSchema: {
      type: 'object',
      properties: { manifests: { type: 'array', items: { type: 'object' } } },
    },
  },
  run_sandbox_build: {
    name: 'run_sandbox_build',
    description: 'Build and test the merged tree inside the sandbox and report the outcome.',
    inputSchema: {
      type: 'object',
      properties: { rootDir: { type: 'string' }, ecosystem: { type: 'string' } },
      required: ['rootDir'],
    },
  },
  subscribe_job_events: {
    name: 'subscribe_job_events',
    description: 'Subscribe to pipeline job events and report what is being buffered.',
    inputSchema: {
      type: 'object',
      properties: { topics: { type: 'array', items: { type: 'string' } } },
    },
  },
  run_pipeline: {
    name: 'run_pipeline',
    description: 'Run the whole merge pipeline for a selection of source files.',
    inputSchema: {
      type: 'object',
      properties: { selection: { type: 'array', items: { type: 'object' } } },
    },
  },
};

function messageOf(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  if (cause !== null && typeof cause === 'object' && 'message' in cause) {
    const message = (cause as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return String(cause);
}

function isResultLike(value: unknown): value is Result<unknown, StitchError> {
  return (
    value !== null &&
    typeof value === 'object' &&
    'isOk' in value &&
    typeof (value as { isOk?: unknown }).isOk === 'function'
  );
}

/** Handler: call the port and normalize whatever it returns. */
function handlerFor(port: CoreToolCallable) {
  return async (args: Readonly<Record<string, unknown>>): Promise<Result<unknown, StitchError>> => {
    const value = await port(args);
    return isResultLike(value) ? value : ok(value);
  };
}

/**
 * Register the core-API tools. Returns the registered names so the caller can
 * report them. A registration failure (a duplicate name) is returned, not
 * thrown.
 */
export function registerCoreTools(
  registry: ToolRegistry,
  ports: CoreToolPorts
): Result<readonly string[], StitchError> {
  const registered: string[] = [];
  const bindings: readonly (readonly [CoreToolName, CoreToolCallable])[] = [
    ['merge_manifests', ports.mergeManifests],
    ['scan_licenses', ports.scanLicenses],
    ['run_sandbox_build', ports.runSandboxBuild],
    ['subscribe_job_events', ports.subscribeJobEvents],
    ['run_pipeline', ports.runPipeline],
  ];
  for (const [name, port] of bindings) {
    const result = registry.register(TOOL_DEFINITIONS[name], handlerFor(port));
    if (result.isErr()) return err(result.error);
    registered.push(name);
  }
  return ok(registered);
}

/**
 * Bind the ports to the public core barrel.
 *
 * `subscribe_job_events` binds the event bus: it subscribes for real and
 * buffers the payloads, so the tool reports what it is holding. Push delivery
 * to a client arrives with the streaming transport in a later phase.
 */
export async function loadCoreToolPorts(): Promise<Result<CoreToolPorts, StitchError>> {
  let core: Record<string, unknown>;
  try {
    core = (await import('@repo-stitcher/core')) as unknown as Record<string, unknown>;
  } catch (cause) {
    return err({
      code: 'CONFIG_ERROR',
      field: 'mcp.core',
      message: `the core barrel could not be loaded: ${messageOf(cause)}`,
    });
  }
  const missing: string[] = [];
  const pick = (name: string): CoreToolCallable | undefined => {
    const value = core[TOOL_BARREL_EXPORTS[name as CoreToolName]];
    if (value === undefined) {
      missing.push(`${name} -> ${TOOL_BARREL_EXPORTS[name as CoreToolName]}`);
      return undefined;
    }
    return value as CoreToolCallable;
  };
  const unionManifests = pick('merge_manifests');
  const scanDeclared = pick('scan_licenses');
  const runVerification = pick('run_sandbox_build');
  const busValue = pick('subscribe_job_events');
  const runPipeline = pick('run_pipeline');
  if (
    unionManifests === undefined ||
    scanDeclared === undefined ||
    runVerification === undefined ||
    busValue === undefined ||
    runPipeline === undefined
  ) {
    return err({
      code: 'CONFIG_ERROR',
      field: 'mcp.core',
      message: `the core barrel is missing ${missing.join(', ')}`,
    });
  }
  const buffered: unknown[] = [];
  const subscribe = busValue as unknown as {
    subscribe: (topic: string, handler: (payload: unknown) => void) => unknown;
  };
  const subscribeJobEvents: CoreToolCallable = args => {
    const record =
      args !== null && typeof args === 'object' ? (args as Record<string, unknown>) : {};
    const requested = record['topics'];
    const topics =
      Array.isArray(requested) && requested.length > 0
        ? requested.filter((topic): topic is string => typeof topic === 'string')
        : ['progress', 'agent.tool'];
    if (typeof subscribe.subscribe !== 'function') {
      return err({
        code: 'CONFIG_ERROR',
        field: 'mcp.core',
        message: 'the core event bus exposes no subscribe method',
      });
    }
    for (const topic of topics) {
      subscribe.subscribe(topic, payload => {
        buffered.push(payload);
        if (buffered.length > 100) buffered.shift();
      });
    }
    return ok({ subscribed: topics, buffered: buffered.length });
  };
  return ok({
    mergeManifests: unionManifests,
    scanLicenses: scanDeclared,
    runSandboxBuild: runVerification,
    subscribeJobEvents,
    runPipeline,
  });
}
