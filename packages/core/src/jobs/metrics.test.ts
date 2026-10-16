// P-247 — metrics tests.
//
// The collector is fed a DETERMINISTIC clock and a real bus, because the two claims
// worth defending are arithmetic: a stage's duration is the distance between its
// transitions (not whatever the wall clock did), and a hostile number from a provider
// must not poison a trend. Persistence runs against real temp SQLite, since
// "queryable per-job and as a trend" is a claim about SQL.
//
// The five required scenarios from the phase spec:
//
//   it('collects timings')  it('tallies counts')  it('aggregates token cost')
//   it('persists queries')  it('resources')

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Bus } from '../events/bus.js';
import { makeDbAdapter } from '../sandbox/__tests__/fake-docker.js';
import type { DbLike } from '../store/schema.js';
import { MetricsCollector, finalizeMetrics, getMetrics, listMetrics } from './metrics.js';

const T1 = '2026-10-17T00:00:00.000Z';

let db: DbLike;
let clock = T1;

/** An ISO stamp `offsetMs` after T1, for a deterministic duration. */
function at(offsetMs: number): string {
  return new Date(Date.parse(T1) + offsetMs).toISOString();
}

beforeEach(() => {
  db = makeDbAdapter();
  clock = T1;
});

afterEach(() => {
  db.close();
});

describe('P-247 metrics', () => {
  it('collects timings', () => {
    const collector = new MetricsCollector('j1', { now: () => clock });

    collector.recordStageTransition({ stage: 'deps', from: 'pending', to: 'running' });
    clock = at(1500);
    collector.recordStageTransition({ stage: 'deps', from: 'running', to: 'passed' });

    // A cache hit (P-238 skips it) is a reuse, not work done.
    collector.recordStageTransition({ stage: 'agent', from: 'pending', to: 'running' });
    clock = at(1500);
    collector.recordStageTransition({ stage: 'agent', from: 'running', to: 'skipped' });

    // A stage that never settled contributes no timing rather than a bogus zero.
    collector.recordStageTransition({ stage: 'sandbox', from: 'pending', to: 'running' });

    const metrics = collector.snapshot();
    expect(metrics.jobId).toBe('j1');
    expect(metrics.stages).toHaveLength(2);

    const deps = metrics.stages.find(s => s.stage === 'deps');
    expect(deps?.durationMs).toBe(1500);
    expect(deps?.started).toBe(T1);
    expect(deps?.finished).toBe(at(1500));
    expect(deps?.reusedFromCache).toBe(false);

    const agent = metrics.stages.find(s => s.stage === 'agent');
    expect(agent?.reusedFromCache).toBe(true);
    expect(metrics.stages.some(s => s.stage === 'sandbox')).toBe(false);
  });

  it('tallies counts', () => {
    const bus = new Bus({ now: () => clock });
    const collector = new MetricsCollector('j1', { now: () => clock });
    const off = collector.attach(bus);

    bus.publish('agent.tool', { tool: 'select_files' });
    bus.publish('agent.tool', { tool: 'edit_config' });
    bus.publish('agent.tool', { tool: 'propose_component' });
    bus.publish('deps.merged', { count: 5 });
    bus.publish('license.verdict', { verdict: 'allow' });

    const counts = collector.snapshot().counts;
    expect(counts.checks).toBe(3);
    expect(counts.deps).toBe(5);
    expect(counts.licenseDecisions).toBe(1);
    expect(counts.tokensIn).toBe(0);

    // Detaching stops the counting — a finished job must not keep accruing.
    off();
    bus.publish('agent.tool', { tool: 'run_build' });
    expect(collector.snapshot().counts.checks).toBe(3);

    // Direct tallies are clamped rather than allowed to go negative or NaN.
    collector.tally('files', 4);
    collector.tally('files', -10);
    collector.tally('files', Number.NaN);
    expect(collector.snapshot().counts.files).toBe(4);
  });

  it('aggregates token cost', () => {
    const collector = new MetricsCollector('j1', { now: () => clock });

    collector.addTokens({ tokensIn: 100, tokensOut: 50, costUsd: 0.25, provider: 'openrouter' });
    collector.addTokens({ tokensIn: 200, tokensOut: 25, costUsd: 0.5 });

    // A hostile reading from a provider adapter must not poison the trend.
    collector.addTokens({ tokensIn: Number.NaN, tokensOut: Number.POSITIVE_INFINITY });
    collector.addTokens({ costUsd: -5 });

    const metrics = collector.snapshot();
    expect(metrics.counts.tokensIn).toBe(300);
    expect(metrics.counts.tokensOut).toBe(75);
    expect(metrics.cost.estimatedUsd).toBeCloseTo(0.75, 10);
    expect(metrics.cost.provider).toBe('openrouter');
  });

  it('persists queries', () => {
    const collector = new MetricsCollector('j1', { now: () => clock });
    collector.recordStageTransition({ stage: 'deps', from: 'pending', to: 'running' });
    clock = at(200);
    collector.recordStageTransition({ stage: 'deps', from: 'running', to: 'passed' });
    collector.tally('files', 12);

    const saved = finalizeMetrics(db, collector.snapshot(), {
      kind: 'stitch',
      now: () => at(1000),
    });
    expect(saved.isOk()).toBe(true);

    const read = getMetrics(db, 'j1');
    expect(read.isOk()).toBe(true);
    if (read.isErr()) return;
    expect(read.value?.jobId).toBe('j1');
    expect(read.value?.counts.files).toBe(12);
    expect(read.value?.stages[0]?.durationMs).toBe(200);

    // Trend list, filtered.
    const listed = listMetrics(db, { kind: 'stitch' });
    expect(listed.isOk() && listed.value.map(m => m.jobId)).toEqual(['j1']);
    expect(listMetrics(db, { kind: 'other' })._unsafeUnwrap()).toEqual([]);
    expect(listMetrics(db, { from: at(5000) })._unsafeUnwrap()).toEqual([]);

    // No metrics is `undefined`, not an error.
    expect(getMetrics(db, 'ghost')._unsafeUnwrap()).toBeUndefined();

    // Re-finalizing replaces rather than duplicating.
    finalizeMetrics(db, collector.snapshot(), { kind: 'stitch', now: () => at(2000) });
    expect(listMetrics(db)._unsafeUnwrap()).toHaveLength(1);
  });

  it('resources', () => {
    const bus = new Bus({ now: () => clock });
    const collector = new MetricsCollector('j1', { now: () => clock });
    collector.attach(bus);

    // CPU and job counts accumulate; memory is a PEAK, so the largest reading wins.
    collector.recordResources({ cpuMs: 100, memMb: 256, jobs: 2 });
    collector.recordResources({ cpuMs: 50, memMb: 512, jobs: 1 });

    expect(collector.snapshot().resources).toEqual({
      sandboxCpuMs: 150,
      sandboxMemMb: 512,
      sandboxJobs: 3,
    });

    // The same readings arrive on the bus in production (P-176).
    bus.publish('sandbox.run', { cpuMs: 25, memMb: 128, jobs: 1 });
    expect(collector.snapshot().resources).toEqual({
      sandboxCpuMs: 175,
      sandboxMemMb: 512,
      sandboxJobs: 4,
    });
  });
});
