// P-242 — Orchestration: progress aggregation.
//
// One stable, throttled progress model, reduced from the noisy event spine (P-241).
// The CLI progress view (P-199) and the web ThinkingStream (P-216) render THIS, via
// the WS bridge, so the shape is a contract and the numbers have to be trustworthy.
//
// The handoff is blunt about the stakes: "a lying ETA erodes trust". Three rules
// exist to keep this module honest, and each one is a decision rather than an
// accident:
//
//   1. IT NEVER INVENTS A NUMBER. Before any work has been observed there is no
//      throughput to extrapolate from, so the ETA is `undefined` rather than a
//      guess. An absent estimate is honest; a fabricated one is worse than none.
//   2. WEIGHTS ARE NORMALISED OVER THE ACTIVE STAGES. The phase's own example
//      weights (deps .15, agent .40, sandbox .30, provenance .10) sum to 0.95, so a
//      naive `Σ weight·percent` can never reach 100% and a finished stitch would
//      report 95%. Normalising over the stages still in play is also exactly what
//      makes a skipped stage's weight redistribute (step 4) instead of leaving a
//      permanent hole in the bar.
//   3. IT EMITS ON STAGE CHANGE AND AT MOST EVERY `cadenceMs` OTHERWISE, and never
//      twice for an unchanged model. That is the "no flicker" requirement: a bar
//      that repaints an identical frame is noise, and a bar that misses a stage
//      change is useless.
//
// The stage vocabulary is taken from the pipeline itself (`PIPELINE_STAGES`), not
// from the phase's four illustrative names, because the aggregator reduces the very
// events the pipeline emits.

import { err, ok, type Result } from 'neverthrow';
import {
  PIPELINE_STAGES,
  STAGE_STATUSES,
  isSettledStatus,
  type PipelineStage,
  type StageStatus,
} from '../pipeline/states.js';
import type { StitchError } from '../result/index.js';
import type { Bus, Unsubscribe } from './bus.js';
import type { ProgressPayload, Topic } from './topics.js';

// ---------------------------------------------------------------------------
// The vocabulary
// ---------------------------------------------------------------------------

/**
 * How much a stage counts toward the overall bar.
 *
 * The four large weights are the phase's example values verbatim; the remaining
 * five are small so they cannot distort the four that dominate. The sum (1.12) is
 * deliberately NOT 1: {@link ProgressAggregator.model} normalises over the active
 * stages, so an absolute unit sum is neither required nor assumed.
 */
export const DEFAULT_STAGE_WEIGHTS: Readonly<Record<PipelineStage, number>> = {
  config: 0.02,
  sources: 0.03,
  selection: 0.05,
  deps: 0.15,
  licenses: 0.05,
  agent: 0.4,
  sandbox: 0.3,
  provenance: 0.1,
  finalize: 0.02,
};

/** The human label for a stage that has no more specific activity to show. */
export const DEFAULT_STAGE_LABELS: Readonly<Record<PipelineStage, string>> = {
  config: 'preparing configuration',
  sources: 'fetching sources',
  selection: 'selecting files',
  deps: 'merging dependencies',
  licenses: 'checking licenses',
  agent: 'running the agent',
  sandbox: 'verifying in a sandbox',
  provenance: 'recording provenance',
  finalize: 'finalising',
};

/** The coarse grouping a stage belongs to, for `overall.phase`. */
export const STAGE_PHASES: Readonly<Record<PipelineStage, string>> = {
  config: 'setup',
  sources: 'setup',
  selection: 'setup',
  deps: 'integrate',
  licenses: 'integrate',
  agent: 'integrate',
  sandbox: 'verify',
  provenance: 'attest',
  finalize: 'attest',
};

/** Which stage each contributing topic reports progress for. */
export const STAGE_FOR_TOPIC: Readonly<Record<string, PipelineStage>> = {
  'agent.tool': 'agent',
  'agent.reasoning': 'agent',
  'deps.merged': 'deps',
  'sandbox.run': 'sandbox',
  'license.verdict': 'licenses',
};

/** The label shown while a human decision is outstanding (spec step 4). */
export const AWAITING_APPROVAL = 'awaiting approval';

/** Default emission cadence. Fast enough to feel live, slow enough not to flicker. */
export const DEFAULT_CADENCE_MS = 200;

/** Default ceiling on a reported ETA, so a slow first tick cannot claim days. */
export const DEFAULT_MAX_ETA_MS = 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// The model
// ---------------------------------------------------------------------------

/** One stage's slice of the model. */
export interface StageProgress {
  id: PipelineStage;
  label: string;
  /** 0–100. Monotonic within a stage: it never goes backwards on a retry. */
  percent: number;
  status: StageStatus;
}

/** The single number and its context. */
export interface OverallProgress {
  percent: number;
  /** Absent until there is throughput to extrapolate from. Never fabricated. */
  etaMs?: number;
  phase: string;
}

/** What a consumer renders. */
export interface ProgressModel {
  jobId: string;
  overall: OverallProgress;
  stages: StageProgress[];
  activity: string;
}

/** A candidate activity label and how much it is worth. */
export interface ActivityLabel {
  text: string;
  /**
   * A specific label names what is actually happening ("installing deps npm"); a
   * generic one only names the stage. A specific label is never overwritten by a
   * generic one, which is what keeps the line informative instead of stale.
   */
  specific: boolean;
}

/** Everything the aggregator needs. */
export interface ProgressAggregatorOptions {
  bus: Bus;
  jobId: string;
  weights?: Partial<Record<PipelineStage, number>>;
  labels?: Partial<Record<PipelineStage, string>>;
  cadenceMs?: number;
  maxEtaMs?: number;
  /** Clock in epoch milliseconds, injectable so the tests are deterministic. */
  now?: () => number;
}

// ---------------------------------------------------------------------------
// Validation — the only fallible entry point
// ---------------------------------------------------------------------------

function isPipelineStage(value: unknown): value is PipelineStage {
  return typeof value === 'string' && (PIPELINE_STAGES as readonly string[]).includes(value);
}

function isStageStatus(value: unknown): value is StageStatus {
  return typeof value === 'string' && (STAGE_STATUSES as readonly string[]).includes(value);
}

/**
 * Reject anything that would make the model unusable.
 *
 * This is a trust boundary, not a formality: P-243 will feed these weights in from
 * per-job config, and a NaN weight would silently corrupt every number on screen.
 * So it returns a `Result` and reuses the existing `CONFIG_ERROR` code rather than
 * inventing a new one.
 */
export function validateProgressOptions(
  options: ProgressAggregatorOptions
): Result<void, StitchError> {
  if (typeof options.jobId !== 'string' || options.jobId.length === 0) {
    return err({
      code: 'CONFIG_ERROR',
      field: 'jobId',
      message: 'jobId must be a non-empty string',
    });
  }
  const cadence = options.cadenceMs;
  if (cadence !== undefined && (!Number.isFinite(cadence) || cadence <= 0)) {
    return err({
      code: 'CONFIG_ERROR',
      field: 'cadenceMs',
      message: 'cadenceMs must be a finite number greater than zero',
    });
  }
  const maxEta = options.maxEtaMs;
  if (maxEta !== undefined && (!Number.isFinite(maxEta) || maxEta < 0)) {
    return err({
      code: 'CONFIG_ERROR',
      field: 'maxEtaMs',
      message: 'maxEtaMs must be a finite number that is not negative',
    });
  }
  for (const [stage, weight] of Object.entries(options.weights ?? {})) {
    if (typeof weight !== 'number' || !Number.isFinite(weight) || weight < 0) {
      return err({
        code: 'CONFIG_ERROR',
        field: `weights.${stage}`,
        message: 'a stage weight must be a finite number that is not negative',
      });
    }
  }
  return ok(undefined);
}

// ---------------------------------------------------------------------------
// The aggregator
// ---------------------------------------------------------------------------

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

/** A stable projection of a model, for "did anything actually change?". */
function signatureOf(model: ProgressModel): string {
  const stages = model.stages.map(s => `${s.id}:${s.status}:${s.percent}`).join('|');
  // `etaMs` is deliberately EXCLUDED: it moves with the clock on every tick, and
  // letting it count as a change would defeat the flicker guard entirely.
  return `${model.overall.percent}|${model.overall.phase}|${model.activity}|${stages}`;
}

function readPercent(payload: Record<string, unknown>): number | undefined {
  const raw = payload['percent'];
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined;
}

function readDetail(payload: Record<string, unknown>): string | undefined {
  const raw = payload['detail'];
  return typeof raw === 'string' && raw.trim().length > 0 ? raw : undefined;
}

/**
 * The best label an event can offer.
 *
 * A payload `detail` is what the producer actually saw happening, so it is
 * specific. Everything else is the stage's generic name. `undefined` means the
 * event says nothing about activity and must not touch the current label.
 */
function describeActivity(
  payload: Record<string, unknown>,
  stage: PipelineStage,
  labels: Readonly<Record<PipelineStage, string>>
): ActivityLabel {
  const detail = readDetail(payload);
  return detail !== undefined
    ? { text: detail, specific: true }
    : { text: labels[stage], specific: false };
}

/**
 * Reduce raw bus events into one progress model, and publish it on `progress`.
 *
 * Construct through {@link createProgressAggregator} so the options are validated;
 * the constructor is private so an unvalidated instance cannot exist.
 */
export class ProgressAggregator {
  readonly #bus: Bus;
  readonly #jobId: string;
  readonly #weights: Readonly<Record<PipelineStage, number>>;
  readonly #labels: Readonly<Record<PipelineStage, string>>;
  readonly #cadenceMs: number;
  readonly #maxEtaMs: number;
  readonly #now: () => number;

  readonly #statuses = new Map<PipelineStage, StageStatus>();
  readonly #percents = new Map<PipelineStage, number>();
  #activity: ActivityLabel | undefined;
  #startedAt: number | undefined;
  #lastEmitAt: number | undefined;
  #lastSignature: string | undefined;
  #emitted = 0;
  #offs: Unsubscribe[] = [];

  private constructor(options: ProgressAggregatorOptions) {
    this.#bus = options.bus;
    this.#jobId = options.jobId;
    this.#weights = { ...DEFAULT_STAGE_WEIGHTS, ...(options.weights ?? {}) };
    this.#labels = { ...DEFAULT_STAGE_LABELS, ...(options.labels ?? {}) };
    this.#cadenceMs = options.cadenceMs ?? DEFAULT_CADENCE_MS;
    this.#maxEtaMs = options.maxEtaMs ?? DEFAULT_MAX_ETA_MS;
    this.#now = options.now ?? (() => Date.now());
    for (const stage of PIPELINE_STAGES) {
      this.#statuses.set(stage, 'pending');
      this.#percents.set(stage, 0);
    }
  }

  /** Build an aggregator from validated options. */
  static create(options: ProgressAggregatorOptions): Result<ProgressAggregator, StitchError> {
    return validateProgressOptions(options).map(() => new ProgressAggregator(options));
  }

  /**
   * Subscribe to the contributing topics.
   *
   * Idempotent: a second call is a no-op, so a caller that starts twice cannot end
   * up double-counting every event.
   */
  start(): void {
    if (this.#offs.length > 0) return;
    const onStage = this.#bus.subscribe('pipeline.stage', payload => {
      this.#onStage(payload);
    });
    // The group topics are subscribed by WILDCARD, per the phase: if a future
    // `sandbox.*` topic is added it is aggregated without editing this file. The
    // payload is narrowed once, here at the boundary.
    const groups: string[] = ['agent.tool', 'agent.reasoning', 'deps.*', 'sandbox.*', 'license.*'];
    const onGroups = groups.map(pattern =>
      this.#bus.subscribe(pattern, (payload, envelope) => {
        this.#onGroup(envelope.topic, payload as Record<string, unknown>);
      })
    );
    this.#offs = [onStage, ...onGroups];
  }

  /** Detach every subscription. Idempotent. */
  stop(): void {
    for (const off of this.#offs) off();
    this.#offs = [];
  }

  /** The current model. Always live, whether or not an event has been emitted. */
  model(nowMs = this.#now()): ProgressModel {
    const stages: StageProgress[] = PIPELINE_STAGES.map(id => ({
      id,
      label: this.#labels[id],
      percent: this.#percents.get(id) ?? 0,
      status: this.#statuses.get(id) ?? 'pending',
    }));

    const active = stages.filter(s => s.status !== 'skipped');
    const totalWeight = active.reduce((sum, s) => sum + this.#weights[s.id], 0);
    let percent: number;
    if (totalWeight > 0) {
      const weighted = active.reduce((sum, s) => sum + this.#weights[s.id] * s.percent, 0);
      percent = Math.round(weighted / totalWeight);
    } else {
      // Every active stage weighs nothing: nothing can be measured, so the bar is
      // only complete when there is genuinely nothing left to do.
      percent = active.every(s => isSettledStatus(s.status)) ? 100 : 0;
    }

    const paused = stages.some(s => s.status === 'awaiting_hil' || s.status === 'blocked');

    const overall: OverallProgress = {
      percent: clampPercent(percent),
      phase: this.#phaseFor(stages),
    };
    const etaMs = this.#etaFor(overall.percent, nowMs);
    if (etaMs !== undefined) overall.etaMs = etaMs;

    return {
      jobId: this.#jobId,
      overall,
      stages,
      activity: paused
        ? AWAITING_APPROVAL
        : (this.#activity?.text ?? this.#labels[this.#currentStage()]),
    };
  }

  /**
   * Emit if due. `force` is for a stage change, which must never be swallowed by
   * the throttle. Returns whether anything was published.
   */
  tick(force = false): boolean {
    return this.#maybeEmit(force);
  }

  /** How many `progress` events have been published. */
  get emitted(): number {
    return this.#emitted;
  }

  // -- internals ------------------------------------------------------------

  #onStage(payload: { stage: string; from: string; to: string }): void {
    if (!isPipelineStage(payload.stage) || !isStageStatus(payload.to)) return;
    this.#noteStart();
    this.#statuses.set(payload.stage, payload.to);
    if (payload.to === 'passed' || payload.to === 'skipped') this.#percents.set(payload.stage, 100);
    // A stage change is a structural milestone: always emit, and let the generic
    // stage label show only when nothing more specific is current.
    this.#offerActivity({ text: this.#labels[payload.stage], specific: false });
    this.#maybeEmit(true);
  }

  #onGroup(topic: Topic, payload: Record<string, unknown>): void {
    const stage = STAGE_FOR_TOPIC[topic];
    if (stage === undefined) return;
    this.#noteStart();
    const percent = readPercent(payload);
    // Monotonic within a stage: a retry that reports a lower fraction must not walk
    // the bar backwards.
    if (percent !== undefined) {
      const next = clampPercent(percent);
      this.#percents.set(stage, Math.max(this.#percents.get(stage) ?? 0, next));
    }
    this.#offerActivity(describeActivity(payload, stage, this.#labels));
    this.#maybeEmit(false);
  }

  #offerActivity(candidate: ActivityLabel): void {
    const current = this.#activity;
    if (current !== undefined && current.specific && !candidate.specific) return;
    this.#activity = candidate;
  }

  #noteStart(): void {
    if (this.#startedAt === undefined) this.#startedAt = this.#now();
  }

  /**
   * The stage the run is currently on: the EARLIEST stage still unresolved.
   *
   * Scanning from the front (not the back) is what makes `overall.phase` and the
   * emitted `progress.stage` describe where the pipeline IS, rather than naming the
   * last thing that happens to be unfinished — which is what the first version did,
   * and it reported `attest` while the agent was still running.
   */
  #currentStage(): PipelineStage {
    for (const stage of PIPELINE_STAGES) {
      if (!isSettledStatus(this.#statuses.get(stage) ?? 'pending')) return stage;
    }
    return 'finalize';
  }

  #phaseFor(stages: readonly StageProgress[]): string {
    if (stages.every(s => isSettledStatus(s.status))) return 'done';
    return STAGE_PHASES[this.#currentStage()];
  }

  #etaFor(percent: number, nowMs: number): number | undefined {
    if (percent >= 100) return 0;
    if (percent <= 0 || this.#startedAt === undefined) return undefined;
    // Elapsed is clamped at zero so a clock that moves backwards cannot produce a
    // negative estimate.
    const elapsed = Math.max(0, nowMs - this.#startedAt);
    const raw = Math.round((elapsed * (100 - percent)) / percent);
    return Math.max(0, Math.min(this.#maxEtaMs, raw));
  }

  #maybeEmit(force: boolean): boolean {
    const nowMs = this.#now();
    const model = this.model(nowMs);
    const signature = signatureOf(model);
    if (!force) {
      if (this.#lastEmitAt !== undefined && nowMs - this.#lastEmitAt < this.#cadenceMs)
        return false;
      if (this.#lastSignature === signature) return false;
    }
    this.#lastEmitAt = nowMs;
    this.#lastSignature = signature;
    this.#emitted += 1;
    this.#bus.publish('progress', toPayload(model, this.#currentStage()));
    return true;
  }
}

/** The model as a `progress` event, which is what the WS bridge forwards. */
function toPayload(model: ProgressModel, stage: PipelineStage): ProgressPayload {
  const payload: ProgressPayload = {
    stage,
    percent: model.overall.percent,
    detail: model.activity,
    overall: model.overall.percent,
    phase: model.overall.phase,
  };
  if (model.overall.etaMs !== undefined) payload.etaMs = model.overall.etaMs;
  return payload;
}

/** Build a validating aggregator. The one fallible entry point. */
export function createProgressAggregator(
  options: ProgressAggregatorOptions
): Result<ProgressAggregator, StitchError> {
  return ProgressAggregator.create(options);
}
