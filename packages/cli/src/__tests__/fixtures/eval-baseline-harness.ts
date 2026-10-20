// P-327 — the baseline harness: run the real `stitch eval baseline` over a
// results directory and print the metrics as one JSON line. The python test
// drives this (the CI is bun-only); the bun mirror lives in
// packages/core/src/__tests__/eval-baseline.test.ts.

import { evalBaseline } from '../../commands/eval_baseline.js';

function argOf(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

const corpus = argOf('--corpus');
const resultDir = argOf('--result-dir');
if (corpus === undefined || resultDir === undefined) {
  process.stdout.write(
    `BASELINE ${JSON.stringify({ error: '--corpus and --result-dir are required' })}\n`
  );
  process.exit(2);
}
const out = argOf('--out');

const code = await evalBaseline(
  {
    verbose: false,
    yes: false,
    offline: false,
    color: false,
    corpus,
    resultDir,
    ...(out !== undefined ? { out } : {}),
  },
  { log: () => undefined }
);

process.stdout.write(`BASELINE ${JSON.stringify({ exit: code })}\n`);
process.exit(code);
