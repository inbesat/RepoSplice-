// P-238 — pipeline state machine tests.
//
// The machine is pure plus injected handlers, so every scenario runs with no repo,
// no daemon and no network: what is under test is the LAW (which moves are legal),
// the SEQUENCING (nine stages in order) and the three outcomes (completed, paused,
// failed) — plus that a second `run` call RESUMES rather than restarts.
//
// The four required scenarios from the phase spec:
//
//   it('happy path')                it('rejects illegal transition')
//   it('blocks and resumes')        it('fails then retries')

import { describe, it, expect } from 'vitest';
import {
  PIPELINE_STAGES,
  STAGE_STATUSES,
  TRANSITIONS,
  canTransition,
  initialRecords,
  isPausedStatus,
  isTerminalStatus,
  nextStage,
  pendingRecord,
  stageOrder,
  type PipelineStage,
} from '../states.js';
import {
  PipelineStateMachine,
  resumePoint,
  type PipelineEvent,
  type StageCache,
  type StageOutcome,
  type StageHandler,
} from '../stateMachine.js';
import { runPipeline, summarise } from '../runPipeline.js';

const TS = '2026-10-16T00:00:00.000Z';

/** A handler map where every stage passes. */
function allPassing(): Partial<Record<PipelineStage, StageHandler>> {
  const handlers: Partial<Record<PipelineStage, StageHandler>> = {};
  for (const stage of PIPELINE_STAGES) handlers[stage] = async () => ({ status: 'passed' });
  return handlers;
}

/** A machine over the given handlers, with a fixed clock. */
function machine(
  handlers: Partial<Record<PipelineStage, StageHandler>> = allPassing(),
  extra: { emit?: (e: PipelineEvent) => void; cache?: StageCache; maxAttempts?: number } = {}
): PipelineStateMachine {
  return new PipelineStateMachine({
    handlers,
    now: () => TS,
    ...(extra.emit !== undefined ? { emit: extra.emit } : {}),
    ...(extra.cache !== undefined ? { cache: extra.cache } : {}),
    ...(extra.maxAttempts !== undefined ? { maxAttempts: extra.maxAttempts } : {}),
  });
}

describe('P-238 pipeline state machine', () => {
  it('happy path', async () => {
    // The vocabulary is what the rest of the plan references.
    expect([...PIPELINE_STAGES]).toEqual([
      'config',
      'sources',
      'selection',
      'deps',
      'licenses',
      'agent',
      'sandbox',
      'provenance',
      'finalize',
    ]);
    expect([...STAGE_STATUSES]).toEqual([
      'pending',
      'running',
      'passed',
      'skipped',
      'failed',
      'blocked',
      'awaiting_hil',
    ]);
    expect(initialRecords()).toHaveLength(9);
    expect(PIPELINE_STAGES.every(stage => initialRecords().some(r => r.stage === stage))).toBe(
      true
    );
    expect(nextStage('config')).toBe('sources');
    expect(nextStage('finalize')).toBeUndefined();
    expect(stageOrder('finalize')).toBe(8);

    const order: PipelineStage[] = [];
    const events: PipelineEvent[] = [];
    const handlers: Partial<Record<PipelineStage, StageHandler>> = {};
    for (const stage of PIPELINE_STAGES) {
      handlers[stage] = async ctx => {
        order.push(ctx.stage);
        return { status: 'passed', meta: { n: ctx.attempt } };
      };
    }

    const ran = await machine(handlers, { emit: e => events.push(e) }).run({
      jobs: 4,
      offline: true,
    });
    expect(ran.isOk()).toBe(true);
    if (ran.isErr()) return;

    // Nine stages, in order, all passed.
    expect(ran.value.outcome).toBe('completed');
    expect(ran.value.stoppedAt).toBeUndefined();
    expect(order).toEqual([...PIPELINE_STAGES]);
    expect(ran.value.records.every(record => record.status === 'passed')).toBe(true);
    expect(ran.value.records.every(record => record.attempts === 1)).toBe(true);
    expect(
      ran.value.records.every(record => record.startedAt === TS && record.finishedAt === TS)
    ).toBe(true);
    expect(summarise(ran.value.records)).toEqual({ passed: 9 });

    // Every transition was announced, and they alternate pending→running→passed.
    expect(events).toHaveLength(18);
    expect(events[0]).toEqual({
      type: 'stage:transition',
      stage: 'config',
      from: 'pending',
      to: 'running',
      at: TS,
    });
    expect(events[1]).toEqual({
      type: 'stage:transition',
      stage: 'config',
      from: 'running',
      to: 'passed',
      at: TS,
    });
    expect(events.at(-1)?.stage).toBe('finalize');
    expect(events.at(-1)?.to).toBe('passed');

    // Policies reach the handlers (P-204's --jobs, P-146's --offline).
    const seen: { offline: boolean; jobs: number }[] = [];
    const policy: Partial<Record<PipelineStage, StageHandler>> = {
      config: async ctx => {
        seen.push({ offline: ctx.offline, jobs: ctx.jobs });
        return { status: 'passed' };
      },
    };
    await machine(policy).run({ offline: true, jobs: 4 });
    expect(seen[0]).toEqual({ offline: true, jobs: 4 });

    // A stage with no handler is a deliberate SKIP, not a failure.
    const partial = await machine({ config: async () => ({ status: 'passed' }) }).run();
    if (partial.isOk()) expect(summarise(partial.value.records)).toEqual({ passed: 1, skipped: 8 });

    // `runPipeline` is the same machine plus the composition contract.
    const piped = await runPipeline({
      handlers: allPassing(),
      now: () => TS,
      commitTarget: '/tmp/c',
    });
    expect(piped.isOk()).toBe(true);
    if (piped.isOk()) {
      expect(piped.value.outcome).toBe('completed');
      expect(piped.value.commitTarget).toBe('/tmp/c');
    }
  });

  it('rejects illegal transition', async () => {
    const m = machine();

    // Every legal move in the table is allowed…
    for (const from of STAGE_STATUSES) {
      for (const to of STAGE_STATUSES) {
        expect(canTransition(from, to)).toBe(TRANSITIONS[from].includes(to));
      }
    }
    // …and the table itself is the law: terminal statuses go nowhere, and a
    // pending stage cannot jump straight to a verdict.
    expect(isTerminalStatus('passed')).toBe(true);
    expect(isTerminalStatus('skipped')).toBe(true);
    expect(isTerminalStatus('running')).toBe(false);
    expect(isPausedStatus('blocked') && isPausedStatus('awaiting_hil')).toBe(true);
    expect(canTransition('pending', 'passed')).toBe(false);
    expect(canTransition('pending', 'running')).toBe(true);

    // The machine ENFORCES it with P-159's typed error, carrying the move.
    const jumped = m.transition('config', 'passed');
    expect(jumped.isErr()).toBe(true);
    if (jumped.isErr()) {
      expect(jumped.error.code).toBe('ILLEGAL_TRANSITION');
      if (jumped.error.code === 'ILLEGAL_TRANSITION') {
        expect(jumped.error.from).toBe('pending');
        expect(jumped.error.to).toBe('passed');
      }
    }

    // A finished stage is terminal: no re-entry without an explicit reset.
    expect(m.transition('config', 'running').isOk()).toBe(true);
    expect(m.transition('config', 'passed').isOk()).toBe(true);
    const reopen = m.transition('config', 'running');
    expect(reopen.isErr()).toBe(true);
    if (reopen.isErr()) expect(reopen.error.code).toBe('ILLEGAL_TRANSITION');

    // An unknown stage is an internal error, not a silent no-op.
    const bogus = m.transition('nope' as PipelineStage, 'running');
    expect(bogus.isErr()).toBe(true);
    if (bogus.isErr()) expect(bogus.error.code).toBe('INTERNAL');

    // A corrupt resume cannot move an illegal way either — the run reports it.
    const corrupt = new PipelineStateMachine({
      handlers: {},
      records: [{ ...pendingRecord('config'), status: 'passed' }, ...initialRecords().slice(1)],
    });
    expect(corrupt.record('config')?.status).toBe('passed');
    expect(resumePoint(corrupt.records())).toBe('sources');
    expect(resumePoint(initialRecords())).toBe('config');
  });

  it('blocks and resumes', async () => {
    // `licenses` waits for a verdict the FIRST time and clears the second — the
    // HIL/licence pause (P-160) this phase must support.
    let licenceAttempts = 0;
    const handlers: Partial<Record<PipelineStage, StageHandler>> = {
      ...allPassing(),
      licenses: async (): Promise<StageOutcome> => {
        licenceAttempts += 1;
        return licenceAttempts === 1
          ? { status: 'blocked', error: 'awaiting licence verdict' }
          : { status: 'passed' };
      },
    };
    const m = machine(handlers);

    const first = await m.run();
    expect(first.isOk()).toBe(true);
    if (first.isErr()) return;
    // PAUSED at the licence stage — reported, not thrown.
    expect(first.value.outcome).toBe('paused');
    expect(first.value.stoppedAt).toBe('licenses');
    expect(m.record('licenses')?.status).toBe('blocked');
    expect(m.record('licenses')?.lastError).toBe('awaiting licence verdict');
    // The earlier stages stayed settled, so the resume is cheap.
    expect(m.record('config')?.status).toBe('passed');
    expect(m.record('licenses')?.attempts).toBe(1);

    // A second `run` RESUMES at that stage: same call, no separate code path.
    const resumed = await m.run();
    expect(resumed.isOk()).toBe(true);
    if (resumed.isOk()) {
      expect(resumed.value.outcome).toBe('completed');
      expect(m.record('licenses')?.status).toBe('passed');
      expect(m.record('licenses')?.attempts).toBe(2);
      // `blocked → running` was the legal re-entry.
      expect(TRANSITIONS['blocked']).toContain('running');
    }

    // `awaiting_hil` pauses identically, and the re-entry is legal from there too.
    expect(TRANSITIONS['awaiting_hil']).toContain('running');
    let hilAttempts = 0;
    const hil = machine(
      {
        ...allPassing(),
        agent: async (): Promise<StageOutcome> => {
          hilAttempts += 1;
          return hilAttempts === 1
            ? { status: 'awaiting_hil', error: 'awaiting approval' }
            : { status: 'passed' };
        },
      },
      { maxAttempts: 2 }
    );
    const hilPaused = await hil.run();
    expect(hilPaused.isOk()).toBe(true);
    if (hilPaused.isOk()) {
      expect(hilPaused.value.outcome).toBe('paused');
      expect(hilPaused.value.stoppedAt).toBe('agent');
    }
    expect(hil.record('agent')?.status).toBe('awaiting_hil');
    const hilResumed = await hil.run();
    if (hilResumed.isOk()) {
      expect(hilResumed.value.outcome).toBe('completed');
      expect(hil.record('agent')?.status).toBe('passed');
    }
  });

  it('fails then retries', async () => {
    // Fails once, passes on the retry — recoverable re-entry, not terminal.
    let flakyAttempts = 0;
    const flaky: Partial<Record<PipelineStage, StageHandler>> = {
      ...allPassing(),
      deps: async (ctx): Promise<StageOutcome> => {
        flakyAttempts += 1;
        return ctx.attempt < 2 ? { status: 'failed', error: 'transient' } : { status: 'passed' };
      },
    };
    const m = machine(flaky, { maxAttempts: 2 });
    const ran = await m.run();
    expect(ran.isOk()).toBe(true);
    if (ran.isErr()) return;
    expect(ran.value.outcome).toBe('completed');
    expect(flakyAttempts).toBe(2);
    expect(m.record('deps')?.attempts).toBe(2);
    expect(m.record('deps')?.status).toBe('passed');
    // The failure is still on the record — a retry does not erase the evidence.
    expect(m.record('deps')?.lastError).toBe('transient');

    // A stage that always fails ends `failed` with the stage reported, and the
    // run is still `ok`: a red pipeline is a RESULT, not an exception.
    const always: Partial<Record<PipelineStage, StageHandler>> = {
      ...allPassing(),
      sandbox: async () => ({ status: 'failed', error: 'build red' }),
    };
    const hard = machine(always, { maxAttempts: 2 });
    const stopped = await hard.run();
    expect(stopped.isOk()).toBe(true);
    if (stopped.isErr()) return;
    expect(stopped.value.outcome).toBe('failed');
    expect(stopped.value.stoppedAt).toBe('sandbox');
    expect(hard.record('sandbox')?.status).toBe('failed');
    expect(hard.record('sandbox')?.attempts).toBe(2);
    expect(hard.record('sandbox')?.lastError).toBe('build red');
    // Later stages never ran.
    expect(hard.record('provenance')?.status).toBe('pending');

    // The cache seam: a hit REUSES a stage instead of re-running it (P-250).
    let ranConfig = 0;
    const cache: StageCache = { has: stage => stage === 'config' };
    const cached = machine(
      {
        config: async () => {
          ranConfig += 1;
          return { status: 'passed' };
        },
      },
      { cache }
    );
    const reused = await cached.run();
    if (reused.isOk()) {
      expect(reused.value.outcome).toBe('completed');
      expect(ranConfig).toBe(0);
      expect(cached.record('config')?.status).toBe('skipped');
      expect(cached.record('config')?.meta['cached']).toBe(true);
    }
  });
});
