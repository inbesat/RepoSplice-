// P-363 — the machine-checkable half of the host compatibility pass.
//
// The phase asks for MANUAL runs against Claude Code, OpenCode and Cursor. No
// MCP host is installable in this environment, so this harness does what can be
// verified from here: it exercises the exact protocol behaviours those hosts
// depend on (handshake and version negotiation, `tools/list` schema strictness,
// `tools/call` argument handling, notification silence, error envelopes, LSP
// frame splitting on stdio, the HTTP transport, and `notifications/progress`)
// and reports them as three HOST-SHAPED profiles. Every profile carries
// `manual: false` and the manual runs are reported as `not run` — a gate that
// did not run is deferred, never passing (ADR-172).

import { PassThrough } from 'node:stream';

import { ok } from 'neverthrow';

import {
  MCP_PROTOCOL_VERSION,
  MCP_SERVER_NAME,
  createMCPServer,
  type JsonRpcResponse,
} from '../src/server.js';
import {
  createHttpTransport,
  createStdioTransport,
  DEFAULT_MCP_HTTP_PORT,
} from '../src/transport.js';
import { createToolRegistry, type ToolRegistry } from '../src/tools/registry.js';
import { registerCoreTools, type CoreToolPorts } from '../src/tools/core-tools.js';
import { registerSelectFilesTool, type SelectFilesPorts } from '../src/tools/select-files.js';
import {
  registerMergeTool,
  type MergeJobListener,
  type MergeJobSnapshot,
  type MergePorts,
} from '../src/tools/merge.js';
import { registerJobStatusTools } from '../src/tools/job-status.js';
import { registerCheckLicenseTool, type CheckLicensePorts } from '../src/tools/check-license.js';
import type { ProgressNotification } from '../src/progress.js';

const HTTP_PORTS = [3461, 3462, 3463];
const PROGRESS_TOKEN = 'tok-host-compat';

/** LSP-style framing, restated here so the harness reads only what a host reads. */
function frame(body: string): string {
  return `Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`;
}

async function waitFor(predicate: () => boolean, timeoutMs = 4000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  return predicate();
}

type Wire = Record<string, unknown>;

/** Decode every COMPLETE frame in a buffer; a partial tail is left alone. */
function parseFrames(text: string): Wire[] {
  const frames: Wire[] = [];
  let rest = text;
  for (;;) {
    const headerEnd = rest.indexOf('\r\n\r\n');
    if (headerEnd < 0) break;
    const match = /content-length:\s*(\d+)/i.exec(rest.slice(0, headerEnd));
    if (match === null || match[1] === undefined) break;
    const length = Number.parseInt(match[1], 10);
    const bodyStart = headerEnd + 4;
    if (rest.length < bodyStart + length) break;
    const body = rest.slice(bodyStart, bodyStart + length);
    rest = rest.slice(bodyStart + length);
    frames.push(JSON.parse(body) as Wire);
  }
  return frames;
}

function resultOf(frameValue: Wire | undefined): Wire | undefined {
  const result = frameValue?.['result'];
  return typeof result === 'object' && result !== null ? (result as Wire) : undefined;
}

function errorCodeOf(frameValue: Wire | undefined): number | undefined {
  const error = frameValue?.['error'];
  const code = typeof error === 'object' && error !== null ? (error as Wire)['code'] : undefined;
  return typeof code === 'number' ? code : undefined;
}

function isErrorOf(frameValue: Wire | undefined): boolean {
  return resultOf(frameValue)?.['isError'] === true;
}

function toolTextOf(frameValue: Wire | undefined): string {
  const content = resultOf(frameValue)?.['content'];
  if (!Array.isArray(content)) return '';
  const first = content[0];
  const text = typeof first === 'object' && first !== null ? (first as Wire)['text'] : undefined;
  return typeof text === 'string' ? text : '';
}

/** No git, no Docker, no network: only the protocol surface is under test. */
function fakeCorePorts(): CoreToolPorts {
  const nothing = async (): Promise<unknown> => ok({});
  return {
    mergeManifests: nothing,
    scanLicenses: nothing,
    runSandboxBuild: nothing,
    subscribeJobEvents: nothing,
    runPipeline: nothing,
  };
}

function fakeSelectPorts(): SelectFilesPorts {
  return {
    materialize: async () => ok({ root: '/repo', source: 'local' as const }),
    list: async () => ok([{ path: 'src/index.ts', size: 12 }]),
    inspect: async () => ok({ commit: 'head-sha', lastCommits: {} }),
    ecosystems: async () => ok(['node']),
    language: () => 'typescript',
  };
}

function fakeLicensePorts(): CheckLicensePorts {
  const scan = async (ref: string) =>
    ok({
      ref,
      source: 'local' as const,
      spdx_ids: ['MIT'],
      licenses: [{ spdx_id: 'MIT', name: 'MIT License', category: 'permissive' }],
      warnings: [],
      cached: false,
    });
  return {
    scan,
    compatibility: async () =>
      ok({
        verdict: 'compatible' as const,
        requirements: [],
        blockers: [],
        failing_categories: [],
      }),
  };
}

interface FakeJobs {
  readonly ports: MergePorts;
  readonly push: (snapshot: MergeJobSnapshot) => void;
  readonly subscribes: () => number;
  readonly releases: () => number;
}

function fakeJobs(sink: (notification: ProgressNotification) => void): FakeJobs {
  const snapshots = new Map<string, MergeJobSnapshot>();
  const listeners = new Set<MergeJobListener>();
  let subscribes = 0;
  let releases = 0;
  snapshots.set('job-1', {
    jobId: 'job-1',
    status: 'queued',
    progress: { completed: 0, total: 3 },
  });
  const ports: MergePorts = {
    createJob: async () => {
      snapshots.set('job-1', {
        jobId: 'job-1',
        status: 'running',
        progress: { completed: 0, total: 3 },
      });
      return ok({ jobId: 'job-1' });
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
    notify: sink,
  };
  return {
    ports,
    push: snapshot => {
      snapshots.set(snapshot.jobId, snapshot);
      for (const listener of [...listeners]) listener(snapshot);
    },
    subscribes: () => subscribes,
    releases: () => releases,
  };
}

function buildRegistry(jobs: FakeJobs): ToolRegistry {
  const registry = createToolRegistry();
  registerCoreTools(registry, fakeCorePorts());
  registerSelectFilesTool(registry, fakeSelectPorts());
  registerMergeTool(registry, jobs.ports);
  registerJobStatusTools(registry, jobs.ports);
  registerCheckLicenseTool(registry, fakeLicensePorts());
  return registry;
}

interface StdioReport {
  readonly initialize_ok: boolean;
  readonly negotiated_version: string | null;
  readonly server_name: string | null;
  readonly capabilities_tools: boolean;
  readonly older_version_answered: boolean;
  readonly tools_list_count: number;
  readonly schema_object: boolean;
  readonly schema_additional_properties_false: boolean;
  readonly every_tool_described: boolean;
  readonly call_ok: boolean;
  readonly call_tree_paths: readonly string[];
  readonly call_without_arguments_is_error: boolean;
  readonly unknown_tool_is_error: boolean;
  readonly unknown_method_code: number | null;
  readonly bad_json_code: number | null;
  readonly bad_json_id_null: boolean;
  readonly notification_silent: boolean;
  readonly string_id_echoed: boolean;
  readonly split_frame_answered: boolean;
  readonly progress_frames: number;
  readonly progress_progresses: readonly number[];
  readonly progress_totals: readonly number[];
  readonly progress_tokens: readonly (string | number)[];
  readonly progress_releases: number;
  readonly tool_names: readonly string[];
}

async function runStdio(): Promise<{
  report: StdioReport;
  registry: ToolRegistry;
  jobs: FakeJobs;
}> {
  const input = new PassThrough();
  const output = new PassThrough();
  let collected = '';
  output.on('data', (chunk: unknown) => {
    collected += String(chunk);
  });

  // The bridge's sink IS the channel a host reads, so a progress notification
  // must land in `output` — not in a side buffer the test peeks at.
  const jobs = fakeJobs(notification => {
    output.write(frame(JSON.stringify(notification)));
  });
  const registry = buildRegistry(jobs);
  const server = createMCPServer({ registry });
  const transport = createStdioTransport({
    input,
    output,
    handler: async (payload: string): Promise<JsonRpcResponse | undefined> =>
      server.handleFrame(payload),
  });
  await transport.start();

  const frames = (): Wire[] => parseFrames(collected);
  const send = (message: unknown): void => {
    input.write(frame(JSON.stringify(message)));
  };
  const next = async (count: number): Promise<void> => {
    await waitFor(() => frames().length >= count);
  };

  send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } });
  await next(1);
  const initialized = resultOf(frames()[0]);

  send({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '2024-10-07' } });
  await next(2);
  const older = resultOf(frames()[1]);

  send({ jsonrpc: '2.0', id: 3, method: 'tools/list' });
  await next(3);
  const listed = resultOf(frames()[2]);
  const tools = Array.isArray(listed?.['tools']) ? (listed['tools'] as Wire[]) : [];

  send({
    jsonrpc: '2.0',
    id: 4,
    method: 'tools/call',
    params: { name: 'stitch_select_files', arguments: { local_path: '/repo' } },
  });
  await next(4);
  const called = frames()[3];
  let treePaths: readonly string[] = [];
  const callText = toolTextOf(called);
  if (callText.startsWith('{')) {
    const parsed = JSON.parse(callText) as Wire;
    const tree = Array.isArray(parsed['tree']) ? (parsed['tree'] as Wire[]) : [];
    treePaths = tree.map(node => String(node['path']));
  }

  send({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'stitch_select_files' } });
  await next(5);
  const noArguments = frames()[4];

  send({
    jsonrpc: '2.0',
    id: 6,
    method: 'tools/call',
    params: { name: 'not_a_tool', arguments: {} },
  });
  await next(6);
  const unknownTool = frames()[5];

  send({ jsonrpc: '2.0', id: 7, method: 'tools/nope' });
  await next(7);
  const unknownMethod = frames()[6];

  input.write(frame('{ this is not json'));
  await next(8);
  const badJson = frames()[7];

  const beforeNotification = frames().length;
  send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  await new Promise(resolve => setTimeout(resolve, 50));
  const notificationSilent = frames().length === beforeNotification;

  send({ jsonrpc: '2.0', id: 'cursor-string-id', method: 'ping' });
  await next(beforeNotification + 1);
  const stringId = frames()[beforeNotification];

  // A host may deliver a frame in pieces; the transport must wait for the body.
  const splitBody = JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'ping' });
  const splitFrame = frame(splitBody);
  const half = Math.floor(splitFrame.length / 2);
  input.write(splitFrame.slice(0, half));
  await new Promise(resolve => setTimeout(resolve, 20));
  input.write(splitFrame.slice(half));
  await next(beforeNotification + 2);
  const splitAnswered = frames()[beforeNotification + 1]?.['id'] === 9;

  // Progress: `stitch_merge` with a token, then two snapshots through the bridge.
  const progressBefore = frames().length;
  send({
    jsonrpc: '2.0',
    id: 10,
    method: 'tools/call',
    params: {
      name: 'stitch_merge',
      arguments: {
        repo_a: 'https://example.invalid/a.git',
        repo_b: 'https://example.invalid/b.git',
        progress_token: PROGRESS_TOKEN,
      },
    },
  });
  await next(progressBefore + 1);
  jobs.push({ jobId: 'job-1', status: 'running', progress: { completed: 1, total: 3 } });
  jobs.push({ jobId: 'job-1', status: 'succeeded', progress: { completed: 3, total: 3 } });
  const progressFrames = (): Wire[] =>
    frames()
      .slice(progressBefore)
      .filter(entry => entry['method'] === 'notifications/progress');
  await waitFor(() => progressFrames().length >= 2);
  const progressed = progressFrames();
  const paramsOf = (entry: Wire): Wire =>
    typeof entry['params'] === 'object' && entry['params'] !== null
      ? (entry['params'] as Wire)
      : {};

  await transport.stop();

  const report: StdioReport = {
    initialize_ok: initialized?.['protocolVersion'] === MCP_PROTOCOL_VERSION,
    negotiated_version:
      typeof initialized?.['protocolVersion'] === 'string'
        ? (initialized['protocolVersion'] as string)
        : null,
    server_name:
      typeof (initialized?.['serverInfo'] as Wire | undefined)?.['name'] === 'string'
        ? String((initialized?.['serverInfo'] as Wire)['name'])
        : null,
    capabilities_tools:
      typeof (initialized?.['capabilities'] as Wire | undefined)?.['tools'] === 'object',
    older_version_answered: older?.['protocolVersion'] === MCP_PROTOCOL_VERSION,
    tools_list_count: tools.length,
    schema_object: tools.every(
      tool => (tool['inputSchema'] as Wire | undefined)?.['type'] === 'object'
    ),
    schema_additional_properties_false: tools.every(
      tool => (tool['inputSchema'] as Wire | undefined)?.['additionalProperties'] === false
    ),
    every_tool_described: tools.every(
      tool => typeof tool['name'] === 'string' && typeof tool['description'] === 'string'
    ),
    call_ok: isErrorOf(called) === false && resultOf(called) !== undefined,
    call_tree_paths: treePaths,
    call_without_arguments_is_error: isErrorOf(noArguments),
    unknown_tool_is_error: isErrorOf(unknownTool),
    unknown_method_code: errorCodeOf(unknownMethod) ?? null,
    bad_json_code: errorCodeOf(badJson) ?? null,
    bad_json_id_null: badJson?.['id'] === null,
    notification_silent: notificationSilent,
    string_id_echoed: stringId?.['id'] === 'cursor-string-id',
    split_frame_answered: splitAnswered,
    progress_frames: progressed.length,
    progress_progresses: progressed.map(entry => Number(paramsOf(entry)['progress'])),
    progress_totals: progressed.map(entry => Number(paramsOf(entry)['total'])),
    progress_tokens: progressed.map(entry => String(paramsOf(entry)['progressToken'])),
    progress_releases: jobs.releases(),
    tool_names: registry.names(),
  };
  return { report, registry, jobs };
}

interface HttpReport {
  readonly port: number | null;
  readonly health_ok: boolean;
  readonly health_status: string | null;
  readonly post_ok: boolean;
  readonly post_status_code: number | null;
  readonly post_tool_count: number | null;
  readonly notification_status_code: number | null;
  readonly default_port: number;
  readonly error: string | null;
}

async function runHttp(registry: ToolRegistry): Promise<HttpReport> {
  const server = createMCPServer({ registry });
  const handler = async (payload: string): Promise<JsonRpcResponse | undefined> =>
    server.handleFrame(payload);
  let lastError: string | null = null;

  for (const port of HTTP_PORTS) {
    const transport = createHttpTransport({ handler, port });
    try {
      await transport.start();
      const health = await fetch(`http://127.0.0.1:${port}/mcp/health`);
      const healthBody = (await health.json()) as Wire;
      const posted = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      });
      const postBody = (await posted.json()) as Wire;
      const notification = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
      });
      const report: HttpReport = {
        port,
        health_ok: health.ok && healthBody['status'] === 'ok',
        health_status: typeof healthBody['status'] === 'string' ? healthBody['status'] : null,
        post_ok: posted.ok && resultOf(postBody) !== undefined,
        post_status_code: posted.status,
        post_tool_count: Array.isArray(resultOf(postBody)?.['tools'])
          ? (resultOf(postBody)?.['tools'] as Wire[]).length
          : null,
        notification_status_code: notification.status,
        default_port: DEFAULT_MCP_HTTP_PORT,
        error: null,
      };
      await transport.stop();
      return report;
    } catch (cause) {
      lastError = cause instanceof Error ? cause.message : String(cause);
    }
  }

  return {
    port: null,
    health_ok: false,
    health_status: null,
    post_ok: false,
    post_status_code: null,
    post_tool_count: null,
    notification_status_code: null,
    default_port: DEFAULT_MCP_HTTP_PORT,
    error: lastError,
  };
}

async function main(): Promise<void> {
  // The stdio case owns its own streams, so it also owns the job provider whose
  // sink must write to that same channel; the HTTP case reuses its registry.
  const { report: stdio, registry } = await runStdio();
  const http = await runHttp(registry);

  const payload = {
    server: {
      protocol_version: MCP_PROTOCOL_VERSION,
      server_name: MCP_SERVER_NAME,
      tool_names: stdio.tool_names,
    },
    stdio,
    http,
    hosts: {
      'claude-code': {
        transport: 'stdio',
        manual: false,
        initialize_ok: stdio.initialize_ok,
        negotiated_version: stdio.negotiated_version,
        tools_list_count: stdio.tools_list_count,
        schema_strict: stdio.schema_additional_properties_false,
        call_ok: stdio.call_ok,
        progress_frames: stdio.progress_frames,
        progress_progresses: stdio.progress_progresses,
      },
      opencode: {
        transport: 'http',
        manual: false,
        http_health_ok: http.health_ok,
        http_post_ok: http.post_ok,
        notification_status_code: http.notification_status_code,
        call_without_arguments_is_error: stdio.call_without_arguments_is_error,
        call_tree_paths: stdio.call_tree_paths,
      },
      cursor: {
        transport: 'stdio',
        manual: false,
        older_version_answered: stdio.older_version_answered,
        string_id_echoed: stdio.string_id_echoed,
        unknown_method_code: stdio.unknown_method_code,
        bad_json_code: stdio.bad_json_code,
        bad_json_id_null: stdio.bad_json_id_null,
        notification_silent: stdio.notification_silent,
        split_frame_answered: stdio.split_frame_answered,
      },
    },
    manual: {
      claude_code: 'not run',
      opencode: 'not run',
      cursor: 'not run',
      reason: 'no MCP host is installable in this environment',
      commands: [
        'claude mcp add repo-stitcher -- bun run --filter @repo-stitcher/mcp server',
        'opencode mcp add repo-stitcher -- bun run --filter @repo-stitcher/mcp server --http',
        'cursor: add packages/mcp/src/index.ts as a stdio MCP server in settings',
      ],
    },
  };

  process.stdout.write(`HOST_COMPAT ${JSON.stringify(payload)}\n`);
}

try {
  await main();
} catch (cause) {
  process.stderr.write(
    `host-compat failed: ${cause instanceof Error ? cause.message : String(cause)}\n`
  );
  process.exitCode = 1;
}
