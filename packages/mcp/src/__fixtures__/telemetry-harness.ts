// P-366 — the bun harness behind `packages/mcp/test_telemetry.py`.
//
// It drives the REAL client over the REAL ports (the P-362 store reader, the
// append-only local file) in a temp directory, so the four mandated ids assert
// observed behaviour rather than a mock: nothing is written while telemetry is
// off, the enabled run lands four whitelisted events in `telemetry.log`, an
// event carrying repository URLs, paths and keys loses them on the way in, and
// no secret from the store ever reaches the log. Only the endpoint and the
// failing-write cases inject a port, because those need a sink to observe.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { err, ok, type Result } from 'neverthrow';
import type { StitchError } from '@repo-stitcher/core';

import {
  createTelemetryClient,
  createTelemetryPorts,
  loadTelemetryClient,
  logTelemetryState,
  optInNotice,
  parseTelemetryConfig,
  summarizeTelemetry,
  TELEMETRY_LOG_FILENAME,
  type TelemetryClient,
  type TelemetryEvent,
  type TelemetryPorts,
} from '../telemetry.js';

// The markers are reported by LABEL, never by value: the harness must not put a
// secret in its own output while it checks that the log has none.
const SECRET_MARKERS = [
  { label: 'github_token', value: 'ghp_telemetry_secret_value' },
  { label: 'provider_api_key', value: 'sk-ant-telemetry-secret' },
  { label: 'repository_url', value: 'https://github.com/secret-org/secret-repo.git' },
  { label: 'local_path', value: '/home/secret-user/private-plans' },
] as const;
const GITHUB_TOKEN = SECRET_MARKERS[0].value;
const ANTHROPIC_KEY = SECRET_MARKERS[1].value;
const REPO_URL = SECRET_MARKERS[2].value;
const SECRET_PATH = SECRET_MARKERS[3].value;
const SECRETS = SECRET_MARKERS.map(marker => marker.value);
const ENDPOINT = 'https://telemetry.example.invalid/v1/events';

const created: string[] = [];

function makeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'stitch-telemetry-'));
  created.push(dir);
  return dir;
}

function writeConfig(dir: string, document: unknown): string {
  const path = join(dir, 'config.json');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(document), 'utf8');
  return path;
}

function logPath(dir: string): string {
  return join(dir, TELEMETRY_LOG_FILENAME);
}

function logText(dir: string): string {
  if (!existsSync(logPath(dir))) return '';
  return readFileSync(logPath(dir), 'utf8');
}

function logEvents(dir: string): TelemetryEvent[] {
  return logText(dir)
    .split('\n')
    .filter(line => line !== '')
    .map(line => JSON.parse(line) as TelemetryEvent);
}

function keysOf(event: TelemetryEvent): string {
  return Object.keys(event).sort().join(',');
}

interface Outcome {
  readonly ok: boolean;
  readonly value?: unknown;
  readonly code?: string;
  readonly field?: unknown;
  readonly message?: unknown;
}

function outcome(result: Result<unknown, StitchError>): Outcome {
  if (result.isOk()) return { ok: true, value: result.value };
  const error = result.error;
  return {
    ok: false,
    code: error.code,
    ...('field' in error ? { field: error.field } : {}),
    ...('message' in error ? { message: error.message } : {}),
  };
}

async function settled(result: Promise<Result<unknown, StitchError>>): Promise<Outcome> {
  return outcome(await result);
}

/** The store the CLI keeps, with real-looking secrets in it. */
function storeConfig(telemetry: unknown): Record<string, unknown> {
  return {
    github: { authType: 'pat', token: GITHUB_TOKEN },
    anthropic: { apiKey: ANTHROPIC_KEY },
    telemetry,
  };
}

/** Fake ports whose write/post do nothing, for the client-level cases. */
function inertPorts(): TelemetryPorts {
  return {
    readDocument: () => ok({}),
    write: () => ok(undefined),
    post: async () => ok(202),
    now: () => 0,
  };
}

async function main(): Promise<void> {
  // 1. Opt-in: the default (and an explicit false) writes nothing at all.
  const offDir = makeDir();
  writeConfig(offDir, storeConfig({ enabled: false }));
  const offClient = loadTelemetryClient(createTelemetryPorts({ dir: offDir }));
  const off: TelemetryClient | undefined = offClient.isOk() ? offClient.value : undefined;
  const offRecords = [
    off?.record({ event: 'session_start', host: 'claude-code' }),
    off?.record({
      event: 'tool_called',
      tool: 'stitch_select_files',
      duration_ms: 5,
      success: true,
    }),
    off?.record({ event: 'session_end', duration_s: 1, tools_used: ['stitch_select_files'] }),
  ].map(entry => (entry === undefined ? { ok: false } : outcome(entry)));

  const absentDir = makeDir();
  const absentClient = loadTelemetryClient(createTelemetryPorts({ dir: absentDir }));

  // 2. Opted in: four whitelisted events land in the local file.
  const onDir = makeDir();
  writeConfig(onDir, storeConfig({ enabled: true }));
  const onPorts = createTelemetryPorts({ dir: onDir });
  const onLoaded = loadTelemetryClient(onPorts);
  if (onLoaded.isErr()) throw new Error(`the enabled client did not load: ${onLoaded.error.code}`);
  const onClient = onLoaded.value;
  onClient.record({ event: 'session_start', host: 'claude-code' });
  onClient.record({
    event: 'tool_called',
    tool: 'stitch_select_files',
    duration_ms: 12,
    success: true,
  });
  onClient.record({ event: 'tool_called', tool: 'stitch_merge', duration_ms: 3, success: false });
  onClient.record({
    event: 'session_end',
    duration_s: 42,
    tools_used: ['stitch_merge', 'stitch_select_files'],
  });
  const bufferedBefore = onClient.pending();
  const summary = summarizeTelemetry(onClient.buffered());
  const flushed = await settled(onClient.flush());
  const onEvents = logEvents(onDir);

  // 3. Anonymization: an event carrying free-form fields loses them on the way in.
  const hostile = {
    event: 'tool_called',
    tool: 'stitch_select_files',
    duration_ms: 1,
    success: true,
    repo_url: REPO_URL,
    local_path: SECRET_PATH,
    apiKey: ANTHROPIC_KEY,
  } as unknown as TelemetryEvent;
  onClient.record(hostile);
  const hostileFlush = await settled(onClient.flush());
  const hostileEvent = logEvents(onDir)[logEvents(onDir).length - 1] as TelemetryEvent;
  const allEvents = logEvents(onDir);
  const whitelist = ['duration_ms,event,success,tool', 'event,host', 'duration_s,event,tools_used'];
  const logBlob = logText(onDir);

  // 4. A configured endpoint replaces the local file.
  const endpointDir = makeDir();
  writeConfig(endpointDir, storeConfig({ enabled: true, endpoint: ENDPOINT }));
  const posted: string[] = [];
  const bodies: string[] = [];
  const endpointPorts: TelemetryPorts = {
    ...createTelemetryPorts({ dir: endpointDir }),
    post: async (endpoint, body) => {
      posted.push(endpoint);
      bodies.push(body);
      return ok(202);
    },
  };
  const endpointClient = createTelemetryClient(
    endpointPorts,
    parseTelemetryConfig(storeConfig({ enabled: true, endpoint: ENDPOINT }))
  );
  endpointClient.record({
    event: 'tool_called',
    tool: 'stitch_check_license',
    duration_ms: 7,
    success: true,
  });
  const endpointFlush = await settled(endpointClient.flush());
  const endpointPending = endpointClient.pending();

  const rejected: TelemetryPorts = {
    ...inertPorts(),
    post: async () => ok(500),
  };
  const rejectedClient = createTelemetryClient(rejected, { enabled: true, endpoint: ENDPOINT });
  rejectedClient.record({ event: 'session_start', host: 'cursor' });
  const rejectedFlush = await settled(rejectedClient.flush());

  // 5. Failures: a write that fails keeps the events, a store that cannot be
  //    read is a named refusal and never a throw.
  const brokenDir = makeDir();
  const failing: TelemetryPorts = {
    ...createTelemetryPorts({ dir: brokenDir }),
    write: () => err({ code: 'INTERNAL', message: 'the disk is full' }),
  };
  const failingClient = createTelemetryClient(failing, { enabled: true, endpoint: undefined });
  failingClient.record({ event: 'session_start', host: 'opencode' });
  const failingFlush = await settled(failingClient.flush());
  const failingPending = failingClient.pending();

  const malformedDir = makeDir();
  mkdirSync(malformedDir, { recursive: true });
  writeFileSync(join(malformedDir, 'config.json'), '{ not json', 'utf8');
  const malformed = outcome(loadTelemetryClient(createTelemetryPorts({ dir: malformedDir })));

  const payload = {
    disabled: {
      loaded: offClient.isOk(),
      enabled: offClient.isOk() ? offClient.value.enabled : null,
      records: offRecords,
      pending: offClient.isOk() ? offClient.value.pending() : null,
      buffered: offClient.isOk() ? offClient.value.buffered().length : null,
      flush: await settled(offClient.isOk() ? offClient.value.flush() : Promise.resolve(ok(0))),
      file_written: existsSync(logPath(offDir)),
      absent_loaded: absentClient.isOk(),
      absent_enabled: absentClient.isOk() ? absentClient.value.enabled : null,
      notice_has_opt_in: optInNotice().includes('telemetry'),
      notice_names_config: optInNotice().includes('config.json'),
      notice_names_log: optInNotice().includes(TELEMETRY_LOG_FILENAME),
      notice_has_secret: SECRETS.some(secret => optInNotice().includes(secret)),
    },
    enabled: {
      enabled: onClient.enabled,
      pending_before: bufferedBefore,
      flushed,
      file_written: existsSync(logPath(onDir)),
      path_endswith: logPath(onDir).endsWith(TELEMETRY_LOG_FILENAME),
      line_count: onEvents.length,
      events: onEvents,
      keys_by_event: onEvents.map(keysOf),
      summary,
      log_summary: logTelemetryState(onClient),
      pending_after: onClient.pending(),
    },
    anonymized: {
      whitelist,
      hostile_flush: hostileFlush,
      hostile_keys: keysOf(hostileEvent),
      hostile_extra_dropped:
        !logText(onDir).includes(REPO_URL) && !logText(onDir).includes(SECRET_PATH),
      all_lines_whitelisted: allEvents.every(event => whitelist.includes(keysOf(event))),
      line_count: allEvents.length,
    },
    endpoint: {
      flushed: endpointFlush,
      posted_count: posted.length,
      posted_endpoint: posted[0] ?? null,
      body_lines: (bodies[0] ?? '').split('\n').filter(line => line !== '').length,
      file_written: existsSync(logPath(endpointDir)),
      pending_after: endpointPending,
      rejected_flush: rejectedFlush,
      rejected_pending: rejectedClient.pending(),
      rejected_keys: rejectedClient.buffered().map(keysOf),
    },
    failure: {
      flush: failingFlush,
      pending_after: failingPending,
      malformed,
    },
    parse: {
      empty: parseTelemetryConfig({}),
      enabled: parseTelemetryConfig({ telemetry: { enabled: true, endpoint: ENDPOINT } }),
      truthy_string: parseTelemetryConfig({ telemetry: { enabled: 'yes' } }),
      not_an_object: parseTelemetryConfig({ telemetry: 'nope' }),
      blank_endpoint: parseTelemetryConfig({ telemetry: { enabled: true, endpoint: '   ' } }),
    },
    privacy: {
      marker_labels: SECRET_MARKERS.map(marker => marker.label),
      markers_checked: SECRETS.length,
      secrets_in_log: SECRET_MARKERS.filter(marker => logBlob.includes(marker.value)).map(
        marker => marker.label
      ),
      secrets_in_config: existsSync(join(onDir, 'config.json'))
        ? SECRET_MARKERS.filter(marker =>
            readFileSync(join(onDir, 'config.json'), 'utf8').includes(marker.value)
          ).length
        : 0,
      events_carry_no_url: allEvents.every(event => !JSON.stringify(event).includes('://')),
    },
  };

  process.stdout.write(`TELEMETRY ${JSON.stringify(payload)}\n`);
}

try {
  await main();
} finally {
  for (const dir of created) rmSync(dir, { recursive: true, force: true });
}
