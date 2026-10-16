// P-244 — dry-run tests.
//
// A dry run is a claim about ABSENCE: nothing was written. So these tests assert
// the negative directly rather than inferring it — the caller's `finalize` handler
// must never be invoked, `plan.finalized` must be false, and the writer sink must
// stay empty. A dry run that quietly wrote would be the worst possible failure, so
// the assertions are about what did NOT happen.
//
// The five required scenarios from the phase spec, plus the step-4 event:
//
//   it('skips finalize')  it('no generation')  it('builds plan')
//   it('no side effects')                       it('plan json')
//   it('emits job.dry-run-plan')

import { describe, it, expect, vi } from 'vitest';
import { defaultConfig } from '../config/schema.js';
import { Bus } from '../events/bus.js';
import type { JobDryRunPlanPayload } from '../events/topics.js';
import { resolveJobConfig, type JobConfig } from '../jobs/jobConfig.js';
import {
  buildDryRunPlan,
  dryRunAllowsGeneration,
  dryRunPlanJson,
  emitDryRunPlan,
} from './dryRun.js';
import { runPipeline } from './runPipeline.js';
import type { StageHandler, StageOutcome } from './stateMachine.js';
import { PIPELINE_STAGES } from './states.js';

/** A resolved config for `job-244`, dry-run on or off. */
function cfgFor(dryRun: boolean): JobConfig {
  const result = resolveJobConfig({
    project: defaultConfig,
    jobId: 'job-244',
    flags: { outDir: 'stitch-out', ai: { provider: 'openrouter' }, flags: { dryRun } },
  });
  if (result.isErr()) throw new Error(`fixture config failed: ${result.error.code}`);
  return result.value;
}

/** A stage that passes, recording why for the plan. */
function passingHandler(meta: Record<string, unknown> = {}): StageHandler {
  return async () => ({ status: 'passed', meta });
}

describe('P-244 dry run', () => {
  it('skips finalize', async () => {
    const cfg = cfgFor(true);
    const finalize = vi.fn(async (): Promise<StageOutcome> => ({ status: 'passed' }));

    const run = await runPipeline({ cfg, handlers: { finalize } });
    expect(run.isOk()).toBe(true);
    const result = run._unsafeUnwrap();

    const finalizeRecord = result.records.find(record => record.stage === 'finalize');
    expect(finalizeRecord?.status).toBe('skipped');
    expect(finalizeRecord?.meta.reason).toBe('dry-run');
    // The caller's own writer is never reached, so C cannot be written.
    expect(finalize).not.toHaveBeenCalled();
    expect(result.outcome).toBe('completed');
  });

  it('no generation', async () => {
    // The rule, asserted directly: a dry run cannot generate.
    expect(dryRunAllowsGeneration(cfgFor(true))).toBe(false);
    expect(dryRunAllowsGeneration(cfgFor(false))).toBe(true);

    // And the instruction reaches the stage: the agent sees `ctx.dryRun`.
    let seenDryRun: boolean | undefined;
    const agent: StageHandler = async ctx => {
      seenDryRun = ctx.dryRun;
      return { status: 'passed' };
    };
    await runPipeline({ cfg: cfgFor(true), handlers: { agent } });
    expect(seenDryRun).toBe(true);
  });

  it('builds plan', async () => {
    const cfg = cfgFor(true);
    const run = await runPipeline({
      cfg,
      handlers: {
        deps: passingHandler({ conflicts: 1 }),
        licenses: passingHandler({ verdict: 'allow' }),
        agent: passingHandler({
          // A well-formed op, an empty path and an unknown op: the last two must be
          // dropped, because this feeds a UI that shows the user what would happen.
          proposedOps: [
            { path: 'src/a.ts', op: 'create', rationale: 'needed by b' },
            { path: '', op: 'create' },
            { path: 'src/b.ts', op: 'bogus' },
          ],
          diffs: { 'src/a.ts': '+export const a = 1;' },
        }),
        sandbox: passingHandler({ build: 'pass' }),
        provenance: passingHandler({ credits: 'CREDITS.md' }),
      },
    });
    expect(run.isOk()).toBe(true);

    const plan = buildDryRunPlan(cfg, run._unsafeUnwrap());
    expect(plan.jobId).toBe('job-244');
    expect(plan.outDir).toBe('stitch-out');
    // Every stage is represented, so a reader sees the whole run even where nothing ran.
    expect(plan.stages.map(stage => stage.stage)).toEqual([...PIPELINE_STAGES]);
    expect(plan.proposedOps).toEqual([
      { path: 'src/a.ts', op: 'create', rationale: 'needed by b' },
    ]);
    expect(plan.proposedDiffs).toEqual({ 'src/a.ts': '+export const a = 1;' });
    expect(plan.deps).toEqual({ conflicts: 1 });
    expect(plan.licenseVerdict).toEqual({ verdict: 'allow' });
    expect(plan.sandboxPreview).toEqual({ build: 'pass' });
    expect(plan.provenancePreview).toEqual({ credits: 'CREDITS.md' });
    // The claim under test: the run did not finalise.
    expect(plan.finalized).toBe(false);
  });

  it('no side effects', async () => {
    // A writer that records any attempt. It must stay empty.
    const written: string[] = [];
    const finalize: StageHandler = async () => {
      written.push('stitch-out');
      return { status: 'passed' };
    };

    const cfg = cfgFor(true);
    const run = await runPipeline({
      cfg,
      handlers: { agent: passingHandler({ proposedOps: [] }), finalize },
    });
    const plan = buildDryRunPlan(cfg, run._unsafeUnwrap());

    expect(written).toEqual([]);
    expect(plan.finalized).toBe(false);

    // A REAL run still finalises — the swap is conditional, not a global change.
    const realWritten: string[] = [];
    const realFinalize: StageHandler = async () => {
      realWritten.push('stitch-out');
      return { status: 'passed' };
    };
    await runPipeline({
      cfg: cfgFor(false),
      handlers: { finalize: realFinalize },
    });
    expect(realWritten).toEqual(['stitch-out']);
  });

  it('plan json', async () => {
    const cfg = cfgFor(true);
    const run = await runPipeline({
      cfg,
      handlers: { deps: passingHandler({ a: 1 }), finalize: passingHandler() },
    });
    const plan = buildDryRunPlan(cfg, run._unsafeUnwrap());
    const json = dryRunPlanJson(plan);

    // Deterministic and key-sorted, so two runs' plans are directly comparable.
    expect(json).toBe(dryRunPlanJson(buildDryRunPlan(cfg, run._unsafeUnwrap())));
    expect(json.startsWith('{"deps"')).toBe(true);
    expect(json).toContain('"jobId":"job-244"');
    expect(json).toContain('"finalized":false');
    // Valid JSON, per P-192's `--json` and P-217's proposed-diff endpoint.
    expect(JSON.parse(json)).toMatchObject({ jobId: 'job-244', finalized: false });
  });

  it('emits job.dry-run-plan', async () => {
    const bus = new Bus({ now: () => '2026-10-17T00:00:00.000Z' });
    const cfg = cfgFor(true);
    const run = await runPipeline({ cfg, handlers: { finalize: passingHandler() } });
    const plan = buildDryRunPlan(cfg, run._unsafeUnwrap());

    let received: JobDryRunPlanPayload | undefined;
    bus.subscribe('job.dry-run-plan', payload => {
      received = payload;
    });
    const envelope = emitDryRunPlan(bus, plan);

    expect(envelope.topic).toBe('job.dry-run-plan');
    expect(envelope.sequence).toBe(1);
    expect(received?.jobId).toBe('job-244');
    expect(received?.outDir).toBe('stitch-out');
    expect(received?.plan.finalized).toBe(false);
  });
});
