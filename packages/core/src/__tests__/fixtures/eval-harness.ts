// P-323 — the fake-port harness the python tests drive.
//
// It is a plain bun SCRIPT (not a vitest file: the core vitest glob is
// `src/**/*.{test,spec}.ts`). The ports are fakes so the run needs neither
// the network nor Docker; the runner itself is the real one.
//
//   bun packages/core/src/__tests__/fixtures/eval-harness.ts \
//     --corpus <dir> --output-dir <dir> [--parallel N]

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { err, ok } from 'neverthrow';
import { EvalRunner, type EvalPorts } from '../../eval/runner.js';

const args = process.argv.slice(2);

function arg(name: string, fallback: string): string {
  const index = args.indexOf(`--${name}`);
  const value = index >= 0 ? args[index + 1] : undefined;
  return value === undefined ? fallback : value;
}

const corpus = arg('corpus', join('src', '__tests__', 'fixtures', 'eval-corpus'));
const outputDir = arg('output-dir', join('eval', 'out'));
const parallel = Number.parseInt(arg('parallel', '1'), 10);

const ports: EvalPorts = {
  clone: async (url, targetDir) => {
    // A short delay so a parallel run really overlaps; the runner's Pool is
    // what bounds it (the summary reports the observed maximum).
    await new Promise(resolve => setTimeout(resolve, 10));
    if (url.includes('missing')) {
      return err({ code: 'GIT_ERROR', message: `fake clone failed for ${url}` });
    }
    await mkdir(targetDir, { recursive: true });
    return ok(targetDir);
  },
  extract: async (repoPath, paths) => {
    const suffix = paths[0]?.replace(/^\.\//, '') ?? '';
    return ok(suffix === '' ? repoPath : join(repoPath, suffix));
  },
  agent: async () => ok({ tokens: 12, cost: 0.01 }),
  sandbox: async () => ok({ buildPass: true }),
  now: () => Date.now(),
  mkdirp: async dir => {
    await mkdir(dir, { recursive: true });
  },
  writeJson: async (path, value) => {
    await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  },
};

const runner = new EvalRunner(ports);
const result = await runner.run(corpus, { outputDir, parallel });
if (result.isErr()) {
  process.stderr.write(`harness: ${result.error.code}\n`);
  process.exit(2);
}
process.stdout.write(
  `${JSON.stringify({
    pairs: result.value.pairs,
    succeeded: result.value.succeeded,
    failed: result.value.failed,
    max_concurrency: result.value.max_concurrency,
  })}\n`
);
