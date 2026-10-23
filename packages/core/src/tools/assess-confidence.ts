// P-348 — the `assess_confidence` tool.
//
// After a proposal is drafted the agent must be able to say HOW confident it is
// in it. This tool gathers the five factors the P-346 schema needs — one from
// the agent's own self-critique (P-347) and four from the measurements other
// phases produce (sandbox pass P-176, resolver tags P-342, license risk P-127,
// test coverage P-259) — and folds them into one `SemanticConfidence` document.
//
// Two rules shape the whole module:
//
//  1. A MISSING MEASUREMENT IS NEVER A ZERO. When a port is absent the tool
//     refuses to answer (CONFIG_ERROR with the field `confidence.ports`)
//     instead of inventing a component.
//  2. The composite is computed by the P-346 module, never here. This tool only
//     gathers inputs and publishes the verdict.

import { err, ok, type Result } from 'neverthrow';
import { z } from 'zod';
import { promptVersion } from '../ai/prompts.js';
import type { ToolContext, ToolDefinition } from '../ai/types.js';
import {
  buildSemanticConfidence,
  DEFAULT_CONFIDENCE_WEIGHTS,
  type ConfidenceComponentScores,
  type ConfidenceWeights,
  type ContributingFactor,
  type SemanticConfidence,
} from '../confidence/schema.js';
import {
  toSelfCritiqueComponents,
  type SelfCritiqueInput,
  type SelfCritiqueReport,
} from '../confidence/self-critique.js';
import type { AgentPayload } from '../events/topics.js';
import type { StitchError } from '../result/index.js';
import type { ConfidenceTag } from '../resolve/types.js';

/** The tool name (the spec's own). */
export const ASSESS_CONFIDENCE_TOOL = 'assess_confidence';

/** The self-critique prompt this tool depends on (P-347). */
export const ASSESS_CONFIDENCE_PROMPT = 'self-critique';

/**
 * The P-342 tags as 0-100 numbers.
 *
 * The mapping is a judgement call, documented in ADR-157: a language-server
 * answer is the strongest evidence we have (100), a deterministic fallback is
 * real but weaker (60), and an unresolved import is no evidence at all (0).
 */
export const RESOLVER_CONFIDENCE_SCORES: Readonly<Record<ConfidenceTag, number>> = {
  'lsp-high': 100,
  'heuristic-medium': 60,
  unresolved: 0,
};

/** The mean confidence of a set of resolved edges (no edges = 0). */
export function resolverConfidenceFromTags(tags: readonly ConfidenceTag[]): number {
  if (tags.length === 0) return 0;
  const total = tags.reduce((sum, tag) => sum + RESOLVER_CONFIDENCE_SCORES[tag], 0);
  return Math.round(total / tags.length);
}

/** The proposal under assessment. */
export interface ConfidenceProposal {
  /** The proposal's identity (a job-scoped id, never a path). */
  readonly id: string;
  /** The files the proposal touches, relative to the repo root. */
  readonly files: readonly string[];
  /** The proposed diff (what the self-critique reads). */
  readonly diff: string;
  /** Extra context handed to the self-critique. */
  readonly context?: string;
}

/**
 * The five factor sources.
 *
 * Each is a function so the tool never imports the sandbox/license/coverage
 * modules itself: the caller supplies them, which keeps the tool testable and
 * keeps the environment-dependent work at the caller's boundary.
 */
export interface ConfidencePorts {
  readonly selfCritique: (
    input: SelfCritiqueInput
  ) => Promise<Result<SelfCritiqueReport, StitchError>>;
  readonly sandboxPass: (proposal: ConfidenceProposal) => Promise<Result<boolean, StitchError>>;
  readonly resolverConfidence: (
    proposal: ConfidenceProposal
  ) => Promise<Result<number, StitchError>>;
  readonly licenseRisk: (proposal: ConfidenceProposal) => Promise<Result<number, StitchError>>;
  readonly testCoverage: (proposal: ConfidenceProposal) => Promise<Result<number, StitchError>>;
}

/** The port names, in the order the spec lists them. */
export const CONFIDENCE_PORTS = [
  'selfCritique',
  'sandboxPass',
  'resolverConfidence',
  'licenseRisk',
  'testCoverage',
] as const;

export type ConfidencePortName = (typeof CONFIDENCE_PORTS)[number];

/** The persisted assessment (the proposal metadata + the event payload). */
export interface ConfidenceRecord {
  readonly proposalId: string;
  readonly confidence: SemanticConfidence;
  readonly components: ConfidenceComponentScores;
  readonly weights: ConfidenceWeights;
  readonly prompt: { readonly name: string; readonly version: string };
  readonly assessedAt: string;
}

export interface AssessConfidenceDeps {
  /** The factor sources; an absent one makes the assessment refuse. */
  readonly ports: Partial<ConfidencePorts>;
  /** Overrides for the P-346 default weights. */
  readonly weights?: ConfidenceWeights;
  /** The event-bus sink (P-241); absent = nothing is published. */
  readonly emit?: (payload: AgentPayload) => void;
  /** The proposal-metadata sink; absent = nothing is persisted. */
  readonly store?: (record: ConfidenceRecord) => void;
  /** A clock, injectable so a test can pin `assessedAt`. */
  readonly now?: () => Date;
}

function missingPort(name: ConfidencePortName): StitchError {
  return {
    code: 'CONFIG_ERROR',
    field: 'confidence.ports',
    message: `the assessment needs the ${name} port; a missing measurement is never a zero`,
  };
}

/**
 * Assess one proposal.
 *
 * The five factors are gathered, folded through the P-346 weighting and
 * returned as a record. A port failure is reported with its own error code
 * (the assessment never rewrites a provider failure into a bad score).
 */
export async function assessConfidence(
  proposal: ConfidenceProposal,
  deps: AssessConfidenceDeps
): Promise<Result<ConfidenceRecord, StitchError>> {
  const selfCritique = deps.ports.selfCritique;
  if (selfCritique === undefined) return err(missingPort('selfCritique'));
  const sandboxPass = deps.ports.sandboxPass;
  if (sandboxPass === undefined) return err(missingPort('sandboxPass'));
  const resolverConfidence = deps.ports.resolverConfidence;
  if (resolverConfidence === undefined) return err(missingPort('resolverConfidence'));
  const licenseRisk = deps.ports.licenseRisk;
  if (licenseRisk === undefined) return err(missingPort('licenseRisk'));
  const testCoverage = deps.ports.testCoverage;
  if (testCoverage === undefined) return err(missingPort('testCoverage'));

  const critiqueInput: SelfCritiqueInput =
    proposal.context !== undefined
      ? { diff: proposal.diff, context: proposal.context }
      : { diff: proposal.diff };
  const critique = await selfCritique(critiqueInput);
  if (critique.isErr()) return err(critique.error);

  const sandbox = await sandboxPass(proposal);
  if (sandbox.isErr()) return err(sandbox.error);
  const resolver = await resolverConfidence(proposal);
  if (resolver.isErr()) return err(resolver.error);
  const license = await licenseRisk(proposal);
  if (license.isErr()) return err(license.error);
  const coverage = await testCoverage(proposal);
  if (coverage.isErr()) return err(coverage.error);

  const self = toSelfCritiqueComponents(critique.value);
  const components: ConfidenceComponentScores = {
    sandbox_pass: sandbox.value ? 1 : 0,
    self_confidence: self.self_confidence,
    resolver_confidence: resolver.value,
    license_risk: license.value,
    test_coverage: coverage.value,
  };

  const factors: Record<string, ContributingFactor> = {
    proposal_id: proposal.id,
    proposal_files: proposal.files.join(','),
    self_wiring_score: critique.value.wiring_self_score,
    self_unnecessary_changes_score: critique.value.unnecessary_changes_self_score,
    self_patterns_score: critique.value.patterns_self_score,
    self_flags: critique.value.self_flags.join(','),
  };

  const built = buildSemanticConfidence({
    components,
    ...(deps.weights !== undefined ? { weights: deps.weights } : {}),
    contributing_factors: factors,
  });
  if (built.isErr()) return err(built.error);

  const at = (deps.now ?? (() => new Date()))();
  const record: ConfidenceRecord = {
    proposalId: proposal.id,
    confidence: built.value,
    components,
    weights: deps.weights ?? DEFAULT_CONFIDENCE_WEIGHTS,
    prompt: { name: ASSESS_CONFIDENCE_PROMPT, version: promptVersion(ASSESS_CONFIDENCE_PROMPT) },
    assessedAt: at.toISOString(),
  };

  deps.store?.(record);
  deps.emit?.({
    tool: ASSESS_CONFIDENCE_TOOL,
    detail: built.value.rationale,
    percent: built.value.composite_score,
  });
  return ok(record);
}

/**
 * Read a proposal out of whatever a tool returned.
 *
 * Tools return their own shapes, so the reader is tolerant by design: a `files`
 * array, a `diff` string and a name. A result with neither files nor a diff is
 * not assessable, and says so.
 */
export function defaultProposal(
  args: unknown,
  value: unknown
): Result<ConfidenceProposal, StitchError> {
  const record =
    value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const request =
    args !== null && typeof args === 'object' ? (args as Record<string, unknown>) : {};
  const rawFiles = Array.isArray(record['files']) ? record['files'] : [];
  const files = rawFiles.filter((entry): entry is string => typeof entry === 'string');
  const diff = typeof record['diff'] === 'string' ? record['diff'] : '';
  const named =
    typeof request['name'] === 'string' && request['name'].length > 0
      ? request['name']
      : typeof record['name'] === 'string'
        ? record['name']
        : 'proposal';
  if (files.length === 0 && diff === '') {
    return err({
      code: 'CONFIG_ERROR',
      field: 'confidence.proposal',
      message: 'the tool produced nothing to assess (no files and no diff)',
    });
  }
  return ok({ id: named, files, diff });
}

/**
 * Wrap a tool so every SUCCESSFUL execution is assessed.
 *
 * This is the spec's "runs automatically after every propose_component": the
 * analysis happens after the tool answered (never before), a failed tool is
 * passed through untouched (an assessment of nothing is not useful), and a
 * failed assessment fails the call — a proposal whose confidence could not be
 * computed must not look like a clean one.
 */
export function withConfidenceAssessment(
  tool: ToolDefinition,
  deps: AssessConfidenceDeps,
  proposalFrom?: (args: unknown, value: unknown) => Result<ConfidenceProposal, StitchError>
): ToolDefinition {
  const toProposal = proposalFrom ?? defaultProposal;
  return {
    ...tool,
    async execute(args: unknown, ctx: ToolContext): Promise<Result<unknown, StitchError>> {
      const produced = await tool.execute(args, ctx);
      if (produced.isErr()) return produced;
      const proposal = toProposal(args, produced.value);
      if (proposal.isErr()) return err(proposal.error);
      const assessed = await assessConfidence(proposal.value, deps);
      if (assessed.isErr()) return err(assessed.error);
      return produced;
    },
  };
}

/** The tool's argument schema (the spec's `assessConfidence(proposalId)`). */
export const assessConfidenceSchema = {
  name: z.string().min(1),
  files: z.array(z.string()),
  diff: z.string(),
  context: z.string().optional(),
};

/** The `assess_confidence` tool itself (callable outside the proposal flow). */
export function createAssessConfidenceTool(deps: AssessConfidenceDeps): ToolDefinition {
  return {
    name: ASSESS_CONFIDENCE_TOOL,
    description:
      'Score the confidence in a proposed change: the self-critique plus the sandbox, resolver, license and coverage measurements, folded into one composite.',
    schema: assessConfidenceSchema,
    autonomy: 'auto',
    async execute(args: unknown, ctx: ToolContext): Promise<Result<unknown, StitchError>> {
      void ctx;
      const parsed = z.object(assessConfidenceSchema).safeParse(args);
      if (!parsed.success) {
        return err({
          code: 'TOOL_ARGS_VALIDATION',
          message: parsed.error.issues.map(issue => issue.message).join('; '),
        });
      }
      const proposal: ConfidenceProposal =
        parsed.data.context !== undefined
          ? {
              id: parsed.data.name,
              files: parsed.data.files,
              diff: parsed.data.diff,
              context: parsed.data.context,
            }
          : { id: parsed.data.name, files: parsed.data.files, diff: parsed.data.diff };
      return assessConfidence(proposal, deps);
    },
  };
}
