// P-243 — Orchestration: the per-job resolved config.
//
// Every stage reads its knobs from ONE resolved, validated, frozen object. The
// handoff is explicit that this is the whole point: "JobConfig is the single read
// source for every stage — never let a stage parse flags/project directly."
//
// Three decisions shape the file, and the first two are deviations from the phase's
// literal wording that an ADR had to reconcile:
//
//   1. THERE IS NO `AppConfig`. Step 1 says the config "extends AppConfig (P-200)",
//      but P-200's type is called `Config` (see `config/schema.ts`); `AppConfig`
//      appears nowhere in the repository. So `JobConfig` carries `project: Config`.
//   2. `project` IS CARRIED VERBATIM RATHER THAN `ConfigSchema`-EXTENDED. `sandbox`
//      exists in both shapes and they disagree: P-200 nests `sandbox.limits.timeout`
//      while this phase wants a run-scoped top-level `sandbox.timeout` (step 5 reads
//      `section(cfg,'sandbox').timeout`). Folding them into one object would leave
//      two writable sources for one knob, which is precisely what the handoff
//      forbids. Keeping P-200's block intact under `project` gives every stage one
//      place to read and cannot silently desynchronise.
//   3. THE HASH EXCLUDES `project`. `configHash` covers a declared, pipeline-relevant
//      subset — never credentials — because P-240 refuses a resume when the hash
//      moved, and rotating an API token must not invalidate an otherwise identical
//      job. Both directions are asserted in the tests.

import { createHash } from 'node:crypto';
import { err, ok, type Result } from 'neverthrow';
import { z } from 'zod';
import { ConfigSchema, type Config } from '../config/schema.js';
import type { Bus, BusEnvelope } from '../events/bus.js';
import { DEFAULT_CADENCE_MS } from '../events/progress.js';
import { PIPELINE_STAGES } from '../pipeline/states.js';
import type { StitchError } from '../result/index.js';
import { isSecretKey, REDACTED } from '../sandbox/secrets.js';

// ---------------------------------------------------------------------------
// The per-run sections
// ---------------------------------------------------------------------------

/** A source repo resolved to a concrete ref, with the paths wanted from it. */
export const ResolvedSourceSchema = z.object({
  repo: z.string().min(1),
  ref: z.string().min(1),
  paths: z.array(z.string().min(1)).default([]),
});
export type ResolvedSource = z.infer<typeof ResolvedSourceSchema>;

export const SelectionSectionSchema = z.object({
  include: z.array(z.string()).default([]),
  exclude: z.array(z.string()).default([]),
  /** Ceiling on selected files; P-148's own limit applies when unset. */
  maxFiles: z.number().int().positive().optional(),
});
export type SelectionSection = z.infer<typeof SelectionSectionSchema>;

export const AiSectionSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1).optional(),
  budget: z
    .object({
      maxTokens: z.number().int().nonnegative().optional(),
      maxCostUsd: z.number().nonnegative().optional(),
    })
    .default({}),
  stream: z.boolean().default(true),
});
export type AiSection = z.infer<typeof AiSectionSchema>;

/**
 * The run-scoped sandbox knobs.
 *
 * Deliberately separate from P-200's `sandbox` block: these are what a single job
 * may vary (`--sandbox-timeout`), while the project block owns the backend, images
 * and image policy.
 */
export const SandboxSectionSchema = z.object({
  jobs: z.number().int().positive().optional(),
  memory: z.string().min(1).optional(),
  timeout: z.number().int().positive().optional(),
  /** P-176's verdict check; default ON because a verdict is the point of a run. */
  verify: z.boolean().default(true),
});
export type SandboxSection = z.infer<typeof SandboxSectionSchema>;

export const LicensesSectionSchema = z.object({
  /** A named compliance policy; `allow`/`deny` below are the per-run overrides. */
  policy: z.string().min(1).optional(),
  allow: z.array(z.string()).default([]),
  deny: z.array(z.string()).default([]),
});
export type LicensesSection = z.infer<typeof LicensesSectionSchema>;

/** Bounded parallelism (P-187's `mapParallel`/`createLimiter` read these). */
export const PerfSectionSchema = z.object({
  jobs: z.number().int().positive().optional(),
  concurrency: z.number().int().positive().optional(),
});
export type PerfSection = z.infer<typeof PerfSectionSchema>;

/**
 * The progress model's knobs (P-242).
 *
 * `partialRecord` over the real stage enum, so a typed caller cannot write a
 * mistyped stage name without a compile error, AND a job may override only the
 * weights it cares about. A plain `z.record(enum, …)` is wrong here: it demands
 * EVERY stage, so the sparse default `{}` fails its own schema (the first version
 * made every resolve return CONFIG_INVALID) — a weight that silently did nothing
 * would make the bar lie, which is the one thing P-242 exists to prevent.
 */
export const ProgressSectionSchema = z.object({
  weights: z.partialRecord(z.enum(PIPELINE_STAGES), z.number().nonnegative()).default({}),
  cadence: z.number().int().positive().default(DEFAULT_CADENCE_MS),
});
export type ProgressSection = z.infer<typeof ProgressSectionSchema>;

export const FlagsSectionSchema = z.object({
  offline: z.boolean().default(false),
  dryRun: z.boolean().default(false),
  /** P-244: `dryRun` also forces generation off; this is the explicit knob. */
  allowGeneration: z.boolean().default(true),
});
export type FlagsSection = z.infer<typeof FlagsSectionSchema>;

// ---------------------------------------------------------------------------
// JobConfig
// ---------------------------------------------------------------------------

/**
 * The resolved config for one job.
 *
 * `jobId` is not in the phase's field list but step 4 requires a `config-resolved`
 * event naming the job, and the hash is a per-job value, so it has to live here.
 */
export const JobConfigSchema = z.object({
  /** P-200's project config, resolved and carried verbatim as the base. */
  project: ConfigSchema,
  jobId: z.string().min(1),
  outDir: z.string().min(1),
  sources: z.array(ResolvedSourceSchema).default([]),
  selection: SelectionSectionSchema.default({ include: [], exclude: [] }),
  ai: AiSectionSchema,
  sandbox: SandboxSectionSchema.default({ verify: true }),
  licenses: LicensesSectionSchema.default({ allow: [], deny: [] }),
  perf: PerfSectionSchema.default({}),
  progress: ProgressSectionSchema.default({ weights: {}, cadence: DEFAULT_CADENCE_MS }),
  flags: FlagsSectionSchema.default({ offline: false, dryRun: false, allowGeneration: true }),
});

export type JobConfig = z.infer<typeof JobConfigSchema>;

/** What a resolver may be handed (the shape zod accepts, before defaults). */
export type JobConfigInput = z.input<typeof JobConfigSchema>;

/**
 * One precedence layer.
 *
 * CLI/API flags (P-204/P-192) and the API body (P-192) supply these; the project
 * config and the job id are not overridable, which is why they are omitted here
 * rather than merely ignored.
 */
export type JobConfigLayer = Partial<Omit<JobConfigInput, 'project' | 'jobId'>>;

/** The sections `section()` exposes, so a stage reads a typed slice. */
export type JobSectionKey =
  | 'project'
  | 'sources'
  | 'selection'
  | 'ai'
  | 'sandbox'
  | 'licenses'
  | 'perf'
  | 'progress'
  | 'flags';

/** What {@link resolveJobConfig} needs. */
export interface ResolveJobConfigInput {
  project: Config;
  jobId: string;
  /** Higher precedence than `project`. */
  flags?: JobConfigLayer;
  /** Highest precedence. */
  overrides?: JobConfigLayer;
}

// ---------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

/**
 * Merge one precedence layer over a base, section by section.
 *
 * The merge is DEEP per key: a flag that sets only `sandbox.timeout` must not wipe
 * the rest of the sandbox section. Two deliberate limits keep it predictable:
 * arrays REPLACE (a layer that names its sources means exactly those sources, not
 * the union), and an `undefined` value in a layer never erases the base (a caller
 * that spread `{ timeout: maybeTimeout }` should not clear the project's setting).
 */
function deepMerge(
  base: Record<string, unknown>,
  layer: Record<string, unknown>
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(layer)) {
    if (value === undefined) continue;
    const current = merged[key];
    merged[key] = isRecord(current) && isRecord(value) ? deepMerge(current, value) : value;
  }
  return merged;
}

/** Freeze a value and everything reachable from it. */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

/**
 * Resolve the config for one job: `project` <- `flags` <- `overrides`.
 *
 * Returns a `Result` rather than a `Config` because a caller-supplied API body is
 * untrusted input and zod's throwing `parse` is not an option here. The merged
 * result is deep-frozen, so a stage cannot change the config its peers are reading
 * — freezing is safe for the caller because zod re-constructs the tree, leaving the
 * caller's own `project` object untouched.
 */
export function resolveJobConfig(input: ResolveJobConfigInput): Result<JobConfig, StitchError> {
  const base: Record<string, unknown> = { project: input.project, jobId: input.jobId };
  const merged = deepMerge(deepMerge(base, asRecord(input.flags)), asRecord(input.overrides));
  const parsed = JobConfigSchema.safeParse(merged);
  if (!parsed.success) {
    const issues = parsed.error.issues.map(issue => ({
      path: issue.path.join('.'),
      message: issue.message,
    }));
    return err({
      code: 'CONFIG_INVALID',
      issues,
      message: `job config failed validation (${issues.length} issue${issues.length === 1 ? '' : 's'})`,
    });
  }
  return ok(deepFreeze(parsed.data));
}

/**
 * A typed slice of the config.
 *
 * The accessor exists so a stage names the section it owns, and a renamed section
 * becomes a compile error at every call site instead of `undefined` at runtime.
 */
export function section<K extends JobSectionKey>(cfg: JobConfig, key: K): JobConfig[K] {
  return cfg[key];
}

// ---------------------------------------------------------------------------
// Hash — the resume-validity anchor
// ---------------------------------------------------------------------------

/**
 * The keys that change what the pipeline DOES.
 *
 * `project` is absent on purpose: it carries credentials (`github.token`,
 * `openrouter.apiKey`), and P-240 refuses a resume when the hash differs, so
 * including them would make a token rotation look like a config change. Listed
 * explicitly rather than derived so adding a field is a visible decision.
 */
export const PIPELINE_RELEVANT_KEYS = [
  'outDir',
  'sources',
  'selection',
  'ai',
  'sandbox',
  'licenses',
  'perf',
  'progress',
  'flags',
] as const;

/** JSON with object keys sorted, so two equal configs always hash the same. */
function canonicalJson(value: unknown): string {
  if (typeof value !== 'object' || value === null) return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, child]) => child !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(',')}}`;
}

/**
 * SHA-256 of the pipeline-relevant subset (P-026's `node:crypto` choice).
 *
 * Stored with the job by P-240's `checkpoint({ configHash })` and compared by
 * `resume({ configHash })`, which refuses a resume when it moved: a job checkpointed
 * under one config must not silently continue under another. Stable across key
 * order and across a credential change; sensitive to any knob that matters.
 */
export function configHash(cfg: JobConfig): string {
  const subset: Record<string, unknown> = {};
  for (const key of PIPELINE_RELEVANT_KEYS) subset[key] = cfg[key];
  return createHash('sha256').update(canonicalJson(subset), 'utf8').digest('hex');
}

// ---------------------------------------------------------------------------
// Redaction + the config-resolved event
// ---------------------------------------------------------------------------

function redactValue(value: unknown, key?: string): unknown {
  if (key !== undefined && isSecretKey(key)) return REDACTED;
  if (Array.isArray(value)) return value.map(child => redactValue(child));
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const [childKey, child] of Object.entries(value))
      out[childKey] = redactValue(child, childKey);
    return out;
  }
  return value;
}

/**
 * A copy of the config with every secret-VALUED key replaced (P-206).
 *
 * Key-based and recursive, so a credential is caught by its NAME at any depth —
 * `github.token` and `openrouter.apiKey` both go, without this module having to
 * know which providers exist. The live config is never modified.
 */
export function redactConfig(cfg: JobConfig): Record<string, unknown> {
  return redactValue(cfg) as Record<string, unknown>;
}

/**
 * Publish `job.config-resolved` for a job that has just been created.
 *
 * The call site is the job's creator (the queue's `enqueue`, or the CLI driving it),
 * not this module: resolving a config must stay a pure function so a stage can call
 * it in a test. The payload carries the HASH — the value resume compares — and the
 * REDACTED config, which is what makes a run auditable (P-187) without leaking a
 * token into an event log.
 */
export function emitConfigResolved(bus: Bus, cfg: JobConfig): BusEnvelope<'job.config-resolved'> {
  return bus.publish('job.config-resolved', {
    jobId: cfg.jobId,
    hash: configHash(cfg),
    effectiveCfg: redactConfig(cfg),
  });
}
