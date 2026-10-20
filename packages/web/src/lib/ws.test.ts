// P-223 tests: in-memory WebSocket fake driven by a pump() the test
// controls — no network, no real timers (vitest fake timers for backoff
// and heartbeat).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WsClient, type WsEnvelope, type WsStatus } from './ws.js';

interface FakeSocket {
  url: string;
  sent: string[];
  readyToSend: boolean;
  onopen: (() => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  close(): void;
  send(data: string): void;
}

class FakeWebSocket implements FakeSocket {
  url: string;
  sent: string[] = [];
  readyToSend = true;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    created.push(this);
  }

  close(): void {
    this.onclose?.();
  }

  send(data: string): void {
    this.sent.push(data);
  }

  // pump helpers
  serverOpen(): void {
    this.onopen?.();
  }

  serverSend(envelope: Omit<WsEnvelope, 'ts'> & { ts?: number }): void {
    this.onmessage?.({
      data: JSON.stringify({ ts: Date.now(), ...envelope }),
    });
  }

  serverDrop(): void {
    this.onclose?.();
  }
}

let created: FakeSocket[] = [];
function lastSocket(): FakeWebSocket {
  return created.at(-1) as FakeWebSocket;
}

const HELLO_RE = /^\{"type":"hello","topics":/;
function sentHellos(sock: FakeWebSocket): string[] {
  return sock.sent.filter(f => HELLO_RE.test(f));
}

const DEFAULTS = {
  open: (u: string) => new FakeWebSocket(u) as unknown as never,
  baseDelay: 500,
  maxDelay: 30_000,
};
function makeClient(url = 'ws://x/ws', extra?: { heartbeatMs?: number }): WsClient {
  return new WsClient(url, { ...DEFAULTS, ...(extra ?? {}) });
}
// __APPEND__

beforeEach(() => {
  vi.useFakeTimers();
  created = [];
});
afterEach(() => {
  vi.useRealTimers();
});

describe('WsClient', () => {
  it('round trips', () => {
    const c = makeClient();
    const got: string[] = [];
    c.subscribe<string>('merge', p => got.push(p));
    c.connect();
    const sock = lastSocket();
    sock.serverOpen();
    expect(c.status).toBe('open');
    // hello carries the subscribed topic
    expect(sentHellos(sock)).toHaveLength(1);
    expect(sentHellos(sock)[0]).toContain('"merge"');
    // client -> server publish
    c.publish('merge', { n: 1 });
    const frame = sock.sent.find(f => f.includes('"topic":"merge"'));
    expect(frame).toBeDefined();
    const env = JSON.parse(frame as string) as WsEnvelope;
    expect(env.id).toBeTruthy();
    expect(env.payload).toEqual({ n: 1 });
    // server -> client dispatch
    sock.serverSend({ id: 's1', topic: 'merge', payload: { n: 2 } });
    expect(got).toEqual([{ n: 2 }]);
    c.close();
    expect(c.status).toBe('closed');
  });

  it('reconnects', () => {
    const c = makeClient();
    const statuses: WsStatus[] = [];
    c.onStatus(s => statuses.push(s));
    c.connect();
    const first = lastSocket();
    first.serverOpen();
    first.serverDrop(); // unexpected drop -> backoff
    expect(c.status).toBe('reconnecting');
    vi.advanceTimersByTime(700); // first backoff ~500ms*jitter
    const second = lastSocket();
    expect(second).not.toBe(first);
    second.serverOpen();
    expect(c.status).toBe('open');
    expect(statuses).toContain('reconnecting');
    c.close();
  });

  it('buffers while down', () => {
    const c = makeClient();
    c.connect();
    const sock = lastSocket();
    // publish while connecting (not yet open) -> buffered
    c.publish('merge', { n: 1 });
    expect(sock.sent).toHaveLength(0);
    sock.serverOpen();
    // flush on open, in order, after the hello
    const frames = sock.sent.filter(f => f.includes('"topic":"merge"'));
    expect(frames).toEqual([expect.stringContaining('"payload":{"n":1}')]);
    expect(sock.sent.findIndex(f => HELLO_RE.test(f))).toBeLessThan(
      sock.sent.findIndex(f => f.includes('"topic":"merge"'))
    );
    c.close();
  });

  it('resubscribes', () => {
    const c = makeClient();
    c.subscribe<string>('merge', () => {});
    c.subscribe<string>('progress', () => {});
    c.connect();
    const sock = lastSocket();
    sock.serverOpen();
    expect(sentHellos(sock)).toHaveLength(1);
    const hello = JSON.parse(sentHellos(sock)[0] ?? '') as { topics: string[] };
    expect([...hello.topics].sort()).toEqual(['merge', 'progress']);
    c.close();
  });

  it('heartbeat stale', () => {
    const c = makeClient('ws://x/ws', { heartbeatMs: 1000 });
    const got: string[] = [];
    c.subscribe<string>('merge', p => got.push(p));
    c.connect();
    const sock = lastSocket() as FakeWebSocket;
    sock.serverOpen();
    // one ping after one interval
    vi.advanceTimersByTime(1000);
    expect(sock.sent.some(f => f.includes('"type":"ping"'))).toBe(true);
    // silence for another full interval -> stale -> drop -> reconnecting
    vi.advanceTimersByTime(1000);
    expect(c.status).toBe('reconnecting');
    // traffic marks the connection alive: no stale drop
    const c2 = makeClient('ws://x/ws', { heartbeatMs: 1000 });
    c2.connect();
    const sock2 = lastSocket() as FakeWebSocket;
    sock2.serverOpen();
    vi.advanceTimersByTime(1000); // ping sent, pong now
    sock2.serverSend({ id: 'p1', topic: '__pong', payload: null });
    vi.advanceTimersByTime(1000); // ping again
    sock2.serverSend({ id: 'p2', topic: '__pong', payload: null });
    vi.advanceTimersByTime(1500);
    expect(c2.status).toBe('open');
    c.close();
    c2.close();
  });

  it('dedupes redelivered envelopes by id', () => {
    const c = makeClient();
    const got: string[] = [];
    c.subscribe<string>('merge', p => got.push(p));
    c.connect();
    const sock = lastSocket();
    sock.serverOpen();
    sock.serverSend({ id: 's1', topic: 'merge', payload: 'a' });
    sock.serverSend({ id: 's1', topic: 'merge', payload: 'a' });
    sock.serverSend({ id: 's2', topic: 'merge', payload: 'b' });
    expect(got).toEqual(['a', 'b']);
    c.close();
  });
});
