// P-216 — the merge stream subscription.
//
// CLIENT CONTRACT: the WS hub (P-193 serves /ws through the vite proxy) does
// not exist yet — the default connector is written against the shape P-193
// will emit and the auto-reconnect is a stub that P-223 replaces with real
// backoff. Tests never touch it: they inject the event pump via `connect`.
//
// Event JSON shape is set by core P-162 (don't hardcode differing shapes): a
// union of reasoning tokens, tool calls, and pipeline progress.

import { useEffect, useState } from 'react';

export type StreamEvent =
  | { type: 'reasoning'; id: string; text: string }
  | {
      type: 'tool';
      toolName: string;
      args: Record<string, unknown>;
      status: 'running' | 'done' | 'failed';
    }
  | { type: 'progress'; step: string; status: string };

/** Subscribes a handler to the merge stream; returns the unsubscribe fn. */
export type Connector = (handler: (event: StreamEvent) => void) => () => void;

const RECONNECT_MS = 2000;

/**
 * Default connector: WebSocket to the serve hub through the vite /ws proxy.
 * Reconnect is a fixed-interval stub (P-223 replaces it with real backoff).
 */
export const defaultConnect: Connector = handler => {
  let closed = false;
  let socket: WebSocket | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const open = (): void => {
    if (closed) return;
    // No WebSocket at runtime (SSR, jsdom without the global) — stay inert;
    // P-223's real reconnect logic replaces this connector anyway.
    if (typeof WebSocket === 'undefined') return;
    socket = new WebSocket(`${location.origin.replace(/^http/, 'ws')}/ws`);
    socket.onmessage = message => {
      try {
        handler(JSON.parse(String(message.data)) as StreamEvent);
      } catch {
        // Malformed frame — drop it, keep the stream alive.
      }
    };
    // shortcut: reconnect stub fires blindly after a close; P-223 adds backoff/jitter.
    socket.onclose = () => {
      if (!closed) timer = setTimeout(open, RECONNECT_MS);
    };
  };
  open();
  return () => {
    closed = true;
    if (timer !== undefined) clearTimeout(timer);
    socket?.close();
  };
};

export interface MergeStream {
  /** Every stream event of the run, in arrival order. */
  readonly events: readonly StreamEvent[];
  /** True while the latest event is a reasoning token (the "thinking" state). */
  readonly thinking: boolean;
  /** Clear the log (a fresh merge run). */
  reset: () => void;
}

export function useMergeStream(deps?: { connect?: Connector; active?: boolean }): MergeStream {
  const connect = deps?.connect ?? defaultConnect;
  // The socket lives only while a run is active — no idle connections, and
  // test environments never open one.
  const active = deps?.active ?? true;
  const [events, setEvents] = useState<readonly StreamEvent[]>([]);
  useEffect(() => {
    if (!active) return undefined;
    return connect(event => setEvents(prev => [...prev, event]));
  }, [connect, active]);
  const last = events.at(-1);
  return {
    events,
    thinking: last?.type === 'reasoning',
    reset: () => setEvents([]),
  };
}
