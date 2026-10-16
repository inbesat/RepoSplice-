// P-193 — `serve.test.ts`: the five MANDATED cases.
//
// Per the P-043 note in `src/serve.test.ts`, vitest's Node runtime gives Elysia
// its WebStandard adapter, where `.listen()` and sockets do not work — so every
// HTTP case drives `app.handle`, the `/ws` works through the exported
// `echoMessage` + hub the route wires, the shutdown runs through the injected
// signal/listen seams plus `createShutdown` (whose stop stage is awaited before
// the audit close — that WAS the point of `app.stop()` being first), and the
// port conflict runs through a fake probe, which needs no network.

import { describe, it, expect } from 'vitest';
import { err, ok } from 'neverthrow';
import { createApp, DEFAULT_SERVE_PORT } from '../server/app.js';
import { createWsHub, echoMessage, type EchoTarget, type HubEnvelope } from '../server/ws.js';
import { serve, createShutdown } from './serve.js';
import { STITCH_VERSION } from '../program.js';

/** `--no-web` app: every GET falls through to the friendly page. */
function noWebApp(): ReturnType<typeof createApp> {
  return createApp();
}

/** The globals a command receives when the user passed none of them. */
const BASE_OPTIONS = { verbose: false, yes: false, offline: false, color: false } as const;

/** An audit stand-in whose close is observable. */
function auditDb(calls: string[]): { close(): void } {
  return { close: () => void calls.push('audit') };
}

describe('stitch serve (P-193)', () => {
  it('health endpoint', async () => {
    const app = noWebApp();
    const res = await app.handle(new Request('http://localhost:3434/health'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ ok: true, service: 'stitch', version: STITCH_VERSION });
  }, 15000);

  it('ws echo', async () => {
    // The echo contract the route wires: the exact message comes back.
    const sent: unknown[] = [];
    const sink: EchoTarget = { send: data => void sent.push(data) };
    echoMessage(sink, 'ws-echo-probe');
    expect(sent[0]).toBe('ws-echo-probe');
    // A non-string packet is spoken as JSON (the web client's protocol).
    echoMessage(sink, { hello: 'there' });
    expect(sent[1]).toBe(JSON.stringify({ hello: 'there' }));

    // And the hub the route subscribes sockets to actually forwards published
    // events, in the fixed {topic, ts, payload} envelope P-223 will parse.
    const hub = createWsHub();
    const seen: string[] = [];
    hub.subscribe({ send: text => void seen.push(text) });
    hub.publish('progress', { stage: 'clone' });
    expect(seen.length).toBeGreaterThan(0);
    const envelope = JSON.parse(seen[0] ?? '{}') as Partial<HubEnvelope>;
    expect(envelope.topic).toBe('progress');
    expect(envelope.payload).toMatchObject({ stage: 'clone' });
  });

  it('static fallback', async () => {
    const app = noWebApp();
    const root = await app.handle(new Request('http://localhost:3434/'));
    expect(root.status).toBe(200);
    expect(root.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(await root.text()).toContain('stitch serve');

    // An arbitrary client route falls through to the same friendly page.
    const deep = await app.handle(new Request('http://localhost:3434/whatever/route'));
    expect(deep.status).toBe(200);
    expect(await deep.text()).toContain('stitch serve');

    // The wildcard must NOT shadow the exact routes registered above it.
    const health = await app.handle(new Request('http://localhost:3434/health'));
    expect(((await health.json()) as Record<string, unknown>)['ok']).toBe(true);
  });

  it('graceful shutdown', async () => {
    // The server really listened and really registered ONE SIGINT handler.
    const handlers: Array<() => void> = [];
    let listening = false;
    const result = await serve(
      { ...BASE_OPTIONS },
      {
        probePort: async () => ok(undefined),
        openAuditDb: async () => ok(auditDb([])),
        registerSignal: handler => void handlers.push(handler),
        runListen: () => void (listening = true),
        write: () => undefined,
      }
    );
    if (result.isErr()) throw new Error(JSON.stringify(result.error));
    expect(result.value.url).toBe(`http://127.0.0.1:${DEFAULT_SERVE_PORT}`);
    expect(listening).toBe(true);
    expect(handlers).toHaveLength(1);

    // The shutdown itself, driven with fakes: stop fully completes BEFORE the
    // audit store's WAL closes, the report is written once, and a second
    // SIGINT is a silent no-op (the `.once` guarantee the handler also has).
    const calls: string[] = [];
    let releaseStop: (() => void) | undefined;
    const shutdown = createShutdown({
      stop: () =>
        new Promise<void>(release => {
          releaseStop = release;
        }),
      closeAudit: () => void calls.push('audit'),
      write: line => void calls.push(`write:${line}`),
    });
    const pending = shutdown();
    expect(calls).toEqual([]); // stop is awaited first; nothing closed yet
    releaseStop?.();
    await pending;
    expect(calls).toEqual(['audit', 'write:stitch serve stopped. (SIGINT)']);
    await shutdown();
    expect(calls).toEqual(['audit', 'write:stitch serve stopped. (SIGINT)']);
  });

  it('cors headers', async () => {
    const app = noWebApp();
    const allowed = await app.handle(
      new Request('http://localhost:3434/api/jobs', {
        headers: { origin: 'http://localhost:5173' },
      })
    );
    // Also the smoke for "REST routes respond": a default (unwired) job list.
    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toEqual([]);
    expect(allowed.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');

    // A foreign origin gets NO CORS header — a refusal, not a wildcard.
    const other = await app.handle(
      new Request('http://localhost:3434/api/jobs', {
        headers: { origin: 'http://evil.example' },
      })
    );
    expect(other.headers.get('access-control-allow-origin')).toBeNull();

    // Preflight answers the methods the web client will use.
    const preflight = await app.handle(
      new Request('http://localhost:3434/api/jobs', {
        method: 'OPTIONS',
        headers: { origin: 'http://localhost:5173' },
      })
    );
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-methods')).toContain('OPTIONS');
    expect(preflight.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
  });

  it('refuses a bound port before opening anything', async () => {
    const opened: string[] = [];
    const result = await serve(
      { ...BASE_OPTIONS },
      {
        probePort: async () => err({ code: 'INTERNAL', message: 'port 3434 busy' }),
        openAuditDb: async () => {
          opened.push('audit');
          return ok(auditDb(opened));
        },
        runListen: () => {
          opened.push('listen');
        },
      }
    );
    if (result.isOk()) throw new Error('serve must refuse a busy port');
    expect(result.error.code).toBe('INTERNAL');
    expect(result.error).toMatchObject({ message: expect.stringContaining('port 3434 busy') });
    expect(opened).toEqual([]);
  });
});
