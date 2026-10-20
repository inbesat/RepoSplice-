// P-326 — a bun SCRIPT the python test drives: it runs the REAL
// `stitch eval rate` work function with a fake prompt (the tool itself is
// interactive) and prints the outcome as one JSON line.
//
// It is NOT a test file (the CLI's vitest glob is src/**/*.{test,spec}.ts)
// — the python side owns the assertions.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { evalRate } from '../../commands/eval_rate.js';

function argOf(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

const resultDir = argOf('--result-dir');
const pairId = argOf('--pair') ?? 'fixture-js-1';
const rater = argOf('--rater') ?? 'rater-x';

if (resultDir === undefined) {
  process.stdout.write('RATE {"error":"--result-dir is required"}\n');
  process.exit(2);
}

const answers = ['4', '5', '4', 'the wiring holds'];
let index = 0;
const code = await evalRate(
  pairId,
  {
    verbose: false,
    yes: false,
    offline: false,
    color: false,
    resultDir,
    rater,
  },
  {
    prompt: async () => answers[index++] ?? null,
    log: () => undefined,
  }
);

const path = join(resultDir, `${pairId}.json`);
const result: unknown = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
const record = (result ?? {}) as Record<string, unknown>;
process.stdout.write(
  `RATE ${JSON.stringify({
    exit: code,
    rubric: record['human_score'] ?? null,
    rater: record['human_rater'] ?? null,
    result,
  })}\n`
);
process.exit(code);
