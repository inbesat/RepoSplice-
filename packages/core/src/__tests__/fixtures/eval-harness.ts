// P-323/P-324 — the fake-port harness the python tests drive.
//
// It is a plain bun SCRIPT (not a vitest file: the core vitest glob is
// `src/**/*.{test,spec}.ts`). The ports are fakes so the run needs neither
// the network nor Docker; the runner itself is the real one.
//
//   bun packages/core/src/__tests__/fixtures/eval-harness.ts \
//     --corpus <dir> --output-dir <dir> [--parallel N] [--spot-check]
//
// P-324: a pair may carry a `build_command` / `test_command` extra field
// (the corpus schema is loose). When present, the fake sandbox port runs that
// command as a REAL local process, so `build_pass` is a genuine exit-code
// decision instead of a hard-coded true. `--spot-check` then re-runs the same
// command INDEPENDENTLY for every pair and reports whether the harness
// verdict matches that manual run (the "manual docker run" of the spec —
// Docker is not available in every environment, so the reference run is a
// direct local execution of the same command).

import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { err, ok } from 'neverthrow';
import { EvalRunner, type EvalPorts } from '../../eval/runner.js';
import { scoreBuild, type VerifyPort } from '../../eval/scoring.js';
import type { EvalPair } from '../../eval/schema.js';
import type { BuildResult } from '../../sandbox/build.js';

const execFileAsync = promisify(execFile);

const args = process.argv.slice(2);

function arg(name: string, fallback: string): string {
  const index = args.indexOf(`--${name}`);
  const value = index >= 0 ? args[index + 1] : undefined;
  return value === undefined ? fallback : value;
}

const corpus = arg('corpus', join('src', '__tests__', 'fixtures', 'eval-corpus'));
const outputDir = arg('output-dir', join('eval', 'out'));
const parallel = Number.parseInt(arg('parallel', '1'), 10);
const spotCheck = args.includes('--spot-check');

/** The command a pair wants run, or undefined when it has none. */
function commandOf(pair: EvalPair, kind: 'build' | 'test'): string[] | undefined {
  const raw = pair[kind === 'build' ? 'build_command' : 'test_command'];
  if (!Array.isArray(raw)) return undefined;
  const parts = raw.filter((part): part is string => typeof part === 'string');
  return parts.length > 0 ? parts : undefined;
}

interface LocalRun {
  readonly pass: boolean;
  readonly stdout: string[];
  readonly stderr: string[];
  readonly durationMs: number;
}

/** Run a command locally; the exit code decides pass/fail. */
async function runLocal(command: string[]): Promise<LocalRun> {
  const [file, ...rest] = command;
  if (file === undefined) {
    return { pass: false, stdout: [], stderr: ['no command'], durationMs: 0 };
  }
  const started = Date.now();
  try {
    const { stdout, stderr } = await execFileAsync(file, rest, { timeout: 60_000 });
    return {
      pass: true,
      stdout: stdout.split('\n').filter(line => line !== ''),
      stderr: stderr.split('\n').filter(line => line !== ''),
      durationMs: Date.now() - started,
    };
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string; code?: number };
    return {
      pass: false,
      stdout: (failure.stdout ?? '').split('\n').filter(line => line !== ''),
      stderr: (failure.stderr ?? '').split('\n').filter(line => line !== ''),
      durationMs: Date.now() - started,
    };
  }
}

/** The fake verification port: the pair's own command, run for real. */
function localVerify(pair: EvalPair): VerifyPort {
  return async kind => {
    const command = commandOf(pair, kind);
    if (command === undefined) {
      const synthetic: BuildResult = {
        pass: true,
        command: 'fixture (no command)',
        exitCode: 0,
        durationMs: 0,
        logs: { stdout: ['fixture build ok'], stderr: [] },
      };
      return ok(synthetic);
    }
    const run = await runLocal(command);
    const result: BuildResult = {
      pass: run.pass,
      command: command.join(' '),
      exitCode: run.pass ? 0 : 1,
      durationMs: run.durationMs,
      logs: { stdout: run.stdout, stderr: run.stderr },
    };
    return ok(result);
  };
}

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
  sandbox: async context => {
    const score = await scoreBuild({
      ecosystem: context.pair.ecosystem,
      repoPath: context.repoB,
      verify: localVerify(context.pair),
    });
    if (score.isErr()) return err(score.error);
    const value = score.value;
    return ok({
      buildPass: value.buildPass,
      buildLogs: value.buildLogs,
      testLogs: value.testLogs,
      buildDurationMs: value.buildDurationMs,
      testDurationMs: value.testDurationMs,
    });
  },
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

if (spotCheck) {
  const manifest = corpus.endsWith('.json') ? corpus : join(corpus, 'pairs.json');
  const raw = await readFile(manifest, 'utf8');
  const pairs = JSON.parse(raw) as EvalPair[];
  const report: {
    pair_id: string;
    harness: boolean | null;
    manual: boolean | null;
    match: boolean;
  }[] = [];
  for (const pair of pairs) {
    let harnessPass: boolean | null;
    try {
      const parsed = JSON.parse(
        await readFile(join(outputDir, `${pair.pair_id}.json`), 'utf8')
      ) as { build_pass?: boolean | null };
      harnessPass = parsed.build_pass ?? null;
    } catch {
      harnessPass = null;
    }
    const command = commandOf(pair, 'build');
    const manual = command === undefined ? null : (await runLocal(command)).pass;
    report.push({
      pair_id: pair.pair_id,
      harness: harnessPass,
      manual,
      match: harnessPass === manual,
    });
  }
  process.stdout.write(`SPOTCHECK ${JSON.stringify(report)}\n`);
}
