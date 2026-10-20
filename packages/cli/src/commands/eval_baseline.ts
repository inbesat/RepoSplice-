// P-327 — `stitch eval baseline`: turn the harness results into the
// baseline metrics and the GO/NO-GO decision.
//
// The command reads the per-pair result files the harness wrote, pulls the
// human ratings out of them, and asks the core module (eval/baseline.ts) for
// the numbers. It NEVER invents a rating: a pair nobody scored stays
// unscored, and an incomplete run (a corpus pair with no result) is
// reported as such — the gate cannot be decided on a partial run.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { computeBaseline, evalPairSchema, type BaselineInput } from '@repo-stitcher/core';
import type { GlobalOptions } from '../globals.js';

export interface EvalBaselineOptions extends GlobalOptions {
  /** Where the harness wrote the per-pair result files. */
  resultDir?: string;
  /** The corpus (a directory with pairs.json). */
  corpus?: string;
  /** Where the baseline artifact is written. */
  out?: string;
}

export interface EvalBaselineDeps {
  readonly readFile?: (path: string) => string;
  readonly writeFile?: (path: string, content: string) => void;
  readonly exists?: (path: string) => boolean;
  readonly makeDir?: (path: string) => void;
  readonly now?: () => string;
  readonly log?: (line: string) => void;
}

/** The default place the harness writes its results. */
export const DEFAULT_BASELINE_RESULT_DIR = 'eval/results/baseline';
/** The default corpus. */
export const DEFAULT_BASELINE_CORPUS = 'eval/corpus';
/** Where the baseline artifacts live. */
export const DEFAULT_BASELINE_OUT_DIR = 'eval/results';

function timestamp(now: string): string {
  return now.replace(/[:.]/g, '-');
}

/** The ratings a result file carries (`human_scores` wins over `human_score`). */
export function ratingsOf(record: Record<string, unknown>): unknown[] {
  const many = record['human_scores'];
  if (Array.isArray(many)) return many;
  const one = record['human_score'];
  return one === undefined ? [] : [one];
}

/**
 * Score the results into the baseline. Exit 0 = every corpus pair has a
 * result; exit 1 = the run is incomplete (the metrics are still written so
 * the owner can see how far it got).
 */
export async function evalBaseline(
  options: EvalBaselineOptions,
  deps: EvalBaselineDeps = {}
): Promise<number> {
  const exists = deps.exists ?? existsSync;
  const read = deps.readFile ?? ((path: string) => readFileSync(path, 'utf8'));
  const write =
    deps.writeFile ?? ((path: string, content: string) => writeFileSync(path, content, 'utf8'));
  const makeDir = deps.makeDir ?? ((path: string) => mkdirSync(path, { recursive: true }));
  const now = deps.now ?? (() => new Date().toISOString());
  const log = deps.log ?? ((line: string) => process.stdout.write(`${line}\n`));

  const corpusDir = options.corpus ?? DEFAULT_BASELINE_CORPUS;
  const resultDir = options.resultDir ?? DEFAULT_BASELINE_RESULT_DIR;
  const corpusPath = join(corpusDir, 'pairs.json');
  if (!exists(corpusPath)) {
    log(`eval baseline: no corpus at ${corpusPath}`);
    return 1;
  }

  const expected: string[] = [];
  try {
    const parsed = JSON.parse(read(corpusPath)) as unknown;
    const entries = Array.isArray(parsed) ? parsed : [];
    for (const entry of entries) {
      const pair = evalPairSchema.safeParse(entry);
      if (pair.success) expected.push(pair.data.pair_id);
    }
  } catch {
    log(`eval baseline: the corpus at ${corpusPath} is not readable JSON`);
    return 1;
  }
  if (expected.length === 0) {
    log(`eval baseline: the corpus at ${corpusPath} holds no pairs`);
    return 1;
  }

  const inputs: BaselineInput[] = [];
  const missing: string[] = [];
  for (const pairId of expected) {
    const resultPath = join(resultDir, `${pairId}.json`);
    if (!exists(resultPath)) {
      missing.push(pairId);
      // A pair that never ran still counts: the rates are over the corpus,
      // so an incomplete run can never report a flattering number.
      inputs.push({
        pair_id: pairId,
        status: 'missing',
        build_pass: null,
        error_code: null,
        ratings: [],
      });
      continue;
    }
    let record: Record<string, unknown>;
    try {
      const parsed = JSON.parse(read(resultPath)) as unknown;
      record = (parsed ?? {}) as Record<string, unknown>;
    } catch {
      missing.push(pairId);
      // A pair that never ran still counts: the rates are over the corpus,
      // so an incomplete run can never report a flattering number.
      inputs.push({
        pair_id: pairId,
        status: 'missing',
        build_pass: null,
        error_code: null,
        ratings: [],
      });
      continue;
    }
    const buildPass = record['build_pass'];
    const errorCode = record['error_code'];
    inputs.push({
      pair_id: pairId,
      status: typeof record['status'] === 'string' ? record['status'] : 'unknown',
      build_pass: typeof buildPass === 'boolean' ? buildPass : null,
      error_code: typeof errorCode === 'string' ? errorCode : null,
      ratings: ratingsOf(record),
    });
  }

  const metrics = computeBaseline(inputs, { now });
  const outPath =
    options.out ?? join(DEFAULT_BASELINE_OUT_DIR, `baseline-${timestamp(now())}.json`);
  makeDir(dirname(outPath));
  write(outPath, `${JSON.stringify(metrics, null, 2)}\n`);

  log(
    `eval baseline: ${metrics.pairs} pairs, ${metrics.rated} rated, build pass ${metrics.build_pass_count}, resolve rate ${metrics.resolve_rate}, decision ${metrics.decision}`
  );
  for (const reason of metrics.reasons) log(`  - ${reason}`);
  log(`eval baseline: wrote ${outPath}`);
  if (missing.length > 0) {
    log(`eval baseline: ${missing.length} corpus pair(s) have no result: ${missing.join(', ')}`);
    return 1;
  }
  return 0;
}

/** The result files in a directory (a helper for the callers + tests). */
