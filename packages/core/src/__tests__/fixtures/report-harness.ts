// P-329 — the report harness: aggregate a results directory per ecosystem
// and print the report + the CI summary table. The python test drives it;
// the CI workflow runs the same aggregation through `stitch eval report`.
//
// USAGE: bun report-harness.ts --result-dir <dir> [--out <file>]

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { aggregateByEcosystem, ecosystemTable } from '../../eval/report.js';
import type { EcosystemKey, PairReportInput } from '../../eval/report.js';

const ECOSYSTEMS: readonly EcosystemKey[] = ['js', 'python', 'go', 'rust'];

function argOf(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  return process.argv[index + 1];
}

function ecosystemOf(value: unknown): EcosystemKey | undefined {
  return typeof value === 'string' && (ECOSYSTEMS as readonly string[]).includes(value)
    ? (value as EcosystemKey)
    : undefined;
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function opt(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

const resultDir = argOf('--result-dir');
if (resultDir === undefined) {
  process.stdout.write('REPORT {"error":"--result-dir is required"}\n');
  process.exit(2);
}
if (!existsSync(resultDir)) {
  process.stdout.write('REPORT {"error":"no results at the given directory"}\n');
  process.exit(2);
}

const inputs: PairReportInput[] = [];
for (const name of readdirSync(resultDir)) {
  if (!name.endsWith('.json') || name === 'summary.json') continue;
  let record: Record<string, unknown>;
  try {
    const parsed = JSON.parse(readFileSync(join(resultDir, name), 'utf8')) as unknown;
    if (parsed === null || typeof parsed !== 'object') continue;
    record = parsed as Record<string, unknown>;
  } catch {
    continue;
  }
  const ecosystem = ecosystemOf(record['ecosystem']);
  if (ecosystem === undefined) continue;
  const buildPass = record['build_pass'];
  inputs.push({
    pair_id:
      typeof record['pair_id'] === 'string' ? record['pair_id'] : name.replace(/\.json$/, ''),
    ecosystem,
    status: typeof record['status'] === 'string' ? record['status'] : 'unknown',
    build_pass: typeof buildPass === 'boolean' ? buildPass : null,
    rubric_score: opt(record['rubric_score']),
    resolve_rate: opt(record['resolve_rate']),
    tokens: num(record['tokens']),
    cost: num(record['cost']),
    duration: num(record['duration']),
    error_code: typeof record['error_code'] === 'string' ? record['error_code'] : null,
  });
}

const report = aggregateByEcosystem(inputs);
const out = argOf('--out');
if (out !== undefined) {
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
}
process.stdout.write(`REPORT ${JSON.stringify({ report, table: ecosystemTable(report) })}\n`);
process.exit(0);
