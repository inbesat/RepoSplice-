// P-366 — opt-in telemetry for the MCP server.
//
// The signal the last Epic-19 phase wants is "is this channel used at all?", so
// the client is inert unless the shared `~/.stitch/config.json` (P-200, the
// store P-362 already reads) sets `telemetry.enabled: true`. Every event is
// REBUILT from a fixed whitelist on the way in — a tool name, a duration, a
// boolean, a host, a duration in seconds, a tool-name list — so a repository
// URL, a path, a prompt or a key has no field to travel in. The default sink is
// the append-only file `~/.stitch/telemetry.log`: nothing leaves the machine
// unless a host points `telemetry.endpoint` somewhere. A telemetry failure is
// never allowed to fail a tool call (ADR-175).

import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { err, ok, type Result } from 'neverthrow';
import { logger, stitchHomeDir, type StitchError } from '@repo-stitcher/core';

import { MCP_CONFIG_FILE, readConfigDocument } from './config.js';

/** The default sink: an append-only file beside the store the CLI keeps. */
export const TELEMETRY_LOG_FILENAME = 'telemetry.log';

export interface TelemetryConfig {
  readonly enabled: boolean;
  readonly endpoint: string | undefined;
}

export interface SessionStartEvent {
  readonly event: 'session_start';
  readonly host: string;
}

export interface ToolCalledEvent {
  readonly event: 'tool_called';
  readonly tool: string;
  readonly duration_ms: number;
  readonly success: boolean;
}

export interface SessionEndEvent {
  readonly event: 'session_end';
  readonly duration_s: number;
  readonly tools_used: readonly string[];
}

/** The whole vocabulary of the log: a value can only travel in these fields. */
export type TelemetryEvent = SessionStartEvent | ToolCalledEvent | SessionEndEvent;

export interface TelemetryPorts {
  /** Read the shared store. The same reader P-362 uses; no second config path. */
  readonly readDocument: () => Result<Readonly<Record<string, unknown>>, StitchError>;
  /** Append already-serialized lines to the local sink. */
  readonly write: (lines: string) => Result<void, StitchError>;
  /** Send already-serialized lines to a configured endpoint. */
  readonly post: (endpoint: string, body: string) => Promise<Result<number, StitchError>>;
  /** Milliseconds, injectable so a test can assert a duration. */
  readonly now: () => number;
}

export interface TelemetrySummary {
  readonly total: number;
  readonly by_host: Readonly<Record<string, number>>;
  readonly by_tool: Readonly<Record<string, number>>;
  readonly tools_used: readonly string[];
  readonly comparison: string;
}

export interface TelemetryClient {
  readonly enabled: boolean;
  readonly endpoint: string | undefined;
  /** Buffer an event. A no-op success while telemetry is off. */
  record: (event: TelemetryEvent) => Result<void, StitchError>;
  /** Write or send what is buffered. */
  flush: () => Promise<Result<number, StitchError>>;
  /** How many events are waiting. */
  pending: () => number;
  /** The events buffered so far, in order (the report's input). */
  buffered: () => readonly TelemetryEvent[];
}

function messageOf(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  if (typeof cause === 'object' && cause !== null) {
    const message = (cause as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return String(cause);
}

function configError(field: string, message: string): StitchError {
  return { code: 'CONFIG_ERROR', field, message };
}

/** Read `telemetry.enabled` / `telemetry.endpoint` out of the shared store. */
export function parseTelemetryConfig(document: Readonly<Record<string, unknown>>): TelemetryConfig {
  const section = document['telemetry'];
  if (typeof section !== 'object' || section === null || Array.isArray(section)) {
    return { enabled: false, endpoint: undefined };
  }
  const record = section as Record<string, unknown>;
  const endpoint = record['endpoint'];
  return {
    enabled: record['enabled'] === true,
    endpoint: typeof endpoint === 'string' && endpoint.trim() !== '' ? endpoint : undefined,
  };
}

/**
 * Rebuild an event from its own whitelist.
 *
 * The type already restricts the shape; this keeps the guarantee at runtime too,
 * so a caller that widened the object with `as never` still cannot smuggle a
 * repository URL, a path or a key into the log.
 */
export function normalizeEvent(event: TelemetryEvent): TelemetryEvent {
  switch (event.event) {
    case 'session_start':
      return { event: 'session_start', host: String(event.host) };
    case 'tool_called':
      return {
        event: 'tool_called',
        tool: String(event.tool),
        duration_ms: Number(event.duration_ms),
        success: event.success === true,
      };
    case 'session_end':
      return {
        event: 'session_end',
        duration_s: Number(event.duration_s),
        tools_used: [...event.tools_used].map(String),
      };
  }
}

/** Aggregate buffered events. The month-1 report's producer (ADR-175). */
export function summarizeTelemetry(events: readonly TelemetryEvent[]): TelemetrySummary {
  const byHost: Record<string, number> = {};
  const byTool: Record<string, number> = {};
  const used = new Set<string>();
  for (const event of events) {
    if (event.event === 'session_start') byHost[event.host] = (byHost[event.host] ?? 0) + 1;
    if (event.event === 'tool_called') {
      byTool[event.tool] = (byTool[event.tool] ?? 0) + 1;
      used.add(event.tool);
    }
    if (event.event === 'session_end') for (const tool of event.tools_used) used.add(tool);
  }
  return {
    total: events.length,
    by_host: byHost,
    by_tool: byTool,
    tools_used: [...used].sort((left, right) => left.localeCompare(right)),
    comparison:
      'the CLI (P-192) and Web (P-208) engines emit no telemetry events, so the ' +
      'MCP-vs-CLI-vs-Web comparison cannot be computed yet (ADR-175)',
  };
}

/** The one-line opt-in notice a host sees while telemetry is switched off. */
export function optInNotice(): string {
  return (
    'mcp: telemetry is off. It is opt-in: set telemetry.enabled to true in ' +
    `${join(stitchHomeDir(), MCP_CONFIG_FILE)} to log anonymized tool-call counts to ` +
    `${join(stitchHomeDir(), TELEMETRY_LOG_FILENAME)} (no repository URLs, paths or secrets)`
  );
}

/** Build a client over injected ports. Nothing is read or written here. */
export function createTelemetryClient(
  ports: TelemetryPorts,
  config: TelemetryConfig
): TelemetryClient {
  const buffer: TelemetryEvent[] = [];

  return {
    enabled: config.enabled,
    endpoint: config.endpoint,
    record: event => {
      if (!config.enabled) return ok(undefined);
      buffer.push(normalizeEvent(event));
      return ok(undefined);
    },
    flush: async () => {
      if (buffer.length === 0) return ok(0);
      const lines = buffer.map(entry => `${JSON.stringify(entry)}\n`).join('');
      if (config.endpoint !== undefined) {
        const sent = await ports.post(config.endpoint, lines);
        if (sent.isErr()) return err(sent.error);
        if (sent.value < 200 || sent.value > 299) {
          return err(
            configError('telemetry.endpoint', `the telemetry endpoint answered ${sent.value}`)
          );
        }
      } else {
        const written = ports.write(lines);
        if (written.isErr()) return err(written.error);
      }
      // Only a completed write clears the buffer: a failure keeps the events so
      // nothing is silently dropped.
      const count = buffer.length;
      buffer.length = 0;
      return ok(count);
    },
    pending: () => buffer.length,
    buffered: () => [...buffer],
  };
}

/**
 * Load the client from the shared store.
 *
 * A store that cannot be read is a `CONFIG_ERROR` on `telemetry.config`, which
 * the caller must log and survive: telemetry never blocks the server.
 */
export function loadTelemetryClient(
  ports: TelemetryPorts = createTelemetryPorts()
): Result<TelemetryClient, StitchError> {
  const document = ports.readDocument();
  if (document.isErr()) return err(document.error);
  return ok(createTelemetryClient(ports, parseTelemetryConfig(document.value)));
}

/** Log the client's state. The summary is secret-free by construction. */
export function logTelemetryState(client: TelemetryClient): string {
  const sink = client.endpoint ?? join(stitchHomeDir(), TELEMETRY_LOG_FILENAME);
  const summary = client.enabled
    ? `telemetry on, ${client.pending()} buffered, sink ${sink}`
    : 'telemetry off (opt-in)';
  logger.info({ enabled: client.enabled, endpoint: client.endpoint ?? null }, `mcp: ${summary}`);
  if (!client.enabled) logger.info(`mcp: ${optInNotice()}`);
  return summary;
}

/** The real ports: the P-362 store reader, the local file and fetch. */
export function createTelemetryPorts(
  options: { readonly dir?: string; readonly logPath?: string } = {}
): TelemetryPorts {
  const logPath = options.logPath ?? join(options.dir ?? stitchHomeDir(), TELEMETRY_LOG_FILENAME);
  return {
    readDocument: () => readConfigDocument(join(options.dir ?? stitchHomeDir(), MCP_CONFIG_FILE)),
    write: lines => {
      try {
        mkdirSync(dirname(logPath), { recursive: true });
        appendFileSync(logPath, lines, 'utf8');
        return ok(undefined);
      } catch (cause) {
        return err({
          code: 'INTERNAL',
          message: `the telemetry log could not be written: ${messageOf(cause)}`,
        });
      }
    },
    post: async (endpoint, body) => {
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/x-ndjson' },
          body,
        });
        return ok(response.status);
      } catch (cause) {
        return err(
          configError(
            'telemetry.endpoint',
            `the telemetry endpoint is unreachable: ${messageOf(cause)}`
          )
        );
      }
    },
    now: () => Date.now(),
  };
}
