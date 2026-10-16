// P-248 — Orchestration: spans and the waterfall.
//
// A span is one unit of work with a start, an end, and where it sat in the nesting.
// A trace is the whole tree for one job. This module owns ONLY the vocabulary and the
// rendering: `tracer.ts` owns when spans are opened and closed, so the shape can be
// asserted (and rendered) without running a pipeline.
//
// The nesting is expressed the way external tooling reads it: a FLAT list of spans
// each naming its `parentId`, not a nested object. Flat is what OTLP and every trace
// viewer consume, and it is what makes a trace serialisable without recursion — so
// {@link toTraceJson} is a straight map rather than a walk.

/** What kind of work a span covers. */
export const SPAN_KINDS = ['job', 'stage', 'tool', 'sandbox', 'ai', 'fs'] as const;
export type SpanKind = (typeof SPAN_KINDS)[number];

/** A span's outcome. `unset` until it is finished — an open span has no verdict. */
export const SPAN_STATUSES = ['unset', 'ok', 'error'] as const;
export type SpanStatus = (typeof SPAN_STATUSES)[number];

/** One unit of work. */
export interface Span {
  id: string;
  /** The enclosing span, absent on the root. */
  parentId?: string;
  name: string;
  kind: SpanKind;
  /** ISO-8601. */
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  /** Free-form detail (counts, paths, model names). */
  attrs: Record<string, unknown>;
  status: SpanStatus;
}

/** One job's whole trace. */
export interface Trace {
  /** The id of the root span (the job span). */
  rootId: string;
  /** Flat, in start order — see the header. */
  spans: Span[];
}

/** How deep a span sits, counting the root as 0. */
export function spanDepth(trace: Trace, span: Span): number {
  const byId = new Map(trace.spans.map(entry => [entry.id, entry]));
  let depth = 0;
  let cursor = span;
  // Bounded by the span count: a cycle in a corrupt trace cannot hang the renderer.
  for (let hops = 0; hops < trace.spans.length; hops++) {
    if (cursor.parentId === undefined) return depth;
    const parent = byId.get(cursor.parentId);
    if (parent === undefined) return depth;
    depth += 1;
    cursor = parent;
  }
  return depth;
}

/**
 * Order spans for reading: the root first, then each subtree depth-first.
 *
 * Spans FINISH in a different order than they start — a child closes before its
 * parent — so insertion order is not readable order. A pre-order walk over `parentId`
 * gives a waterfall whose lines are already in the order a reader expects, and makes
 * the renderer independent of finish timing. Children keep their insertion order.
 */
export function orderTrace(spans: readonly Span[]): Span[] {
  const children = new Map<string, Span[]>();
  for (const span of spans) {
    if (span.parentId === undefined) continue;
    const list = children.get(span.parentId);
    if (list === undefined) children.set(span.parentId, [span]);
    else list.push(span);
  }
  const out: Span[] = [];
  const seen = new Set<string>();
  const visit = (span: Span): void => {
    // Bounded: a corrupt cycle must not hang the walk.
    if (seen.has(span.id)) return;
    seen.add(span.id);
    out.push(span);
    for (const child of children.get(span.id) ?? []) visit(child);
  };
  for (const span of spans) {
    if (span.parentId === undefined) visit(span);
  }
  // Orphans (a parent not in this trace) are kept rather than dropped.
  for (const span of spans) if (!seen.has(span.id)) out.push(span);
  return out;
}

/** `1234` → `1.2s`; keeps a waterfall readable at a glance. */
function formatDuration(ms: number | undefined): string {
  if (ms === undefined) return '(open)';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Render a trace as an indented waterfall.
 *
 * Two spaces per level and the kind in the gutter, so a reader sees the shape of the
 * tree and what each level was. Spans are indented by DEPTH, never by their position
 * in the list, so a flat list in start order still renders nested.
 */
export function renderWaterfall(trace: Trace): string {
  const lines: string[] = [];
  for (const span of trace.spans) {
    const indent = '  '.repeat(spanDepth(trace, span));
    const marker = span.status === 'error' ? '!' : span.status === 'unset' ? '~' : '·';
    lines.push(`${indent}${marker} [${span.kind}] ${span.name} ${formatDuration(span.durationMs)}`);
  }
  return lines.join('\n');
}

/** The JSON an external viewer (or `/api/jobs/<id>/trace`) receives. */
export interface TraceJson {
  rootId: string;
  /** Flat list with `parentId` — OTLP-shaped, see the header. */
  spans: {
    id: string;
    parentId?: string;
    name: string;
    kind: SpanKind;
    startedAt: string;
    finishedAt?: string;
    durationMs?: number;
    status: SpanStatus;
    attrs: Record<string, unknown>;
  }[];
}

/** Serialise a trace for export. A plain map — no recursion, no cycles. */
export function toTraceJson(trace: Trace): TraceJson {
  return {
    rootId: trace.rootId,
    spans: trace.spans.map(span => ({
      id: span.id,
      ...(span.parentId !== undefined ? { parentId: span.parentId } : {}),
      name: span.name,
      kind: span.kind,
      startedAt: span.startedAt,
      ...(span.finishedAt !== undefined ? { finishedAt: span.finishedAt } : {}),
      ...(span.durationMs !== undefined ? { durationMs: span.durationMs } : {}),
      status: span.status,
      attrs: span.attrs,
    })),
  };
}

/** The `err.traceId`/`spanId` pair an error carries so a failure points at a trace. */
export interface TraceRef {
  traceId: string;
  spanId: string;
}

/** Build the reference an error hangs onto (P-203's error id). */
export function traceRef(trace: Trace, span: Span): TraceRef {
  return { traceId: trace.rootId, spanId: span.id };
}
