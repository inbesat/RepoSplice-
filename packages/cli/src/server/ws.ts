// P-193 — the WebSocket hub for `stitch serve`.
//
// The transport the web client (P-223) attaches to, and the single place a pipeline's
// events reach a browser. It is deliberately NOT the event bus (P-241): the bus is the
// in-process spine, this is the fan-out to socket clients, and keeping them separate is
// what lets the bus stay synchronous and allocation-free on the pipeline's critical path.
//
// Three properties, matching the bus's own:
//
//   1. A THROWING CLIENT CANNOT BREAK THE HUB. One dead socket must not stop the others
//      from receiving an event — failures are counted, not propagated.
//   2. SUBSCRIPTIONS ARE `topic` OR `prefix.*`, the same grammar as P-241's
//      `matchesTopic`, so a client's filter means the same thing on both channels.
//   3. THE WIRE SHAPE IS FIXED (`{topic, ts, payload}`). The web client parses one
//      envelope, not a per-topic shape, which is what makes a new topic a non-event for
//      the client.
//
// No-throw: nothing here returns a Result because nothing here can fail for a caller —
// `subscribe` returns its own unsubscribe, and `publish` reports a per-client failure by
// counting it. A transport that threw on a half-closed socket would take the server with
// it.

/** What the hub needs from a socket. Kept structural so a test needs no real WebSocket. */
export interface HubClient {
  /** Enqueue one envelope for the client. */
  send(text: string): void;
}

/** Anything that can receive an echoed packet — Elysia's socket implements this. */
export interface EchoTarget {
  send(data: string | ArrayBuffer): void;
}

/** The envelope every client receives. Matches P-241's wire shape. */
export interface HubEnvelope<T = unknown> {
  topic: string;
  ts: string;
  payload: T;
}

/** Options for {@link createWsHub}. */
export interface WsHubOptions {
  /** Clock, injectable so a test can pin the timestamp. */
  now?: () => string;
  /** Receives every delivery failure (a dead socket), for logging. */
  onError?: (failure: { topic: string; message: string }) => void;
}

/** Delivery counters, so a leak or a dead socket is visible rather than guessed at. */
export interface WsHubStats {
  /** Envelopes successfully handed to at least one client. */
  delivered: number;
  /** Envelopes with no matching subscriber. */
  unmatched: number;
  /** Per-client send failures. */
  failed: number;
  /** Live subscriptions. */
  subscriptions: number;
}

/** The hub. */
export interface WsHub {
  /**
   * Subscribe a client to a topic pattern (`'progress'`, or `'job.*'`).
   * An empty pattern list subscribes to EVERY topic.
   */
  subscribe(client: HubClient, patterns?: readonly string[]): () => void;
  /** Fan one event out to every matching client. Never throws. */
  publish(topic: string, payload: unknown): void;
  /** Live subscription count. */
  size(): number;
  /** Delivery counters. */
  stats(): WsHubStats;
  /** Drop every subscription (server shutdown). */
  close(): void;
}

/** One live subscription. */
interface Subscription {
  client: HubClient;
  /** Empty means "every topic". */
  patterns: readonly string[];
}

/**
 * Does `pattern` match `topic`?
 *
 * The same one-level grammar P-241 uses: an exact name, or a trailing `.*` wildcard.
 * Duplicated here rather than imported because the CLI must not reach into core
 * internals, and this is four lines of grammar, not logic.
 */
export function matchesPattern(pattern: string, topic: string): boolean {
  if (pattern === topic) return true;
  if (pattern.endsWith('.*')) return topic.startsWith(`${pattern.slice(0, -2)}.`);
  return false;
}

/** Build a hub. One per server process. */
export function createWsHub(opts: WsHubOptions = {}): WsHub {
  const now = opts.now ?? ((): string => new Date().toISOString());
  const subscriptions: Subscription[] = [];
  const counters = { delivered: 0, unmatched: 0, failed: 0 };

  return {
    subscribe(client: HubClient, patterns: readonly string[] = []): () => void {
      const subscription: Subscription = { client, patterns: [...patterns] };
      subscriptions.push(subscription);
      // Idempotent, so a cleanup path that runs twice cannot remove a later client.
      return () => {
        const index = subscriptions.indexOf(subscription);
        if (index >= 0) subscriptions.splice(index, 1);
      };
    },

    publish(topic: string, payload: unknown): void {
      const envelope: HubEnvelope = { topic, ts: now(), payload };
      let text: string;
      try {
        text = JSON.stringify(envelope);
      } catch (cause: unknown) {
        // A payload that cannot be serialised is dropped rather than crashing the
        // server: it is the publisher's bug, not the transport's job to die for.
        counters.failed += 1;
        opts.onError?.({
          topic,
          message: `unserialisable payload: ${cause instanceof Error ? cause.message : String(cause)}`,
        });
        return;
      }

      let matched = 0;
      for (const subscription of [...subscriptions]) {
        const wants =
          subscription.patterns.length === 0 ||
          subscription.patterns.some(pattern => matchesPattern(pattern, topic));
        if (!wants) continue;
        matched += 1;
        try {
          subscription.client.send(text);
        } catch (cause: unknown) {
          // Property 1: a dead socket is counted, never propagated.
          counters.failed += 1;
          opts.onError?.({
            topic,
            message: cause instanceof Error ? cause.message : String(cause),
          });
        }
      }

      if (matched === 0) counters.unmatched += 1;
      else counters.delivered += 1;
    },

    size(): number {
      return subscriptions.length;
    },

    stats(): WsHubStats {
      return { ...counters, subscriptions: subscriptions.length };
    },

    close(): void {
      subscriptions.length = 0;
    },
  };
}

/**
 * Echo one client packet back to the client, verbatim.
 *
 * The `/ws` route's `message` handler wires this directly, so the mandated
 * `ws echo` case in `serve.test.ts` drives the REAL function the route uses
 * (a socket cannot be opened under vitest's Node runtime — see the P-043 note
 * in `src/serve.test.ts`). A non-string packet is spoken as JSON — the web
 * client (P-223) speaks JSON — and a packet that cannot be stringified echoes
 * an empty frame rather than crashing the route.
 */
export function echoMessage(target: EchoTarget, message: unknown): void {
  let text: string;
  if (typeof message === 'string') {
    text = message;
  } else {
    try {
      text = JSON.stringify(message) ?? String(message);
    } catch {
      // A circular payload cannot be serialised; an empty echo still proves
      // the route is alive without taking the socket down.
      text = '';
    }
  }
  target.send(text);
}
