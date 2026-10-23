// P-344 — the warm language-server pool.
//
// A language server costs one to three seconds to boot; resolving imports one
// file at a time paid that cost per call. The pool keeps ONE server per
// ecosystem per session, so the second request pays only the round trip
// (the target is < 200 ms warm). It also owns the two things a caller should
// never have to think about: an idle timeout (5 minutes by default) and a cap
// on concurrent requests per server.
//
// The pool never throws: every fallible step returns a Result and the errors
// reuse the existing StitchError codes (CONFIG_ERROR with a `field` when an
// ecosystem has no configured server, INTERNAL otherwise).

import { err, ok, type Result } from 'neverthrow';
import type { Ecosystem } from '../deps/ecosystem.js';
import type { StitchError } from '../result/index.js';
import { createLspClient, type LspClient } from './lsp-client.js';

/** How to start one ecosystem's language server. */
export interface LspServerSpec {
  readonly command: string;
  readonly args?: readonly string[];
  readonly env?: Record<string, string>;
}

/** Builds a client for the pool (injectable so the tests use the stub server). */
export type LspClientFactory = (ecosystem: Ecosystem, spec: LspServerSpec) => LspClient;

export interface LspPoolOptions {
  /** The workspace the servers are started in. */
  readonly rootDir?: string;
  /** The server per ecosystem; an absent entry means "not available here". */
  readonly servers?: Partial<Record<Ecosystem, LspServerSpec>>;
  /** How long an unused server may live. Default 5 minutes. */
  readonly idleTimeoutMs?: number;
  /** How many requests one server may run at once. Default 10. */
  readonly maxConcurrentRequests?: number;
  /** Test seam: build the client yourself (the stub server, a fake, ...). */
  readonly createClient?: LspClientFactory;
}

/** What the pool can report about itself. */
export interface LspPoolStats {
  readonly created: number;
  readonly reused: number;
  readonly idleShutdowns: number;
  readonly peakConcurrentRequests: number;
  /** The observed warm round trips, in milliseconds. */
  readonly warmLatencyMs: readonly number[];
}

/** The health of one ecosystem's server. */
export interface LspPoolHealth {
  /** Is there a live server for this ecosystem right now? */
  readonly healthy: boolean;
  /** Is any server configured for this ecosystem at all? */
  readonly present: boolean;
  readonly detail?: string;
}

interface PoolEntry {
  client: LspClient;
  inFlight: number;
  lastUsed: number;
  idleTimer: ReturnType<typeof setTimeout> | undefined;
}

const DEFAULT_IDLE_TIMEOUT_MS = 300_000;
const DEFAULT_MAX_CONCURRENT_REQUESTS = 10;
const HEALTH_PING_TIMEOUT_MS = 2_000;

function messageOf(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  if (cause !== null && typeof cause === 'object' && 'message' in cause) {
    const message = (cause as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return String(cause);
}

/** The default server of each ecosystem we can start here. */
export function defaultServerSpecs(): Partial<Record<Ecosystem, LspServerSpec>> {
  return {
    node: {
      command: process.execPath,
      args: [
        // The bundled tsserver does not speak LSP; this bridge does (P-335).
        new URL('../../../node_modules/typescript-language-server/lib/cli.mjs', import.meta.url)
          .pathname,
        '--stdio',
      ],
    },
    rust: { command: 'rust-analyzer' },
  };
}

function idleTimeoutFromEnv(): number {
  const raw = process.env['STITCH_LSP_IDLE_TIMEOUT_MS'];
  if (raw === undefined) return DEFAULT_IDLE_TIMEOUT_MS;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_IDLE_TIMEOUT_MS;
}

export class LSPPool {
  private readonly rootDir: string | undefined;
  private readonly servers: Partial<Record<Ecosystem, LspServerSpec>>;
  private readonly idleTimeoutMs: number;
  private readonly maxConcurrentRequests: number;
  private readonly createClient: LspClientFactory;
  private readonly entries = new Map<Ecosystem, PoolEntry>();
  private readonly waiters = new Map<Ecosystem, (() => void)[]>();
  private created = 0;
  private reused = 0;
  private idleShutdowns = 0;
  private peakConcurrentRequests = 0;
  private readonly warmLatencyMs: number[] = [];

  constructor(options: LspPoolOptions = {}) {
    this.rootDir = options.rootDir;
    this.servers = options.servers ?? defaultServerSpecs();
    this.idleTimeoutMs = options.idleTimeoutMs ?? idleTimeoutFromEnv();
    this.maxConcurrentRequests = options.maxConcurrentRequests ?? DEFAULT_MAX_CONCURRENT_REQUESTS;
    this.createClient =
      options.createClient ??
      ((_ecosystem, spec) =>
        createLspClient({
          command: spec.command,
          ...(spec.args !== undefined ? { args: spec.args } : {}),
          ...(spec.env !== undefined ? { env: spec.env } : {}),
          ...(this.rootDir !== undefined ? { cwd: this.rootDir } : {}),
          autoReconnect: true,
        }));
  }

  /** The warm client of an ecosystem, started on first use and reused after. */
  async getClient(ecosystem: Ecosystem): Promise<Result<LspClient, StitchError>> {
    const existing = this.entries.get(ecosystem);
    if (existing !== undefined && existing.client.isAlive()) {
      this.touch(ecosystem, existing);
      this.reused += 1;
      return ok(existing.client);
    }
    if (existing !== undefined) {
      // The pipe broke: drop it so the caller gets a fresh server.
      this.drop(ecosystem);
    }
    const spec = this.servers[ecosystem];
    if (spec === undefined) {
      return err({
        code: 'CONFIG_ERROR',
        field: 'lsp.pool',
        message: `no language server is configured for the ${ecosystem} ecosystem`,
      });
    }
    const client = this.createClient(ecosystem, spec);
    const started = await client.initialize();
    if (started.isErr()) {
      client.dispose();
      return err(started.error);
    }
    this.created += 1;
    const entry: PoolEntry = { client, inFlight: 0, lastUsed: Date.now(), idleTimer: undefined };
    this.entries.set(ecosystem, entry);
    this.touch(ecosystem, entry);
    return ok(client);
  }

  /** Run one request through the pool, respecting the concurrency cap. */
  async request<T>(
    ecosystem: Ecosystem,
    method: string,
    params?: unknown
  ): Promise<Result<T, StitchError>> {
    await this.acquire(ecosystem);
    try {
      const client = await this.getClient(ecosystem);
      if (client.isErr()) return err(client.error);
      const startedAt = Date.now();
      const answer = await client.value.request<T>(method, params);
      // Only the requests after the first count as warm round trips.
      if (this.created > 0 && answer.isOk()) {
        this.warmLatencyMs.push(Date.now() - startedAt);
      }
      return answer;
    } finally {
      this.release(ecosystem);
    }
  }

  /** Ping the server; a dead pipe is dropped so the next use reconnects. */
  async healthCheck(ecosystem: Ecosystem): Promise<Result<LspPoolHealth, StitchError>> {
    const entry = this.entries.get(ecosystem);
    if (entry === undefined) {
      return ok({
        healthy: false,
        present: false,
        detail: 'no server has been started for this ecosystem yet',
      });
    }
    if (!entry.client.isAlive()) {
      this.drop(ecosystem);
      return ok({ healthy: false, present: false, detail: 'the server process is gone' });
    }
    // A DEFINITION or an ERROR both prove the pipe works; only silence fails.
    // The ping is bounded: a server that answers nothing at all is gone, and
    // waiting for the client's own request timeout would stall the caller.
    const ping = await Promise.race([
      entry.client.request<unknown>('textDocument/hover', {
        textDocument: { uri: 'file:///stitch-pool-health' },
        position: { line: 0, character: 0 },
      }),
      new Promise<Result<unknown, StitchError>>(resolve => {
        const timer = setTimeout(
          () =>
            resolve(
              err({
                code: 'INTERNAL',
                message: `the health ping went unanswered for ${HEALTH_PING_TIMEOUT_MS} ms`,
              })
            ),
          HEALTH_PING_TIMEOUT_MS
        );
        timer.unref();
      }),
    ]);
    if (ping.isOk()) {
      this.touch(ecosystem, entry);
      return ok({ healthy: true, present: true });
    }
    const detail = messageOf(ping.error);
    // A refusal (an unknown method, a protocol-level error) proves the pipe is
    // up - the server answered. Only silence (a timeout, an unwritable pipe or
    // a dead process) means the connection is gone.
    const answered = /refused the request/i.test(detail);
    if (answered && entry.client.isAlive()) {
      this.touch(ecosystem, entry);
      return ok({ healthy: true, present: true, detail });
    }
    this.drop(ecosystem);
    return ok({ healthy: false, present: false, detail });
  }

  stats(): LspPoolStats {
    return {
      created: this.created,
      reused: this.reused,
      idleShutdowns: this.idleShutdowns,
      peakConcurrentRequests: this.peakConcurrentRequests,
      warmLatencyMs: [...this.warmLatencyMs],
    };
  }

  /** Stop every server the pool owns. */
  async shutdownAll(): Promise<Result<void, StitchError>> {
    const ecosystems = [...this.entries.keys()];
    let firstError: StitchError | undefined;
    for (const ecosystem of ecosystems) {
      const entry = this.entries.get(ecosystem);
      if (entry === undefined) continue;
      this.clearIdleTimer(entry);
      const stopped = await entry.client.shutdown();
      if (stopped.isErr() && firstError === undefined) firstError = stopped.error;
      this.entries.delete(ecosystem);
    }
    if (firstError !== undefined) return err(firstError);
    return ok(undefined);
  }

  // --- internals ---------------------------------------------------------

  /** Wait for a free slot, then take it. */
  private async acquire(ecosystem: Ecosystem): Promise<void> {
    for (;;) {
      const entry = this.entries.get(ecosystem);
      const inFlight = entry?.inFlight ?? 0;
      if (entry === undefined || inFlight < this.maxConcurrentRequests) {
        if (entry !== undefined) {
          entry.inFlight += 1;
          this.peakConcurrentRequests = Math.max(this.peakConcurrentRequests, entry.inFlight);
        }
        return;
      }
      await new Promise<void>(resolve => {
        const queue = this.waiters.get(ecosystem) ?? [];
        queue.push(resolve);
        this.waiters.set(ecosystem, queue);
      });
    }
  }

  private release(ecosystem: Ecosystem): void {
    const entry = this.entries.get(ecosystem);
    if (entry !== undefined) entry.inFlight = Math.max(0, entry.inFlight - 1);
    const queue = this.waiters.get(ecosystem);
    const next = queue?.shift();
    if (next !== undefined) next();
  }

  /** Mark the entry used now and arm its idle timer again. */
  private touch(ecosystem: Ecosystem, entry: PoolEntry): void {
    entry.lastUsed = Date.now();
    this.clearIdleTimer(entry);
    if (this.idleTimeoutMs <= 0) return;
    entry.idleTimer = setTimeout(() => {
      void this.expire(ecosystem);
    }, this.idleTimeoutMs);
    // Never keep the process alive just for the idle sweep.
    if (typeof entry.idleTimer === 'object' && 'unref' in entry.idleTimer) {
      entry.idleTimer.unref();
    }
  }

  private clearIdleTimer(entry: PoolEntry): void {
    if (entry.idleTimer !== undefined) clearTimeout(entry.idleTimer);
    entry.idleTimer = undefined;
  }

  /** Shut an idle server down (the spec's timeout). */
  private async expire(ecosystem: Ecosystem): Promise<void> {
    const entry = this.entries.get(ecosystem);
    if (entry === undefined) return;
    if (entry.inFlight > 0) {
      this.touch(ecosystem, entry);
      return;
    }
    this.idleShutdowns += 1;
    this.clearIdleTimer(entry);
    this.entries.delete(ecosystem);
    await entry.client.shutdown();
  }

  private drop(ecosystem: Ecosystem): void {
    const entry = this.entries.get(ecosystem);
    if (entry === undefined) return;
    this.clearIdleTimer(entry);
    this.entries.delete(ecosystem);
    entry.client.dispose();
  }
}

/** Build a pool for a session. */
export function createLspPool(options: LspPoolOptions = {}): LSPPool {
  return new LSPPool(options);
}
