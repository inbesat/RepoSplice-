// P-238 — Orchestration: the pipeline's states and transition table.
//
// The heart of merge execution: one stitch walks nine ordered stages. This module
// owns the VOCABULARY (which stages exist, which statuses a stage can be in) and
// the LAW (which status may become which). Nothing else.
//
// The handoff is explicit about why the law lives here and only here: "keep
// transitions table-only (no hidden state) so it's testable and resumable." A
// state machine whose legality is spread across its executor cannot be resumed
// from a database row, because the row would have to encode the hidden state too.
// So {@link TRANSITIONS} is the single source of truth, {@link canTransition} is
// the only predicate, and the executor merely consults it.

/** The nine stages of a stitch, in execution order. */
export const PIPELINE_STAGES = [
  'config',
  'sources',
  'selection',
  'deps',
  'licenses',
  'agent',
  'sandbox',
  'provenance',
  'finalize',
] as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[number];

/** Every status a stage can hold. */
export const STAGE_STATUSES = [
  'pending',
  'running',
  'passed',
  'skipped',
  'failed',
  'blocked',
  'awaiting_hil',
] as const;

export type StageStatus = (typeof STAGE_STATUSES)[number];

/**
 * The allowed transitions, per current status.
 *
 * Read it as the law rather than as documentation:
 *   - `pending` may START (or be skipped outright, e.g. an optional stage).
 *   - `running` is the only status that may reach a verdict — `passed`, `failed`,
 *     `skipped` — and the only one that may PAUSE (`blocked`, `awaiting_hil`).
 *   - `blocked` / `awaiting_hil` may RESUME into `running`, because a decision
 *     arrived, or be abandoned (`skipped`) or refused (`failed`).
 *   - `failed` may RETRY into `running`, which is what makes a failing stage
 *     recoverable rather than terminal.
 *   - `passed` and `skipped` are TERMINAL: a finished stage is never re-entered
 *     without the caller resetting it deliberately (a resume, P-240, reuses it).
 */
export const TRANSITIONS: Readonly<Record<StageStatus, readonly StageStatus[]>> = {
  pending: ['running', 'skipped'],
  running: ['passed', 'failed', 'skipped', 'blocked', 'awaiting_hil'],
  blocked: ['running', 'skipped', 'failed'],
  awaiting_hil: ['running', 'skipped', 'failed'],
  failed: ['running', 'skipped'],
  passed: [],
  skipped: [],
};

/** Is `from → to` a legal move? */
export function canTransition(from: StageStatus, to: StageStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** The statuses a stage can never leave. */
export function isTerminalStatus(status: StageStatus): boolean {
  return TRANSITIONS[status].length === 0;
}

/** The statuses that mean "the machine is waiting for someone else". */
export function isPausedStatus(status: StageStatus): boolean {
  return status === 'blocked' || status === 'awaiting_hil';
}

/**
 * The statuses that mean a stage needs no further work.
 *
 * `failed` is deliberately NOT one of them: a failed stage is still owed a retry
 * (the table allows `failed → running`), so treating it as settled would let the
 * executor walk PAST a broken stage and report a pipeline that skipped its own
 * failure. The test caught exactly that.
 */
export function isSettledStatus(status: StageStatus): boolean {
  return status === 'passed' || status === 'skipped';
}

/** The index of a stage in execution order (higher = later). */
export function stageOrder(stage: PipelineStage): number {
  return PIPELINE_STAGES.indexOf(stage);
}

/** The stage after this one, or `undefined` at the end of the pipeline. */
export function nextStage(stage: PipelineStage): PipelineStage | undefined {
  return PIPELINE_STAGES[stageOrder(stage) + 1];
}

/** One stage's record. Plain data, so it can be stored and resumed verbatim. */
export interface StageRecord {
  stage: PipelineStage;
  status: StageStatus;
  /** How many times this stage has STARTED; a retry increments it. */
  attempts: number;
  /** The last failure, when the stage failed or is being retried. */
  lastError?: string;
  startedAt?: string;
  finishedAt?: string;
  /** Free-form per-stage detail (counts, paths) for the UI and the audit log. */
  meta: Record<string, unknown>;
}

/** A fresh record for one stage. */
export function pendingRecord(stage: PipelineStage): StageRecord {
  return { stage, status: 'pending', attempts: 0, meta: {} };
}

/** The nine records in order — the pipeline's initial state. */
export function initialRecords(): StageRecord[] {
  return PIPELINE_STAGES.map(pendingRecord);
}
