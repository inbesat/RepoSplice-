// P-327 — the baseline command: the harness results become the metrics + the
// GO/NO-GO decision. The IO is injected (no disk in the unit test).

import { describe, expect, it } from 'vitest';
import { evalBaseline } from './eval_baseline.js';

const GLOBALS = { verbose: false, yes: false, offline: false, color: false };

const pair = (pairId: string): Record<string, unknown> => ({
  pair_id: pairId,
  repo_a_url: 'https://github.com/o/a',
  repo_b_url: 'https://github.com/o/b',
  repo_a_sha: 'a'.repeat(40),
  repo_b_sha: 'b'.repeat(40),
  extract_paths_a: ['./'],
  extract_paths_b: ['./'],
  ecosystem: 'js',
  license_a: 'MIT',
  license_b: 'MIT',
  expected_outcome: 'clean',
});

const rubric = (score: number): Record<string, unknown> => ({
  pair_id: 'p1',
  rater: 'rater-a',
  wiring_correctness: score,
  unnecessary_changes: score,
  respects_patterns: score,
  notes: 'a note',
});

const result = (fields: Record<string, unknown>): string =>
  JSON.stringify({
    pair_id: 'p1',
    status: 'succeeded',
    build_pass: true,
    build_logs: [],
    test_logs: [],
    rubric_score: null,
    resolve_rate: null,
    tokens: 0,
    cost: 0,
    duration: 1,
    error_code: null,
    error_message: null,
    ...fields,
  });

interface Harness {
  readonly exit: Promise<number>;
  readonly written: Map<string, string>;
  readonly lines: string[];
}

function run(
  results: Map<string, string>,
  corpusIds: readonly string[],
  outPath = 'out/baseline.json'
): Harness {
  const written = new Map<string, string>();
  const lines: string[] = [];
  const corpus = JSON.stringify(corpusIds.map(pair));
  const exit = evalBaseline(
    {
      ...GLOBALS,
      corpus: 'corpus',
      resultDir: 'results',
      out: outPath,
    },
    {
      readFile: (path: string) => {
        if (path.endsWith('pairs.json')) return corpus;
        const id =
          path
            .split(/[\\/]/)
            .at(-1)
            ?.replace(/\.json$/, '') ?? '';
        const found = results.get(id);
        if (found === undefined) throw new Error(`no result for ${id}`);
        return found;
      },
      writeFile: (path: string, content: string) => {
        written.set(path, content);
      },
      exists: () => true,
      makeDir: () => undefined,
      now: () => '2026-10-21T00:00:00.000Z',
      log: (line: string) => {
        lines.push(line);
      },
    }
  );
  return { exit, written, lines };
}

describe('eval baseline command (P-327)', () => {
  it('writes the metrics for a complete run', async () => {
    const harness = run(
      new Map([
        [
          'p1',
          result({
            pair_id: 'p1',
            build_pass: true,
            human_scores: [rubric(4)],
          }),
        ],
        [
          'p2',
          result({
            pair_id: 'p2',
            status: 'failed',
            build_pass: false,
            error_code: 'DEPENDENCY_CONFLICT',
            human_scores: [rubric(2)],
          }),
        ],
      ]),
      ['p1', 'p2']
    );
    expect(await harness.exit).toBe(0);
    const artifact = harness.written.get('out/baseline.json');
    expect(artifact).toBeTruthy();
    const metrics = JSON.parse(artifact as string) as Record<string, unknown>;
    expect(metrics['pairs']).toBe(2);
    expect(metrics['build_pass_rate']).toBe(0.5);
    expect(metrics['resolve_rate']).toBe(0.5);
    expect(metrics['decision']).toBe('go');
  });

  it('reports an incomplete run', async () => {
    const harness = run(new Map([['p1', result({ pair_id: 'p1' })]]), ['p1', 'p2']);
    expect(await harness.exit).toBe(1);
    const artifact = harness.written.get('out/baseline.json');
    expect(artifact).toBeTruthy();
    const metrics = JSON.parse(artifact as string) as Record<string, unknown>;
    expect(metrics['pairs']).toBe(2);
    expect(harness.lines.join('\n')).toContain('p2');
  });
});
