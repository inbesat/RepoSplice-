import type { Command } from 'commander';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildDoctorChecks,
  loadConfig,
  ok,
  runDoctor,
  type DependencyCheck,
  type DoctorReport,
  type CheckOutcome,
  type ProcessRunner,
  type Result,
  type StitchError,
} from '@repo-stitcher/core';
import { STITCH_CONFIG_FILE, defaultStoreDir, openStore, providerNames } from '../config.js';
import { makeBunCheck, makeNodeCheck } from '../checks/system.js';
import { theme } from '../theme.js';

/**
 * `stitch doctor` command (P-068, extended P-195). Verifies system
 * dependencies through core's public API only (P-013): git, git-filter-repo,
 * docker, plus the configured optionals (local AI, GitHub token); P-195 adds
 * the TECH_STACK runtime versions (bun critical, node fallback) and the two
 * project-level rows — config validity and provider-key presence — behind
 * injectable probes, since the checks themselves must stay pure + test-safe.
 *
 * Exit codes: 0 when every CRITICAL check passes and (with `--strict`) no
 * check at all failed; 1 when a critical check fails, or `--strict` saw any
 * failure (optional failures are otherwise informational — docker falls back
 * to GH Actions, optionals degrade); 2 when the runner itself breaks (not a
 * failed check: a broken probe harness). Never throws, never prompts: safe
 * to run in CI.
 *
 * Init first-run wiring (P-190) is deferred: no `init` command exists yet
 * in this package, so there is nothing to hook. P-190 calls
 * runDoctorCommand (or parse `['doctor']`) when it lands.
 */

/** Flags for `stitch doctor`. Mirrors the StatusOptions pattern. */
export type DoctorOptions = {
  json?: boolean;
  all?: boolean;
  /** P-195: exit 1 when ANY check fails, including the informational ones. */
  strict?: boolean;
};

/** Injectable seams: tests drive the command without touching the machine. */
export interface DoctorCommandDeps {
  checks?: DependencyCheck[];
  execute?: () => Promise<Result<DoctorReport, StitchError>>;
  write?: (line: string) => void;
  /** Version-probe runners for the P-195 bun/node checks. */
  bunRun?: ProcessRunner;
  nodeRun?: ProcessRunner;
  /** Returns the reason the config is invalid, or undefined when it loads. */
  configProbe?: () => string | undefined;
  /** Returns the providers whose API key is resolvable without reading values. */
  providerProbe?: () => readonly string[];
}

function renderCheckHuman(outcome: CheckOutcome): string[] {
  // P-195's pass/warn/fail report: a failing non-critical check is WARN, not
  // FAIL — FAIL stays reserved for critical checks (which decide the exit).
  const marker = outcome.pass
    ? theme('ok', 'PASS')
    : outcome.critical
      ? theme('err', 'FAIL')
      : theme('warn', 'WARN');
  const scope = outcome.critical ? '' : ' (optional)';
  const lines = [`${marker} ${outcome.label}${scope}`, `  ${outcome.detail}`];
  if (outcome.fix !== undefined) {
    lines.push(`  fix: ${outcome.fix}`);
  }
  return lines;
}

/**
 * renderDoctorReport: pure render behind the action (the same split the
 * `status` command uses in commands/status.ts, so tests assert without
 * capturing stdout).
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
    case 'LOCKFILE_GENERATION_FAILED':
      return `doctor failed to run: ${error.code}: ${error.command} exit ${error.exitCode}`;
    case 'LOCKFILE_NOT_CREATED':
      return `doctor failed to run: ${error.code}: ${error.lockfilePath}`;
    case 'LICENSE_SCAN_FAILED':
      return `doctor failed to run: ${error.code}: ${error.message}`;
    case 'UNSUPPORTED_ECOSYSTEM':
      return `doctor failed to run: ${error.code}: ${error.ecosystem}`;
    default:
      return `doctor failed to run: ${error.code}: ${error.message}`;
  }
}

/**
 * The config row (P-195): load + validate against the P-200 schema.
 *
 * `loadConfig` (P-192 precedent) is synchronous and throwing; a throw is the
 * invalid signal, so the default probe catches and degrades it to a reason.
 * Nothing builds the env layer that would carry a real GitHub token yet
 * (ADR-079), so on a token-less machine this FAILS with that exact reason —
 * truthful, and it is exactly what doctor exists to surface. The check is
 * informational (critical: false): per the phase, only `--strict` promotes it
 * to an exit failure.
 */
export function makeConfigCheck(configProbe: () => string | undefined): DependencyCheck {
  return {
    id: 'config',
    label: 'config validity (P-200 schema)',
    critical: false,
    check: async () => {
      const invalid = configProbe();
      if (invalid === undefined) {
        return ok({ pass: true, detail: 'config loads and validates against the schema' });
      }
      return ok({
        pass: false,
        detail: `config invalid: ${invalid}`,
        fix: 'set github.token / GITHUB_TOKEN or fix the named issue (stitch init writes the template)',
      });
    },
  };
}

/**
 * The provider-key row (P-195): at least one resolvable provider credential —
 * an env name from PROVIDER_ENV_KEYS, or a nested `<provider>.apiKey` store
 * key, values never read (config.ts's providerNames). The phase's
 * `[ai].provider` does not exist (no such section; ADR-076), so "has a
 * provider to run against" is the reconciled question, warned (never failed)
 * without --strict.
 */
export function makeProviderCheck(providerProbe: () => readonly string[]): DependencyCheck {
  return {
    id: 'provider-key',
    label: 'provider API key resolvable',
    critical: false,
    check: async () => {
      const providers = providerProbe();
      if (providers.length === 0) {
        return ok({
          pass: false,
          detail:
            'no provider credential resolvable (PROVIDER_ENV_KEYS env names, or <provider>.apiKey in the user store)',
          fix: 'stitch init --provider <name>, or export a documented provider env var',
        });
      }
      return ok({ pass: true, detail: `configured: ${providers.join(', ')}` });
    },
  };
}

/**
 * The default probe set in run order: core's dep checks (system rows first,
 * then optionals per --all), P-195's bun/node runtime rows, and the two
 * P-195 project rows (config validity, provider key). Store access follows
 * the open-only-if-exists rule (ADR-079 point 5) — doctor must not create
 * `~/.stitch/config.json` just by being run.
 */
function defaultChecks(deps: DoctorCommandDeps, options: DoctorOptions): DependencyCheck[] {
  const storeDir = defaultStoreDir();
  return [
    ...buildDoctorChecks({ includeGitHubToken: options.all === true }),
    makeBunCheck(deps.bunRun),
    makeNodeCheck(deps.nodeRun),
    makeConfigCheck(
      deps.configProbe ??
        (() => {
          try {
            loadConfig();
            return undefined;
          } catch (cause: unknown) {
            return cause instanceof Error ? cause.message : String(cause);
          }
        })
    ),
    makeProviderCheck(
      deps.providerProbe ??
        (() => {
          if (existsSync(join(storeDir, STITCH_CONFIG_FILE)) === false) {
            return providerNames(null);
          }
          const store = openStore(storeDir);
          return providerNames(store.isErr() ? null : store);
        })
    ),
  ];
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
  const execute = deps.execute ?? (() => runDoctor(deps.checks ?? defaultChecks(deps, options)));
  const result = await execute();
  if (result.isErr()) {
    write(renderRunnerError(result.error));
    return 2;
  }
  const report = result.value;
  write(renderDoctorReport(report, options));
  const strictFailed = options.strict === true && report.checks.some(check => !check.pass);
  return report.ok && !strictFailed ? 0 : 1;
}

/**
 * registerDoctorCommand: attach `stitch doctor [--json] [--all] [--strict]`
 * to the root program. `--all` enables the optional checks (local AI,
 * GitHub token); without it only the required git/filter-repo/docker run.
 * `--strict` promotes EVERY failed check (including the informational
 * config/provider rows) to an exit failure — the preflight gate CI uses.
 */
export function registerDoctorCommand(program: Command): void {
  program
    .command('doctor')
    .description('Verify system dependencies (git, git-filter-repo, docker)')
    .option('--json', 'emit the doctor report as JSON')
    .option('--all', 'include optional checks (local AI, GitHub token)')
    .option('--strict', 'exit 1 when any check fails, including informational ones')
    .action(async (options: DoctorOptions) => {
      process.exitCode = await runDoctorCommand(options);
    });
}
