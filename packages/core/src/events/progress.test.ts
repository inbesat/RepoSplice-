// P-242 — progress aggregation tests.
//
// The aggregator takes an injected clock and an in-process bus, so every case here
// is exact arithmetic with no timers and no server: the throttle is proven by
// moving the clock rather than by sleeping, and the ETA clamp by choosing a ceiling
// small enough to be reached.
//
// The five required scenarios from the phase spec:
//
//   it('weighted percent')  it('throttles')  it('redistributes skipped')
//   it('eta clamp')         it('activity priority')
//
// The arithmetic in each case is stated in a comment, so a failure says WHAT broke
// rather than just that a number moved.

import { describe, it, expect } from 'vitest';
import { PIPELINE_STAGES, type PipelineStage, type StageStatus } from '../pipeline/states.js';
import { Bus } from './bus.js';
import {
  AWAITING_APPROVAL,
  DEFAULT_STAGE_WEIGHTS,
  STAGE_PHASES,
  createProgressAggregator,
  type ProgressAggregator,
  type ProgressAggregatorOptions,
} from './progress.js';
import type { ProgressPayload } from './topics.js';

interface Harness {
  bus: Bus;
  agg: ProgressAggregator;
  emitted: ProgressPayload[];
  advance: (ms: number) => void;
  /** Publish a stage transition. `from` is ignored by the aggregator. */
  pub: (stage: PipelineStage, to: StageStatus) => void;
}

/**
 * An aggregator on a bus with a hand-cranked clock.
 *
 * The clock starts non-zero so an "elapsed = now − startedAt" bug that assumed a
 * zero origin would show up immediately.
 */
function harness(
  overrides: Partial<Omit<ProgressAggregatorOptions, 'bus' | 'jobId' | 'now'>> = {}
): Harness {
  let now = 1_000;
  const bus = new Bus({ now: () => new Date(now).toISOString() });
  const emitted: ProgressPayload[] = [];
  bus.subscribe('progress', payload => emitted.push(payload));
  const result = createProgressAggregator({ bus, jobId: 'job-1', now: () => now, ...overrides });
  if (result.isErr()) expect.fail(`aggregator options rejected: ${result.error.code}`);
  const agg = result.value;
  agg.start();
  return {
    bus,
    agg,
    emitted,
    advance: ms => {
      now += ms;
    },
    pub: (stage, to) => {
      bus.publish('pipeline.stage', { stage, from: 'pending', to });
    },
  };
}

function stageOf(h: Harness, id: PipelineStage) {
  return h.agg.model().stages.find(s => s.id === id);
}

describe('P-242 progress aggregation', () => {
  it('weighted percent', () => {
    const h = harness();

    // Percent is a WEIGHTED sum over the real nine stages, not a stage count.
    const pre: PipelineStage[] = ['config', 'sources', 'selection', 'deps', 'licenses'];
    for (const stage of pre) h.pub(stage, 'passed');
    h.pub('agent', 'running');
    h.bus.publish('agent.tool', { percent: 50, detail: 'generating component xyz' });

    // (0.02+0.03+0.05+0.15+0.05)·100 + 0.40·50 = 30 + 20 = 50, over 1.12 → 44.64 → 45.
    const model = h.agg.model();
    expect(model.jobId).toBe('job-1');
    expect(model.overall.percent).toBe(45);
    expect(model.overall.phase).toBe('integrate');

    // Every real stage is represented, with its label and its own percent.
    expect(model.stages.map(s => s.id)).toEqual([...PIPELINE_STAGES]);
    expect(model.stages).toHaveLength(9);
    expect(stageOf(h, 'config')?.percent).toBe(100);
    expect(stageOf(h, 'config')?.status).toBe('passed');
    expect(stageOf(h, 'agent')?.percent).toBe(50);
    expect(stageOf(h, 'agent')?.status).toBe('running');
    expect(stageOf(h, 'sandbox')?.percent).toBe(0);
    expect(stageOf(h, 'sandbox')?.label).toBe('verifying in a sandbox');

    // A finished stitch reads 100, not 95 — the reason the weights are normalised.
    for (const stage of ['agent', 'sandbox', 'provenance', 'finalize'] as PipelineStage[]) {
      h.pub(stage, 'passed');
    }
    expect(h.agg.model().overall.percent).toBe(100);
    expect(h.agg.model().overall.phase).toBe('done');
    expect(h.agg.model().overall.etaMs).toBe(0);

    // The phase's four illustrative weights are used verbatim, and every stage has
    // a weight and a grouping (a missing one would be a compile error anyway).
    expect(DEFAULT_STAGE_WEIGHTS.deps).toBe(0.15);
    expect(DEFAULT_STAGE_WEIGHTS.agent).toBe(0.4);
    expect(DEFAULT_STAGE_WEIGHTS.sandbox).toBe(0.3);
    expect(DEFAULT_STAGE_WEIGHTS.provenance).toBe(0.1);
    for (const stage of PIPELINE_STAGES) {
      expect(DEFAULT_STAGE_WEIGHTS[stage]).toBeGreaterThan(0);
      expect(typeof STAGE_PHASES[stage]).toBe('string');
    }
  });

  it('throttles', () => {
    const h = harness(); // cadence defaults to 200ms

    // A stage change emits immediately, even as the very first event.
    h.pub('config', 'running');
    expect(h.agg.emitted).toBe(1);
    expect(h.emitted).toHaveLength(1);

    // A non-stage event inside the cadence window does NOT emit...
    h.bus.publish('sandbox.run', { percent: 10 });
    expect(h.agg.emitted).toBe(1);
    // ...but the model is already live, so nothing is LOST by holding the frame.
    expect(stageOf(h, 'sandbox')?.percent).toBe(10);

    // Past the cadence, the next change goes out.
    h.advance(200);
    h.bus.publish('sandbox.run', { percent: 20 });
    expect(h.agg.emitted).toBe(2);

    // Past the cadence again, but with an IDENTICAL model: no frame, so no flicker.
    h.advance(200);
    h.bus.publish('sandbox.run', { percent: 20 });
    expect(h.agg.emitted).toBe(2);

    // Forced emissions are never swallowed by the throttle.
    h.pub('sandbox', 'passed');
    expect(h.agg.emitted).toBe(3);
    h.pub('provenance', 'running');
    expect(h.agg.emitted).toBe(4);

    // Each emitted event carries the aggregated snapshot, not a raw tick.
    const last = h.emitted.at(-1);
    expect(last?.overall).toBe(h.agg.model().overall.percent);
    expect(last?.phase).toBe(h.agg.model().overall.phase);
    expect(last?.detail).toBe(h.agg.model().activity);
    // `progress.stage` names the EARLIEST unresolved stage. Config never got a
    // verdict in this scenario, so that is where the bar legitimately sits — the
    // `weighted percent` case covers the stage advancing.
    expect(last?.stage).toBe('config');

    // A manual tick honours the same window and reports what it did: closed window
    // and an unchanged model mean no frame, and `force` always gets through.
    expect(h.agg.tick()).toBe(false);
    h.advance(200);
    expect(h.agg.tick()).toBe(false);
    expect(h.agg.tick(true)).toBe(true);
    expect(h.agg.emitted).toBe(5);
  });

  it('redistributes skipped', () => {
    // Weights chosen so the arithmetic is exact and the redistribution is visible.
    const weights: Partial<Record<PipelineStage, number>> = {
      config: 0,
      sources: 0,
      selection: 0,
      deps: 0.15,
      licenses: 0,
      agent: 0.4,
      sandbox: 0.3,
      provenance: 0.1,
      finalize: 0,
    };
    const h = harness({ weights });

    // The premise: this run only has the four weighted stages; the rest are skipped
    // outright, which is what a project without a sandbox step would do.
    for (const stage of [
      'config',
      'sources',
      'selection',
      'licenses',
      'finalize',
    ] as PipelineStage[]) {
      h.pub(stage, 'skipped');
    }

    h.pub('deps', 'passed');
    h.pub('agent', 'running');
    h.bus.publish('agent.tool', { percent: 50 });
    h.pub('sandbox', 'skipped');

    // Active weights = 0.15 + 0.40 + 0.10 = 0.65; contributions = 15 + 20 = 35.
    // 35 / 0.65 = 53.85 → 54. A skipped stage hands its weight to the others.
    expect(h.agg.model().overall.percent).toBe(54);
    // Without redistribution it would have been 35 / 0.95 = 36.84 → 37: the skipped
    // stage would have left a permanent hole in the bar.
    expect(h.agg.model().overall.percent).not.toBe(37);

    // The skipped stage is still reported, as skipped and complete.
    expect(stageOf(h, 'sandbox')).toEqual({
      id: 'sandbox',
      label: 'verifying in a sandbox',
      percent: 100,
      status: 'skipped',
    });

    // Skipping the heavy stages does not cap the bar below 100.
    h.pub('agent', 'passed');
    expect(h.agg.model().overall.percent).toBe(85); // (15 + 40) / 0.65 = 84.6 → 85
    h.pub('provenance', 'passed');
    expect(h.agg.model().overall.percent).toBe(100);
    expect(h.agg.model().overall.phase).toBe('done');

    // A wholly skipped pipeline is complete, not stuck at zero.
    const all = harness({ weights });
    for (const stage of PIPELINE_STAGES) all.pub(stage, 'skipped');
    expect(all.agg.model().overall.percent).toBe(100);
  });

  it('eta clamp', () => {
    const h = harness({ maxEtaMs: 1_000 });

    // Nothing observed yet: there is no throughput, so there is no estimate. An
    // invented number here is exactly the "lying ETA" the handoff warns about.
    expect(h.agg.model().overall.etaMs).toBeUndefined();

    h.pub('config', 'running');
    // Work has started but no fraction is known: still no estimate.
    expect(h.agg.model().overall.percent).toBe(0);
    expect(h.agg.model().overall.etaMs).toBeUndefined();

    // Ten seconds in, a quarter of the sandbox done: the raw extrapolation is
    // ~67s, far past the 1s ceiling, so it is clamped rather than reported.
    h.advance(10_000);
    h.bus.publish('sandbox.run', { percent: 50 });
    const clamped = h.agg.model();
    expect(clamped.overall.percent).toBe(13); // 0.30·50 / 1.12 = 13.39 → 13
    expect(clamped.overall.etaMs).toBe(1_000);

    // A clock that jumps backwards cannot yield a negative estimate.
    h.advance(-20_000);
    const backwards = h.agg.model().overall.etaMs;
    expect(backwards).toBeDefined();
    expect(backwards ?? -1).toBeGreaterThanOrEqual(0);

    // A finished pipeline reports zero — known, not unknown.
    for (const stage of PIPELINE_STAGES) h.pub(stage, 'passed');
    expect(h.agg.model().overall.percent).toBe(100);
    expect(h.agg.model().overall.etaMs).toBe(0);

    // Etas are NOT smoothed into a change signal: an ETA-only move must not emit.
    const steady = harness({ maxEtaMs: 1_000 });
    steady.pub('config', 'running');
    steady.advance(200);
    steady.bus.publish('agent.tool', { percent: 10 });
    const before = steady.agg.emitted;
    steady.advance(200);
    steady.agg.tick();
    expect(steady.agg.emitted).toBe(before);
  });

  it('activity priority', () => {
    const h = harness();

    // A stage transition offers a GENERIC label.
    h.pub('config', 'running');
    expect(h.agg.model().activity).toBe('preparing configuration');
    // Generic replaces generic, so the line follows the newest stage rather than
    // going stale on the first one.
    h.pub('sources', 'running');
    expect(h.agg.model().activity).toBe('fetching sources');

    // A payload `detail` is what the producer actually observed: specific.
    h.bus.publish('deps.merged', { detail: 'installing deps npm' });
    expect(h.agg.model().activity).toBe('installing deps npm');

    // A later GENERIC label must not clobber a specific one.
    h.pub('sandbox', 'running');
    expect(h.agg.model().activity).toBe('installing deps npm');

    // A newer specific label wins.
    h.bus.publish('sandbox.run', { detail: 'running npm test', percent: 10 });
    expect(h.agg.model().activity).toBe('running npm test');

    // A group event with no detail falls back to its stage's generic label, which
    // loses to the specific label already on screen.
    h.bus.publish('agent.tool', { percent: 5 });
    expect(h.agg.model().activity).toBe('running npm test');
    h.bus.publish('agent.tool', { percent: 5, detail: 'generating component xyz' });
    expect(h.agg.model().activity).toBe('generating component xyz');

    // HIL pause overrides everything, whatever is on the stage (spec step 4).
    h.pub('agent', 'awaiting_hil');
    expect(h.agg.model().activity).toBe(AWAITING_APPROVAL);
    // ...and the pause is released on resume, back to the label that was showing.
    h.pub('agent', 'running');
    expect(h.agg.model().activity).toBe('generating component xyz');
    // A blocked stage reports the same thing, and the stage keeps its percent.
    h.pub('sandbox', 'blocked');
    expect(h.agg.model().activity).toBe(AWAITING_APPROVAL);

    // A whitespace-only detail is not a label.
    const blank = harness();
    blank.pub('deps', 'running');
    expect(blank.agg.model().activity).toBe('merging dependencies');
    blank.bus.publish('deps.merged', { detail: '   ' });
    expect(blank.agg.model().activity).toBe('merging dependencies');
  });
});
