// P-192 — `stitch merge`: the core command.
//
// A THIN ORCHESTRATOR over the core pipeline. The state machine, the stage handlers,
// the agent loop and the sandbox all live in core (P-238); this file decides the
// options, drives the run, renders progress, and maps the outcome to an exit code.
// Keeping it thin is the phase's own handoff note ("the actual pipeline state machine
// lives in core P-238"), and it is also what makes all six cases testable with a fake
// pipeline — no git, no Docker, no AI, no network.
//
// ON THE ERROR CODE: the phase names `err('NOTHING_TO_STITCH')`, which does NOT exist in
// `StitchError` (grepping packages/core/src returns nothing). An empty `sources` array
// is therefore a `CONFIG_ERROR` on `field: 'sources'` telling the user the exact command
// that fixes it. Adding a code is a coordinated multi-file change (ADR-072 measured it),
// so it is recorded as a deviation rather than smuggled in.

import { join, resolve } from 'node:path';
import { stat } from 'node:fs/promises';
import { err, ok, type Result } from 'neverthrow';
import type { StitchError } from '@repo-stitcher/core';
import type { GlobalOptions } from '../globals.js';
import type { SourceSelection } from './add.js';
import {
  checkCaps,
  describePerf,
  parsePerfFlags,
  type PerfConfig,
  type PerfFlagsInput,
} from '../flags.js';

/** The default child directory, relative to the working dir. */
export const DEFAULT_OUT_DIR = 'stitch-out';

/** What the command is given on top of the globals. */
export interface MergeOptions extends GlobalOptions {
  /** `--out <dir>`: where child repo C is written. */
  out?: string;
  /** `--dry-run`: run to a verdict but never write C (P-244). */
  dryRun?: boolean;
  /** `--jobs <n>`: parallel sandbox/build jobs (P-204/P-249). */
  jobs?: number | string;
  /** `--memory <mb>`: sandbox/agent memory cap (P-204). */
  memory?: number | string;
  /** `--timeout <s>`: whole-operation cap, 0 = unlimited (P-204). */
  timeout?: number | string;
  /** `--max-files <n>`: selection file-count cap (P-204). */
  maxFiles?: number | string;
  /** `--max-size <mb>`: selection byte cap (P-204). */
  maxSize?: number | string;
  /** `--concurrency <n>`: AI/dependency async-concurrency (P-204). */
  concurrency?: number | string;
}

/** The pipeline options this command builds (P-243's shape, narrowed). */
export interface MergePipelineOptions {
  /** Absolute path child repo C is written to. */
  outDir: string;
  /** The selections recorded by `stitch add`. */
  sources: SourceSelection[];
  dryRun: boolean;
  offline: boolean;
  /** `--yes`: non-interactive; auto-approve the mechanical tools (P-156). */
  yes: boolean;
  /** Absent means "the pipeline decides" (P-204's default). */
  jobs?: number;
  /** The parsed perf knobs; absent when no perf flag was given (P-204). */
  perf?: PerfConfig;
}

/** One stage's record, as much of it as the summary needs. */
export interface MergeStageRecord {
  stage: string;
  status: string;
  meta: Record<string, unknown>;
}

/** What the pipeline reports back. */
export interface MergePipelineResult {
  outcome: 'completed' | 'failed' | 'paused';
  /** The stage the run stopped at, when it did not complete. */
  stoppedAt?: string;
  records: MergeStageRecord[];
}

/** Everything environmental, injected. */
export interface MergeDeps {
  /** The project's recorded selections (P-200). */
  loadSources: () => Result<SourceSelection[], StitchError>;
  /** Drive the core pipeline (P-238). */
  runPipeline: (options: MergePipelineOptions) => Promise<Result<MergePipelineResult, StitchError>>;
  /** Where the live progress and the summary go. */
  write?: (line: string) => void;
  /**
   * Size one recorded path, for the P-204 pre-run cap guardrail. Default:
   * `node:fs` stat, a missing file counting as 0 (the core selection stage,
   * P-148, stays the authoritative cap over what actually materializes).
   */
  statFile?: (filePath: string) => Promise<number>;
}

/** How the run ended, for the summary and the caller's exit code. */
export interface MergeOutcome {
  outDir: string;
  outcome: MergePipelineResult['outcome'];
  /** The stage a pause or a failure stopped at. */
  stoppedAt?: string;
  dryRun: boolean;
}

/** The stage name whose meta key the summary reads. */
function metaOf(result: MergePipelineResult, stage: string): Record<string, unknown> {
  return result.records.find(record => record.stage === stage)?.meta ?? {};
}

/** A count out of a stage's meta, or `undefined` when it was never reported. */
function countOf(meta: Record<string, unknown>, key: string): number | undefined {
  const value = meta[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** The stages that produced a provenance artifact, by their own report. */
function artifactsOf(result: MergePipelineResult): string[] {
  const wanted: Array<[string, string]> = [
    ['provenance', 'credits'],
    ['provenance', 'sbom'],
  ];
  const provenance = metaOf(result, 'provenance');
  return wanted
    .filter(([, key]) => provenance[key] !== undefined)
    .map(([, key]) => String(provenance[key]));
}

/**
 * The success summary: where C landed and what it contains.
 *
 * Counts come from the STAGES' OWN reports, so the summary cannot claim something the
 * run did not do; a stage that never ran simply contributes no line.
 */
export function mergeSummary(outcome: MergeOutcome, result: MergePipelineResult): string[] {
  const lines: string[] = [];
  if (outcome.dryRun) {
    lines.push('Dry run — no child repo written.');
    lines.push(`Would write to: ${outcome.outDir}`);
  } else {
    lines.push(`Child repo written to: ${outcome.outDir}`);
  }

  const deps = countOf(metaOf(result, 'deps'), 'merged');
  const files = countOf(metaOf(result, 'selection'), 'files');
  const licences = countOf(metaOf(result, 'licenses'), 'decisions');
  if (files !== undefined) lines.push(`  files:    ${files}`);
  if (deps !== undefined) lines.push(`  deps:     ${deps}`);
  if (licences !== undefined) lines.push(`  licenses: ${licences}`);
  for (const artifact of artifactsOf(result)) lines.push(`  artifact: ${artifact}`);
  return lines;
}

/**
 * Run the merge.
 *
 * Order: load → build options → drive → report. An empty `sources` array is refused
 * BEFORE the pipeline is invoked, so a misconfigured project costs nothing.
 */
export async function merge(
  opts: MergeOptions,
  deps: MergeDeps
): Promise<Result<MergeOutcome, StitchError>> {
  const write = deps.write ?? ((line: string): void => void process.stdout.write(`${line}\n`));

  const loaded = deps.loadSources();
  if (loaded.isErr()) return err(loaded.error);
  if (loaded.value.length === 0) {
    return err({
      code: 'CONFIG_ERROR',
      field: 'sources',
      message: 'merge: nothing to stitch — record a source first with `stitch add <repo> <paths>`',
    });
  }

  const outDir = resolve(opts.out ?? join(opts.cwd ?? '.', DEFAULT_OUT_DIR));

  // P-204: when ANY perf flag is given, parse the full set against the defaults
  // and enforce the selection caps pre-run — the phase's "hard guardrail", so an
  // over-budget stitch is refused before the pipeline is invoked. With no flag,
  // nothing is threaded and the pipeline decides (the P-192 contract preserved).
  const raw: PerfFlagsInput = {
    jobs: opts.jobs,
    memory: opts.memory,
    timeout: opts.timeout,
    maxFiles: opts.maxFiles,
    maxSize: opts.maxSize,
    concurrency: opts.concurrency,
  };
  let perf: PerfConfig | undefined;
  if (Object.values(raw).some(value => value !== undefined)) {
    const parsed = parsePerfFlags(raw);
    if (parsed.isErr()) return err(parsed.error);
    perf = parsed.value;

    // Best-effort sizing over the RECORDED expanded paths (P-191). Locally
    // missing files count as 0 — a remote source cannot be sized pre-run —
    // and missing bytes never trip the cap; core P-148 owns the real one.
    const statFile =
      deps.statFile ??
      (async filePath => {
        try {
          return (await stat(filePath)).size;
        } catch {
          return 0;
        }
      });
    const root = resolve(opts.cwd ?? '.');
    let count = 0;
    let bytes = 0;
    for (const selection of loaded.value) {
      count += selection.paths.length;
      for (const path of selection.paths) {
        bytes += await statFile(join(root, selection.source, path));
      }
    }
    const capped = checkCaps(count, bytes, perf);
    if (capped.isErr()) return err(capped.error);

    write(describePerf(perf));
  }

  const pipelineOptions: MergePipelineOptions = {
    outDir,
    sources: loaded.value,
    dryRun: opts.dryRun === true,
    offline: opts.offline === true,
    yes: opts.yes === true,
    ...(opts.jobs !== undefined ? { jobs: Number(opts.jobs) } : {}),
    ...(perf !== undefined ? { perf } : {}),
  };

  const ran = await deps.runPipeline(pipelineOptions);
  if (ran.isErr()) return err(ran.error);
  const result = ran.value;

  // A pause is NOT a failure: the run is waiting for a decision (P-160), and the caller
  // resumes it. Reported so the user knows what is being asked.
  if (result.outcome === 'paused') {
    const stage = result.stoppedAt ?? 'unknown';
    write(`Awaiting approval at stage "${stage}".`);
    write(
      pipelineOptions.yes
        ? 'Re-run once the decision is made (--yes only auto-approves the mechanical tools).'
        : 'Approve in the prompt, or re-run with --yes for the mechanical tools.'
    );
    return ok({
      outDir,
      outcome: 'paused',
      stoppedAt: stage,
      dryRun: pipelineOptions.dryRun,
    });
  }

  if (result.outcome === 'failed') {
    const stage = result.stoppedAt ?? 'unknown';
    return err({
      code: 'INTERNAL',
      message: `merge: pipeline failed at stage "${stage}"`,
    });
  }

  for (const line of mergeSummary(
    { outDir, outcome: 'completed', dryRun: pipelineOptions.dryRun },
    result
  )) {
    write(line);
  }
  return ok({ outDir, outcome: 'completed', dryRun: pipelineOptions.dryRun });
}
