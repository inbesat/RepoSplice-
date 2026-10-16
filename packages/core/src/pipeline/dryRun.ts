// P-244 — Orchestration: the dry-run plan.
//
// A dry run is the "what WOULD happen" mode: the pipeline runs config → sources →
// selection → deps → licenses → agent → sandbox → provenance and reaches a verdict,
// but `finalize` is skipped, so C, the lockfile and the commit are never written
// (runPipeline swaps that one handler — see `skipFinalize` in `runPipeline.ts`).
//
// This module is the PREVIEW CONTRACT that mode produces. It is pure: it reads what
// the stages reported (`StageRecord.meta`, P-238) and shapes it into one object the
// CLI's `--json` (P-192) and the web's proposed-diff view (P-217) both render. It
// performs no I/O and never writes, which is what makes a dry run safe to point at
// any project.
//
// On the phase's wording: step 2 says the agent should "generate a `ProposedPlan`
// (new/modify/delete ops + rationale)". `ProposedPlan` exists nowhere in the
// repository (grep: only PHASES_DETAILED.md:12024), so this module DEFINES the
// shape — {@link ProposedFileOp} for the ops and {@link DryRunPlan} for the plan —
// rather than importing a type that is not there. The nearest real analogue, P-154's
// `ComponentProposal`, is deliberately not reused: it describes one component and
// has no notion of a whole-run plan.

import type { Bus, BusEnvelope } from '../events/bus.js';
import type { JobConfig } from '../jobs/jobConfig.js';
import { PIPELINE_STAGES, type PipelineStage, type StageStatus } from './states.js';
import type { PipelineRunResult } from './stateMachine.js';

/** One file operation a dry run WOULD perform, with the reason it would. */
export interface ProposedFileOp {
  /** Repo-relative path in C, posix-separated. */
  path: string;
  op: 'create' | 'modify' | 'delete';
  /** Why the agent proposed it (P-160's propose-only rationale). */
  rationale?: string;
}

/** One stage's outcome, flattened for the wire. */
export interface DryRunStage {
  stage: PipelineStage;
  status: StageStatus;
  meta: Record<string, unknown>;
}

/**
 * The whole preview.
 *
 * `finalized` is reported rather than assumed: a dry run MUST leave it `false`, and
 * the tests assert exactly that, so a future change that lets `finalize` run cannot
 * pass silently.
 */
export interface DryRunPlan {
  jobId: string;
  outDir: string;
  stages: DryRunStage[];
  /** The agent's proposed new/modify/delete ops (P-160, propose-only). */
  proposedOps: ProposedFileOp[];
  /** Would-be diffs per path, as the stages reported them. */
  proposedDiffs: Record<string, unknown>;
  deps: Record<string, unknown>;
  licenseVerdict: Record<string, unknown>;
  sandboxPreview: Record<string, unknown>;
  provenancePreview: Record<string, unknown>;
  /** `true` only if `finalize` passed — which a dry run must never allow. */
  finalized: boolean;
}

/** The ops a `meta.proposedOps` value may legally contain. */
const FILE_OPS: ReadonlySet<string> = new Set(['create', 'modify', 'delete']);

/**
 * Read `meta.proposedOps` defensively.
 *
 * Stage metas are `Record<string, unknown>` by contract, so anything can be in
 * there. A malformed entry is DROPPED rather than trusted, because this feeds a UI
 * that shows the user what a run would do — a bad op is worse than a missing one.
 */
function toProposedOps(value: unknown): ProposedFileOp[] {
  if (!Array.isArray(value)) return [];
  const out: ProposedFileOp[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const path = record.path;
    const op = record.op;
    if (typeof path !== 'string' || path === '') continue;
    if (typeof op !== 'string' || !FILE_OPS.has(op)) continue;
    const narrowed = op as ProposedFileOp['op'];
    const rationale = record.rationale;
    out.push(
      typeof rationale === 'string' ? { path, op: narrowed, rationale } : { path, op: narrowed }
    );
  }
  return out;
}

/** One stage's meta, or `{}` when the stage did not run. */
function metaOf(
  records: readonly { stage: PipelineStage; meta: Record<string, unknown> }[],
  stage: PipelineStage
): Record<string, unknown> {
  return records.find(record => record.stage === stage)?.meta ?? {};
}

/** One stage's status, or `pending` when the record is absent. */
function statusOf(
  records: readonly { stage: PipelineStage; status: StageStatus }[],
  stage: PipelineStage
): StageStatus {
  return records.find(record => record.stage === stage)?.status ?? 'pending';
}

/**
 * Build the preview for a dry run.
 *
 * Pure: it derives everything from the resolved config (P-243) and the run the
 * machine already produced (P-238). `run.records` is the single source, so the plan
 * can never disagree with the run it describes.
 */
export function buildDryRunPlan(cfg: JobConfig, run: PipelineRunResult): DryRunPlan {
  const agentMeta = metaOf(run.records, 'agent');
  const proposedDiffs = agentMeta.diffs;
  return {
    jobId: cfg.jobId,
    outDir: cfg.outDir,
    stages: PIPELINE_STAGES.map(stage => ({
      stage,
      status: statusOf(run.records, stage),
      meta: metaOf(run.records, stage),
    })),
    proposedOps: toProposedOps(agentMeta.proposedOps),
    proposedDiffs:
      typeof proposedDiffs === 'object' && proposedDiffs !== null
        ? (proposedDiffs as Record<string, unknown>)
        : {},
    deps: metaOf(run.records, 'deps'),
    licenseVerdict: metaOf(run.records, 'licenses'),
    sandboxPreview: metaOf(run.records, 'sandbox'),
    provenancePreview: metaOf(run.records, 'provenance'),
    finalized: statusOf(run.records, 'finalize') === 'passed',
  };
}

/**
 * Whether a dry run may generate content.
 *
 * `flags.dryRun` (P-243) forces generation OFF: a dry run reviews and proposes
 * (P-160) but must not spend tokens producing work it will throw away. Exposed as a
 * named predicate so the agent stage has ONE thing to consult and the tests can
 * assert the rule directly rather than inferring it.
 */
export function dryRunAllowsGeneration(cfg: JobConfig): boolean {
  return cfg.flags.dryRun !== true && cfg.flags.allowGeneration === true;
}

/** JSON with object keys sorted, so two equal plans always serialise identically. */
function stableStringify(value: unknown): string {
  if (typeof value !== 'object' || value === null) return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, child]) => child !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries
    .map(([key, child]) => `${JSON.stringify(key)}:${stableStringify(child)}`)
    .join(',')}}`;
}

/**
 * Serialise a plan for `--json` (P-192) and `/api/merge/proposed-diff` (P-217).
 *
 * Stable across key order, so a client can diff two runs' plans and a test can
 * assert equality without depending on insertion order.
 */
export function dryRunPlanJson(plan: DryRunPlan): string {
  return stableStringify(plan);
}

/**
 * Publish the plan as `job.dry-run-plan` (P-241's bus) once the run has produced it.
 *
 * The payload carries the plan as a plain object rather than the interface, because
 * the topic payload type lives in `events/topics.ts` and must not import this module
 * (`events → pipeline → events` would be a cycle). Built explicitly, so no cast is
 * needed and a new `DryRunPlan` field cannot silently go missing from the wire.
 */
export function emitDryRunPlan(bus: Bus, plan: DryRunPlan): BusEnvelope<'job.dry-run-plan'> {
  const wire: Record<string, unknown> = {
    jobId: plan.jobId,
    outDir: plan.outDir,
    stages: plan.stages,
    proposedOps: plan.proposedOps,
    proposedDiffs: plan.proposedDiffs,
    deps: plan.deps,
    licenseVerdict: plan.licenseVerdict,
    sandboxPreview: plan.sandboxPreview,
    provenancePreview: plan.provenancePreview,
    finalized: plan.finalized,
  };
  return bus.publish('job.dry-run-plan', {
    jobId: plan.jobId,
    outDir: plan.outDir,
    plan: wire,
  });
}
