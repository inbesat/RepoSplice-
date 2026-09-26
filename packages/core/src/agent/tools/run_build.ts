// P-155 — agent tool `run_build` (sandbox).
//
// The read-only verification step that closes the agent loop. `fix_dependency`,
// `edit_config`, `move_file`, and `propose_component` all change the child repo;
// this proves those changes still build and test, so the loop can iterate on
// real evidence instead of guessing.
//
// THE ONE INVARIANT: NOTHING RUNS ON THE HOST.
//
// P-155 is emphatic — "Call the SANDBOX runner (P-171 build / P-172 test) —
// **never run on the host**" — and the acceptance criteria repeat it as
// "Read-only on the host tree (diff applied in sandbox)". This module contains
// no `child_process`, no `execa`, no shell invocation of any kind, and no
// filesystem writes. The only way to execute anything is the injected
// `SandboxRunner`, so "never on the host" is a structural property of the type
// surface, not a rule the code could forget to follow.
//
// Per P-155's Dependencies note, the sandbox modules (P-168/P-171/P-172) have
// not landed yet and the spec directs a stub here; the production Docker client
// and GH Actions fallback are wired into the same seam later.

import { z } from 'zod';
import { ok, err, type Result } from 'neverthrow';
import type { StitchError } from '../../result/index.js';
import type { ToolDefinition, ToolContext } from '../../ai/types.js';
import {
  MAX_BUILD_LOG_LINES,
  type BuildCmd,
  type BuildEcosystem,
  type BuildOutcome,
} from '../types.js';

/** The canonical build/test command pair per ecosystem (P-155 step 2). */
export const ECOSYSTEM_COMMANDS: Readonly<Record<BuildEcosystem, { build: string; test: string }>> =
  {
    node: { build: 'bun run build', test: 'bun test' },
    python: { build: 'python -m build', test: 'pytest' },
    rust: { build: 'cargo build', test: 'cargo test' },
    go: { build: 'go build ./...', test: 'go test ./...' },
  };

/** The canonical commands for an ecosystem, with caller overrides applied. */
export function commandsFor(cmd: BuildCmd): { build: string; test: string } {
  const base = ECOSYSTEM_COMMANDS[cmd.ecosystem];
  return {
    build: cmd.build ?? base.build,
    test: cmd.test ?? base.test,
  };
}

/** Keep only the last `MAX_BUILD_LOG_LINES` lines. */
export function boundLogs(lines: readonly string[], limit = MAX_BUILD_LOG_LINES): string[] {
  return lines.length <= limit ? [...lines] : lines.slice(lines.length - limit);
}

/** Manifest basenames that identify each ecosystem (P-103/P-115 metadata). */
const ECOSYSTEM_MARKERS: ReadonlyArray<{ marker: string; ecosystem: BuildEcosystem }> = [
  { marker: 'package.json', ecosystem: 'node' },
  { marker: 'pyproject.toml', ecosystem: 'python' },
  { marker: 'requirements.txt', ecosystem: 'python' },
  { marker: 'Cargo.toml', ecosystem: 'rust' },
  { marker: 'go.mod', ecosystem: 'go' },
];

/**
 * Infer the ecosystem from a staged listing.
 *
 * Mirrors P-103's marker set so the sandbox image selection (P-169) and the
 * build command agree. Returns `undefined` when no marker is present, which
 * the caller reports as a configuration problem rather than guessing.
 */
export function detectEcosystemFromListing(
  stagedFiles: readonly string[]
): BuildEcosystem | undefined {
  const basenames = new Set(
    stagedFiles.map(p => p.slice(p.lastIndexOf('/') + 1).replace(/\\/g, '/'))
  );
  for (const { marker, ecosystem } of ECOSYSTEM_MARKERS) {
    if (basenames.has(marker)) return ecosystem;
    // `requirements-dev.txt` counts for python, matching P-103's prefix rule.
    if (marker === 'requirements.txt') {
      for (const name of basenames) {
        if (name.startsWith('requirements') && name.endsWith('.txt')) return ecosystem;
      }
    }
  }
  return undefined;
}

/** Options for `runBuildForStage`. */
export interface RunBuildOptions {
  /** Repo-relative stage root handed to the sandbox runner. */
  repoPath?: string;
  /** Repeat the test step to detect flakiness. Default: true. */
  detectFlaky?: boolean;
  /** Log-line cap override. */
  maxLogLines?: number;
}

/**
 * Infer the stage's ecosystem from its staged listing, or `undefined` when no
 * recognised marker file is present.
 */
export async function inferEcosystem(ctx: ToolContext): Promise<BuildEcosystem | undefined> {
  const staging = ctx.staging;
  if (staging === undefined) return undefined;
  const listed = await staging.listStagedFiles();
  if (listed.isErr()) return undefined;
  return detectEcosystemFromListing(listed.value);
}

/**
 * Run the stage's build and test inside the sandbox and report the outcome.
 *
 * Sequence:
 *  1. Require an available sandbox backend, or return `SANDBOX_UNAVAILABLE`.
 *  2. Run the build step once. A build failure is terminal — repeating a failed
 *     build tells us nothing, so `flaky` stays false.
 *  3. Run the test step twice when flakiness detection is on. `pass` is true if
 *     EITHER run passes; `flaky` is true when the two runs disagree.
 *  4. Return a bounded, deterministic outcome.
 */
export async function runBuildForStage(
  ctx: ToolContext,
  cmd: BuildCmd,
  opts: RunBuildOptions = {}
): Promise<Result<BuildOutcome, StitchError>> {
  const runner = ctx.sandbox;
  if (runner === undefined) {
    return err({
      code: 'SANDBOX_UNAVAILABLE',
      message:
        'run_build requires an injected SandboxRunner; builds are never executed on the host',
    });
  }

  const { ecosystem } = cmd;
  const available = await runner.available();
  if (!available) {
    return err({
      code: 'SANDBOX_UNAVAILABLE',
      backend: runner.backend,
      message: `Sandbox backend "${runner.backend}" is not available; enable Docker or the GH Actions fallback`,
    });
  }

  const { build, test } = commandsFor(cmd);
  const repoPath = opts.repoPath ?? '.';
  const maxLines = opts.maxLogLines ?? MAX_BUILD_LOG_LINES;

  const stdout: string[] = [];
  const stderr: string[] = [];
  let durationMs = 0;
  // Declared uninitialized: the build step assigns it before any read, and a
  // placeholder here would be a value that never reaches an outcome.
  let exitCode: number;

  // --- build step -------------------------------------------------------
  const built = await runner.run({ command: build, step: 'build', repoPath });
  if (built.isErr()) return err(built.error);
  durationMs += built.value.durationMs;
  exitCode = built.value.exitCode;
  stdout.push(...built.value.stdout);
  stderr.push(...built.value.stderr);

  if (exitCode !== 0) {
    // A build failure is terminal: there is nothing to test, and repeating a
    // failing build would only produce the same failure.
    return ok({
      pass: false,
      command: `${build} && ${test}`,
      exitCode,
      durationMs,
      logs: { stdout: boundLogs(stdout, maxLines), stderr: boundLogs(stderr, maxLines) },
      flaky: false,
      ecosystem,
      backend: runner.backend,
    });
  }

  // --- test step, repeated for flaky detection --------------------------
  const detectFlaky = opts.detectFlaky !== false;
  const first = await runner.run({ command: test, step: 'test', repoPath });
  if (first.isErr()) return err(first.error);
  durationMs += first.value.durationMs;
  exitCode = first.value.exitCode;
  stdout.push(...first.value.stdout);
  stderr.push(...first.value.stderr);
  const firstPassed = exitCode === 0;

  let flaky = false;
  if (detectFlaky) {
    const second = await runner.run({ command: test, step: 'test', repoPath });
    if (second.isErr()) return err(second.error);
    durationMs += second.value.durationMs;
    stdout.push(...second.value.stdout);
    stderr.push(...second.value.stderr);
    const secondPassed = second.value.exitCode === 0;
    // The reported exit code is the first run's when both fail, and zero when
    // either passes — so `pass` and `exitCode` never disagree.
    exitCode = firstPassed || secondPassed ? 0 : first.value.exitCode;
    flaky = firstPassed !== secondPassed;
  }

  return ok({
    // "Pass if any pass" (P-155 step 2): a suite that passes on retry is
    // buildable, and `flaky` carries the caveat so the loop can decide.
    pass: exitCode === 0,
    command: `${build} && ${test}`,
    exitCode,
    durationMs,
    logs: { stdout: boundLogs(stdout, maxLines), stderr: boundLogs(stderr, maxLines) },
    flaky,
    ecosystem,
    backend: runner.backend,
  });
}

/** Tool schema. */
export const runBuildSchema = {
  ecosystem: z.enum(['node', 'python', 'rust', 'go']).optional(),
  repoPath: z.string().optional(),
  detectFlaky: z.boolean().optional(),
  maxLogLines: z.number().int().positive().optional(),
} satisfies Record<string, z.ZodTypeAny>;

const runBuildObject = z.object(runBuildSchema);

/** `run_build` — `autonomy: 'auto'`; it is verify-only and writes nothing. */
export const runBuildTool: ToolDefinition = {
  name: 'run_build',
  description:
    'Verify the staged repo by running its build and test inside the sandbox. Returns pass/fail, exit code, and bounded logs. Never builds on the host.',
  schema: runBuildSchema,
  autonomy: 'auto',
  execute: async (args: unknown, ctx: ToolContext): Promise<Result<unknown, StitchError>> => {
    const parsed = runBuildObject.safeParse(args);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map(i => `${i.path.length > 0 ? '/' + i.path.join('/') : '(root)'}: ${i.message}`)
        .join('; ');
      return err({
        code: 'TOOL_ARGS_VALIDATION',
        message: `run_build arguments validation failed: ${issues}`,
      });
    }
    const { ecosystem, repoPath, detectFlaky, maxLogLines } = parsed.data;
    // When the caller omits the ecosystem, the staged listing decides — which
    // is what "from P-115 parser metadata" means.
    const resolved = ecosystem ?? (await inferEcosystem(ctx));
    if (resolved === undefined) {
      return err({
        code: 'CONFIG_ERROR',
        field: 'ecosystem',
        message:
          'run_build could not determine the stage ecosystem; pass one explicitly (node | python | rust | go)',
      });
    }
    return runBuildForStage(
      ctx,
      { ecosystem: resolved },
      {
        ...(repoPath === undefined ? {} : { repoPath }),
        ...(detectFlaky === undefined ? {} : { detectFlaky }),
        ...(maxLogLines === undefined ? {} : { maxLogLines }),
      }
    );
  },
};

/** Human-readable summary for the CLI/web, derived from an outcome. */
export function describeOutcome(outcome: BuildOutcome): string {
  const verdict = outcome.pass ? 'PASS' : 'FAIL';
  const flaky = outcome.flaky ? ' (flaky — test runs disagreed)' : '';
  return `${verdict}${flaky} ${outcome.command} via ${outcome.backend} in ${outcome.durationMs}ms`;
}
