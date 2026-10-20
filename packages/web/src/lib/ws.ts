// P-223: single realtime transport for the web app (Web Epic 11).
// Envelope {id, topic, payload, ts} matches the serve hub contract (P-193).
// Reconnect: exponential backoff 500ms -> 30s with jitter, reset on open.
// Publishes buffered while offline; flushed on reconnect. Hello carries
// the topic list so the server (P-193) can re-establish subscriptions.

export type WsStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface WsEnvelope<T = unknown> {
  id: string;
  topic: string;
  payload: T;
  ts: number;
}

type Listener<T> = (payload: T) => void;
type StatusListener = (status: WsStatus) => void;

interface SocketLike {
  close(): void;
  send(data: string): void;
  onopen: (() => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
}

export interface WsClientDeps {
  /** Socket factory — injectable for tests (in-memory WS). */
  open?: (url: string) => SocketLike;
  /** Base delay in ms. */
  baseDelay?: number;
  /** Max delay in ms. */
  maxDelay?: number;
  /** Heartbeat interval in ms (0 disables). */
  heartbeatMs?: number;
}

const DEFAULT_BASE = 500;
const DEFAULT_MAX = 30_000;
const DEFAULT_HEARTBEAT = 15_000;

export class WsClient {
  private url: string;
  private openFn: (url: string) => SocketLike;
  private baseDelay: number;
  private maxDelay: number;
  private heartbeatMs: number;
  private socket: SocketLike | null = null;
  private statusValue: WsStatus = 'closed';
  private statusListeners = new Set<StatusListener>();
  private topicListeners = new Map<string, Set<Listener<unknown>>>();
  private pending: string[] = [];
  private attempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatWaitTimer: ReturnType<typeof setTimeout> | null = null;
  private manualClose = false;
  private seenIds = new Set<string>();
  private nextId = 1;

  constructor(url: string, deps: WsClientDeps = {}) {
    this.url = url;
    this.openFn = deps.open ?? (u => new WebSocket(u) as unknown as SocketLike);
    this.baseDelay = deps.baseDelay ?? DEFAULT_BASE;
    this.maxDelay = deps.maxDelay ?? DEFAULT_MAX;
    this.heartbeatMs = deps.heartbeatMs ?? DEFAULT_HEARTBEAT;
  }

  get status(): WsStatus {
    return this.statusValue;
  }

  connect(): void {
    if (this.socket !== null || this.statusValue === 'connecting') return;
    this.manualClose = false;
    this.setStatus(this.attempts === 0 ? 'connecting' : 'reconnecting');
    let socket: SocketLike;
    try {
      socket = this.openFn(this.url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;
    socket.onopen = () => {
      this.attempts = 0;
      this.setStatus('open');
      // Re-subscribe everything, then flush buffered publishes (P-193 hello).
      const topics = [...this.topicListeners.keys()];
      socket.send(JSON.stringify({ type: 'hello', topics }));
      for (const frame of this.pending.splice(0)) socket.send(frame);
      this.startHeartbeat(socket);
    };
    socket.onclose = () => {
      this.teardownHeartbeat();
      if (this.socket === socket) this.socket = null;
      if (this.manualClose) {
        this.setStatus('closed');
        return;
      }
      this.scheduleReconnect();
    };
    socket.onerror = () => {
      // onclose fires after onerror for real sockets; in-memory mocks may
      // only fire onerror — treat it as a drop too.
      this.teardownHeartbeat();
      if (this.socket === socket) this.socket = null;
      if (!this.manualClose) this.scheduleReconnect();
    };
    socket.onmessage = ev => {
      this.handleMessage(ev.data);
    };
  }

  close(): void {
    this.manualClose = true;
    this.teardownHeartbeat();
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.socket?.close();
    this.socket = null;
    this.setStatus('closed');
  }

  subscribe<T>(topic: string, cb: Listener<T>): () => void {
    let set = this.topicListeners.get(topic);
    if (set === undefined) {
      set = new Set();
      this.topicListeners.set(topic, set);
    }
    set.add(cb as Listener<unknown>);
    // Late subscriber on an already-open socket: tell the server.
    if (this.socket !== null && this.statusValue === 'open') {
      this.socket.send(JSON.stringify({ type: 'subscribe', topic }));
    }
    return () => {
      const s = this.topicListeners.get(topic);
      if (s === undefined) return;
      s.delete(cb as Listener<unknown>);
      if (s.size === 0) this.topicListeners.delete(topic);
    };
  }

  publish(topic: string, payload: unknown): void {
    const envelope: WsEnvelope = {
      id: `c${this.nextId++}`,
      topic,
      payload,
      ts: Date.now(),
    };
    const frame = JSON.stringify(envelope);
    if (this.socket !== null && this.statusValue === 'open') {
      this.socket.send(frame);
    } else {
      this.pending.push(frame);
    }
  }

  onStatus(cb: StatusListener): () => void {
    this.statusListeners.add(cb);
    return () => {
      this.statusListeners.delete(cb);
    };
  }

  /**
   * Dedupe window for redelivered envelopes after reconnect
   * (server may replay; subscribers must not render duplicates).
   */
  wasSeen(id: string): boolean {
    if (this.seenIds.has(id)) return true;
    this.seenIds.add(id);
    if (this.seenIds.size > 500) {
      // Bound memory: drop the oldest half (insertion order).
      const drop = [...this.seenIds].slice(0, 100);
      for (const old of drop) this.seenIds.delete(old);
    }
    return false;
  }

  private handleMessage(raw: unknown): void {
    if (typeof raw !== 'string') return;
    // Any inbound frame proves liveness — clear the pending pong wait.
    if (this.heartbeatWaitTimer !== null) {
      clearTimeout(this.heartbeatWaitTimer);
      this.heartbeatWaitTimer = null;
    }
    let env: WsEnvelope;
    try {
      env = JSON.parse(raw) as WsEnvelope;
    } catch {
      return; // malformed frame — drop
    }
    if (env.topic === '__pong') return;
    if (this.wasSeen(env.id)) return;
    const set = this.topicListeners.get(env.topic);
    if (set === undefined) return;
    for (const cb of [...set]) cb(env.payload);
  }

  private scheduleReconnect(): void {
    if (this.manualClose || this.reconnectTimer !== null) return;
    this.setStatus('reconnecting');
    const exp = this.baseDelay * 2 ** this.attempts;
    const jittered = exp * (0.5 + Math.random() * 0.5);
    const delay = Math.min(this.maxDelay, jittered);
    this.attempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private startHeartbeat(socket: SocketLike): void {
    if (this.heartbeatMs <= 0) return;
    this.teardownHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      // Pong-expected ping: if the previous ping saw no traffic, treat
      // the connection as stale and force a drop.
      if (this.heartbeatWaitTimer !== null) {
        socket.close();
        return;
      }
      socket.send(JSON.stringify({ type: 'ping' }));
      this.heartbeatWaitTimer = setTimeout(() => {
        this.heartbeatWaitTimer = null;
      }, this.heartbeatMs);
    }, this.heartbeatMs);
  }

  private teardownHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.heartbeatWaitTimer !== null) {
      clearTimeout(this.heartbeatWaitTimer);
      this.heartbeatWaitTimer = null;
    }
  }

  private setStatus(s: WsStatus): void {
    this.statusValue = s;
    for (const cb of [...this.statusListeners]) cb(s);
  }
}

/** App socket singleton — topics ride one connection (P-224/HIL share it). */
export const wsClient = new WsClient(
  `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`
);
