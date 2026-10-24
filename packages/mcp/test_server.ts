// P-357 - the mandated MCP server tests.
//
// The plan names three ids under `mcp/test_server.ts`; they live here as the
// `it(...)` descriptions (this repo's vitest style) and the path maps to this
// file - recorded in ADR-166.

import { PassThrough } from 'node:stream';
import { err, ok } from 'neverthrow';
import { describe, expect, it } from 'vitest';
import {
  createMCPServer,
  createStdioTransport,
  createToolRegistry,
  encodeFrame,
  JSON_RPC_ERROR_CODES,
  MCP_PROTOCOL_VERSION,
  registerCoreTools,
  type CoreToolPorts,
  type JsonRpcResponse,
  type ReadableLike,
  type ToolRegistry,
  type WritableLike,
} from './src/index.js';

interface InitializeResultShape {
  readonly protocolVersion: string;
  readonly capabilities: { readonly tools: unknown };
  readonly serverInfo: { readonly name: string; readonly version: string };
}

interface ToolDescriptorShape {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: { readonly type: string };
}

interface CallToolShape {
  readonly content: readonly { readonly text: string }[];
  readonly isError: boolean;
}

function fakePorts(overrides: Partial<CoreToolPorts> = {}): CoreToolPorts {
  return {
    mergeManifests: () => ok({ merged: 2 }),
    scanLicenses: () => ok({ verdict: 'clean' }),
    runSandboxBuild: () => ok({ passed: true }),
    subscribeJobEvents: () => ok({ subscribed: [], buffered: 0 }),
    runPipeline: () => ok({ outcome: 'completed' }),
    ...overrides,
  };
}

function registryWith(ports: CoreToolPorts): ToolRegistry {
  const registry = createToolRegistry();
  const registered = registerCoreTools(registry, ports);
  if (registered.isErr()) {
    // A test fixture may throw; the server APIs never do.
    const error = registered.error;
    throw new Error('message' in error ? error.message : error.code);
  }
  return registry;
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('timed out waiting for the condition');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

describe('MCP server (P-357)', () => {
  it('test_initialize', async () => {
    const server = createMCPServer({ registry: registryWith(fakePorts()) });
    const response = await server.handleMessage({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'test', version: '0' },
      },
    });
    expect(response).toBeTruthy();
    const result = response?.result as InitializeResultShape;
    expect(result.protocolVersion).toBe(MCP_PROTOCOL_VERSION);
    expect(result.serverInfo.name).toBe('repo-stitcher');
    expect(result.capabilities.tools).toBeTruthy();

    // the same path serves a framed payload
    const ping = await server.handleFrame(
      JSON.stringify({ jsonrpc: '2.0', id: 'a', method: 'ping' })
    );
    expect(ping?.id).toBe('a');
    expect(ping?.error).toBeUndefined();

    // malformed JSON is a parse error, an unknown method is a method error
    const malformed = await server.handleFrame('{not json');
    expect(malformed?.error?.code).toBe(JSON_RPC_ERROR_CODES.parseError);
    const unknown = await server.handleMessage({ jsonrpc: '2.0', id: 2, method: 'nope' });
    expect(unknown?.error?.code).toBe(JSON_RPC_ERROR_CODES.methodNotFound);

    // a notification is never answered
    const notification = await server.handleMessage({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    });
    expect(notification).toBeUndefined();
  });

  it('test_tools_list', async () => {
    const server = createMCPServer({ registry: registryWith(fakePorts()) });
    const listed = await server.handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    const tools = (listed?.result as { readonly tools: readonly ToolDescriptorShape[] }).tools;
    expect(tools.length).toBe(5);
    expect(tools.map(tool => tool.name)).toEqual([
      'merge_manifests',
      'run_pipeline',
      'run_sandbox_build',
      'scan_licenses',
      'subscribe_job_events',
    ]);
    for (const tool of tools) {
      expect(tool.description.length > 0).toBeTruthy();
      expect(tool.inputSchema.type).toBe('object');
    }

    // a tool call returns its value as text content
    const called = await server.handleMessage({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'merge_manifests', arguments: { manifests: [] } },
    });
    const result = called?.result as CallToolShape;
    expect(result.isError).toBe(false);
    expect(result.content[0]?.text).toBe(JSON.stringify({ merged: 2 }));

    // a failing tool is an isError RESULT, not a protocol error
    const failing = createMCPServer({
      registry: registryWith(
        fakePorts({ scanLicenses: () => err({ code: 'INTERNAL', message: 'the scan blew up' }) })
      ),
    });
    const refused = await failing.handleMessage({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'scan_licenses' },
    });
    expect(refused?.error).toBeUndefined();
    const refusedResult = refused?.result as CallToolShape;
    expect(refusedResult.isError).toBe(true);
    expect(refusedResult.content[0]?.text).toContain('the scan blew up');

    // an unknown tool is reported, never silently ignored
    const ghost = await server.handleMessage({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'ghost' },
    });
    expect((ghost?.result as CallToolShape).isError).toBe(true);

    // and the registry refuses to overwrite a name
    const registry = registryWith(fakePorts());
    const duplicate = registry.register(
      { name: 'merge_manifests', description: 'again', inputSchema: { type: 'object' } },
      () => ok(null)
    );
    expect(duplicate.isErr()).toBe(true);
  });

  it('test_stdio_transport', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const server = createMCPServer({ registry: registryWith(fakePorts()) });
    const transport = createStdioTransport({
      input: input as unknown as ReadableLike,
      output: output as unknown as WritableLike,
      handler: payload => server.handleFrame(payload),
    });
    const replies: JsonRpcResponse[] = [];
    let buffer = '';
    output.on('data', (chunk: unknown) => {
      buffer += String(chunk);
      for (;;) {
        const separator = buffer.indexOf('\r\n\r\n');
        if (separator < 0) return;
        const match = /content-length:\s*(\d+)/i.exec(buffer.slice(0, separator));
        if (match === null) {
          buffer = '';
          return;
        }
        const length = Number.parseInt(match[1] ?? '0', 10);
        const start = separator + 4;
        if (buffer.length < start + length) return;
        const body = buffer.slice(start, start + length);
        buffer = buffer.slice(start + length);
        replies.push(JSON.parse(body) as JsonRpcResponse);
      }
    });
    await transport.start();

    const request = encodeFrame({ jsonrpc: '2.0', id: 7, method: 'initialize', params: {} });
    // a half frame waits for the rest of its bytes
    input.write(request.slice(0, 12));
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(replies.length).toBe(0);

    input.write(request.slice(12));
    await waitFor(() => replies.length === 1);
    expect(replies[0]?.id).toBe(7);
    const result = replies[0]?.result as InitializeResultShape;
    expect(result.protocolVersion).toBe(MCP_PROTOCOL_VERSION);

    await transport.stop();
  });
});
