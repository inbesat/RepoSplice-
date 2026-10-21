// P-335 — the generic Language Server Protocol client (JSON-RPC over stdio).
//
// A language server is a separate process that speaks LSP's JSON-RPC over
// stdio. This module owns that conversation: the framing, the request ids,
// the timeouts, the notification fan-out and the shutdown. It is
// language-agnostic on purpose — the per-language resolvers (P-336–P-339)
// sit on top of it.
//
// The client NEVER throws: every fallible step returns a Result. The errors
// REUSE the existing StitchError codes (a new code is never invented):
// CONFIG_ERROR for a server that will not start or initialize, INTERNAL for
// a protocol violation, a request that times out, a server 'error' response
// or a process that died.

import { spawn } from 'node:child_process';
import { err, ok, type Result } from 'neverthrow';
import type { StitchError } from '../result/index.js';

/** What a language server answers to `initialize`. */
/** The error a timed-out request settles with (CONFIG_ERROR carries a field). */
type LspTimeoutError =
  { code: 'INTERNAL'; message: string } | { code: 'CONFIG_ERROR'; field: string; message: string };

export interface LspInitializeResult {
  readonly capabilities: Record<string, unknown>;
  readonly serverInfo?: { readonly name?: string; readonly version?: string };
}

/** A handler for a server notification (window/logMessage, telemetry/event…). */
export type LspNotificationHandler = (params: unknown) => void;

/** The write half of the server's stdin. */
export interface LspWritable {
  write(chunk: string): boolean;
  end(): void;
}

/** The read half of the server's stdout. */
export interface LspReadable {
  on(event: 'data', listener: (chunk: string) => void): void;
}

/** The process surface the client needs (a real ChildProcess satisfies it). */
export interface LspChild {
  readonly stdin: LspWritable | null;
  readonly stdout: LspReadable | null;
  readonly stderr: LspReadable | null;
  on(event: 'exit', listener: (code: number | null) => void): void;
  on(event: 'error', listener: (error: Error) => void): void;
  kill(signal?: 'SIGTERM' | 'SIGKILL'): boolean;
  readonly exitCode: number | null;
}

/** How the client starts a server (injectable so the tests can use a stub). */
export type LspSpawnFn = (
  command: string,
  args: readonly string[],
  options: { cwd?: string; env?: Record<string, string> }
) => LspChild;

export interface LspClientOptions {
  /** The server binary (e.g. 'node' with the tsserver script as an argument). */
  readonly command: string;
  readonly args?: readonly string[];
  readonly cwd?: string;
  readonly env?: Record<string, string>;
  /** How long a single request may take. */
  readonly requestTimeoutMs?: number;
  /** How long the initialize round trip may take. */
  readonly initializeTimeoutMs?: number;
  /** How long the process may take to exit after the shutdown request. */
  readonly shutdownTimeoutMs?: number;
  /** Respawn + re-initialize when the server dies unexpectedly. */
  readonly autoReconnect?: boolean;
  readonly spawnFn?: LspSpawnFn;
}

export interface LspClient {
  /** Start the server and negotiate its capabilities. */
  initialize(params?: unknown): Promise<Result<LspInitializeResult, StitchError>>;
  /** Send a request and wait for its correlated response. */
  request<T>(method: string, params?: unknown): Promise<Result<T, StitchError>>;
  /** Send a notification (no response expected). */
  notify(method: string, params?: unknown): Result<void, StitchError>;
  /** Register a server-notification handler; the disposer unregisters it. */
  onNotification(method: string, handler: LspNotificationHandler): () => void;
  /** The health check: is the server still running? */
  isAlive(): boolean;
  /** Ask the server to shut down and make sure the process is gone. */
  shutdown(): Promise<Result<void, StitchError>>;
  /** Stop the process immediately (no shutdown handshake). */
  dispose(): void;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_INITIALIZE_TIMEOUT_MS = 30_000;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 5_000;

/** One LSP frame: the Content-Length header and the JSON body. */
export function lspFrame(payload: unknown): string {
  const body = JSON.stringify(payload);
  return `Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`;
}

interface PendingRequest {
  readonly method: string;
  readonly resolve: (outcome: Result<unknown, StitchError>) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

type LspState = 'idle' | 'starting' | 'ready' | 'closing' | 'closed';

/** Spawn a real process and adapt it to the client's process surface. */
function spawnNode(
  command: string,
  args: readonly string[],
  options: { cwd?: string; env?: Record<string, string> }
): LspChild {
  const child = spawn(command, [...args], {
    ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
    ...(options.env !== undefined ? { env: { ...process.env, ...options.env } } : {}),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return {
    stdin:
      child.stdin === null
        ? null
        : {
            write: (chunk: string): boolean => child.stdin.write(chunk),
            end: (): void => {
              child.stdin.end();
            },
          },
    stdout:
      child.stdout === null
        ? null
        : {
            on: (event: 'data', listener: (chunk: string) => void): void => {
              child.stdout.on(event, chunk => listener(chunk.toString('utf8')));
            },
          },
    stderr:
      child.stderr === null
        ? null
        : {
            on: (event: 'data', listener: (chunk: string) => void): void => {
              child.stderr.on(event, chunk => listener(chunk.toString('utf8')));
            },
          },
    on: (
      event: 'exit' | 'error',
      listener: ((code: number | null) => void) | ((error: Error) => void)
    ): void => {
      if (event === 'exit') {
        child.on('exit', code => (listener as (code: number | null) => void)(code));
      } else {
        child.on('error', error => (listener as (error: Error) => void)(error));
      }
    },
    kill: (signal?: 'SIGTERM' | 'SIGKILL'): boolean => child.kill(signal),
    get exitCode(): number | null {
      return child.exitCode;
    },
  };
}

class Client implements LspClient {
  private readonly options: Required<
    Pick<
      LspClientOptions,
      'requestTimeoutMs' | 'initializeTimeoutMs' | 'shutdownTimeoutMs' | 'autoReconnect'
    >
  > &
    LspClientOptions;

  private child: LspChild | null = null;
  private state: LspState = 'idle';
  private nextId = 1;
  private buffer = '';
  private readonly pending = new Map<number, PendingRequest>();
  private readonly notifications = new Map<string, Set<LspNotificationHandler>>();
  private spawnError: StitchError | null = null;
  private exitWaiters: ((code: number | null) => void)[] = [];

  constructor(options: LspClientOptions) {
    this.options = {
      ...options,
      requestTimeoutMs: options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
      initializeTimeoutMs: options.initializeTimeoutMs ?? DEFAULT_INITIALIZE_TIMEOUT_MS,
      shutdownTimeoutMs: options.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS,
      autoReconnect: options.autoReconnect ?? true,
    };
  }

  async initialize(params?: unknown): Promise<Result<LspInitializeResult, StitchError>> {
    if (this.child !== null) {
      return err({
        code: 'CONFIG_ERROR',
        field: 'lsp.server',
        message: 'the language server is already running',
      });
    }
    const started = this.start();
    if (started.isErr()) return err(started.error);
    this.state = 'starting';
    const initParams =
      params ??
      ({
        processId: process.pid,
        rootUri: null,
        capabilities: {},
        workspaceFolders: null,
      } as unknown);
    const response = await this.send<LspInitializeResult>(
      'initialize',
      initParams,
      this.options.initializeTimeoutMs,
      {
        code: 'CONFIG_ERROR',
        field: 'lsp.initialize',
        message: 'the language server did not initialize',
      }
    );
    if (response.isErr()) {
      this.dispose();
      return err(response.error);
    }
    this.state = 'ready';
    this.notify('initialized', {});
    return ok(response.value);
  }

  async request<T>(method: string, params?: unknown): Promise<Result<T, StitchError>> {
    const response = await this.send<T>(method, params, this.options.requestTimeoutMs, {
      code: 'INTERNAL',
      message: `the request ${method} timed out`,
    });
    if (response.isErr()) return err(response.error);
    return ok(response.value);
  }

  notify(method: string, params?: unknown): Result<void, StitchError> {
    if (this.child === null) {
      return err({ code: 'INTERNAL', message: `the language server is not running (${method})` });
    }
    const written = this.write({
      jsonrpc: '2.0',
      method,
      ...(params !== undefined ? { params } : {}),
    });
    if (!written) {
      return err({ code: 'INTERNAL', message: `the notification ${method} could not be written` });
    }
    return ok(undefined);
  }

  onNotification(method: string, handler: LspNotificationHandler): () => void {
    const handlers = this.notifications.get(method) ?? new Set<LspNotificationHandler>();
    handlers.add(handler);
    this.notifications.set(method, handlers);
    return () => {
      handlers.delete(handler);
    };
  }

  isAlive(): boolean {
    return this.child !== null && this.child.exitCode === null && this.state !== 'closed';
  }

  async shutdown(): Promise<Result<void, StitchError>> {
    const child = this.child;
    if (child === null) {
      this.state = 'closed';
      return ok(undefined);
    }
    this.state = 'closing';
    // Ask nicely: the shutdown request, then the exit notification. A server
    // that never answers is still stopped below.
    await this.send('shutdown', undefined, this.options.shutdownTimeoutMs, {
      code: 'INTERNAL',
      message: 'the language server did not acknowledge the shutdown',
    });
    this.notify('exit', undefined);
    const exited = await this.waitForExit(this.options.shutdownTimeoutMs);
    if (!exited) {
      try {
        child.kill('SIGKILL');
      } catch {
        // the process is already gone - nothing to kill
      }
      await this.waitForExit(1_000);
    }
    this.child = null;
    this.state = 'closed';
    this.failPending({
      code: 'INTERNAL',
      message: 'the language server was shut down',
    });
    return ok(undefined);
  }

  dispose(): void {
    const child = this.child;
    this.state = 'closed';
    this.child = null;
    this.failPending({ code: 'INTERNAL', message: 'the language server was stopped' });
    if (child !== null) {
      try {
        child.kill('SIGKILL');
      } catch {
        // the process is already gone
      }
    }
  }

  // --- internals ---------------------------------------------------------

  private start(): Result<void, StitchError> {
    const spawnFn = this.options.spawnFn ?? spawnNode;
    let child: LspChild;
    try {
      child = spawnFn(this.options.command, this.options.args ?? [], {
        ...(this.options.cwd !== undefined ? { cwd: this.options.cwd } : {}),
        ...(this.options.env !== undefined ? { env: this.options.env } : {}),
      });
    } catch (cause) {
      return err({
        code: 'CONFIG_ERROR',
        field: 'lsp.server',
        message: `the language server could not be started: ${cause instanceof Error ? cause.message : String(cause)}`,
      });
    }
    this.child = child;
    this.spawnError = null;
    child.stdout?.on('data', chunk => {
      this.onData(chunk);
    });
    child.on('exit', () => {
      this.onExit();
    });
    child.on('error', error => {
      const failure: StitchError = {
        code: 'CONFIG_ERROR',
        field: 'lsp.server',
        message: `the language server could not be started: ${error instanceof Error ? error.message : String(error)}`,
      };
      this.spawnError = failure;
      this.failPending(failure);
    });
    return ok(undefined);
  }

  private onExit(): void {
    const wasReady = this.state === 'ready';
    this.child = null;
    for (const waiter of this.exitWaiters) waiter(null);
    this.exitWaiters = [];
    this.failPending({
      code: 'INTERNAL',
      message: 'the language server exited',
    });
    if (this.state === 'closing' || this.state === 'closed') {
      this.state = 'closed';
      return;
    }
    this.state = 'closed';
    if (wasReady && this.options.autoReconnect) {
      this.reconnect();
    }
  }

  private reconnect(): void {
    this.state = 'idle';
    void this.initialize().then(
      () => undefined,
      () => undefined
    );
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    for (;;) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd < 0) return;
      const header = this.buffer.slice(0, headerEnd);
      const match = /content-length:\s*(\d+)/i.exec(header);
      if (match === null) {
        // A frame we cannot parse — drop the buffer instead of guessing.
        this.buffer = '';
        return;
      }
      const length = Number.parseInt(match[1] ?? '0', 10);
      const start = headerEnd + 4;
      if (this.buffer.length < start + length) return;
      const body = this.buffer.slice(start, start + length);
      this.buffer = this.buffer.slice(start + length);
      this.dispatch(body);
    }
  }

  private dispatch(body: string): void {
    let message: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(body);
      if (parsed === null || typeof parsed !== 'object') return;
      message = parsed as Record<string, unknown>;
    } catch {
      // A malformed body — the server is misbehaving; ignore the frame.
      return;
    }
    const id = message['id'];
    if (typeof id === 'number') {
      if (message['error'] !== undefined) {
        const error = message['error'] as { message?: string } | undefined;
        this.settle(
          id,
          err({
            code: 'INTERNAL',
            message: `the language server refused the request: ${error?.message ?? 'unknown error'}`,
          })
        );
        return;
      }
      this.settle(id, ok(message['result'] ?? null));
      return;
    }
    const method = message['method'];
    if (typeof method !== 'string') return;
    const handlers = this.notifications.get(method);
    if (handlers === undefined) return;
    for (const handler of handlers) {
      try {
        handler(message['params']);
      } catch {
        // A broken handler must not take the client down.
      }
    }
  }

  private settle(id: number, outcome: Result<unknown, StitchError>): void {
    const pending = this.pending.get(id);
    if (pending === undefined) return; // an unknown id (a late response)
    this.pending.delete(id);
    clearTimeout(pending.timer);
    pending.resolve(outcome);
  }

  private failPending(error: StitchError): void {
    const pending = [...this.pending.values()];
    this.pending.clear();
    for (const entry of pending) {
      clearTimeout(entry.timer);
      entry.resolve(err(error));
    }
  }

  private write(payload: unknown): boolean {
    const child = this.child;
    if (child === null || child.stdin === null) return false;
    try {
      child.stdin.write(lspFrame(payload));
      return true;
    } catch {
      return false;
    }
  }

  private async send<T>(
    method: string,
    params: unknown,
    timeoutMs: number,
    timeoutError: LspTimeoutError
  ): Promise<Result<T, StitchError>> {
    if (this.spawnError !== null) {
      return err(this.spawnError);
    }
    if (this.child === null) {
      return err({ code: 'INTERNAL', message: `the language server is not running (${method})` });
    }
    const id = this.nextId++;
    const outcome = await new Promise<Result<unknown, StitchError>>(resolve => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        const message = `${timeoutError.message} after ${timeoutMs} ms`;
        resolve(
          err(
            timeoutError.code === 'CONFIG_ERROR'
              ? { code: 'CONFIG_ERROR', field: timeoutError.field, message }
              : { code: 'INTERNAL', message }
          )
        );
      }, timeoutMs);
      this.pending.set(id, { method, resolve, timer });
      const written = this.write({
        jsonrpc: '2.0',
        id,
        method,
        ...(params !== undefined ? { params } : {}),
      });
      if (!written) {
        this.pending.delete(id);
        clearTimeout(timer);
        resolve(err({ code: 'INTERNAL', message: `the request ${method} could not be written` }));
      }
    });
    if (outcome.isErr()) return err(outcome.error);
    return ok(outcome.value as T);
  }

  private waitForExit(timeoutMs: number): Promise<boolean> {
    if (this.child === null) return Promise.resolve(true);
    return new Promise<boolean>(resolve => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve(false);
      }, timeoutMs);
      this.exitWaiters.push(() => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(true);
      });
    });
  }
}

/** Create a language-server client (the process is started by initialize). */
export function createLspClient(options: LspClientOptions): LspClient {
  return new Client(options);
}
