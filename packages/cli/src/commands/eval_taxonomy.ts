// P-331 — `stitch eval taxonomy`: name what broke.
//
// The baseline counted the failures; this classifies them. Every corpus pair
// gets an entry (a pair that passed is 'none', a pair that never ran is
// 'unknown' — the report must show that the pair was looked at), and the
// decision rule the plan states is applied to the result.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { buildTaxonomy, type TaxonomyInput } from '@repo-stitcher/core';
import { evalPairSchema } from '@repo-stitcher/core';
import type { GlobalOptions } from '../globals.js';

export interface EvalTaxonomyOptions extends GlobalOptions {
  /** Where the harness wrote the per-pair results. */
  resultDir?: string;
  /** The corpus directory (for the expected pair ids). */
  corpus?: string;
  /** Where the classification artifact is written. */
  out?: string;
}

export interface EvalTaxonomyDeps {
  readonly readFile?: (path: string) => string;
  readonly writeFile?: (path: string, content: string) => void;
  readonly exists?: (path: string) => boolean;
  readonly makeDir?: (path: string) => void;
  readonly now?: () => string;
  readonly log?: (line: string) => void;
}

export const DEFAULT_TAXONOMY_RESULT_DIR = 'eval/results/pr';
export const DEFAULT_TAXONOMY_CORPUS = 'eval/corpus';
export const DEFAULT_TAXONOMY_OUT = 'eval/taxonomy/failure_categories.json';

/** The ratings of a result (the `human_scores` array wins over the single). */
function ratingsOf(record: Record<string, unknown>): readonly unknown[] {
  const scores = record['human_scores'];
  if (Array.isArray(scores)) return scores as readonly unknown[];
  const single = record['human_score'];
  return single === null || single === undefined ? [] : [single];
}

/** The log lines of a result (build first, then the test output). */
function logsOf(record: Record<string, unknown>): {
  readonly build_logs: readonly string[];
  readonly test_logs: readonly string[];
} {
  const build = record['build_logs'];
  const test = record['test_logs'];
  return {
    build_logs: Array.isArray(build) ? (build as readonly string[]) : [],
    test_logs: Array.isArray(test) ? (test as readonly string[]) : [],
  };
}

function errorCodeOf(record: Record<string, unknown>): string | null {
  const code = record['error_code'];
  return typeof code === 'string' ? code : null;
}

function buildPassOf(record: Record<string, unknown>): boolean | null {
  const pass = record['build_pass'];
  return typeof pass === 'boolean' ? pass : null;
}

/**
 * Classify the corpus. A corpus pair with no result is still classified
 * (as 'unknown' with a note) — an incomplete run is reported, not hidden.
 */
export async function evalTaxonomy(
  options: EvalTaxonomyOptions,
  deps: EvalTaxonomyDeps = {}
): Promise<number> {
  const readFile = deps.readFile ?? ((path: string) => readFileSync(path, 'utf8'));
  const writeFile =
    deps.writeFile ?? ((path: string, content: string) => writeFileSync(path, content, 'utf8'));
  const exists = deps.exists ?? ((path: string) => existsSync(path));
  const makeDir =
    deps.makeDir ??
    ((path: string) => {
      mkdirSync(path, { recursive: true });
    });
  const log = deps.log ?? ((line: string) => process.stdout.write(`${line}\n`));
  const now = deps.now ?? (() => new Date().toISOString());

  const resultDir = options.resultDir ?? DEFAULT_TAXONOMY_RESULT_DIR;
  const corpus = options.corpus ?? DEFAULT_TAXONOMY_CORPUS;
  const out = options.out ?? DEFAULT_TAXONOMY_OUT;

  const manifestPath = corpus.endsWith('.json') ? corpus : join(corpus, 'pairs.json');
  if (!exists(manifestPath)) {
    log(`eval taxonomy: no corpus at ${manifestPath}`);
    return 2;
  }
  const pairs: { pair_id: string }[] = [];
  try {
    const parsed = JSON.parse(readFile(manifestPath)) as unknown;
    if (!Array.isArray(parsed)) throw new Error('the corpus is not a list');
    for (const entry of parsed) {
      const candidate = evalPairSchema.safeParse(entry);
      if (candidate.success) pairs.push({ pair_id: candidate.data.pair_id });
    }
  } catch (error) {
    log(
      `eval taxonomy: the corpus is unreadable - ${error instanceof Error ? error.message : String(error)}`
    );
    return 2;
  }
  if (pairs.length === 0) {
    log('eval taxonomy: the corpus holds no valid pair');
    return 2;
  }

  const inputs: TaxonomyInput[] = pairs.map(pair => {
    const resultPath = join(resultDir, `${pair.pair_id}.json`);
    if (!exists(resultPath)) {
      return {
        pair_id: pair.pair_id,
        status: 'missing',
        build_pass: null,
        error_code: null,
        ratings: [],
      };
    }
    let record: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(readFile(resultPath)) as unknown;
      if (parsed !== null && typeof parsed === 'object') {
        record = parsed as Record<string, unknown>;
      }
    } catch {
      record = {};
    }
    const status = record['status'];
    const logs = logsOf(record);
    return {
      pair_id: pair.pair_id,
      status: typeof status === 'string' ? status : 'unknown',
      build_pass: buildPassOf(record),
      error_code: errorCodeOf(record),
      ratings: ratingsOf(record),
      build_logs: logs.build_logs,
      test_logs: logs.test_logs,
    };
  });

  const report = buildTaxonomy(inputs, { now });
  makeDir(dirname(out));
  writeFile(out, `${JSON.stringify(report, null, 2)}\n`);
  for (const [category, count] of Object.entries(report.frequencies)) {
    log(`eval taxonomy: ${category} ${count}`);
  }
  for (const reason of report.reasons) log(`eval taxonomy: ${reason}`);
  log(`eval taxonomy: wrote ${out}`);
  return 0;
}
