// P-193 — `stitch serve`: start the local HTTP/WS server (P-043 Elysia) that
// hosts the REST + WS API and, when built, the web UI (P-235).
//
// THIN ORCHESTRATION, like `merge.ts`: the app itself lives in `server/app.ts`;
// this file validates the port, opens the P-187 audit database, listens, wires
// SIGINT, and prints the URL. Everything environmental is injected so every
// mandated behaviour is testable under vitest's Node runtime (Elysia's
// WebStandard adapter cannot `.listen()` there — see the P-043 note in
// `src/serve.test.ts`; the shipped path runs on Bun, the TECH_STACK runtime).
//
// ON THE PORT AND "FROM CONFIG": the phase's context says the port comes from
// config (default 3434), but `ConfigSchema` has NO server/host/port section
// (grepped, ADR-078); a config key is never invented here. The port therefore
// comes from `--port` (default 3434) until a config section owns it.
//
// ON `FLUSH AUDIT` (SIGINT): P-187's `ProvenanceAudit` appends to SQLite
// synchronously — there is no buffer to flush, and `AUDIT_ACTIONS` has no
// 'serve' action to invent a record for. The flush IS the clean close of the
// `stitch.db` handle (WAL checkpoint on close), after the server has stopped.

import { join, resolve } from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { err, ok, type Result } from 'neverthrow';
import { openSqlite, STITCH_DB_FILENAME, type StitchError } from '@repo-stitcher/core';
import type { GlobalOptions } from '../globals.js';
import { DEFAULT_SERVE_HOST, DEFAULT_SERVE_PORT, createApp } from '../server/app.js';

/** What the command accepts, on top of the globals. */
export interface ServeOptions extends GlobalOptions {
  /** `--host <host>`: bind address. Default `127.0.0.1`. */
  host?: string;
  /** `--port <port>`: HTTP port. Commander hands a string; must be integer 1-65535. */
  port?: number | string;
  /** `--no-web` (commander sets this to `false`): skip the web UI; keep /health, /api, /ws. */
  web?: boolean;
}

/** What the command reports once the server is listening. */
export interface ServeOutcome {
  /** The URL the user opens. */
  url: string;
}

/** Everything environmental, injected (mirrors `MergeDeps`). */
export interface ServeDeps {
  /** Where the URL report goes. Default: stdout. */
  write?: (line: string) => void;
  /**
   * Probe that the host:port is free BEFORE opening anything.
   * Default: a throwaway `node:net` bind.
   */
  probePort?: (host: string, port: number) => Promise<Result<void, StitchError>>;
  /**
   * Open the P-187 audit store; its `close()` IS the shutdown flush.
   * Default: core's `openSqlite` on `<cwd>/stitch.db`. Only `close()` is used,
   * so the dependency stays wide-open to whichever durable store owns it.
   */
  openAuditDb?: (filePath: string) => Promise<Result<{ close(): void }, StitchError>>;
  /** Register the SIGINT handler. Default: `process.once`. */
  registerSignal?: (handler: () => void) => void;
  /**
   * Bind and keep listening. Default: `app.listen({ hostname, port })` on the
   * Bun runtime. Tests inject a stand-in, because vitest's Node runtime cannot
   * listen (see the P-043 note in `src/serve.test.ts`).
   */
  runListen?: () => void | Promise<void>;
}

/**
 * Build the SIGINT shutdown: stop the server, THEN close the audit store
 * (WAL flush), then report — and drop any second invocation silently.
 */
export function createShutdown(halt: {
  stop: () => unknown;
  closeAudit: () => void;
  write?: (line: string) => void;
}): () => Promise<void> {
  let done = false;
  return async (): Promise<void> => {
    if (done) return;
    done = true;
    // Graceful stop (no `closeActiveConnections`): inflight responses finish.
    await Promise.resolve(halt.stop());
    halt.closeAudit();
    halt.write?.('stitch serve stopped. (SIGINT)');
  };
}

/** Default port probe: bind a throwaway server; free ⇒ closed, busy ⇒ refused. */
function probePortDefault(host: string, port: number): Promise<Result<void, StitchError>> {
  return new Promise(settle => {
    const server = net.createServer();
    const detail = (cause: unknown): string =>
      cause instanceof Error ? cause.message : String(cause);
    server.once('error', (cause: unknown) => {
      const busy = (cause as { code?: unknown }).code === 'EADDRINUSE';
      server.close();
      settle(
        err({
          code: 'INTERNAL',
          message: busy
            ? `serve: port ${port} on ${host} is already in use`
            : `serve: cannot probe ${host}:${port}: ${detail(cause)}`,
        })
      );
    });
    server.once('listening', () => {
      server.close();
      settle(ok(undefined));
    });
    try {
      server.listen(port, host);
    } catch (cause: unknown) {
      server.close();
      settle(err({ code: 'INTERNAL', message: `serve: probe failed: ${detail(cause)}` }));
    }
  });
}

// shortcut: webDist is resolved against the SOURCE tree (packages/web/dist); a
// bundled binary would resolve elsewhere and fall back to the stub page —
// relocation belongs to a release/packaging step.
function webDistPath(): string {
  const here = dirname(fileURLToPath(import.meta.url)); // …/packages/cli/src/commands
  return join(here, '..', '..', '..', 'web', 'dist');
}

/**
 * Start the server.
 *
 * Order: normalize port → probe → open audit → build app → listen → register
 * SIGINT → report. A busy port is refused BEFORE anything is opened, so a
 * double-`serve` costs nothing.
 */
export async function serve(
  opts: ServeOptions,
  deps: ServeDeps = {}
): Promise<Result<ServeOutcome, StitchError>> {
  const write = deps.write ?? ((line: string): void => void process.stdout.write(`${line}\n`));
  const probePort = deps.probePort ?? probePortDefault;
  const openAuditDb = deps.openAuditDb ?? (async filePath => openSqlite(filePath));

  const host = opts.host ?? DEFAULT_SERVE_HOST;

  // Commander hands `--port` as a string; `Number('')` unfolding to 0 is
  // rejected by the range check below.
  const port = opts.port === undefined ? DEFAULT_SERVE_PORT : Number(opts.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return err({
      code: 'CONFIG_ERROR',
      field: 'port',
      message: `serve: --port must be an integer between 1 and 65535, got ${JSON.stringify(opts.port ?? null)}`,
    });
  }

  const free = await probePort(host, port);
  if (free.isErr()) return err(free.error);

  const cwd = opts.cwd === undefined ? process.cwd() : resolve(opts.cwd);
  const audit = await openAuditDb(join(cwd, STITCH_DB_FILENAME));
  if (audit.isErr()) return err(audit.error);

  const webDist = opts.web === false ? undefined : webDistPath();
  const app = createApp(webDist === undefined ? {} : { webDist });

  const stop = createShutdown({
    stop: () => app.stop(),
    closeAudit: () => audit.value.close(),
    write,
  });

  const runListen = deps.runListen ?? (() => app.listen({ hostname: host, port }));
  try {
    await runListen();
  } catch (cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    return err({
      code: 'INTERNAL',
      message: `serve: listening failed: ${detail}`,
    });
  }

  const register =
    deps.registerSignal ?? ((handler: () => void) => void process.once('SIGINT', handler));
  register(stop);

  const url = `http://${host}:${port}`;
  write(`stitch serve on ${url}`);
  write('  /health  /api/*  /ws    (Ctrl-C to stop)');
  return ok({ url });
}
