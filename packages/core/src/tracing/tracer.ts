// P-248 — Orchestration: the tracer.
//
// `tracer.startSpan(name)` opens a span; nested calls AUTO-PARENT because the current
// span travels in async-local storage rather than through a threaded parameter. That
// is the whole point of the phase: an agent tool that starts an AI call three frames
// down gets the right parent without every intermediate function growing a `ctx`.
//
// Three deliberate properties:
//
//   1. SPANS ARE CHEAP AND SYNCHRONOUS. Opening one allocates a record and stores it;
//      nothing awaits, nothing touches the disk, and `finish` is idempotent. Tracing
//      sits on the pipeline's hot path, so it must not be able to slow a stage down.
//   2. SAMPLING IS DECIDED AT THE ROOT AND INHERITED. A child of a sampled span is
//      sampled (a trace with holes is worse than no trace), and a child of an
//      unsampled one is not — so a sampled run is complete from root to leaf.
//   3. THE COLLECTOR IS SEPARATE FROM THE TRACER. The tracer knows how to open and
//      close; the collector knows which JOB a span belongs to. That keeps the tracer
//      reusable across jobs and makes "per job buffer" a plain map lookup.
//
// On the config seam: the phase ties `trace.ratio` to P-243's `JobConfig`. Rather than
// edit another phase's schema, the ratio arrives as a constructor option — the wiring
// that builds a Tracer is where a `cfg.trace.ratio` will be read. Recorded, not hidden.

import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import {
  orderTrace,
  toTraceJson,
  type Span,
  type SpanKind,
  type SpanStatus,
  type Trace,
  type TraceJson,
} from './spans.js';

/** Options for {@link Tracer}. */
export interface TracerOptions {
  /** Clock, injectable so a test can assert a real duration. */
  now?: () => string;
  /** 0..1; `1` (the default) records everything. */
  sampleRatio?: number;
  /** Randomness for the sampling decision; injectable so a test is deterministic. */
  random?: () => number;
  /** Receives every RECORDED span — wire this to the P-241 bus. */
  onSpan?: (span: Span) => void;
  /** Id source; injectable so a test can name spans. */
  idFactory?: () => string;
}

/** An open span. `finish` is idempotent — a double-close cannot corrupt the trace. */
export interface SpanHandle {
  readonly span: Span;
  /** False when sampling dropped this span (it is still usable, just not recorded). */
  readonly sampled: boolean;
  finish(status?: SpanStatus, attrs?: Record<string, unknown>): Span;
}

/** Options for {@link Tracer.startSpan}. */
export interface StartSpanOptions {
  /** What kind of work this is. Defaults to `stage`. */
  kind?: SpanKind;
  /** Detail to attach at open time. */
  attrs?: Record<string, unknown>;
}

/**
 * The async-context tracer.
 *
 * One instance is cheap; the current span lives in `AsyncLocalStorage`, so concurrent
 * async work in the same process does not leak parents into one another.
 */
export class Tracer {
  readonly #now: () => string;
  readonly #ratio: number;
  readonly #random: () => number;
  readonly #onSpan: ((span: Span) => void) | undefined;
  readonly #ids: () => string;
  readonly #als = new AsyncLocalStorage<Span>();
  /** Ids of spans whose sampling decision was "record". */
  readonly #sampled = new Set<string>();

  constructor(opts: TracerOptions = {}) {
    this.#now = opts.now ?? (() => new Date().toISOString());
    this.#ratio = Math.max(0, Math.min(1, opts.sampleRatio ?? 1));
    this.#random = opts.random ?? Math.random;
    this.#onSpan = opts.onSpan;
    this.#ids = opts.idFactory ?? (() => randomUUID());
  }

  /** The span this async context is inside, if any. */
  get current(): Span | undefined {
    return this.#als.getStore();
  }

  /**
   * Open a span.
   *
   * Sampling is decided HERE and inherited by children (module header, point 2). An
   * unsampled span is still returned so call sites stay free of `if (sampled)` — it
   * just never reaches {@link TracerOptions.onSpan}.
   */
  startSpan(name: string, opts: StartSpanOptions = {}): SpanHandle {
    const parent = this.#als.getStore();
    const id = this.#ids();
    const sampled =
      parent !== undefined ? this.#sampled.has(parent.id) : this.#random() < this.#ratio;

    const span: Span = {
      id,
      ...(parent !== undefined ? { parentId: parent.id } : {}),
      name,
      kind: opts.kind ?? 'stage',
      startedAt: this.#now(),
      attrs: { ...(opts.attrs ?? {}), sampled },
      status: 'unset',
    };
    if (sampled) this.#sampled.add(id);

    let finished: Span | undefined;
    return {
      span,
      sampled,
      finish: (status: SpanStatus = 'ok', attrs?: Record<string, unknown>): Span => {
        // Idempotent: a stage that finishes in both a success and an error path
        // (a `finally`) must not emit two records for one span.
        if (finished !== undefined) return finished;
        const at = this.#now();
        const start = Date.parse(span.startedAt);
        const end = Date.parse(at);
        finished = {
          ...span,
          finishedAt: at,
          // A clock that moved backwards yields 0, never a negative duration.
          durationMs: Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : 0,
          status,
          attrs: { ...span.attrs, ...(attrs ?? {}) },
        };
        this.#sampled.delete(id);
        if (sampled) this.#onSpan?.(finished);
        return finished;
      },
    };
  }

  /**
   * Run `fn` with `handle`'s span as the current one.
   *
   * The returned value is passed through untouched, so an async `fn` keeps the
   * context across its awaits (that is what `AsyncLocalStorage.run` gives us) and
   * this reads as a plain wrapper at the call site rather than a scope to manage.
   */
  withSpan<T>(handle: SpanHandle, fn: () => T): T {
    return this.#als.run(handle.span, fn);
  }
}

/**
 * Buffers finished spans per job (P-248 step 2).
 *
 * Deliberately not part of {@link Tracer}: the tracer does not know what a job is.
 * Wire `new Tracer({ onSpan: span => collector.record(jobId, span) })` and the two
 * stay independent — which is also what lets one Tracer serve several jobs.
 */
export class TraceCollector {
  readonly #byJob = new Map<string, Span[]>();

  /** Record one finished span for a job. They arrive in FINISH order. */
  record(jobId: string, span: Span): void {
    const spans = this.#byJob.get(jobId);
    if (spans === undefined) this.#byJob.set(jobId, [span]);
    else spans.push(span);
  }

  /** How many spans a job has buffered. */
  size(jobId: string): number {
    return this.#byJob.get(jobId)?.length ?? 0;
  }

  /** The job's trace, or `undefined` when nothing was recorded for it. */
  getTrace(jobId: string): Trace | undefined {
    const spans = this.#byJob.get(jobId);
    if (spans === undefined || spans.length === 0) return undefined;
    const root = spans.find(span => span.parentId === undefined) ?? spans[0];
    if (root === undefined) return undefined;
    // Re-ordered for reading: a child finishes before its parent, so a trace is
    // emitted in pre-order rather than in the order the spans happened to close.
    return { rootId: root.id, spans: orderTrace(spans) };
  }

  /** The job's trace as exportable JSON, or `undefined` when there is none. */
  toJson(jobId: string): TraceJson | undefined {
    const trace = this.getTrace(jobId);
    return trace === undefined ? undefined : toTraceJson(trace);
  }

  /** Forget one job (a finished trace is handed off, not kept forever). */
  release(jobId: string): void {
    this.#byJob.delete(jobId);
  }
}

/** Build a collector. Kept as a factory so the module exposes one construction style. */
export function traceCollector(): TraceCollector {
  return new TraceCollector();
}
