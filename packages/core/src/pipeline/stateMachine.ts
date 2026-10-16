// P-238 — Orchestration: the pipeline executor.
//
// Drives the nine stages in order, consulting {@link canTransition} for every move
// so the law lives in `states.ts` and nowhere else. Three properties are the whole
// point:
//
//   1. RESUMABLE BY CONSTRUCTION. `run` starts at the first stage that is not
//      already SETTLED, so calling it again after a pause, a failure or a process
//      restart continues where it stopped. No hidden cursor, no separate resume
//      path to keep in sync — the records ARE the cursor. That is what the handoff
//      means by "table-only (no hidden state) so it's testable and resumable".
//   2. A FAILED STAGE IS A RESULT, NOT AN EXCEPTION. Like P-155's failing build, a
//      stage that fails is reported in the returned records; only a genuine defect
//      (an illegal move from a corrupt resume) is an `err`. The caller decides
//      whether a red pipeline is fatal.
//   3. PAUSING IS A FIRST-CLASS OUTCOME. `blocked` / `awaiting_hil` stop the run
//      and report where, so a licence verdict or an HIL approval (P-160) can
//      arrive out-of-band and the same `run` call resumes at that stage.

import { err, ok, type Result } from 'neverthrow';
import { type StitchError } from '../result/index.js';
import {
  canTransition,
  initialRecords,
  nextStage,
  pendingRecord,
  isSettledStatus,
  PIPELINE_STAGES,
  type PipelineStage,
  type StageRecord,
  type StageStatus,
} from './states.js';

/** One transition observation, for the event bus (P-241) and the audit log. */
export interface PipelineEvent {
  type: 'stage:transition';
  stage: PipelineStage;
  from: StageStatus;
  to: StageStatus;
  at: string;
}

/** What a stage handler reports back. It never throws. */
export interface StageOutcome {
  /** `passed` and `skipped` settle the stage; the others pause or fail it. */
  status: 'passed' | 'skipped' | 'blocked' | 'awaiting_hil' | 'failed';
  /** A human-readable reason, recorded on the stage when it does not pass. */
  error?: string;
  /** Free-form detail for the UI, the audit log and the SBOM. */
  meta?: Record<string, unknown>;
}

/** What a stage handler is given. Extendable by the caller per stage. */
export interface PipelineCtx {
  /** The live records — the machine's own state, exposed read-only by contract. */
  readonly records: readonly StageRecord[];
  /** The stage about to run. */
  readonly stage: PipelineStage;
  /** How many times this stage has already started (0 on the first run). */
  readonly attempt: number;
  /** `--offline`: stages must not reach the network. */
  readonly offline: boolean;
  /** `--jobs` (P-204): the caller's concurrency allowance. */
  readonly jobs: number;
  /**
   * P-244: this run is a dry run. Stages must reach a verdict but write NOTHING —
   * no C, no lockfile, and AI in propose-only (P-160). A primitive rather than the
   * `JobConfig` on purpose: `jobs/jobConfig.ts` already imports `pipeline/states.js`,
   * so importing the config back here would close a `jobs → pipeline → jobs` cycle.
   */
  readonly dryRun: boolean;
  /** Cancellation (P-246). */
  readonly signal?: AbortSignal;
}

/** A stage's work. */
export type StageHandler = (ctx: PipelineCtx) => Promise<StageOutcome>;

/**
 * The idempotency seam (step 4).
 *
 * A hit lets a resume REUSE a stage instead of re-running it, which is what makes
 * re-entry cheap. Deliberately just a predicate here: P-250 owns persistence, so
 * this phase depends on the SHAPE and not on the store.
 */
export interface StageCache {
  has(stage: PipelineStage, ctx: PipelineCtx): boolean;
}

/** How a run ended. */
export type PipelineOutcome = 'completed' | 'failed' | 'paused';

/** What a run reports. */
export interface PipelineRunResult {
  records: StageRecord[];
  outcome: PipelineOutcome;
  /** The stage the run stopped at, when it did not complete. */
  stoppedAt?: PipelineStage;
}

/** Options for {@link PipelineStateMachine}. */
export interface PipelineStateMachineOptions {
  /** Handlers by stage. A stage with no handler is `skipped`. */
  handlers: Partial<Record<PipelineStage, StageHandler>>;
  /** Clock, injectable so tests are deterministic. */
  now?: () => string;
  /** Receives every transition (P-241's event bus shape). */
  emit?: (event: PipelineEvent) => void;
  /** Optional idempotency cache. */
  cache?: StageCache;
  /** Total attempts per stage before it is left `failed`. Default 2. */
  maxAttempts?: number;
  /** Starting records, for a resume from persisted state (P-240). */
  records?: readonly StageRecord[];
}

/** A `StitchError` for an illegal move, matching P-159's shape (ADR-032). */
function illegal(from: StageStatus, to: StageStatus, stage: PipelineStage): StitchError {
  return {
    code: 'ILLEGAL_TRANSITION',
    from,
    to,
    message: `pipeline: stage ${stage} cannot move ${from} → ${to}`,
  };
}

/**
 * The deterministic core.
 *
 * Construct with the handlers and drive it with {@link run}; call `run` again to
 * resume after a pause or a failure.
 */
export class PipelineStateMachine {
  readonly #handlers: Partial<Record<PipelineStage, StageHandler>>;
  readonly #now: () => string;
  readonly #emit: ((event: PipelineEvent) => void) | undefined;
  readonly #cache: StageCache | undefined;
  readonly #maxAttempts: number;
  #records: StageRecord[];

  constructor(options: PipelineStateMachineOptions) {
    this.#handlers = options.handlers;
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#emit = options.emit;
    this.#cache = options.cache;
    this.#maxAttempts = Math.max(1, options.maxAttempts ?? 2);
    this.#records =
      options.records !== undefined
        ? options.records.map(record => ({ ...record, meta: { ...record.meta } }))
        : initialRecords();
  }

  /** Every stage record, in pipeline order. */
  records(): StageRecord[] {
    return this.#records.map(record => ({ ...record, meta: { ...record.meta } }));
  }

  /** One stage's record. */
  record(stage: PipelineStage): StageRecord | undefined {
    const found = this.#records.find(record => record.stage === stage);
    return found === undefined ? undefined : { ...found, meta: { ...found.meta } };
  }

  /**
   * Move a stage to a new status, or refuse.
   *
   * The ONLY place a status changes, and it consults the table every time — which
   * is why an illegal move is impossible to perform by accident.
   */
  transition(
    stage: PipelineStage,
    to: StageStatus,
    detail: { error?: string; meta?: Record<string, unknown> } = {}
  ): Result<StageRecord, StitchError> {
    const index = this.#records.findIndex(record => record.stage === stage);
    if (index < 0) {
      return err({ code: 'INTERNAL', message: `pipeline: unknown stage ${stage}` });
    }
    const current = this.#records[index] as StageRecord;
    if (!canTransition(current.status, to)) {
      return err(illegal(current.status, to, stage));
    }

    const at = this.#now();
    const next: StageRecord = {
      ...current,
      status: to,
      ...(to === 'running' ? { attempts: current.attempts + 1, startedAt: at } : {}),
      ...(to === 'passed' || to === 'skipped' || to === 'failed' ? { finishedAt: at } : {}),
      ...(detail.error !== undefined ? { lastError: detail.error } : {}),
      ...(detail.meta !== undefined ? { meta: { ...current.meta, ...detail.meta } } : {}),
    };
    this.#records[index] = next;
    this.#emit?.({ type: 'stage:transition', stage, from: current.status, to, at });
    return ok({ ...next, meta: { ...next.meta } });
  }

  /** The first stage that is not settled, or `undefined` when all are done. */
  #nextUnsettled(): StageRecord | undefined {
    return this.#records.find(record => !isSettledStatus(record.status));
  }

  /** The context handed to a handler. */
  #ctxFor(stage: PipelineStage, attempt: number, overrides: RunOptions): PipelineCtx {
    return {
      records: this.records(),
      stage,
      attempt,
      offline: overrides.offline === true,
      jobs: Math.max(1, overrides.jobs ?? 1),
      dryRun: overrides.dryRun === true,
      ...(overrides.signal !== undefined ? { signal: overrides.signal } : {}),
    };
  }

  /**
   * Run (or RESUME) the pipeline.
   *
   * Stages already `passed` or `skipped` are left alone and the run starts at the
   * first unsettled stage; a stage in `blocked`, `awaiting_hil` or `failed` is
   * re-entered through `running`, which the table allows. Returns a typed error
   * ONLY for an illegal move — a failing stage is reported in the records.
   */
  async run(overrides: RunOptions = {}): Promise<Result<PipelineRunResult, StitchError>> {
    for (;;) {
      const current = this.#nextUnsettled();
      if (current === undefined) {
        return ok({ records: this.records(), outcome: 'completed' });
      }
      const stage = current.stage;

      // Idempotency: a hit reuses the stage instead of re-running it.
      if (
        current.status === 'pending' &&
        this.#cache?.has(stage, this.#ctxFor(stage, 0, overrides)) === true
      ) {
        const reused = this.transition(stage, 'skipped', { meta: { cached: true } });
        if (reused.isErr()) return err(reused.error);
        continue;
      }

      const started = this.transition(stage, 'running');
      if (started.isErr()) return err(started.error);
      const attempt = started.value.attempts;

      const handler = this.#handlers[stage];
      const outcome: StageOutcome =
        handler === undefined
          ? // A stage with no handler is a deliberate skip (a stage not wired yet),
            // NOT a failure: the machine's job is to sequence, not to require.
            { status: 'skipped', meta: { reason: 'no-handler' } }
          : await handler(this.#ctxFor(stage, attempt, overrides));

      if (outcome.status === 'passed' || outcome.status === 'skipped') {
        const settled = this.transition(stage, outcome.status, {
          ...(outcome.meta !== undefined ? { meta: outcome.meta } : {}),
        });
        if (settled.isErr()) return err(settled.error);
        continue;
      }

      if (outcome.status === 'blocked' || outcome.status === 'awaiting_hil') {
        // PAUSE. The run stops here and reports where, so a decision can arrive
        // out-of-band and the next `run` call resumes at this stage.
        const paused = this.transition(stage, outcome.status, {
          ...(outcome.error !== undefined ? { error: outcome.error } : {}),
          ...(outcome.meta !== undefined ? { meta: outcome.meta } : {}),
        });
        if (paused.isErr()) return err(paused.error);
        return ok({ records: this.records(), outcome: 'paused', stoppedAt: stage });
      }

      // Failure. Retry while attempts remain, then leave it failed and stop.
      const failed = this.transition(stage, 'failed', {
        ...(outcome.error !== undefined ? { error: outcome.error } : {}),
        ...(outcome.meta !== undefined ? { meta: outcome.meta } : {}),
      });
      if (failed.isErr()) return err(failed.error);
      if (failed.value.attempts >= this.#maxAttempts) {
        return ok({ records: this.records(), outcome: 'failed', stoppedAt: stage });
      }
      // `failed → running` is legal, so the loop re-enters the same stage.
    }
  }
}

/** Per-run overrides, kept separate from the construction-time wiring. */
export interface RunOptions {
  /** `--offline` (P-146/P-174 respect it). */
  offline?: boolean;
  /** `--jobs` (P-204): the caller's concurrency allowance. */
  jobs?: number;
  /** P-244: run to a verdict but skip `finalize` — nothing is written. */
  dryRun?: boolean;
  /** Cancellation (P-246). */
  signal?: AbortSignal;
}

/** The default handler-free machine — every stage skips. Useful for a dry run. */
export function createPipelineStateMachine(
  options: PipelineStateMachineOptions
): PipelineStateMachine {
  return new PipelineStateMachine(options);
}

/** Reset one stage to `pending` so a caller can deliberately re-run it. */
export function resetStage(records: readonly StageRecord[], stage: PipelineStage): StageRecord[] {
  if (!PIPELINE_STAGES.includes(stage)) return records.map(record => ({ ...record }));
  return records.map(record => (record.stage === stage ? pendingRecord(stage) : { ...record }));
}

/** The stage a record list would resume at, for a caller that wants to know first. */
export function resumePoint(records: readonly StageRecord[]): PipelineStage | undefined {
  return records.find(record => !isSettledStatus(record.status))?.stage ?? nextStage('finalize');
}
