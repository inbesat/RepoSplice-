// P-324 — build-pass scoring. Reuses the Epic 8 sandbox runner (P-168-P-180)
// to decide whether a merged repo builds (and tests) clean, and captures the
// logs + artifacts that land in the per-pair EvalResult.
//
// The corpus ecosystem (js | python | go | rust) maps onto the core
// Ecosystem (node | python | go | rust): 'js' builds inside the node image.
// The sandbox runner is REUSED as-is — this module only orchestrates it and
// shapes the outcome into the scorable fields.

import { err, ok, type Result } from 'neverthrow';
import type { Ecosystem } from '../deps/ecosystem.js';
import type { StitchError } from '../result/index.js';
import { boundLogLines } from '../sandbox/build.js';
import { runVerification, type VerifiedRun } from '../sandbox/runner.js';

/** Corpus ecosystem -> core ecosystem (the sandbox images, P-169). */
export const ECOSYSTEM_BY_CORPUS: Readonly<Record<string, Ecosystem>> = {
  js: 'node',
  python: 'python',
  go: 'go',
  rust: 'rust',
};

/** The scoreable outcome of one pair's build (+ test) verification. */
export interface BuildScore {
  /** null = the build never ran (the verification failed before it). */
  readonly buildPass: boolean | null;
  readonly buildLogs: readonly string[];
  readonly testLogs: readonly string[];
  readonly buildDurationMs: number;
  readonly testDurationMs: number;
  /** Host path of the copied-out build artifacts (P-173). */
  readonly artifactsDir?: string;
}

/** The injected verification step — the same seam the runner uses. */
export type VerifyPort = (
  kind: 'build' | 'test',
  ecosystem: Ecosystem,
  repoPath: string
) => Promise<Result<VerifiedRun, StitchError>>;

export interface ScoreBuildOptions {
  /** The corpus ecosystem ('js' | 'python' | 'go' | 'rust'). */
  readonly ecosystem: string;
  /** The merged child repo to verify. */
  readonly repoPath: string;
  /** Where the logs + artifacts are written (P-173). */
  readonly outputDir?: string;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  /** The verification port — defaults to the real sandbox runner. */
  readonly verify?: VerifyPort;
}

/** The log lines kept per phase (the sandbox keeps its own bound too). */
const MAX_LOG_LINES = 200;

/** stdout + stderr of a verification run, bounded. */
function logsOf(run: VerifiedRun): string[] {
  const logs = run.logs;
  const lines = [...(logs.stdout ?? []), ...(logs.stderr ?? [])];
  return boundLogLines(lines, MAX_LOG_LINES);
}

/** The artifacts dir, present on a build run only. */
function artifactsOf(run: VerifiedRun): string | undefined {
  return 'outputDir' in run ? run.outputDir : undefined;
}

/**
 * Score one merged repo: run the build verification, then the test
 * verification, and shape the outcome into the scorable fields.
 *
 * When the build fails the tests are NOT run (they could not run against a
 * broken tree) — the test logs stay empty and their duration is 0.
 */
export async function scoreBuild(
  options: ScoreBuildOptions
): Promise<Result<BuildScore, StitchError>> {
  const ecosystem = ECOSYSTEM_BY_CORPUS[options.ecosystem] ?? 'node';
  const verify: VerifyPort =
    options.verify ??
    (async (kind, eco, repoPath) =>
      runVerification(kind, eco, repoPath, {
        ...(options.outputDir !== undefined ? { outputDir: options.outputDir } : {}),
        ...(options.signal !== undefined ? { signal: options.signal } : {}),
        ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
      }));

  const build = await verify('build', ecosystem, options.repoPath);
  if (build.isErr()) return err(build.error);
  const buildRun = build.value;
  const buildLogs = logsOf(buildRun);
  const artifactsDir = artifactsOf(buildRun);

  if (!buildRun.pass) {
    return ok({
      buildPass: false,
      buildLogs,
      testLogs: [],
      buildDurationMs: buildRun.durationMs,
      testDurationMs: 0,
      ...(artifactsDir !== undefined ? { artifactsDir } : {}),
    });
  }

  const tests = await verify('test', ecosystem, options.repoPath);
  if (tests.isErr()) return err(tests.error);
  const testRun = tests.value;
  return ok({
    buildPass: true,
    buildLogs,
    testLogs: logsOf(testRun),
    buildDurationMs: buildRun.durationMs,
    testDurationMs: testRun.durationMs,
    ...(artifactsDir !== undefined ? { artifactsDir } : {}),
  });
}
