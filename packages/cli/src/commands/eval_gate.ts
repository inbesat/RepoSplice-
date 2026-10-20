// P-328 — `stitch eval gate`: does this run regress against the baseline?
//
// The gate compares the COMPOSITE score (the P-327 metrics) of the current
// run against the last baseline. A drop of more than the threshold fails the
// job; a rise (or a drop inside the threshold) passes.
//
// The current side may be a metrics artifact (the JSON the baseline command
// writes) OR a directory of per-pair result files (what the runner leaves
// behind) — the per-pair reading reuses the P-327 helpers, so the metric
// logic lives in exactly one place.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { computeBaseline, gateFromMetrics } from '@repo-stitcher/core';
import type { BaselineInput, BaselineMetrics, GateVerdict } from '@repo-stitcher/core';
import type { GlobalOptions } from '../globals.js';
import { ratingsOf } from './eval_baseline.js';

export interface EvalGateOptions extends GlobalOptions {
  /** The current run: a metrics artifact or a directory of per-pair results. */
  current?: string;
  /** The baseline: a metrics artifact (or a results directory). */
  baseline?: string;
  /** The drop (in composite points) that fails the gate. Default 5. */
  threshold?: string;
}

export interface EvalGateDeps {
  readonly readFile?: (path: string) => string;
  readonly exists?: (path: string) => boolean;
  readonly listDir?: (path: string) => string[];
  readonly log?: (line: string) => void;
}

export const DEFAULT_GATE_CURRENT = 'eval/results/pr';
export const DEFAULT_GATE_BASELINE = 'eval/results/baseline.json';

/** The three components the composite needs, read from a metrics artifact. */
function metricsFromJson(value: unknown): BaselineMetrics | undefined {
  if (value === null || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  const buildPassRate = record['build_pass_rate'];
  const resolveRate = record['resolve_rate'];
  const rubricAvg = record['rubric_avg'];
  if (typeof buildPassRate !== 'number' || typeof resolveRate !== 'number') return undefined;
  if (rubricAvg !== null && typeof rubricAvg !== 'number') return undefined;
  return {
    version: 1,
    generated_at: typeof record['generated_at'] === 'string' ? record['generated_at'] : '',
    pairs: typeof record['pairs'] === 'number' ? record['pairs'] : 0,
    rated: typeof record['rated'] === 'number' ? record['rated'] : 0,
    build_pass_count: 0,
    build_pass_rate: buildPassRate,
    rubric_avg: rubricAvg === null ? null : rubricAvg,
    resolved_count: 0,
    resolve_rate: resolveRate,
    decision: 'pending',
    reasons: [],
    categories: { resolution: 0, build: 0, test: 0, license: 0, timeout: 0, other: 0 },
    per_pair: [],
  };
}

/** The per-pair inputs the P-327 baseline module computes from. */
function inputOf(record: Record<string, unknown>): BaselineInput {
  const buildPass = record['build_pass'];
  const errorCode = record['error_code'];
  return {
    pair_id: typeof record['pair_id'] === 'string' ? record['pair_id'] : 'unknown',
    status: typeof record['status'] === 'string' ? record['status'] : 'unknown',
    build_pass: typeof buildPass === 'boolean' ? buildPass : null,
    error_code: typeof errorCode === 'string' ? errorCode : null,
    ratings: ratingsOf(record),
  };
}

/**
 * Read one side of the comparison: a metrics artifact, or a directory of
 * per-pair result files.
 */
export function loadMetrics(path: string, deps: EvalGateDeps = {}): BaselineMetrics | undefined {
  const exists = deps.exists ?? existsSync;
  const read = deps.readFile ?? ((file: string) => readFileSync(file, 'utf8'));
  const listDir = deps.listDir ?? ((dir: string) => readdirSync(dir));
  if (!exists(path)) return undefined;
  if (path.endsWith('.json')) {
    try {
      return metricsFromJson(JSON.parse(read(path)) as unknown);
    } catch {
      return undefined;
    }
  }
  let names: string[];
  try {
    names = listDir(path);
  } catch {
    return undefined;
  }
  const inputs: BaselineInput[] = [];
  for (const name of names) {
    if (!name.endsWith('.json') || name === 'summary.json') continue;
    try {
      const parsed = JSON.parse(read(join(path, name))) as unknown;
      if (parsed === null || typeof parsed !== 'object') continue;
      inputs.push(inputOf(parsed as Record<string, unknown>));
    } catch {
      // an unreadable pair result is skipped; the run's own summary reports it
    }
  }
  if (inputs.length === 0) return undefined;
  return computeBaseline(inputs);
}

/** The gate: 0 = passed, 1 = the gate failed, 2 = the inputs are unusable. */
export async function evalGate(options: EvalGateOptions, deps: EvalGateDeps = {}): Promise<number> {
  const log = deps.log ?? ((line: string) => process.stdout.write(`${line}\n`));
  const currentPath = options.current ?? DEFAULT_GATE_CURRENT;
  const baselinePath = options.baseline ?? DEFAULT_GATE_BASELINE;
  const thresholdRaw = options.threshold ?? '';
  const threshold = thresholdRaw === '' ? undefined : Number.parseFloat(thresholdRaw);
  if (threshold !== undefined && (!Number.isFinite(threshold) || threshold < 0)) {
    log('eval gate: the threshold must be a number of points (0 or more)');
    return 2;
  }
  const current = loadMetrics(currentPath, deps);
  if (current === undefined) {
    log(`eval gate: no current metrics at ${currentPath}`);
    return 2;
  }
  const baseline = loadMetrics(baselinePath, deps);
  if (baseline === undefined) {
    log(`eval gate: no baseline metrics at ${baselinePath}`);
    return 2;
  }
  const verdict: GateVerdict =
    threshold === undefined
      ? gateFromMetrics(current, baseline)
      : gateFromMetrics(current, baseline, threshold);
  for (const reason of verdict.reasons) log(`  - ${reason}`);
  log(
    `eval gate: ${verdict.passed ? 'passed' : 'FAILED'} (composite ${verdict.composite} vs baseline ${verdict.baseline_composite}, threshold ${verdict.threshold})`
  );
  return verdict.passed ? 0 : 1;
}
