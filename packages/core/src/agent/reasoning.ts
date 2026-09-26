// P-162 — the reasoning stream.
//
// Until now the agent's behaviour was observable only as a side effect: a tool
// ran, a policy decided, a state advanced, and anyone watching had to infer all
// of it from the final output. This is the surface that makes the agent legible
// — "why did it do that?" — and it is the primary UX for both the CLI (P-199)
// and the web detail page (P-216) over WS (P-193/P-241).
//
// NOT THE SAME THING AS P-136's `ReasoningChunk`. The spec's context blurs the
// two, so it is worth being precise: `ReasoningChunk` is the *provider's* raw
// stream (`text | tool_call | done | error`), and `ReasoningEvent` is the
// *agent's* account of what it is doing (`policy | state | tool_call | cost |
// ...`). They relate the way a transcript relates to a summary: a provider text
// chunk is where a `plan` event comes from, and nothing else about the two types
// overlaps. Declaring a second copy of `ReasoningChunk` here would have been
// the mistake.
//
// A BROKEN SUBSCRIBER MUST NOT BREAK THE AGENT. A WS bridge that throws while
// forwarding an event — a closed socket, a serialisation bug — cannot be allowed
// to fail the stitch. Every callback is isolated, and the failure is logged and
// counted. This is the one requirement the spec does not state and the one that
// matters most: the observability layer must be strictly less load-bearing than
// the thing it observes.
//
// LIVE DELIVERY IS COMPLETE; THE POST-HOC BUFFER IS BOUNDED. The acceptance
// criteria demand "no events lost" AND the handoff note asks for a buffered
// `dump()` for job review. Those are reconciled rather than traded: a subscriber
// attached at emit time receives every event, without exception, while the
// retained history is capped so a long job cannot grow without limit. What the
// cap discarded is counted and exposed, because a silently truncated audit trail
// is indistinguishable from one that never happened.

import { logger } from '../logger/index.js';
import { redactAuditText } from '../ai/audit.js';
import type { TokenUsage, FinishReason } from '../ai/types.js';
import type { PolicyDecision } from './types.js';
import type { AgentState } from './state.js';

/** Everything the agent did, in the order it did it (P-162 step 1). */
export type ReasoningEvent =
  | { type: 'plan'; text: string }
  | { type: 'tool_call'; tool: string; args: unknown; gate: 'auto' | 'gated' }
  | { type: 'tool_result'; tool: string; ok: boolean; summary: string }
  | { type: 'policy'; decision: PolicyDecision; tool: string }
  | { type: 'state'; from: AgentState; to: AgentState }
  | { type: 'failover'; from: string; to: string; reason: string }
  | { type: 'cost'; totalCost: number; tokens: TokenUsage }
  | { type: 'complete'; finishReason: FinishReason };

/** One subscriber. */
export type ReasoningListener = (event: ReasoningEvent) => void;

/** How much history `dump()` retains by default. */
export const MAX_REASONING_HISTORY = 1000;

/** The public surface the tool loop drives (P-162 step 3). */
export interface ReasoningSink {
  emit(event: ReasoningEvent): void;
}

/**
 * A pub/sub hub over the agent's reasoning (P-162 step 2).
 *
 * Bounded history, isolated subscribers, idempotent unsubscribe.
 */
export class ReasoningStream implements ReasoningSink {
  readonly #listeners = new Set<ReasoningListener>();
  readonly #history: ReasoningEvent[] = [];
  readonly #maxHistory: number;
  #dropped = 0;
  #subscriberFailures = 0;

  constructor(options: { maxHistory?: number } = {}) {
    this.#maxHistory = Math.max(1, options.maxHistory ?? MAX_REASONING_HISTORY);
  }

  /** Events discarded because the history cap was reached. */
  get dropped(): number {
    return this.#dropped;
  }

  /** Subscriber callbacks that threw. Surfaced, so a broken bridge is visible. */
  get subscriberFailures(): number {
    return this.#subscriberFailures;
  }

  /** How many subscribers are attached. */
  get listenerCount(): number {
    return this.#listeners.size;
  }

  /**
   * Publish an event to every current subscriber and retain it.
   *
   * A subscriber that throws is logged and counted, and the remaining
   * subscribers still receive the event. The agent's progress must not depend
   * on whether anyone is watching.
   */
  emit(event: ReasoningEvent): void {
    for (const listener of [...this.#listeners]) {
      try {
        listener(event);
      } catch (e) {
        this.#subscriberFailures += 1;
        logger.warn(
          { err: e instanceof Error ? e.message : String(e), type: event.type },
          'reasoning: subscriber threw; continuing'
        );
      }
    }
    this.#history.push(event);
    // Drop the OLDEST, so a review shows the end of the run — which is where
    // whatever went wrong is.
    while (this.#history.length > this.#maxHistory) {
      this.#history.shift();
      this.#dropped += 1;
    }
  }

  /**
   * Attach a listener.
   *
   * @returns An unsubscribe function. Calling it more than once is harmless,
   *   which matters because a WS bridge that reconnects may tear down twice.
   */
  subscribe(listener: ReasoningListener): () => void {
    this.#listeners.add(listener);
    let live = true;
    return () => {
      if (!live) return;
      live = false;
      this.#listeners.delete(listener);
    };
  }

  /** The retained history, oldest first. */
  dump(): ReasoningEvent[] {
    return [...this.#history];
  }

  /** Drop every subscriber and the history — a fresh run, or a teardown. */
  reset(): void {
    this.#listeners.clear();
    this.#history.length = 0;
    this.#dropped = 0;
    this.#subscriberFailures = 0;
  }
}

/** Shorten to one line and cap the length, so a render never wraps a row. */
function oneLine(text: string, max = 160): string {
  const flat = redactAuditText(text).replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** A compact preview of a tool's arguments for the log line. */
function briefArgs(args: unknown): string {
  if (args === null || args === undefined) return 'no args';
  if (typeof args === 'string') return oneLine(args, 60);
  try {
    return oneLine(JSON.stringify(args) ?? '', 60);
  } catch {
    // A circular or BigInt-bearing argument object must not break rendering.
    return '(unserialisable args)';
  }
}

/**
 * Render one event as a single human-readable line (P-162 step 4).
 *
 * Used by CLI P-199 and the web console, so it must be safe to show a user:
 * every field that can carry model- or human-authored text goes through
 * `redactAuditText`, because a tool result or an error message can contain a
 * credential shape and this is a display surface, not a redacting log pipeline.
 */
export function reasoningText(event: ReasoningEvent): string {
  switch (event.type) {
    case 'plan':
      return `plan: ${oneLine(event.text)}`;
    case 'tool_call':
      return `tool ${event.tool} (${event.gate}): ${briefArgs(event.args)}`;
    case 'tool_result':
      return `result ${event.tool} ${event.ok ? 'ok' : 'FAILED'}: ${oneLine(event.summary, 120)}`;
    case 'policy': {
      const { action, reason } = event.decision;
      return `policy ${event.tool} -> ${action}${reason.length > 0 ? ` (${oneLine(reason, 80)})` : ''}`;
    }
    case 'state':
      return `state ${event.from} -> ${event.to}`;
    case 'failover':
      return `failover ${event.from} -> ${event.to}: ${oneLine(event.reason, 80)}`;
    case 'cost':
      return `cost ${formatCost(event.totalCost)} (${event.tokens.total} tokens)`;
    case 'complete':
      return `complete: ${event.finishReason}`;
  }
}

/**
 * Format a USD amount for a one-line display.
 *
 * `CostTracker` reports dollars, and `estimateCost` divides per-million-token
 * prices by 1e6, so a short run legitimately costs a fraction of a cent. Fixed
 * 4dp would render every such run as `$0.0000`, which reads as "free" — so the
 * precision scales with the magnitude instead.
 */
function formatCost(usd: number): string {
  if (usd === 0) return '$0.00';
  if (usd < 0.01) return `$${usd.toFixed(6)}`;
  if (usd < 1) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}
