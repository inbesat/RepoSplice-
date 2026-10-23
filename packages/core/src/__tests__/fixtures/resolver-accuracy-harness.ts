// P-345 — the accuracy harness the mandated python tests drive.
//
// It reuses the four ground-truth fixtures (P-336..P-339) and the shared
// helper (packages/core/test-utils/resolve-fixtures.ts) rather than rebuilding
// either, measures every ecosystem's accuracy, checks the confidence tags,
// proves the fallback survives a dead language server and reports the measured
// cold/warm latency. One line: `ACCURACY {json}`

import {
  ACCURACY_FIXTURES,
  ACCURACY_THRESHOLD,
  createAccuracyRegistry,
  measureFixture,
  prepareWorkspace,
  runFallbackCheck,
  runPerformanceCheck,
  tagSummary,
} from '../../../test-utils/resolve-fixtures.js';
import type { AccuracyReport } from '../../../test-utils/resolve-fixtures.js';

interface EcosystemReport extends AccuracyReport {
  readonly tags: ReturnType<typeof tagSummary>;
}

async function measureAll(): Promise<Record<string, EcosystemReport>> {
  const ecosystems: Record<string, EcosystemReport> = {};
  for (const spec of ACCURACY_FIXTURES) {
    const workspace = prepareWorkspace(spec);
    try {
      const registry = createAccuracyRegistry(workspace.rootDir);
      const report = await measureFixture(spec, registry);
      ecosystems[spec.language] = { ...report, tags: tagSummary(report) };
    } finally {
      workspace.cleanup();
    }
  }
  return ecosystems;
}

const ecosystems = await measureAll();
const fallback = await runFallbackCheck(ACCURACY_FIXTURES[0]);
const performance = await runPerformanceCheck();

const report = {
  mode: 'accuracy',
  threshold: ACCURACY_THRESHOLD,
  ecosystems,
  fallback,
  performance,
};

process.stdout.write(`ACCURACY ${JSON.stringify(report)}\n`);
