// P-345 — the resolver accuracy suite (the spec's accuracy.test.ts).
//
// It runs the whole resolver stack (P-335..P-344) against the four fixture
// repos and their ground truths: accuracy >= 95% per ecosystem, the
// confidence tags, the LSP-kill fallback and the warm/cold performance. The
// shared measurement lives in packages/core/test-utils/resolve-fixtures.ts so
// the bun harness the python ids drive measures the same thing.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ACCURACY_FIXTURES,
  ACCURACY_THRESHOLD,
  createAccuracyRegistry,
  measureFixture,
  prepareWorkspace,
  runFallbackCheck,
  runPerformanceCheck,
  tagSummary,
  type FixtureSpec,
  type PreparedWorkspace,
} from '../../../test-utils/resolve-fixtures.js';

function accuracySuite(spec: FixtureSpec): void {
  describe(`${spec.language} resolver accuracy`, () => {
    let prepared: PreparedWorkspace;

    beforeAll(() => {
      prepared = prepareWorkspace(spec);
    });

    afterAll(() => {
      prepared.cleanup();
    });

    it('resolves its ground truth at or above the 95% bar', async () => {
      const registry = createAccuracyRegistry(prepared.rootDir);
      const report = await measureFixture(spec, registry);
      expect(report.total).toBeGreaterThan(0);
      expect(report.accuracyPercent).toBeGreaterThanOrEqual(ACCURACY_THRESHOLD * 100);
      expect(report.met).toBe(true);
    });

    it('tags every answer with a known confidence', async () => {
      const registry = createAccuracyRegistry(prepared.rootDir);
      const report = await measureFixture(spec, registry);
      const summary = tagSummary(report);
      expect(summary.allValid).toBe(true);
      // A heuristic-only registry can only answer with the fallback tag.
      expect(summary.allHeuristic).toBe(true);
    });
  });
}

for (const spec of ACCURACY_FIXTURES) {
  accuracySuite(spec);
}

describe('resolver accuracy checks', () => {
  it('keeps resolving when the language server is dead', async () => {
    const typescript = ACCURACY_FIXTURES[0];
    expect(typescript).toBeDefined();
    if (typescript === undefined) return;
    const result = await runFallbackCheck(typescript);
    expect(result.crashed).toBe(false);
    expect(result.ok).toBe(true);
    expect(result.confidence).toBe('heuristic-medium');
  });

  it('answers a warm request well under the cold start', async () => {
    const performance = await runPerformanceCheck();
    expect(performance.coldUnder3000Ms).toBe(true);
    expect(performance.warmUnder200Ms).toBe(true);
    expect(performance.warmMs).toBeLessThanOrEqual(performance.coldMs);
  });
});
