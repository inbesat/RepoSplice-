// P-366 — the telemetry client's own logic, with every port faked.
//
// The client is the piece that can leak data, so the assertions here are about
// what may leave the process: a disabled client touches no port at all, an
// enabled one writes newline-delimited JSON whose keys are the whitelist and
// nothing else, a failed sink keeps the events instead of dropping them, and
// the logger summary never carries an event payload.

import { err, ok, type Result } from 'neverthrow';
import type { StitchError } from '@repo-stitcher/core';
import { describe, expect, it } from 'vitest';

import {
  createTelemetryClient,
  loadTelemetryClient,
  logTelemetryState,
  normalizeEvent,
  optInNotice,
  parseTelemetryConfig,
  summarizeTelemetry,
  type TelemetryConfig,
  type TelemetryEvent,
  type TelemetryPorts,
} from './telemetry.js';

const ENDPOINT = 'https://telemetry.example.invalid/v1/events';
const ON: TelemetryConfig = { enabled: true, endpoint: undefined };
const OFF: TelemetryConfig = { enabled: false, endpoint: undefined };

interface FakeSink {
  readonly ports: TelemetryPorts;
  readonly written: string[];
  readonly posted: { endpoint: string; body: string }[];
  readonly reads: { count: number };
  status: number;
  writeFails: boolean;
  readFails: boolean;
  document: Readonly<Record<string, unknown>>;
}

/** Every port a fake, so a test can see exactly what would leave the process. */
function createFakeSink(): FakeSink {
  const written: string[] = [];
  const posted: { endpoint: string; body: string }[] = [];
  const reads = { count: 0 };
  const sink: FakeSink = {
    written,
    posted,
    reads,
    status: 202,
    writeFails: false,
    readFails: false,
    document: {},
    ports: {
      readDocument: () => {
        reads.count += 1;
        if (sink.readFails) {
          return err({ code: 'CONFIG_ERROR', field: 'config', message: 'the store is unreadable' });
        }
        return ok(sink.document);
      },
      write: (lines: string): Result<void, StitchError> => {
        if (sink.writeFails) {
          return err({ code: 'INTERNAL', message: 'the disk is full' });
        }
        written.push(lines);
        return ok(undefined);
      },
      post: async (endpoint, body) => {
        posted.push({ endpoint, body });
        return ok(sink.status);
      },
      now: () => 1_700_000_000_000,
    },
  };
  return sink;
}

/** The three events a session produces, in the order the wiring emits them. */
function sessionEvents(): TelemetryEvent[] {
  return [
    { event: 'session_start', host: 'claude-code' },
    { event: 'tool_called', tool: 'stitch_select_files', duration_ms: 12, success: true },
    { event: 'session_end', duration_s: 42, tools_used: ['stitch_select_files'] },
  ];
}

function linesOf(sink: FakeSink): Record<string, unknown>[] {
  return sink.written
    .join('')
    .split('\n')
    .filter(line => line !== '')
    .map(line => JSON.parse(line) as Record<string, unknown>);
}

describe('MCP telemetry (P-366)', () => {
  it('reads the opt-in flag and endpoint from the store document', () => {
    expect(parseTelemetryConfig({})).toEqual({ enabled: false, endpoint: undefined });
    expect(parseTelemetryConfig({ telemetry: { enabled: true } })).toEqual({
      enabled: true,
      endpoint: undefined,
    });
    expect(parseTelemetryConfig({ telemetry: { enabled: true, endpoint: ENDPOINT } })).toEqual({
      enabled: true,
      endpoint: ENDPOINT,
    });
    expect(parseTelemetryConfig({ telemetry: { enabled: true, endpoint: '   ' } })).toEqual({
      enabled: true,
      endpoint: undefined,
    });
    expect(parseTelemetryConfig({ telemetry: { enabled: 'yes' } }).enabled).toBe(false);
    expect(parseTelemetryConfig({ telemetry: 'nope' }).enabled).toBe(false);
    expect(parseTelemetryConfig({ telemetry: [1, 2] }).enabled).toBe(false);
  });

  it('rebuilds every event from the whitelist and drops anything else', () => {
    expect(normalizeEvent({ event: 'session_start', host: 'cursor' })).toEqual({
      event: 'session_start',
      host: 'cursor',
    });
    expect(
      normalizeEvent({ event: 'tool_called', tool: 'stitch_merge', duration_ms: 3, success: false })
    ).toEqual({ event: 'tool_called', tool: 'stitch_merge', duration_ms: 3, success: false });
    expect(
      normalizeEvent({ event: 'session_end', duration_s: 7, tools_used: ['stitch_merge'] })
    ).toEqual({ event: 'session_end', duration_s: 7, tools_used: ['stitch_merge'] });

    const hostile = {
      event: 'tool_called',
      tool: 'stitch_select_files',
      duration_ms: 1,
      success: true,
      repo_url: 'https://github.com/secret/repo.git',
      local_path: '/home/secret/plans',
      apiKey: 'sk-secret',
    } as unknown as TelemetryEvent;
    const clean = normalizeEvent(hostile) as unknown as Record<string, unknown>;
    expect(Object.keys(clean).sort()).toEqual(['duration_ms', 'event', 'success', 'tool']);
    expect(JSON.stringify(clean)).not.toContain('secret');
  });

  it('is inert while the flag is off', async () => {
    const sink = createFakeSink();
    const client = createTelemetryClient(sink.ports, OFF);
    expect(client.enabled).toBe(false);
    for (const event of sessionEvents()) {
      expect(client.record(event).isOk()).toBe(true);
    }
    expect(client.pending()).toBe(0);
    expect(client.buffered()).toEqual([]);
    const flushed = await client.flush();
    expect(flushed._unsafeUnwrap()).toBe(0);
    expect(sink.written).toEqual([]);
    expect(sink.posted).toEqual([]);
  });

  it('writes newline-delimited JSON to the local sink only once enabled', async () => {
    const sink = createFakeSink();
    const client = createTelemetryClient(sink.ports, ON);
    expect(client.enabled).toBe(true);
    for (const event of sessionEvents()) client.record(event);
    expect(client.pending()).toBe(3);
    expect(client.buffered()).toHaveLength(3);
    const flushed = await client.flush();
    expect(flushed._unsafeUnwrap()).toBe(3);
    expect(client.pending()).toBe(0);
    const lines = linesOf(sink);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toEqual({ event: 'session_start', host: 'claude-code' });
    expect(lines[2]).toEqual({
      event: 'session_end',
      duration_s: 42,
      tools_used: ['stitch_select_files'],
    });
    for (const line of lines) {
      expect(line['event']).toBeDefined();
      expect(JSON.stringify(line)).not.toContain('://');
    }
  });

  it('posts to a configured endpoint instead of writing a file', async () => {
    const sink = createFakeSink();
    const client = createTelemetryClient(sink.ports, { enabled: true, endpoint: ENDPOINT });
    expect(client.endpoint).toBe(ENDPOINT);
    client.record({ event: 'session_start', host: 'opencode' });
    expect((await client.flush())._unsafeUnwrap()).toBe(1);
    expect(sink.written).toEqual([]);
    expect(sink.posted).toHaveLength(1);
    expect(sink.posted[0]?.endpoint).toBe(ENDPOINT);
    expect(sink.posted[0]?.body).toContain('"host":"opencode"');
    expect(client.pending()).toBe(0);
  });

  it('refuses a non-2xx endpoint answer and keeps the events', async () => {
    const sink = createFakeSink();
    sink.status = 500;
    const client = createTelemetryClient(sink.ports, { enabled: true, endpoint: ENDPOINT });
    client.record({ event: 'session_start', host: 'cursor' });
    const flushed = await client.flush();
    expect(flushed.isErr()).toBe(true);
    expect(flushed._unsafeUnwrapErr()).toEqual({
      code: 'CONFIG_ERROR',
      field: 'telemetry.endpoint',
      message: 'the telemetry endpoint answered 500',
    });
    expect(client.pending()).toBe(1);
  });

  it('keeps the buffer when the sink fails, and flushes it on the next try', async () => {
    const sink = createFakeSink();
    sink.writeFails = true;
    const client = createTelemetryClient(sink.ports, ON);
    client.record({ event: 'session_start', host: 'claude-code' });
    const failed = await client.flush();
    expect(failed.isErr()).toBe(true);
    expect(failed._unsafeUnwrapErr().code).toBe('INTERNAL');
    expect(client.pending()).toBe(1);
    expect(sink.written).toEqual([]);

    sink.writeFails = false;
    expect((await client.flush())._unsafeUnwrap()).toBe(1);
    expect(client.pending()).toBe(0);
    expect(linesOf(sink)).toEqual([{ event: 'session_start', host: 'claude-code' }]);
  });

  it('summarizes volume by host and tool, and names what it cannot compare', () => {
    const summary = summarizeTelemetry(sessionEvents());
    expect(summary.total).toBe(3);
    expect(summary.by_host).toEqual({ 'claude-code': 1 });
    expect(summary.by_tool).toEqual({ stitch_select_files: 1 });
    expect(summary.tools_used).toEqual(['stitch_select_files']);
    expect(summary.comparison).toContain('CLI');
    expect(summary.comparison).toContain('cannot be computed');
  });

  it('offers a one-line opt-in notice that names no secret', () => {
    const notice = optInNotice();
    expect(notice).toContain('config.json');
    expect(notice).toContain('telemetry.log');
    expect(notice).not.toContain('://');
  });

  it('surfaces an unreadable store as a named configuration error', () => {
    const sink = createFakeSink();
    sink.readFails = true;
    const loaded = loadTelemetryClient(sink.ports);
    expect(loaded.isErr()).toBe(true);
    expect(loaded._unsafeUnwrapErr()).toMatchObject({ code: 'CONFIG_ERROR', field: 'config' });
    expect(sink.reads.count).toBe(1);

    sink.readFails = false;
    sink.document = { telemetry: { enabled: true, endpoint: ENDPOINT } };
    const client = loadTelemetryClient(sink.ports);
    expect(client.isOk()).toBe(true);
    expect(client._unsafeUnwrap().enabled).toBe(true);
    expect(client._unsafeUnwrap().endpoint).toBe(ENDPOINT);
  });

  it('logs whether telemetry is on or off, never the events', () => {
    const sink = createFakeSink();
    const on = logTelemetryState(createTelemetryClient(sink.ports, ON));
    expect(on).toContain('telemetry on');
    expect(on).toContain('telemetry.log');
    const off = logTelemetryState(createTelemetryClient(sink.ports, OFF));
    expect(off).toBe('telemetry off (opt-in)');
  });
});
