// P-329 — the per-ecosystem breakdown: which language is dragging the
// average down?
//
// Every metric is aggregated per ecosystem (js / python / go / rust) with the
// mean AND the median, so a single outlier pair cannot hide behind an
// average. A metric nobody measured is SKIPPED (null), never a fake zero —
// the same rule the baseline uses.
//
// ALL FOUR ecosystems are always listed, even when an ecosystem has no pairs
// yet, so the CI summary table always has the same four rows.

import { categoryFor, type FailureCategory } from './baseline.js';
import { EVAL_ECOSYSTEMS } from './schema.js';

/** The corpus ecosystems (P-103). */
export type EcosystemKey = (typeof EVAL_ECOSYSTEMS)[number];

/** One pair's result, ready to be aggregated. */
export interface PairReportInput {
  readonly pair_id: string;
  readonly ecosystem: EcosystemKey;
  readonly status: string;
  readonly build_pass: boolean | null;
  readonly rubric_score: number | null;
  readonly resolve_rate: number | null;
  readonly tokens: number;
  readonly cost: number;
  readonly duration: number;
  readonly error_code: string | null;
}

/** The aggregates of one ecosystem. */
export interface EcosystemStats {
  readonly ecosystem: EcosystemKey;
  readonly pairs: number;
  readonly build_pass_rate: number | null;
  readonly rubric_avg: number | null;
  readonly resolve_rate: number | null;
  readonly tokens_total: number;
  readonly tokens_avg: number | null;
  readonly cost_total: number;
  readonly cost_avg: number | null;
  readonly duration_total: number;
  readonly duration_avg: number | null;
  readonly build_pass_median: number | null;
  readonly rubric_median: number | null;
  readonly resolve_median: number | null;
  readonly categories: Readonly<Record<FailureCategory, number>>;
}

/** The whole breakdown. */
export interface EcosystemReport {
  readonly version: 1;
  readonly generated_at: string;
  readonly ecosystems: readonly EcosystemStats[];
  readonly per_pair: readonly PairReportInput[];
  readonly totals: {
    readonly pairs: number;
    readonly build_pass_rate: number | null;
    readonly rubric_avg: number | null;
    readonly resolve_rate: number | null;
    readonly tokens_total: number;
    readonly cost_total: number;
    readonly duration_total: number;
  };
}

const FAILURE_CATEGORIES: readonly FailureCategory[] = [
  'resolution',
  'build',
  'test',
  'license',
  'timeout',
  'other',
];

function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sum = values.reduce((total, value) => total + value, 0);
  return Math.round((sum / values.length) * 10000) / 10000;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const pick =
    sorted.length % 2 === 1
      ? (sorted[middle] as number)
      : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
  return Math.round(pick * 10000) / 10000;
}

function present<T>(values: readonly (T | null)[]): T[] {
  return values.filter((value): value is T => value !== null);
}

function round(value: number | null, digits: number): number | null {
  if (value === null) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function emptyCategories(): Record<FailureCategory, number> {
  const categories = {} as Record<FailureCategory, number>;
  for (const category of FAILURE_CATEGORIES) categories[category] = 0;
  return categories;
}

function statsFor(ecosystem: EcosystemKey, group: readonly PairReportInput[]): EcosystemStats {
  const buildPasses = present(group.map(pair => pair.build_pass)).map(value => (value ? 1 : 0));
  const rubrics = present(group.map(pair => pair.rubric_score));
  const resolves = present(group.map(pair => pair.resolve_rate));
  const tokensTotal = group.reduce((total, pair) => total + pair.tokens, 0);
  const costTotal = group.reduce((total, pair) => total + pair.cost, 0);
  const durationTotal = group.reduce((total, pair) => total + pair.duration, 0);
  const categories = emptyCategories();
  for (const pair of group) {
    if (pair.build_pass === true) continue;
    categories[categoryFor(pair.error_code) ?? 'other'] += 1;
  }
  return {
    ecosystem,
    pairs: group.length,
    build_pass_rate: round(mean(buildPasses), 4),
    rubric_avg: round(mean(rubrics), 1),
    resolve_rate: round(mean(resolves), 4),
    tokens_total: tokensTotal,
    tokens_avg: round(mean(group.map(pair => pair.tokens)), 1),
    cost_total: round(costTotal, 4) as number,
    cost_avg: round(mean(group.map(pair => pair.cost)), 4),
    duration_total: durationTotal,
    duration_avg: round(mean(group.map(pair => pair.duration)), 1),
    build_pass_median: round(median(buildPasses), 4),
    rubric_median: round(median(rubrics), 1),
    resolve_median: round(median(resolves), 4),
    categories,
  };
}

/** Aggregate the per-pair results by ecosystem. */
export function aggregateByEcosystem(
  inputs: readonly PairReportInput[],
  options?: { now?: () => string }
): EcosystemReport {
  const now = options?.now ?? ((): string => new Date().toISOString());
  const ecosystems = EVAL_ECOSYSTEMS.map(ecosystem =>
    statsFor(
      ecosystem,
      inputs.filter(pair => pair.ecosystem === ecosystem)
    )
  );
  const allBuildPasses = present(inputs.map(pair => pair.build_pass)).map(value => (value ? 1 : 0));
  return {
    version: 1,
    generated_at: now(),
    ecosystems,
    per_pair: inputs,
    totals: {
      pairs: inputs.length,
      build_pass_rate: round(mean(allBuildPasses), 4),
      rubric_avg: round(mean(present(inputs.map(pair => pair.rubric_score))), 1),
      resolve_rate: round(mean(present(inputs.map(pair => pair.resolve_rate))), 4),
      tokens_total: inputs.reduce((total, pair) => total + pair.tokens, 0),
      cost_total: round(
        inputs.reduce((total, pair) => total + pair.cost, 0),
        4
      ) as number,
      duration_total: inputs.reduce((total, pair) => total + pair.duration, 0),
    },
  };
}

function percent(value: number | null): string {
  return value === null ? 'n/a' : `${Math.round(value * 1000) / 10}%`;
}

function number(value: number | null): string {
  return value === null ? 'n/a' : String(value);
}

/** The CI summary markdown table (one row per ecosystem + a totals row). */
export function ecosystemTable(report: EcosystemReport): string {
  const lines = [
    '| ecosystem | pairs | build-pass | rubric | resolve | tokens | cost | duration |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const stats of report.ecosystems) {
    lines.push(
      `| ${stats.ecosystem} | ${stats.pairs} | ${percent(stats.build_pass_rate)} | ${number(stats.rubric_avg)} | ${percent(stats.resolve_rate)} | ${stats.tokens_total} | ${number(stats.cost_total)} | ${stats.duration_total} |`
    );
  }
  lines.push(
    `| all | ${report.totals.pairs} | ${percent(report.totals.build_pass_rate)} | ${number(report.totals.rubric_avg)} | ${percent(report.totals.resolve_rate)} | ${report.totals.tokens_total} | ${number(report.totals.cost_total)} | ${report.totals.duration_total} |`
  );
  return lines.join('\n');
}
