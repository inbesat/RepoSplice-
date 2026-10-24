// P-357 - the MCP transports.
//
// Two ways in: stdio for local clients (the framing is the same
// `Content-Length: N\r\n\r\n{json}` the language-server world uses) and HTTP
// for remote ones, served by Elysia (P-043). Both are thin: they move bytes and
// hand complete JSON payloads to the server, which owns the protocol.

import { Elysia } from 'elysia';
import type { JsonRpcResponse } from './server.js';

/** What a transport needs from the server. */
export type FrameHandler = (payload: string) => Promise<JsonRpcResponse | undefined>;

/** The common surface. */
export interface Transport {
  readonly kind: 'stdio' | 'http';
  start(): Promise<void>;
  stop(): Promise<void>;
}

/** The readable half of a stream (process.stdin and a PassThrough both fit). */
export interface ReadableLike {
  on(event: 'data', listener: (chunk: unknown) => void): unknown;
}

/** The writable half. */
export interface WritableLike {
  write(chunk: string): unknown;
}

/** Encode one JSON-RPC message as an LSP-style frame. */
export function encodeFrame(message: unknown): string {
  const body = JSON.stringify(message);
  return `Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`;
}

export interface StdioTransportOptions {
  readonly input?: ReadableLike;
  readonly output?: WritableLike;
  readonly handler: FrameHandler;
}

/**
 * The stdio transport.
 *
 * Reads are framed by `Content-Length`; a partial frame waits for more bytes
 * and a header that cannot be parsed drops the buffer rather than throwing.
 * Any reply goes back out as one framed message.
 */
export class StdioTransport implements Transport {
  readonly kind = 'stdio' as const;
  private readonly input: ReadableLike;
  private readonly output: WritableLike;
  private readonly handler: FrameHandler;
  private buffer = '';
  private started = false;

  constructor(options: StdioTransportOptions) {
    this.input = options.input ?? (process.stdin as unknown as ReadableLike);
    this.output = options.output ?? (process.stdout as unknown as WritableLike);
    this.handler = options.handler;
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.input.on('data', chunk => {
      this.onData(String(chunk));
    });
  }

  async stop(): Promise<void> {
    this.started = false;
    this.buffer = '';
  }

  /** Write one framed reply. */
  send(response: JsonRpcResponse): void {
    this.output.write(encodeFrame(response));
  }

  /** Feed raw bytes; complete frames are dispatched. Exposed for the tests. */
  onData(chunk: string): void {
    this.buffer += chunk;
    for (;;) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd < 0) return;
      const header = this.buffer.slice(0, headerEnd);
      const match = /content-length:\s*(\d+)/i.exec(header);
      if (match === null) {
        // A frame we cannot parse: drop the buffer instead of guessing.
        this.buffer = '';
        return;
      }
      const length = Number.parseInt(match[1] ?? '0', 10);
      const start = headerEnd + 4;
      if (this.buffer.length < start + length) return;
      const body = this.buffer.slice(start, start + length);
      this.buffer = this.buffer.slice(start + length);
      void this.dispatch(body);
    }
  }

  private async dispatch(payload: string): Promise<void> {
    const response = await this.handler(payload);
    if (response !== undefined) this.send(response);
  }
}

export interface HttpTransportOptions {
  readonly port?: number;
  readonly hostname?: string;
  readonly path?: string;
  readonly handler: FrameHandler;
}

/** The default port the `mcp:server` script listens on. */
export const DEFAULT_MCP_HTTP_PORT = 3435;

/**
 * The HTTP transport, built on Elysia.
 *
 * `POST <path>` carries one JSON-RPC message and returns its reply; a
 * notification is answered with 202 and no body. `GET <path>/health` is a
 * liveness probe. The app is built eagerly so a test can exercise the routes
 * without binding a port; `start()` binds.
 */
export class HttpTransport implements Transport {
  readonly kind = 'http' as const;
  readonly app: Elysia;
  private readonly port: number;
  private readonly hostname: string;
  private readonly handler: FrameHandler;

  constructor(options: HttpTransportOptions) {
    this.port = options.port ?? DEFAULT_MCP_HTTP_PORT;
    this.hostname = options.hostname ?? '127.0.0.1';
    this.handler = options.handler;
    const path = options.path ?? '/mcp';
    this.app = new Elysia()
      .get(`${path}/health`, () => ({ status: 'ok' }))
      .post(path, async ({ body }: { body: unknown }) => {
        const payload = typeof body === 'string' ? body : JSON.stringify(body ?? {});
        const response = await this.handler(payload);
        if (response === undefined) return new Response(null, { status: 202 });
        return Response.json(response);
      });
  }

  async start(): Promise<void> {
    this.app.listen({ port: this.port, hostname: this.hostname });
  }

  async stop(): Promise<void> {
    await this.app.stop();
  }
}

/** Build a stdio transport. */
export function createStdioTransport(options: StdioTransportOptions): StdioTransport {
  return new StdioTransport(options);
}

/** Build the HTTP transport. */
export function createHttpTransport(options: HttpTransportOptions): HttpTransport {
  return new HttpTransport(options);
}
