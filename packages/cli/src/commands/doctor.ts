import type { Command } from 'commander';
import {
  buildDoctorChecks,
  runDoctor,
  type DependencyCheck,
  type DoctorReport,
  type CheckOutcome,
  type Result,
  type StitchError,
} from '@repo-stitcher/core';
import { theme } from '../theme.js';

/**
 * `stitch doctor` command (P-068). Verifies system dependencies through
 * core's public API only (P-013): git, git-filter-repo, docker, plus the
 * configured optionals (local AI, GitHub token).
 *
 * Exit codes: 0 when every CRITICAL check passes (optional failures are
 * informational — docker falls back to GH Actions, optionals degrade), 1
 * when any critical check fails, 2 when the runner itself breaks (not a
 * failed check: a broken probe harness). Never throws, never prompts:
 * safe to run in CI.
 *
 * Init first-run wiring (P-190) is deferred: no `init` command exists yet
 * in this package, so there is nothing to hook. P-190 calls
 * runDoctorCommand (or parse `['doctor']`) when it lands.
 */

/** Flags for `stitch doctor`. Mirrors the StatusOptions pattern. */
export type DoctorOptions = {
  json?: boolean;
  all?: boolean;
};

/** Injectable seams: tests drive the command without touching the machine. */
export interface DoctorCommandDeps {
  checks?: DependencyCheck[];
  execute?: () => Promise<Result<DoctorReport, StitchError>>;
  write?: (line: string) => void;
}

function renderCheckHuman(outcome: CheckOutcome): string[] {
  const marker = outcome.pass ? theme('ok', 'PASS') : theme('err', 'FAIL');
  const scope = outcome.critical ? '' : ' (optional)';
  const lines = [`${marker} ${outcome.label}${scope}`, `  ${outcome.detail}`];
  if (outcome.fix !== undefined) {
    lines.push(`  fix: ${outcome.fix}`);
  }
  return lines;
}

/**
 * renderDoctorReport: pure render behind the action (same split as
 * runStatus in program.ts, so tests assert without capturing stdout).
 * `--json` emits the stable DoctorReport shape; human mode paints
 * PASS/FAIL per check (P-044 theme) plus fix lines and a tally.
 */
export function renderDoctorReport(report: DoctorReport, options: DoctorOptions): string {
  if (options.json === true) {
    return JSON.stringify(report, null, 2);
  }
  const lines = ['stitch doctor'];
  for (const check of report.checks) {
    lines.push(...renderCheckHuman(check));
  }
  const passed = report.checks.filter(c => c.pass).length;
  lines.push(`${passed}/${report.checks.length} checks passed`);
  if (!report.ok) {
    lines.push(theme('err', 'critical check failed — see fix lines above'));
  }
  return lines.join('\n');
}

function renderRunnerError(error: StitchError): string {
  switch (error.code) {
    case 'USER_CANCELLED':
      return `doctor failed to run: ${error.code}: ${error.reason}`;
    case 'LICENSE_VIOLATION':
      return `doctor failed to run: ${error.code}: ${error.license}`;
    case 'DEPENDENCY_CONFLICT':
      return `doctor failed to run: ${error.code}: ${error.details}`;
    case 'SANDBOX_FAILED':
      return `doctor failed to run: ${error.code}: ${error.step}`;
    case 'COST_LIMIT':
      return `doctor failed to run: ${error.code}: ${error.provider}`;
    case 'UNKNOWN_LICENSE':
      return `doctor failed to run: ${error.code}: ${error.id}`;
    default:
      return `doctor failed to run: ${error.code}: ${error.message}`;
  }
}

/**
 * runDoctorCommand: execute (real probes by default, injected in tests),
 * render, and map the report to an exit code. Returns the code instead of
 * exiting so tests and P-190's first-run hook can reuse it; the commander
 * action assigns it to process.exitCode.
 */
export async function runDoctorCommand(
  options: DoctorOptions,
  deps: DoctorCommandDeps = {}
): Promise<number> {
  // console is allowed in CLI commands (AGENTS.md §4); logic stays pure above.
  const write = deps.write ?? console.log;
  const execute =
    deps.execute ??
    (() =>
      runDoctor(deps.checks ?? buildDoctorChecks({ includeGitHubToken: options.all === true })));
  const result = await execute();
  if (result.isErr()) {
    write(renderRunnerError(result.error));
    return 2;
  }
  const report = result.value;
  write(renderDoctorReport(report, options));
  return report.ok ? 0 : 1;
}

/**
 * registerDoctorCommand: attach `stitch doctor [--json] [--all]` to the
 * root program. `--all` enables the optional checks (local AI, GitHub
 * token); without it only the required git/filter-repo/docker run.
 */
export function registerDoctorCommand(program: Command): void {
  program
    .command('doctor')
    .description('Verify system dependencies (git, git-filter-repo, docker)')
    .option('--json', 'emit the doctor report as JSON')
    .option('--all', 'include optional checks (local AI, GitHub token)')
    .action(async (options: DoctorOptions) => {
      process.exitCode = await runDoctorCommand(options);
    });
}
