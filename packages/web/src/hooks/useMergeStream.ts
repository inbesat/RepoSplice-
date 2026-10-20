// P-216 — the merge stream subscription (P-223-rewired).
//
// CLIENT CONTRACT: the WS hub (P-193 serves /ws through the vite proxy) does
// not exist yet. Since P-223 the default connector rides the shared
// WsClient singleton (lib/ws.ts): real exponential-backoff reconnect,
// buffering, resubscription, heartbeat — the old fixed-2s stub is gone.
// The Connector facade and injectability stay (tests inject the pump; the
// P-216 plumbing pin "inert without a WebSocket global" is preserved).
//
// Event JSON shape is set by core P-162 (don't hardcode differing shapes): a
// union of reasoning tokens, tool calls, and pipeline progress. The hub
// envelope {id, topic, payload, ts} is unwrapped by WsClient — subscribers
// see bare StreamEvents on the 'merge' topic.

import { useEffect, useState } from 'react';
import { wsClient } from '../lib/ws.js';

export type StreamEvent =
  | { type: 'reasoning'; id: string; text: string }
  | {
      type: 'tool';
      toolName: string;
      args: Record<string, unknown>;
      status: 'running' | 'done' | 'failed';
    }
  | { type: 'progress'; step: string; status: string };

export const MERGE_TOPIC = 'merge';

/** Subscribes a handler to the merge stream; returns the unsubscribe fn. */
export type Connector = (handler: (event: StreamEvent) => void) => () => void;

/**
 * Default connector: the 'merge' topic of the shared WsClient singleton.
 * Inert without a WebSocket global (SSR / bare jsdom) — P-216 pin kept.
 */
export const defaultConnect: Connector = handler => {
  if (typeof WebSocket === 'undefined') return () => undefined;
  return wsClient.subscribe<StreamEvent>(MERGE_TOPIC, payload => handler(payload));
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
