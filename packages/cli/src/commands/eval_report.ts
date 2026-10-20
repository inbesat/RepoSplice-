// P-329 — `stitch eval report`: the per-ecosystem breakdown of a run.
//
// The command reads the per-pair result files, aggregates them per
// ecosystem (js / python / go / rust) through the core module, writes the
// breakdown artifact and prints the markdown table the CI summary shows.
//
// A result that carries no ecosystem cannot be attributed to a language, so
// it is SKIPPED (and counted in the log) — never filed under a guess.

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { aggregateByEcosystem, ecosystemTable, meanScore } from '@repo-stitcher/core';
import type { EcosystemKey, PairReportInput } from '@repo-stitcher/core';
import type { GlobalOptions } from '../globals.js';

export interface EvalReportOptions extends GlobalOptions {
  /** Where the harness wrote the per-pair results. */
  resultDir?: string;
  /** Where the breakdown artifact is written. */
  out?: string;
}

export interface EvalReportDeps {
  readonly readFile?: (path: string) => string;
  readonly writeFile?: (path: string, content: string) => void;
  readonly exists?: (path: string) => boolean;
  readonly listDir?: (path: string) => string[];
  readonly log?: (line: string) => void;
}

export const DEFAULT_REPORT_RESULT_DIR = 'eval/results/pr';
export const DEFAULT_REPORT_OUT = 'eval/report/ecosystem_breakdown.json';

const ECOSYSTEMS: readonly EcosystemKey[] = ['js', 'python', 'go', 'rust'];

function ecosystemOf(value: unknown): EcosystemKey | undefined {
  return typeof value === 'string' && (ECOSYSTEMS as readonly string[]).includes(value)
    ? (value as EcosystemKey)
    : undefined;
}

function numberOf(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function optionalNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function rubricOf(record: Record<string, unknown>): number | null {
  const many = record['human_scores'];
  const one = record['human_score'];
  const ratings: unknown[] = Array.isArray(many)
    ? many
    : one !== undefined && one !== null
      ? [one]
      : [];
  const scores: number[] = [];
  for (const rating of ratings) {
    if (rating === null || typeof rating !== 'object') continue;
    const mean = meanScore(rating as Parameters<typeof meanScore>[0]);
    if (mean !== null && Number.isFinite(mean)) scores.push(mean);
  }
  if (scores.length > 0) {
    return Math.round((scores.reduce((sum, value) => sum + value, 0) / scores.length) * 10) / 10;
  }
  return optionalNumber(record['rubric_score']);
}

/** Read the per-pair results and aggregate them per ecosystem. */
export async function evalReport(
  options: EvalReportOptions,
  deps: EvalReportDeps = {}
): Promise<number> {
  const exists = deps.exists ?? existsSync;
  const read = deps.readFile ?? ((path: string): string => readFileSync(path, 'utf8'));
  const write =
    deps.writeFile ??
    ((path: string, content: string): void => writeFileSync(path, content, 'utf8'));
  const listDir = deps.listDir ?? ((path: string): string[] => readdirSync(path));
  const log =
    deps.log ??
    ((line: string): void => {
      process.stdout.write(`${line}\n`);
    });
  const resultDir = options.resultDir ?? DEFAULT_REPORT_RESULT_DIR;
  const outPath = options.out ?? DEFAULT_REPORT_OUT;
  if (!exists(resultDir)) {
    log(`eval report: no results at ${resultDir}`);
    return 2;
  }
  const inputs: PairReportInput[] = [];
  let skipped = 0;
  for (const name of listDir(resultDir)) {
    if (!name.endsWith('.json') || name === 'summary.json') continue;
    const path = join(resultDir, name);
    let record: Record<string, unknown>;
    try {
      const parsed = JSON.parse(read(path)) as unknown;
      if (parsed === null || typeof parsed !== 'object') continue;
      record = parsed as Record<string, unknown>;
    } catch {
      skipped += 1;
      continue;
    }
    const ecosystem = ecosystemOf(record['ecosystem']);
    if (ecosystem === undefined) {
      skipped += 1;
      continue;
    }
    const buildPass = record['build_pass'];
    inputs.push({
      pair_id:
        typeof record['pair_id'] === 'string' ? record['pair_id'] : name.replace(/\.json$/, ''),
      ecosystem,
      status: typeof record['status'] === 'string' ? record['status'] : 'unknown',
      build_pass: typeof buildPass === 'boolean' ? buildPass : null,
      rubric_score: rubricOf(record),
      resolve_rate: optionalNumber(record['resolve_rate']),
      tokens: numberOf(record['tokens']),
      cost: numberOf(record['cost']),
      duration: numberOf(record['duration']),
      error_code: typeof record['error_code'] === 'string' ? record['error_code'] : null,
    });
  }
  const report = aggregateByEcosystem(inputs);
  write(outPath, `${JSON.stringify(report, null, 2)}\n`);
  if (skipped > 0) {
    log(`eval report: ${skipped} result file(s) carry no ecosystem and were skipped`);
  }
  log(ecosystemTable(report));
  return 0;
}
