// P-241 — Orchestration: the in-process event bus.
//
// The single spine every module publishes to. Four properties are deliberate:
//
//   1. SYNCHRONOUS DELIVERY, IN PUBLISH ORDER, PER TOPIC. A subscriber that wants
//      to observe a sequence must see it in the order it happened; making delivery
//      asynchronous by default would let a slow handler reorder the story it is
//      meant to tell. Async handlers are supported, but an async handler does not
//      make the NEXT subscriber async.
//   2. A HANDLER THAT THROWS CANNOT BREAK THE BUS. A publish walks every matching
//      subscriber; one throwing would otherwise abort delivery to the rest and
//      propagate into the publisher — which is a pipeline stage. Failures become
//      reported values instead.
//   3. WILDCARDS ARE ONE LEVEL, `prefix.*`. See `matchesTopic`.
//   4. NOTHING PUBLISHES TO THE WEBSOCKET HUB DIRECTLY. Modules publish here; the
//      CLI's bridge ({@link createBusForwarder}) subscribes and forwards. That is
//      what keeps the CLI and the web reading one contract.
//
// On the backpressure requirement (phase step 4): a slow WebSocket must never make
// the bus wait — the bus is on the pipeline's critical path. So the forwarder
// COALESCES the high-frequency topics ({@link COALESCIBLE_TOPICS}) when its buffer
// is full: a newer `progress` tick replaces an unsent older one, because a progress
// bar cares about the LATEST position and never about a missed intermediate one.

import { COALESCIBLE_TOPICS, matchesTopic, TOPICS, type PayloadFor, type Topic } from './topics.js';

/** A subscriber's function. May return a promise; the bus does not wait on it. */
export type BusHandler<T extends Topic> = (
  payload: PayloadFor<T>,
  envelope: BusEnvelope<T>
) => unknown | Promise<unknown>;

/** What a subscriber receives alongside the payload. */
export interface BusEnvelope<T extends Topic> {
  topic: T;
  ts: string;
  /** Delivery order within the topic, from 1. Makes ordering assertable. */
  sequence: number;
}

/** A callable that removes a subscription. */
export type Unsubscribe = () => void;

/** An observation about a handler that failed, for the caller to log or audit. */
export interface BusHandlerError {
  topic: Topic;
  message: string;
}

/** Options for {@link Bus}. */
export interface BusOptions {
  /** Clock, injectable so tests are deterministic. */
  now?: () => string;
  /** Receives a handler failure. A publish never THROWS one. */
  onHandlerError?: (failure: BusHandlerError) => void;
}

/** One subscription. */
interface Subscription {
  pattern: string;
  handler: (payload: unknown, envelope: BusEnvelope<Topic>) => unknown | Promise<unknown>;
}

/**
 * The bus.
 *
 * Prefer the shared {@link bus} singleton in production, so there is exactly one
 * spine; construct separate instances in tests so they cannot leak into each other.
 */
export class Bus {
  readonly #subscriptions: Subscription[] = [];
  readonly #sequence = new Map<Topic, number>();
  readonly #now: () => string;
  readonly #onHandlerError: ((failure: BusHandlerError) => void) | undefined;

  constructor(options: BusOptions = {}) {
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#onHandlerError = options.onHandlerError;
  }

  /**
   * Deliver `payload` to every matching subscriber, in registration order.
   *
   * The PER-TOPIC sequence is stamped here rather than by the publisher, so two
   * publishers on the same topic cannot disagree about order.
   */
  publish<T extends Topic>(topic: T, payload: PayloadFor<T>): BusEnvelope<T> {
    const sequence = (this.#sequence.get(topic) ?? 0) + 1;
    this.#sequence.set(topic, sequence);
    const envelope: BusEnvelope<T> = { topic, ts: this.#now(), sequence };

    for (const subscription of [...this.#subscriptions]) {
      if (!matchesTopic(subscription.pattern, topic)) continue;
      try {
        const returned = subscription.handler(payload, envelope as BusEnvelope<Topic>);
        // An async handler is allowed, but the bus does NOT await it: waiting would
        // put a slow subscriber on the publisher's critical path. A rejection is
        // reported like a throw.
        if (returned !== undefined && typeof (returned as Promise<void>).catch === 'function') {
          void (returned as Promise<void>).catch((cause: unknown) => {
            this.#onHandlerError?.({
              topic,
              message: cause instanceof Error ? cause.message : String(cause),
            });
          });
        }
      } catch (cause: unknown) {
        // Point 2: one bad subscriber must not starve the others.
        this.#onHandlerError?.({
          topic,
          message: cause instanceof Error ? cause.message : String(cause),
        });
      }
    }
    return envelope;
  }

  /**
   * Subscribe to one topic or a `prefix.*` wildcard.
   *
   * The returned function removes THIS subscription. It is idempotent, so a
   * cleanup path that runs twice cannot remove a later subscriber by accident.
   */
  subscribe<T extends Topic>(
    pattern: T | `${string}.*` | string,
    handler: BusHandler<T>
  ): Unsubscribe {
    const subscription: Subscription = {
      pattern,
      handler: handler as Subscription['handler'],
    };
    this.#subscriptions.push(subscription);
    return () => {
      const index = this.#subscriptions.indexOf(subscription);
      if (index >= 0) this.#subscriptions.splice(index, 1);
    };
  }

  /** Subscribe once: removed after its first delivery. */
  once<T extends Topic>(pattern: string, handler: BusHandler<T>): Unsubscribe {
    const off = this.subscribe<T>(pattern, (payload, envelope) => {
      off();
      return handler(payload, envelope);
    });
    return off;
  }

  /** How many subscriptions are live (a leak is a bug worth being able to see). */
  get size(): number {
    return this.#subscriptions.length;
  }

  /** Every topic that has ever been published, with its delivery count. */
  sequenceCounts(): Record<string, number> {
    return Object.fromEntries(this.#sequence.entries());
  }

  /** Drop every subscription. For tests and for a deliberate reset. */
  clear(): void {
    this.#subscriptions.length = 0;
  }
}

/**
 * The process-wide spine.
 *
 * Modules import THIS rather than constructing their own bus, so producers and the
 * WS bridge share one. Tests construct a `Bus` instead.
 */
export const bus = new Bus();

// ---------------------------------------------------------------------------
// The WS forwarder (framework-agnostic half of P-241 step 3)
// ---------------------------------------------------------------------------

/** What the forwarder needs from a WebSocket-like sink. */
export interface EventSink {
  /**
   * Enqueue one event for the client. Returns `false` when the client's buffer is
   * full (a slow client), which is the signal to coalesce.
   */
  send(event: { topic: string; payload: unknown; ts: string }): boolean;
  /** The topics the client asked for in its `hello` (P-223). Empty = all. */
  topics(): readonly string[];
}

/** What the forwarder reports. */
export interface ForwarderStats {
  forwarded: number;
  /** Events replaced by a newer one for the same topic, because the buffer was full. */
  coalesced: number;
  /** Events dropped because the payload could not be combined. */
  dropped: number;
}

/** The forwarder handle. */
export interface BusForwarder {
  /** Stop forwarding and detach every subscription. */
  close(): void;
  stats(): ForwarderStats;
  /** Push whatever is queued, after a client drains its buffer. */
  flush(): void;
}

/**
 * Forward bus events to one client sink, coalescing when it falls behind.
 *
 * The bridge lives in core (not in the CLI) on purpose: it is pure logic over an
 * injected sink, so it is testable without a WebSocket server, and the CLI's
 * adapter is then a handful of lines that bind its hub to {@link EventSink}. See
 * ADR-065 — the same split P-185's ADR-058 used for routes.
 */
export function createBusForwarder(
  source: Bus,
  sink: EventSink,
  opts: { bufferLimit?: number } = {}
): BusForwarder {
  const bufferLimit = Math.max(1, opts.bufferLimit ?? 64);
  const stats: ForwarderStats = { forwarded: 0, coalesced: 0, dropped: 0 };
  const pending: { topic: Topic; payload: unknown; ts: string }[] = [];

  const drain = (): void => {
    while (pending.length > 0) {
      const next = pending[0] as { topic: Topic; payload: unknown; ts: string };
      if (sink.send(next)) {
        pending.shift();
        stats.forwarded += 1;
        continue;
      }
      // Still full: stop trying, we will be called again on flush.
      break;
    }
  };

  const accept = (topic: Topic, payload: unknown, ts: string): void => {
    const wanted = sink.topics();
    if (wanted.length > 0 && !wanted.some(pattern => matchesTopic(pattern, topic))) return;

    // A COALESCIBLE topic never occupies more than one slot. Replacing the queued
    // sample outright (rather than only when the buffer is full) is what makes that
    // true: a progress bar wants the latest position, and any earlier one is dead
    // weight whether or not the client has fallen behind yet.
    if (COALESCIBLE_TOPICS.includes(topic)) {
      const index = pending.findIndex(entry => entry.topic === topic);
      if (index >= 0) {
        pending[index] = { topic, payload, ts };
        stats.coalesced += 1;
        return;
      }
    }

    if (pending.length >= bufferLimit) {
      // The client is behind. Make room by dropping the OLDEST coalescible sample,
      // because that is the one whose information a later sample already supersedes.
      const victim = pending.findIndex(entry => COALESCIBLE_TOPICS.includes(entry.topic));
      if (victim >= 0) {
        pending.splice(victim, 1);
        stats.coalesced += 1;
      } else {
        // Nothing can be combined, so the event is DROPPED rather than allowed to
        // block the pipeline. Counted, so the loss is visible (phase step 4).
        stats.dropped += 1;
        return;
      }
    }

    pending.push({ topic, payload, ts });
    drain();
  };

  // Subscribe per topic rather than through a wildcard: the topic list IS the
  // declared contract, and it keeps wildcard semantics in `matchesTopic` alone.
  const offs = TOPICS.map(topic =>
    source.subscribe(topic, (payload, envelope) => accept(envelope.topic, payload, envelope.ts))
  );

  return {
    close: () => {
      for (const unsubscribe of offs) unsubscribe();
    },
    stats: () => ({ ...stats }),
    flush: drain,
  };
}
