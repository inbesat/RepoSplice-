// P-328 — the CI gate harness: compare two metrics files and print the
// verdict. A bun SCRIPT (the core vitest glob is src/**/*.{test,spec}.ts),
// driven by packages/core/test_ci_gate.py.
//
//   bun packages/core/src/__tests__/fixtures/ci-gate-harness.ts \
//     --current <metrics.json> --baseline <metrics.json> [--threshold 5]

import { readFileSync } from 'node:fs';
import { evaluateGate, compositeScore } from '../../eval/ci_gate.js';
import type { BaselineMetrics } from '../../eval/baseline.js';

function argOf(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

function metricsOf(path: string): BaselineMetrics {
  return JSON.parse(readFileSync(path, 'utf8')) as BaselineMetrics;
}

const currentPath = argOf('--current');
const baselinePath = argOf('--baseline');
if (currentPath === undefined || baselinePath === undefined) {
  process.stdout.write('GATE {"error":"--current and --baseline are required"}\n');
  process.exit(2);
}

const thresholdRaw = argOf('--threshold');
const threshold = thresholdRaw === undefined ? undefined : Number.parseInt(thresholdRaw, 10);

try {
  const current = metricsOf(currentPath);
  const baseline = metricsOf(baselinePath);
  const verdict = evaluateGate(
    { composite: compositeScore(current), label: 'the current run' },
    { composite: compositeScore(baseline), label: 'the baseline' },
    threshold ?? undefined
  );
  process.stdout.write(`GATE ${JSON.stringify(verdict)}\n`);
  process.exit(verdict.passed ? 0 : 1);
} catch (error) {
  const reason = error instanceof Error ? error.message : String(error);
  process.stdout.write(`GATE ${JSON.stringify({ error: reason })}\n`);
  process.exit(2);
}
