// P-238 — Orchestration: the pipeline entry point.
//
// Composes the two things a run needs — the STAGE HANDLERS and the per-run
// POLICIES — into one call that drives the state machine and returns a report.
//
// On scope: the phase lists this file as the place that "wires the concrete stages
// to their modules (deps P-113, license P-131, agent P-167, sandbox P-177,
// provenance P-187)". Those handlers are supplied here rather than constructed
// here, and deliberately so: each is a thin adapter over a module whose own
// signature belongs to that module, and the drivers that exist — the merge command
// (P-192), the web server (P-216) and the job queue (P-239) — are where the
// business choice of WHICH modules to wire belongs. What this function owns is the
// composition contract: build the context, drive the machine, report the outcome.
// Wiring five modules blind from here would be guessing at their APIs.

import { err, ok, type Result } from 'neverthrow';
import { type StitchError } from '../result/index.js';
import {
  PipelineStateMachine,
  type PipelineRunResult,
  type RunOptions,
  type StageHandler,
  type StageOutcome,
} from './stateMachine.js';
import type { JobConfig } from '../jobs/jobConfig.js';
import { type PipelineStage, type StageRecord } from './states.js';
import { type StageCache } from './stateMachine.js';
import { type PipelineEvent } from './stateMachine.js';

/** Options for {@link runPipeline}. */
export interface PipelineOptions extends RunOptions {
  /** The per-stage work. A stage with no handler is `skipped`. */
  handlers: Partial<Record<PipelineStage, StageHandler>>;
  /** Where the finalised child repo C lives, echoed into the result. */
  commitTarget?: string;
  /** Clock, injectable so tests are deterministic. */
  now?: () => string;
  /** Receives every transition (the P-241 event shape). */
  emit?: (event: PipelineEvent) => void;
  /** Idempotency seam: a hit lets a resume reuse a stage. */
  cache?: StageCache;
  /** Attempts per stage before it is left `failed`. Default 2. */
  maxAttempts?: number;
  /** Resume from persisted state (P-240). */
  records?: readonly StageRecord[];
  /**
   * P-244: the resolved per-job config (P-243). Its `flags.dryRun` selects the
   * dry-run branch; `flags.allowGeneration` is what a stage reads to stay in
   * propose-only (P-160). Omitted for callers that have no job config yet.
   */
  cfg?: JobConfig;
}

/** What a run reports. */
export interface PipelineResult extends PipelineRunResult {
  /** The child repo the pipeline was finalising, when one was named. */
  commitTarget?: string;
}

/**
 * Drive one stitch through the nine stages.
 *
 * Call it again to RESUME: settled stages are left alone and the run continues at
 * the first stage that is not settled, so a pause (a licence verdict, an HIL
 * approval) or a failure is a re-entry rather than a restart.
 */
export async function runPipeline(
  options: PipelineOptions
): Promise<Result<PipelineResult, StitchError>> {
  // P-244: a dry run is `cfg.flags.dryRun` (the P-243 contract). `finalize` is the
  // stage that writes C/lockfile/commit, so it is swapped for a skip here rather
  // than deferred to the caller — a dry run that forgot to skip it would write.
  const dryRun = options.cfg?.flags.dryRun === true || options.dryRun === true;
  const machine = new PipelineStateMachine({
    handlers: dryRun ? { ...options.handlers, finalize: skipFinalize } : options.handlers,
    ...(options.now !== undefined ? { now: options.now } : {}),
    ...(options.emit !== undefined ? { emit: options.emit } : {}),
    ...(options.cache !== undefined ? { cache: options.cache } : {}),
    ...(options.maxAttempts !== undefined ? { maxAttempts: options.maxAttempts } : {}),
    ...(options.records !== undefined ? { records: options.records } : {}),
  });

  const ran = await machine.run({
    ...(options.offline !== undefined ? { offline: options.offline } : {}),
    ...(options.jobs !== undefined ? { jobs: options.jobs } : {}),
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
    dryRun,
  });
  if (ran.isErr()) return err(ran.error);

  return ok({
    ...ran.value,
    ...(options.commitTarget !== undefined ? { commitTarget: options.commitTarget } : {}),
  });
}

/**
 * P-244: the dry-run `finalize`.
 *
 * `finalize` is the stage that writes the child repo, the lockfile and the commit
 * — the ONE thing a dry run must never do. Skipping it here (rather than teaching
 * every `finalize` implementation about dry-run) keeps the ban in one place the
 * machine already understands, and leaves the caller's handler untouched for a
 * real run. `meta.reason` makes the skip auditable in the stage record.
 */
function skipFinalize(): Promise<StageOutcome> {
  return Promise.resolve({ status: 'skipped', meta: { reason: 'dry-run' } });
}

/** Count the records by status — the summary a UI or an audit entry renders. */
export function summarise(records: readonly StageRecord[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const record of records) counts[record.status] = (counts[record.status] ?? 0) + 1;
  return counts;
}
