// P-357 - the MCP server.
//
// The server is a PROTOCOL ADAPTER: it owns the JSON-RPC envelope (ids,
// methods, error objects) and nothing else. Every outcome, including a tool
// failure, leaves through the wire as a well-formed JSON-RPC message, so the
// dispatch path itself cannot throw. The domain work lives in the registry and
// in core; the transport lives in ./transport.ts.

import { err, ok, type Result } from 'neverthrow';
import type { StitchError } from '@repo-stitcher/core';
import type { ToolRegistry } from './tools/registry.js';

/** The MCP revision this scaffold speaks. */
export const MCP_PROTOCOL_VERSION = '2024-11-05';
export const MCP_SERVER_NAME = 'repo-stitcher';
export const MCP_SERVER_VERSION = '0.0.0';

/** The JSON-RPC error codes the protocol defines. */
export const JSON_RPC_ERROR_CODES = {
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internalError: -32603,
} as const;

export type JsonRpcId = string | number | null;

export interface JsonRpcRequest {
  readonly jsonrpc: '2.0';
  readonly id?: JsonRpcId;
  readonly method: string;
  readonly params?: unknown;
}

export interface JsonRpcErrorObject {
  readonly code: number;
  readonly message: string;
  readonly data?: unknown;
}

export interface JsonRpcResponse {
  readonly jsonrpc: '2.0';
  readonly id: JsonRpcId;
  readonly result?: unknown;
  readonly error?: JsonRpcErrorObject;
}

export interface MCPServerInfo {
  readonly name: string;
  readonly version: string;
}

export interface MCPInitializeResult {
  readonly protocolVersion: string;
  readonly capabilities: { readonly tools: Record<string, unknown> };
  readonly serverInfo: MCPServerInfo;
  readonly instructions?: string;
}

export interface MCPToolContent {
  readonly type: 'text';
  readonly text: string;
}

export interface MCPCallToolResult {
  readonly content: readonly MCPToolContent[];
  readonly isError: boolean;
}

export interface MCPServerOptions {
  readonly registry: ToolRegistry;
  readonly name?: string;
  readonly version?: string;
  readonly protocolVersion?: string;
  readonly instructions?: string;
  /** Called with the client's name when it initializes (telemetry's host, P-366). */
  readonly onClient?: (name: string) => void;
}

function messageOf(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  if (cause !== null && typeof cause === 'object' && 'message' in cause) {
    const message = (cause as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return String(cause);
}

/** Render a `StitchError` into the protocol's error object. */
function toJsonRpcError(error: StitchError): JsonRpcErrorObject {
  return {
    code: JSON_RPC_ERROR_CODES.invalidParams,
    message: 'message' in error && typeof error.message === 'string' ? error.message : error.code,
    data: { code: error.code },
  };
}

function parseRequest(message: unknown): Result<JsonRpcRequest, JsonRpcErrorObject> {
  if (message === null || typeof message !== 'object' || Array.isArray(message)) {
    return err({
      code: JSON_RPC_ERROR_CODES.invalidRequest,
      message: 'a JSON-RPC request must be an object',
    });
  }
  const record = message as Record<string, unknown>;
  const method = record['method'];
  if (typeof method !== 'string') {
    return err({
      code: JSON_RPC_ERROR_CODES.invalidRequest,
      message: 'a JSON-RPC request needs a string method',
    });
  }
  const id = record['id'];
  const request: JsonRpcRequest =
    typeof id === 'string' || typeof id === 'number'
      ? { jsonrpc: '2.0', id, method, params: record['params'] }
      : { jsonrpc: '2.0', method, params: record['params'] };
  return ok(request);
}

/**
 * The MCP server surface: `initialize`, `tools/list` and `tools/call`.
 *
 * `handleMessage` is pure (no transport), so a test can drive the protocol
 * directly; `handleFrame` parses one wire payload first.
 */
export class MCPServer {
  private readonly registry: ToolRegistry;
  private readonly name: string;
  private readonly version: string;
  private readonly protocolVersion: string;
  private readonly instructions: string | undefined;
  private readonly onClient: ((name: string) => void) | undefined;

  constructor(options: MCPServerOptions) {
    this.registry = options.registry;
    this.name = options.name ?? MCP_SERVER_NAME;
    this.version = options.version ?? MCP_SERVER_VERSION;
    this.protocolVersion = options.protocolVersion ?? MCP_PROTOCOL_VERSION;
    this.instructions = options.instructions;
    this.onClient = options.onClient;
  }

  /** Report which client connected. A hook that throws cannot fail the handshake. */
  private notifyClient(params: unknown): void {
    if (this.onClient === undefined) return;
    const record =
      params !== null && typeof params === 'object' ? (params as Record<string, unknown>) : {};
    const client = record['clientInfo'];
    const info =
      client !== null && typeof client === 'object' ? (client as Record<string, unknown>) : {};
    const name = info['name'];
    if (typeof name !== 'string' || name === '') return;
    try {
      this.onClient(name);
    } catch {
      // Diagnostics must never fail a request.
    }
  }

  /** The `initialize` result. */
  initialize(): MCPInitializeResult {
    return {
      protocolVersion: this.protocolVersion,
      capabilities: { tools: {} },
      serverInfo: { name: this.name, version: this.version },
      ...(this.instructions !== undefined ? { instructions: this.instructions } : {}),
    };
  }

  /** The `tools/list` result. */
  listTools(): { readonly tools: ReturnType<ToolRegistry['list']> } {
    return { tools: this.registry.list() };
  }

  /** The `tools/call` result. A tool failure is a Result error, never a throw. */
  async callTool(name: string, args: unknown): Promise<Result<MCPCallToolResult, StitchError>> {
    const outcome = await this.registry.call(name, args);
    if (outcome.isErr()) return err(outcome.error);
    return ok({
      content: [{ type: 'text', text: JSON.stringify(outcome.value ?? null) }],
      isError: false,
    });
  }

  /**
   * Dispatch one JSON-RPC message.
   *
   * Returns `undefined` for a notification (a message with no id) - the
   * protocol forbids answering one. Everything else is a response; a request
   * that cannot be parsed becomes an error response.
   */
  async handleMessage(message: unknown): Promise<JsonRpcResponse | undefined> {
    const parsed = parseRequest(message);
    if (parsed.isErr()) {
      const record = message as { id?: unknown } | null;
      const rawId = record !== null && typeof record === 'object' ? record.id : undefined;
      const id: JsonRpcId = typeof rawId === 'string' || typeof rawId === 'number' ? rawId : null;
      return { jsonrpc: '2.0', id, error: parsed.error };
    }
    const request = parsed.value;
    if (request.id === undefined) {
      // A notification: nothing to answer.
      return undefined;
    }
    const id = request.id;
    switch (request.method) {
      case 'initialize':
        this.notifyClient(request.params);
        return { jsonrpc: '2.0', id, result: this.initialize() };
      case 'ping':
        return { jsonrpc: '2.0', id, result: {} };
      case 'tools/list':
        return { jsonrpc: '2.0', id, result: this.listTools() };
      case 'tools/call': {
        const params = request.params;
        const record =
          params !== null && typeof params === 'object' ? (params as Record<string, unknown>) : {};
        const name = record['name'];
        if (typeof name !== 'string' || name === '') {
          return {
            jsonrpc: '2.0',
            id,
            error: {
              code: JSON_RPC_ERROR_CODES.invalidParams,
              message: 'tools/call needs a string name',
            },
          };
        }
        const called = await this.callTool(name, record['arguments']);
        if (called.isErr()) {
          // A tool that failed is reported INSIDE the result (isError), not as
          // a protocol error - the client asked a valid question.
          return {
            jsonrpc: '2.0',
            id,
            result: {
              content: [{ type: 'text', text: toJsonRpcError(called.error).message }],
              isError: true,
            },
          };
        }
        return { jsonrpc: '2.0', id, result: called.value };
      }
      default:
        return {
          jsonrpc: '2.0',
          id,
          error: {
            code: JSON_RPC_ERROR_CODES.methodNotFound,
            message: `the method ${request.method} is not supported`,
          },
        };
    }
  }

  /** Parse one wire payload and dispatch it. Malformed JSON is a parse error. */
  async handleFrame(payload: string): Promise<JsonRpcResponse | undefined> {
    let message: unknown;
    try {
      message = JSON.parse(payload) as unknown;
    } catch (cause) {
      return {
        jsonrpc: '2.0',
        id: null,
        error: {
          code: JSON_RPC_ERROR_CODES.parseError,
          message: `the payload is not JSON: ${messageOf(cause)}`,
        },
      };
    }
    return this.handleMessage(message);
  }
}

/** Build a server over a registry. */
export function createMCPServer(options: MCPServerOptions): MCPServer {
  return new MCPServer(options);
}
