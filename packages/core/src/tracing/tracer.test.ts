// P-248 — tracing tests.
//
// The two claims worth defending are STRUCTURAL: a nested span gets the right parent
// (including across an await — that is the whole reason async-local storage is used
// instead of a threaded parameter), and a finished span is recorded exactly once.
// Rendering and export are asserted on hand-built traces so the expected shape is
// visible rather than inferred from whatever the tracer happened to produce.
//
// The five required scenarios from the phase spec:
//
//   it('nests spans')  it('finish attrs')  it('per job buffer')
//   it('waterfall render')  it('json export')

import { describe, it, expect, beforeEach } from 'vitest';
import { renderWaterfall, spanDepth, toTraceJson, type Span, type Trace } from './spans.js';
import { Tracer, traceCollector } from './tracer.js';

const T1 = '2026-10-17T00:00:00.000Z';

let clock = T1;
let seq = 0;

/** An ISO stamp `offsetMs` after T1. */
function at(offsetMs: number): string {
  return new Date(Date.parse(T1) + offsetMs).toISOString();
}

/** A deterministic tracer: fixed clock, sequential ids, pinned randomness. */
function makeTracer(onSpan?: (span: Span) => void): Tracer {
  return new Tracer({
    now: () => clock,
    idFactory: () => `s${++seq}`,
    random: () => 0.5,
    sampleRatio: 1,
    ...(onSpan !== undefined ? { onSpan } : {}),
  });
}

beforeEach(() => {
  clock = T1;
  seq = 0;
});

describe('P-248 tracing', () => {
  it('nests spans', async () => {
    const tracer = makeTracer();

    const root = tracer.startSpan('job', { kind: 'job' });
    const stage = tracer.withSpan(root, () => tracer.startSpan('deps', { kind: 'stage' }));
    const tool = tracer.withSpan(root, () =>
      tracer.withSpan(stage, () => tracer.startSpan('select_files', { kind: 'tool' }))
    );

    expect(root.span.parentId).toBeUndefined();
    expect(stage.span.parentId).toBe(root.span.id);
    expect(tool.span.parentId).toBe(stage.span.id);
    expect(tracer.current).toBeUndefined();

    // Sibling at the top level is a root, not a child of the last span opened.
    const sibling = tracer.startSpan('other');
    expect(sibling.span.parentId).toBeUndefined();

    // The context survives an await — otherwise every async op would detach.
    await tracer.withSpan(root, async () => {
      await Promise.resolve();
      const deep = tracer.startSpan('ai', { kind: 'ai' });
      expect(deep.span.parentId).toBe(root.span.id);
    });
  });

  it('finish attrs', () => {
    const tracer = makeTracer();

    const span = tracer.startSpan('deps', { kind: 'stage', attrs: { ecosystem: 'npm' } });
    expect(span.span.status).toBe('unset');
    expect(span.span.durationMs).toBeUndefined();

    clock = at(250);
    const done = span.finish('ok', { files: 12 });

    expect(done.status).toBe('ok');
    expect(done.finishedAt).toBe(at(250));
    expect(done.durationMs).toBe(250);
    // Open attrs survive; finish attrs are merged in.
    expect(done.attrs).toMatchObject({ ecosystem: 'npm', files: 12 });

    // Idempotent: a `finally` that finishes an already-finished span adds nothing.
    const again = span.finish('error', { oops: true });
    expect(again).toBe(done);
    expect(again.status).toBe('ok');

    // A failing span is recorded as such.
    const failing = tracer.startSpan('build');
    clock = at(300);
    expect(failing.finish('error').status).toBe('error');
  });

  it('per job buffer', () => {
    const collector = traceCollector();

    const j1 = makeTracer(span => collector.record('j1', span));
    const j2 = makeTracer(span => collector.record('j2', span));

    const rootA = j1.startSpan('job', { kind: 'job' });
    j1.withSpan(rootA, () => j1.startSpan('deps')).finish();
    rootA.finish();

    const rootB = j2.startSpan('job', { kind: 'job' });
    rootB.finish();

    expect(collector.size('j1')).toBe(2);
    expect(collector.size('j2')).toBe(1);
    const trace = collector.getTrace('j1');
    expect(trace?.rootId).toBe(rootA.span.id);
    expect(trace?.spans.map(s => s.name)).toEqual(['job', 'deps']);

    // Nothing recorded for a job that never ran.
    expect(collector.getTrace('ghost')).toBeUndefined();

    // Sampling: a dropped span is not recorded, and neither is its child — a trace
    // with holes is worse than no trace.
    const collector3 = traceCollector();
    const dropped = new Tracer({
      now: () => clock,
      idFactory: () => `d${++seq}`,
      random: () => 0.99,
      sampleRatio: 0.5,
      onSpan: span => collector3.record('j3', span),
    });
    const unsampled = dropped.startSpan('job', { kind: 'job' });
    dropped.withSpan(unsampled, () => dropped.startSpan('deps')).finish();
    unsampled.finish();
    expect(unsampled.sampled).toBe(false);
    expect(collector3.size('j3')).toBe(0);

    // Release hands the trace off rather than keeping it forever.
    collector.release('j1');
    expect(collector.size('j1')).toBe(0);
  });

  it('waterfall render', () => {
    const root: Span = {
      id: 'a',
      name: 'job',
      kind: 'job',
      startedAt: T1,
      finishedAt: at(500),
      durationMs: 500,
      attrs: {},
      status: 'ok',
    };
    const stage: Span = {
      id: 'b',
      parentId: 'a',
      name: 'deps',
      kind: 'stage',
      startedAt: T1,
      finishedAt: at(250),
      durationMs: 250,
      attrs: {},
      status: 'ok',
    };
    const tool: Span = {
      id: 'c',
      parentId: 'b',
      name: 'run_build',
      kind: 'tool',
      startedAt: T1,
      attrs: {},
      status: 'error',
    };
    const trace: Trace = { rootId: 'a', spans: [root, stage, tool] };

    expect(spanDepth(trace, root)).toBe(0);
    expect(spanDepth(trace, stage)).toBe(1);
    expect(spanDepth(trace, tool)).toBe(2);

    const lines = renderWaterfall(trace).split('\n');
    expect(lines[0]).toBe('· [job] job 500ms');
    expect(lines[1]).toBe('  · [stage] deps 250ms');
    // Indent is DEPTH, not list position; an open span says so; an error is marked.
    expect(lines[2]).toBe('    ! [tool] run_build (open)');

    // Long spans read in seconds.
    expect(renderWaterfall({ rootId: 'a', spans: [{ ...root, durationMs: 1200 }] })).toContain(
      '1.2s'
    );
  });

  it('json export', () => {
    const collector = traceCollector();
    const tracer = makeTracer(span => collector.record('j1', span));

    const root = tracer.startSpan('job', { kind: 'job' });
    const deps = tracer.withSpan(root, () => tracer.startSpan('deps', { kind: 'stage' }));
    clock = at(100);
    deps.finish('ok', { files: 3 });
    clock = at(400);
    root.finish();

    const json = collector.toJson('j1');
    expect(json?.rootId).toBe(root.span.id);
    expect(json?.spans).toHaveLength(2);
    expect(json?.spans[0]).toMatchObject({ name: 'job', kind: 'job', status: 'ok' });
    expect(json?.spans[1]).toMatchObject({
      name: 'deps',
      kind: 'stage',
      parentId: root.span.id,
      durationMs: 100,
    });
    expect(json?.spans[1]?.attrs).toMatchObject({ files: 3 });

    // Flat + parentId round-trips through JSON with nothing lost.
    const text = JSON.stringify(json);
    expect(JSON.parse(text)).toEqual(json);

    // `toTraceJson` on the collected trace carries the same ids in the same order.
    const trace = collector.getTrace('j1');
    expect(trace).toBeDefined();
    if (trace === undefined) return;
    expect(toTraceJson(trace).spans.map(s => s.id)).toEqual(trace.spans.map(s => s.id));

    expect(collector.toJson('ghost')).toBeUndefined();
  });
});
