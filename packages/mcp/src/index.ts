// P-357 - the MCP server package entry point.
//
// `startMcpServer` wires the registry, the core tools and a transport; `main`
// is what `bun run mcp:server` executes (stdio by default, HTTP on request).

import { err, ok, type Result } from 'neverthrow';
import type { StitchError } from '@repo-stitcher/core';
import { createMCPServer, MCPServer, type JsonRpcResponse } from './server.js';
import {
  createHttpTransport,
  createStdioTransport,
  DEFAULT_MCP_HTTP_PORT,
  HttpTransport,
  StdioTransport,
} from './transport.js';
import { createToolRegistry, ToolRegistry } from './tools/registry.js';
import { loadCoreToolPorts, registerCoreTools } from './tools/core-tools.js';
import { loadSelectFilesPorts, registerSelectFilesTool } from './tools/select-files.js';
import { registerJobStatusTools } from './tools/job-status.js';
import { loadMergePorts, registerMergeTool } from './tools/merge.js';
import { loadCheckLicensePorts, registerCheckLicenseTool } from './tools/check-license.js';

export * from './server.js';
export * from './transport.js';
export * from './tools/registry.js';
export * from './tools/core-tools.js';
export * from './tools/select-files.js';
export * from './tools/job-status.js';
export * from './tools/merge.js';
export * from './tools/check-license.js';

export interface StartMcpServerOptions {
  readonly transport?: 'stdio' | 'http';
  readonly port?: number;
  readonly hostname?: string;
  readonly registry?: ToolRegistry;
}

export interface StartedMcpServer {
  readonly server: MCPServer;
  readonly transport: StdioTransport | HttpTransport;
  /** The tool names the registry holds. */
  readonly tools: readonly string[];
}

/**
 * Build the server, register the core tools and start a transport.
 *
 * A missing core export is a configuration error, never a silent empty tool
 * set: the caller must be able to see that the wiring is incomplete.
 */
export async function startMcpServer(
  options: StartMcpServerOptions = {}
): Promise<Result<StartedMcpServer, StitchError>> {
  const registry = options.registry ?? createToolRegistry();
  if (registry.names().length === 0) {
    const ports = await loadCoreToolPorts();
    if (ports.isErr()) return err(ports.error);
    const registered = registerCoreTools(registry, ports.value);
    if (registered.isErr()) return err(registered.error);
    const selectPorts = await loadSelectFilesPorts();
    if (selectPorts.isErr()) return err(selectPorts.error);
    const selectRegistered = registerSelectFilesTool(registry, selectPorts.value);
    if (selectRegistered.isErr()) return err(selectRegistered.error);
    const mergePorts = await loadMergePorts();
    const mergeRegistered = registerMergeTool(registry, mergePorts);
    if (mergeRegistered.isErr()) return err(mergeRegistered.error);
    const jobRegistered = registerJobStatusTools(registry, mergePorts);
    if (jobRegistered.isErr()) return err(jobRegistered.error);
    const licensePorts = await loadCheckLicensePorts();
    const licenseRegistered = registerCheckLicenseTool(registry, licensePorts);
    if (licenseRegistered.isErr()) return err(licenseRegistered.error);
  }
  const server = createMCPServer({ registry });
  const handler = async (payload: string): Promise<JsonRpcResponse | undefined> =>
    server.handleFrame(payload);
  if (options.transport === 'http') {
    const transport = createHttpTransport({
      handler,
      ...(options.port !== undefined ? { port: options.port } : {}),
      ...(options.hostname !== undefined ? { hostname: options.hostname } : {}),
    });
    await transport.start();
    return ok({ server, transport, tools: registry.names() });
  }
  const transport = createStdioTransport({ handler });
  await transport.start();
  return ok({ server, transport, tools: registry.names() });
}

/** Resolve the HTTP port from `--port <n>` or `MCP_PORT`, else the default. */
export function resolvePort(argv: readonly string[]): number {
  const index = argv.indexOf('--port');
  const fromFlag = index >= 0 ? Number.parseInt(argv[index + 1] ?? '', 10) : Number.NaN;
  if (Number.isInteger(fromFlag) && fromFlag > 0) return fromFlag;
  const fromEnv = Number.parseInt(process.env['MCP_PORT'] ?? '', 10);
  if (Number.isInteger(fromEnv) && fromEnv > 0) return fromEnv;
  return DEFAULT_MCP_HTTP_PORT;
}

/** The `mcp:server` entry point. */
export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  const useHttp = argv.includes('--http');
  const started = await startMcpServer({
    transport: useHttp ? 'http' : 'stdio',
    port: resolvePort(argv),
  });
  if (started.isErr()) {
    const error = started.error;
    process.stderr.write(`mcp: ${'message' in error ? error.message : error.code}\n`);
    return 1;
  }
  if (useHttp) {
    process.stderr.write(
      `mcp: listening on http://127.0.0.1:${resolvePort(argv)}/mcp (${started.value.tools.length} tools)\n`
    );
  }
  return 0;
}
