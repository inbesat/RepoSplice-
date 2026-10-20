// P-323 — `stitch eval run`: the headless corpus harness.
//
// The command wires the runner's PORTS to the real core modules (git clone,
// git filter-repo, the pipeline state machine, the sandbox verifier) and
// reports the run. Exit codes: 0 = every pair succeeded, 1 = at least one
// pair failed, 2 = the corpus/usage is unusable.

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { err, ok } from 'neverthrow';
import {
  cloneRepo,
  EvalRunner,
  extractPathsViaFilterRepo,
  runPipeline,
  runVerification,
  type EvalPorts,
  type StitchError,
} from '@repo-stitcher/core';
import type { GlobalOptions } from '../globals.js';

export interface EvalRunOptions extends GlobalOptions {
  /** The corpus directory (or a manifest path). Default: eval/corpus. */
  corpus?: string;
  /** How many pairs run at once (1..16). Default: 1. */
  parallel?: string;
  /** Where the per-pair results and the summary land. Default: eval/out. */
  outputDir?: string;
  /** The per-pair budget in milliseconds. Default: unset (no budget). */
  timeout?: string;
  /** Print the run summary as JSON. */
  json?: boolean;
}

export interface EvalRunDeps {
  /** Injected runner (the tests drive a fake-port runner). */
  readonly runner?: EvalRunner;
}

/** The corpus ecosystems (P-320) mapped onto the core's ecosystem names. */
const ECOSYSTEM_BY_CORPUS: Readonly<Record<string, 'node' | 'python' | 'go' | 'rust'>> = {
  js: 'node',
  python: 'python',
  go: 'go',
  rust: 'rust',
};

function messageOf(error: StitchError): string {
  return 'message' in error && typeof error.message === 'string' ? error.message : error.code;
}

/** The default ports: the REAL core modules, no duplication. */
export function defaultEvalPorts(): EvalPorts {
  return {
    clone: async (url, targetDir) => cloneRepo({ url, targetDir, shallow: true, depth: 1 }),
    extract: async (repoPath, paths) =>
      extractPathsViaFilterRepo({
        repoPath,
        paths: [...paths],
        targetSubdir: paths[0]?.replace(/^\.\//, '') ?? 'root',
      }),
    agent: async context => {
      // The pipeline IS the agent loop; this phase drives it with an empty
      // handler set (the pipeline skips a stage without a handler by its own
      // contract). The AI stage handlers arrive with the scoring phase
      // (P-324) — the port is the seam (ADR-131).
      const pipeline = await runPipeline({
        handlers: {},
        commitTarget: context.workDir,
        ...(context.signal !== undefined ? { signal: context.signal } : {}),
      });
      if (pipeline.isErr()) return err(pipeline.error);
      return ok({ tokens: 0, cost: 0 });
    },
    sandbox: async context => {
      const run = await runVerification(
        'build',
        ECOSYSTEM_BY_CORPUS[context.pair.ecosystem] ?? 'node',
        context.repoB,
        {
          outputDir: join(context.workDir, 'sandbox'),
          ...(context.signal !== undefined ? { signal: context.signal } : {}),
        }
      );
      if (run.isErr()) return err(run.error);
      // The verdict shape is consumed loosely until the scoring phase (P-324)
      // maps it onto build_pass/rubric_score/resolve_rate.
      const verdict = run.value.verdict as unknown as { passed?: boolean } | undefined;
      return ok({ buildPass: verdict?.passed ?? null });
    },
    now: () => Date.now(),
    mkdirp: async dir => {
      await mkdir(dir, { recursive: true });
    },
    writeJson: async (path, value) => {
      await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    },
  };
}

/** Run the corpus; returns the process exit code. */
export async function evalRun(options: EvalRunOptions, deps: EvalRunDeps = {}): Promise<number> {
  const corpus = options.corpus ?? 'eval/corpus';
  const outputDir = options.outputDir ?? 'eval/out';
  const parallel = Number.parseInt(options.parallel ?? '1', 10);
  const timeoutRaw =
    options.timeout === undefined ? undefined : Number.parseInt(options.timeout, 10);

  if (!Number.isInteger(parallel) || parallel < 1 || parallel > 16) {
    process.stderr.write('eval: --parallel must be an integer between 1 and 16\n');
    return 2;
  }
  if (timeoutRaw !== undefined && (!Number.isInteger(timeoutRaw) || timeoutRaw <= 0)) {
    process.stderr.write('eval: --timeout must be a positive number of milliseconds\n');
    return 2;
  }

  const runner = deps.runner ?? new EvalRunner(defaultEvalPorts());
  const result = await runner.run(corpus, {
    outputDir,
    parallel,
    ...(timeoutRaw !== undefined ? { timeoutMs: timeoutRaw } : {}),
  });
  if (result.isErr()) {
    process.stderr.write(`eval: ${messageOf(result.error)}\n`);
    return 2;
  }
  const summary = result.value;
  if (options.json === true) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } else {
    process.stdout.write(
      `eval: ${summary.succeeded}/${summary.pairs} pairs succeeded ` +
        `(max concurrency ${summary.max_concurrency}/${summary.parallel})\n`
    );
  }
  return summary.failed === 0 ? 0 : 1;
}
