// P-329 — the per-ecosystem breakdown (the bun CI mirror of the python
// test): the aggregation, the medians and the CI summary table.

import { describe, expect, it } from 'vitest';
import { aggregateByEcosystem, ecosystemTable, type PairReportInput } from '../eval/report.js';

function pair(
  pair_id: string,
  ecosystem: PairReportInput['ecosystem'],
  build_pass: boolean | null,
  score: number | null,
  error_code: string | null = null
): PairReportInput {
  return {
    pair_id,
    ecosystem,
    status: build_pass === true ? 'succeeded' : 'failed',
    build_pass,
    rubric_score: score,
    resolve_rate: build_pass === true ? 1 : 0,
    tokens: 100,
    cost: 0.01,
    duration: 1000,
    error_code,
  };
}

const INPUTS: readonly PairReportInput[] = [
  pair('js-1', 'js', true, 4),
  pair('js-2', 'js', false, 2, 'DEPENDENCY_CONFLICT'),
  pair('py-1', 'python', true, 5),
];

describe('per-ecosystem breakdown (P-329)', () => {
  it('lists every ecosystem, even the empty ones', () => {
    const report = aggregateByEcosystem(INPUTS, { now: () => '2026-10-21T00:00:00.000Z' });
    expect(report.ecosystems.map(entry => entry.ecosystem)).toEqual(['js', 'python', 'go', 'rust']);
    const rust = report.ecosystems.find(entry => entry.ecosystem === 'rust');
    expect(rust?.pairs).toBe(0);
    expect(rust?.build_pass_rate).toBeNull();
    expect(rust?.rubric_avg).toBeNull();
  });

  it('aggregates the metrics per ecosystem', () => {
    const report = aggregateByEcosystem(INPUTS, { now: () => '2026-10-21T00:00:00.000Z' });
    const js = report.ecosystems.find(entry => entry.ecosystem === 'js');
    expect(js?.pairs).toBe(2);
    expect(js?.build_pass_rate).toBe(0.5);
    expect(js?.rubric_avg).toBe(3);
    expect(js?.resolve_rate).toBe(0.5);
    const python = report.ecosystems.find(entry => entry.ecosystem === 'python');
    expect(python?.pairs).toBe(1);
    expect(python?.build_pass_rate).toBe(1);
    expect(python?.rubric_avg).toBe(5);
  });

  it('buckets the failures per ecosystem', () => {
    const report = aggregateByEcosystem(INPUTS, { now: () => '2026-10-21T00:00:00.000Z' });
    const js = report.ecosystems.find(entry => entry.ecosystem === 'js');
    expect(js?.categories['resolution']).toBe(1);
    expect(js?.categories['build']).toBe(0);
  });

  it('takes the median over the values that exist', () => {
    const report = aggregateByEcosystem(
      [pair('js-1', 'js', true, 4), pair('js-2', 'js', true, 2), pair('js-3', 'js', true, 6)],
      { now: () => '2026-10-21T00:00:00.000Z' }
    );
    const js = report.ecosystems.find(entry => entry.ecosystem === 'js');
    expect(js?.rubric_median).toBe(4);
  });

  it('keeps the totals over every pair', () => {
    const report = aggregateByEcosystem(INPUTS, { now: () => '2026-10-21T00:00:00.000Z' });
    expect(report.totals.pairs).toBe(3);
    expect(report.totals.tokens_total).toBe(300);
    expect(report.per_pair.length).toBe(3);
    expect(report.generated_at).toBe('2026-10-21T00:00:00.000Z');
  });

  it('renders the ci summary table', () => {
    const report = aggregateByEcosystem(INPUTS, { now: () => '2026-10-21T00:00:00.000Z' });
    const table = ecosystemTable(report);
    expect(table).toContain('| ecosystem');
    for (const ecosystem of ['js', 'python', 'go', 'rust']) {
      expect(table).toContain(`| ${ecosystem} `);
    }
    expect(table).toContain('| all ');
  });
});
