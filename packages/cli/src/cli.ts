// P-189 — the CLI shell: global options, exit-code convention, and error mapping.
//
// Three deliberate properties:
//
//   1. COMMANDER NEVER CALLS `process.exit`. `exitOverride()` turns every commander
//      exit into a thrown `CommanderError`, so the exit code is decided in ONE place
//      (`main`) that a test can call directly — rather than being a side effect of
//      parsing that only an integration test could observe.
//   2. THE EXIT-CODE CONVENTION IS EXPLICIT: 0 success, 1 known error, 2 usage.
//      The phase's acceptance criteria also require an UNKNOWN COMMAND to exit 1 (and
//      the phase's own test is named `unknown command exits 1`), so commander's
//      option/argument faults map to 2 while `commander.unknownCommand` maps to 1.
//      That satisfies both bullets literally instead of picking one and breaking the
//      other.
//   3. ERRORS ARE RENDERED, NOT DUMPED. A command's `StitchError` goes through
//      `printStitchError` (P-203: code + message + the P-163 hint + a next
//      step, stack under `--trace`/`-V`), and its EXIT CODE comes from
//      `exitFor` — one typed map, one renderer, for every command.
//
// No-throw: `main` returns a NUMBER (the exit code) and never throws outward; a
// `Result` maps to a code via {@link exitCodeForResult}. The only `throw` is the one
// commander raises internally, which `main` catches.

import { CommanderError, InvalidArgumentError, type Command } from 'commander';
import { cloneRepo, listFiles, toPosix } from '@repo-stitcher/core';
import { err, ok, type Result } from 'neverthrow';
import type { StitchError } from '@repo-stitcher/core';
import { join, relative, resolve } from 'node:path';
import { askSelect, promptText } from './ui/prompt.js';
import { parseGlobal, type GlobalOptions } from './globals.js';
import { init } from './commands/init.js';
import { add, looksRemote } from './commands/add.js';
import { serve } from './commands/serve.js';
import { audit } from './commands/audit.js';
import { status } from './commands/status.js';
import {
  license,
  type LicensePromptContext,
  type LicensePromptResult,
} from './commands/license.js';
import { deps, type DepsPromptContext } from './commands/deps.js';
import { evalRate, type EvalRateOptions } from './commands/eval_rate.js';
import { evalRun, type EvalRunOptions } from './commands/eval.js';
import { configCommand, type ConfigCommandOptions } from './commands/config.js';
import { defaultStoreDir, openStore, readSources, type JsonValue } from './config.js';
import { applyColorMode, resetColorMode } from './theme.js';
import {
  exitFor,
  ExitCode,
  ExitError,
  printStitchError,
  resetDiagnostics,
  setDiagnostics,
} from './errors.js';

/** Clean run. */
export const EXIT_OK = 0;
/** A known, reported failure (a command's `StitchError`). */
export const EXIT_ERROR = 1;
/** The invocation itself was wrong (a bad option or missing argument). */
export const EXIT_USAGE = 2;

/**
 * Commander codes that are the CALLER's mistake rather than a runtime failure.
 *
 * Verified against `commander@15.0.0`'s typings — note there is NO `onCommandNotFound`
 * method in that version, which is why the unknown-command path is expressed here as
 * the `commander.unknownCommand` code instead.
 */
const USAGE_CODES: readonly string[] = [
  'commander.unknownOption',
  'commander.missingArgument',
  'commander.optionMissingArgument',
  'commander.missingMandatoryOptionValue',
  'commander.invalidArgument',
  'commander.excessArguments',
];

/**
 * Shared selection resolver: a local dir is used as-is; `owner/repo` is
 * shallow-cloned into the cache (P-069) so the selection is pinned to a real
 * commit (P-181). Used by `add` and `license`.
 */
export async function defaultResolveSource(
  source: string,
  opts: { ref?: string; offline: boolean }
): Promise<Result<string, StitchError>> {
  if (!looksRemote(source)) return ok(resolve(source));
  const targetDir = join(defaultStoreDir(), 'cache', source.replace(/\//g, '__'));
  const cloned = await cloneRepo({
    url: `https://github.com/${source}.git`,
    targetDir,
    shallow: true,
    depth: 1,
    ...(opts.ref !== undefined ? { branch: opts.ref } : {}),
  });
  return cloned.isOk() ? ok(targetDir) : err(cloned.error);
}

/**
 * P-198 wrapper for the license prompt: one askSelect per pending unknown.
 * The options ARE the decision; an unanswerable surface (a cancelled escape
 * included — the wrappers reject typed `USER_CANCELLED` and the command's
 * catch degrades to 'skip') keeps the entry pending rather than killing the
 * process mid-question.
 */
async function defaultLicensePrompt(ctx: LicensePromptContext): Promise<LicensePromptResult> {
  const decision = await askSelect(
    `license: ${ctx.package}@${ctx.version} declares "${ctx.rawLicense}"`,
    [
      { label: 'allow — accept this license for this package', value: 'allow' },
      { label: 'deny — mark an explicit deny for this package', value: 'deny' },
      { label: 'skip — leave the entry pending', value: 'skip' },
    ]
  );
  if (decision === 'allow') return 'allow';
  if (decision === 'deny') return 'deny';
  return 'skip';
}

/** Repeatable-option collector: `--allow A --allow B` → ['A','B']. */
function collectFlag(value: string, previous: string[] | undefined): string[] {
  return [...(previous ?? []), value];
}

/**
 * P-198 wrapper for the deps prompt: one promptText per needs-attention
 * conflict, phrased with each source's competing spec. An empty answer —
 * or a cancelled/failed surface, caught and degraded to null below — keeps
 * the conflict pending rather than killing the process.
 */
async function defaultDepsPrompt(ctx: DepsPromptContext): Promise<string | null> {
  const choices = Object.entries(ctx.values)
    .map(([label, spec]) => `${label} wants ${spec}`)
    .join('; ');
  try {
    const answer = await promptText(`deps: resolution for ${ctx.package} (${choices})`, {
      placeholder: 'type a spec, or press enter to skip',
    });
    const trimmed = (answer ?? '').trim();
    return trimmed.length === 0 ? null : trimmed;
  } catch {
    return null;
  }
}

/** How a commander fault should end the process. */
export interface ExitPlan {
  code: number;
  /** The line to surface, when commander has not already written one. */
  message?: string;
}

/**
 * Map a commander fault to an exit code.
 *
 * `--help` and `--version` are SUCCESS: they asked for information and got it. An
 * unknown command is a reported failure (1). Option/argument faults are usage (2).
 */
export function classifyCommanderError(error: CommanderError): ExitPlan {
  if (error.code === 'commander.helpDisplayed' || error.code === 'commander.version') {
    return { code: EXIT_OK };
  }
  if (error.code === 'commander.unknownCommand') {
    return { code: EXIT_ERROR, message: error.message };
  }
  if (USAGE_CODES.includes(error.code)) return { code: EXIT_USAGE, message: error.message };
  return { code: EXIT_ERROR, message: error.message };
}

/**
 * Attach the global options, the exit convention, and the `init`, `add`,
 * `serve`, `status`, `license`, and `deps` commands.
 *
 * `program.ts` remains the registry for the commands it owns (`doctor`).
 * The workspace commands are registered HERE — per phase mandate for `init`
 * (P-190 step 4: registering inside `program.ts` would close a cycle, since
 * `cli.ts` already imports `STITCH_VERSION` from it) and for consistency with
 * it: each registration wires the same global options via {@link globalOptionsOf}.
 * Registration is additive, so the globals stay testable on their own via
 * {@link buildCLI} on a bare `Command`.
 */
export function buildCLI(program: Command): Command {
  program
    // Name, description and version are already set by the program's owner
    // (`program.ts`). Re-declaring `version` here would register the flag twice and
    // commander throws on a duplicate — so this function owns only the GLOBAL
    // OPTIONS and the exit convention, which is the part P-189 is about.
    .option('-V, --verbose', 'increase log verbosity (error render includes stacks)')
    .option('-c, --config <path>', 'override the config file')
    .option('--trace', 'include full stack and error JSON in failure output (P-203)')
    .option('-y, --yes', 'assume yes for prompts')
    .option('--offline', 'do not reach the network')
    .option('-C, --cwd <dir>', 'working directory override')
    .option('--color <mode>', 'color mode: auto, dark, light, or off (P-202; default auto)')
    .option('--no-color', 'disable coloured output')
    // P-206 log controls. The LOG level is `levelFor`-derived (quiet > verbose);
    // --log/--log-json feed createLogger, the single logging entrypoint.
    .option(
      '--log <spec>',
      'log filter: module=level pairs or a bare level, repeatable (P-206)',
      collectFlag
    )
    .option('--log-json', 'emit structured NDJSON log lines (P-206)')
    .option('-q, --silent', 'suppress non-error log output; errors still show')
    .option('--quiet-error', 'with --silent, suppress even error output')
    .showHelpAfterError()
    .showSuggestionAfterError()
    .exitOverride();

  program
    .command('init')
    .description('Scaffold a stitch project (stitch.toml, .env.example, .gitignore)')
    .option('--force', 'overwrite an existing stitch.toml without prompting')
    .option('--provider <name>', 'validate and store an API key for this provider')
    .option('--no-key-prompt', 'do not prompt for a provider key')
    .action(async (options: InitCommandOptions) => {
      // The store is opened here, not inside `init`, so the module stays free of the
      // user's home directory and every persistence path is injectable in tests.
      const store = openStore();
      const result = await init(
        {
          ...globalOptionsOf(program),
          force: options.force === true,
          ...(options.provider !== undefined ? { provider: options.provider } : {}),
          ...(options.keyPrompt === false ? { keyPrompt: false } : {}),
        },
        { ...(store.isOk() ? { store: store.value } : {}) }
      );
      process.exitCode = exitCodeForResult(result, line => {
        process.stderr.write(`${line}\n`);
      });
    });

  program
    .command('add')
    .description('Record a source repo and the paths to bring into the child')
    .argument('<source>', 'a local directory, or owner/repo on GitHub')
    .argument('[paths...]', 'file or glob patterns to include')
    .option('--branch <ref>', 'pin a remote source to this ref')
    .option('--allow-empty', 'record a selection that matched nothing')
    .action(async (source: string, paths: string[], options: AddCommandOptions) => {
      const store = openStore();
      const result = await add(
        {
          ...globalOptionsOf(program),
          ...(options.branch !== undefined ? { branch: options.branch } : {}),
          ...(options.allowEmpty === true ? { allowEmpty: true } : {}),
        },
        { source, paths },
        {
          resolveSource: defaultResolveSource,
          // Core's canonical glob (P-034). `listFiles` yields ABSOLUTE posix paths, so
          // they are re-based on the source dir before `add` sees them.
          expand: async (dir, patterns) => {
            const found = await listFiles(dir, [...patterns]);
            return found.isOk()
              ? ok(found.value.map(path => toPosix(relative(dir, path))).sort())
              : err(found.error);
          },
          loadSources: () =>
            store.isErr() ? err(store.error) : readSources(store.value.get('sources')),
          saveSources: sources =>
            store.isErr()
              ? err(store.error)
              : store.value.set('sources', sources as unknown as JsonValue),
        }
      );
      process.exitCode = exitCodeForResult(result, line => {
        process.stderr.write(`${line}\n`);
      });
    });

  program
    .command('serve')
    .description('Start the local HTTP/WS server hosting the REST, WS, and built web UI')
    .option('--host <host>', 'bind address (default 127.0.0.1)')
    .option('--port <port>', 'HTTP port (default 3434)')
    .option('--no-web', 'skip serving the built web UI; keep /health, /api, /ws')
    // P-204 perf flags (parse/validate shared with merge in flags.ts).
    .option('--jobs <n>', 'parallel sandbox/build jobs (default: cpu count)', perfArg)
    .option('--memory <mb>', 'sandbox/agent memory cap in MB (default 2048)', perfArg)
    .option('--timeout <s>', 'whole-operation cap in seconds, 0 = unlimited (default 0)', perfArg)
    .option('--max-files <n>', 'selection file-count cap (default 50000)', perfArg)
    .option('--max-size <mb>', 'selection size cap in MB (default 512)', perfArg)
    .option('--concurrency <n>', 'AI/dependency async-call concurrency (default 8)', perfArg)
    .action(async (options: ServeCommandOptions) => {
      const result = await serve(
        {
          ...globalOptionsOf(program),
          ...(options.host !== undefined ? { host: options.host } : {}),
          ...(options.port !== undefined ? { port: options.port } : {}),
          ...(options.web === false ? { web: false } : {}),
          ...(options.jobs !== undefined ? { jobs: options.jobs } : {}),
          ...(options.memory !== undefined ? { memory: options.memory } : {}),
          ...(options.timeout !== undefined ? { timeout: options.timeout } : {}),
          ...(options.maxFiles !== undefined ? { maxFiles: options.maxFiles } : {}),
          ...(options.maxSize !== undefined ? { maxSize: options.maxSize } : {}),
          ...(options.concurrency !== undefined ? { concurrency: options.concurrency } : {}),
        },
        {}
      );
      process.exitCode = exitCodeForResult(
        result.map(() => undefined),
        line => {
          process.stderr.write(`${line}\n`);
        }
      );
    });

  program
    .command('audit')
    .description('Read the provenance and AI-call audit logs (compliance view)')
    .option('--from <ts>', 'inclusive lower time bound (ISO string, P-207)')
    .option('--to <ts>', 'inclusive upper time bound (ISO string, P-207)')
    .option('--actor <who>', 'only rows by this actor (P-207)')
    .option('--export <format>', 'export format: json or md (P-207)')
    .option('--no-ai', 'hide the AI-call section (P-207)')
    .option('-f, --follow', 'tail new records until interrupted (P-207)')
    .action(async (options: AuditCommandOptions) => {
      const result = await audit(
        {
          ...globalOptionsOf(program),
          ...(options.from !== undefined ? { from: options.from } : {}),
          ...(options.to !== undefined ? { to: options.to } : {}),
          ...(options.actor !== undefined ? { actor: options.actor } : {}),
          ...(options.export !== undefined ? { export: options.export } : {}),
          ...(options.ai === false ? { noAi: true } : {}),
          ...(options.follow === true ? { follow: true } : {}),
        },
        {}
      );
      // Read-only by mandate: the audit view always resolves ok on a read.
      process.exitCode = exitCodeForResult(result, line => {
        process.stderr.write(`${line}\n`);
      });
    });

  program
    .command('status')
    .description('Show workspace status: config, sources, HIL gates, jobs, sandbox, checksums')
    .option('--json', 'emit the structured status report as JSON')
    .action(async (options: StatusCommandOptions) => {
      const result = await status(
        {
          ...globalOptionsOf(program),
          ...(options.json === true ? { json: true } : {}),
        },
        {}
      );
      // Informational by mandate: status itself always resolves ok (section
      // failures are printed in their section), so this stays 0 in practice.
      process.exitCode = exitCodeForResult(result, line => {
        process.stderr.write(`${line}\n`);
      });
    });

  program
    .command('license')
    .description('Show the license posture of the current selection (P-118–P-128)')
    .option('--json', 'emit the full license report data as JSON')
    .option(
      '--allow <licenseId>',
      'record an allowed license id (exact SPDX, validated via P-119; repeatable)',
      collectFlag
    )
    .option(
      '--deny <licenseId>',
      'record a denied license id (exact SPDX, validated via P-119; repeatable)',
      collectFlag
    )
    .action(async (options: LicenseCommandOptions) => {
      const globals = globalOptionsOf(program);
      const store = openStore();
      // Interactive only when a TTY is watching and --yes did not suppress it;
      // the prompt surface is the shared P-198 picker (askSelect).
      const interactive = process.stdout.isTTY === true && globals.yes !== true;
      const result = await license(
        {
          ...globals,
          ...(options.json === true ? { json: true } : {}),
          ...(options.allow !== undefined ? { allow: options.allow } : {}),
          ...(options.deny !== undefined ? { deny: options.deny } : {}),
        },
        {
          ...(store.isOk() ? { store: store.value } : {}),
          resolveSource: defaultResolveSource,
          ...(interactive ? { prompt: defaultLicensePrompt } : {}),
        }
      );
      process.exitCode = exitCodeForResult(result, line => {
        process.stderr.write(`${line}\n`);
      });
    });

  program
    .command('deps')
    .description('Preview the dependency merge for the selected sources (P-104–P-116)')
    .option('--json', 'emit the DependencyReport (one per ecosystem, as JSON)')
    .option('--auto', 'apply the resolver\u2019s suggestion to every fixable conflict')
    .option('--lockfile', 'regenerate the ecosystem lockfile for the merged manifest')
    .action(async (options: DepsCommandOptions) => {
      const globals = globalOptionsOf(program);
      const store = openStore();
      // Interactive only when a TTY is watching and --yes did not suppress it;
      // the prompt surface is the shared P-198 picker (promptText).
      const interactive = process.stdout.isTTY === true && globals.yes !== true;
      const result = await deps(
        {
          ...globals,
          ...(options.json === true ? { json: true } : {}),
          ...(options.auto === true ? { auto: true } : {}),
          ...(options.lockfile === true ? { lockfile: true } : {}),
        },
        {
          ...(store.isOk() ? { store: store.value } : {}),
          resolveSource: defaultResolveSource,
          ...(interactive ? { prompt: defaultDepsPrompt } : {}),
        }
      );
      process.exitCode = exitCodeForResult(result, line => {
        process.stderr.write(`${line}\n`);
      });
    });

  const evalCommand = program.command('eval').description('Run the eval corpus headlessly (P-323)');
  evalCommand
    .command('run')
    .description('Run every corpus pair and write the per-pair results')
    .option('--corpus <path>', 'the corpus directory (or a pairs.json path)')
    .option('--parallel <n>', 'how many pairs run at once (1-16)')
    .option('--output-dir <path>', 'where the per-pair results and the summary are written')
    .option('--timeout <ms>', 'the per-pair budget in milliseconds')
    .option('--json', 'print the run summary as JSON')
    .action(async (options: EvalRunOptions) => {
      const globals = globalOptionsOf(program);
      process.exitCode = await evalRun({ ...globals, ...options });
    });
  evalCommand
    .command('rate')
    .description('Score a corpus pair with the human rubric (P-326)')
    .argument('<pair-id>', 'the corpus pair to score')
    .option('--result-dir <path>', 'where the harness wrote the per-pair results')
    .option('--rater <id>', 'who is scoring (recorded with the score)')
    .option('--json', 'print the saved rubric as JSON')
    .action(async (pairId: string, options: EvalRateOptions) => {
      const globals = globalOptionsOf(program);
      process.exitCode = await evalRate(pairId, { ...globals, ...options });
    });

  program
    .command('config')
    .description('Print the merged effective project config (defaults + stitch.toml + env) as JSON')
    .option('--edit', 'open stitch.toml in $VISUAL/$EDITOR and validate on close (P-201)')
    .option('--no-loop', 'with --edit: validate once, do not re-open on an invalid save')
    .action(async (options: ConfigCommandOptions) => {
      const globals = globalOptionsOf(program);
      const result = await configCommand(
        {
          ...(options.edit === true ? { edit: true } : {}),
          ...(options.loop === false ? { loop: false } : {}),
          ...(globals.configPath !== undefined ? { config: globals.configPath } : {}),
          ...(globals.cwd !== undefined ? { cwd: globals.cwd } : {}),
        },
        {}
      );
      process.exitCode = exitCodeForResult(
        result.map(() => undefined),
        line => {
          process.stderr.write(`${line}\n`);
        }
      );
    });

  // P-202: the `--color <mode>` override must be installed BEFORE any action
  // paints (actions run during parseAsync), and preAction is the one official
  // point commander gives that runs after option parsing but before every
  // action handler. `--no-color` never reaches the THEME module on its own
  // (commander does not write NO_COLOR), so a literal `false` maps to `off`
  // here too — that pairing was a live gap this phase closes: `theme()` reads
  // env, not options, and only deps.ts checked opts.color locally.
  program.hook('preAction', () => {
    const globals = parseGlobal(program.opts());
    setDiagnostics(globals.trace === true, globals.verbose === true);
    if (globals.colorMode !== undefined) applyColorMode(globals.colorMode);
    else if (globals.color === false) applyColorMode('off');
  });

  return program;
}

/** The options commander hands `stitch license`. */
interface LicenseCommandOptions {
  json?: boolean;
  allow?: string[];
  deny?: string[];
}

/** The options commander hands `stitch deps`. */
interface DepsCommandOptions {
  json?: boolean;
  auto?: boolean;
  lockfile?: boolean;
}

/** The options commander hands `stitch status`. */
interface StatusCommandOptions {
  json?: boolean;
}

/** The options commander hands `stitch add`. */
interface AddCommandOptions {
  branch?: string;
  allowEmpty?: boolean;
}

/** The options commander hands `stitch serve`. */
interface ServeCommandOptions {
  host?: string;
  /** A string until `serve` normalizes it (integer 1-65535). */
  port?: string;
  /** Commander's `--no-web` sets this to `false`. */
  web?: boolean;
  // P-204 perf flags — commander hands strings; `parsePerfFlags` owns the
  // range validation (out-of-range = config error, exit 3).
  jobs?: string;
  memory?: string;
  timeout?: string;
  maxFiles?: string;
  maxSize?: string;
  concurrency?: string;
}

/**
 * P-204: the CLI-face guard for the perf flags. A MALFORMED value (not a plain
 * non-negative integer) is USAGE — throwing `InvalidArgumentError` routes
 * through commander's `invalidArgument` fault, which P-203 maps to exit 2.
 * Well-formed integers out of RANGE are the command's `CONFIG_ERROR` (exit 3),
 * decided by `parsePerfFlags` inside the command.
 */
function perfArg(value: string): string {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new InvalidArgumentError(`expected a non-negative integer, got "${value}"`);
  }
  return trimmed;
}

/** The options commander hands `stitch audit`. */
interface AuditCommandOptions {
  from?: string;
  to?: string;
  actor?: string;
  export?: string;
  /** Commander's `--no-ai` sets this to `false`. */
  ai?: boolean;
  follow?: boolean;
}

/**
 * readSources has moved to `config.ts` (P-194): it validates a store shape, so
 * it belongs beside `StitchStore` — and `commands/status.ts` imports it from
 * there, keeping the command free of a shell import.
 */

/** The options commander hands `stitch init`. */
interface InitCommandOptions {
  force?: boolean;
  provider?: string;
  keyPrompt?: boolean;
}

/** The typed globals a parsed program carries. */
export function globalOptionsOf(program: Command): GlobalOptions {
  return parseGlobal(program.opts());
}

/**
 * Map a command's `Result` to an exit code, writing the rendered error on
 * failure. P-203: the code comes from `exitFor` (the full typed map — config
 * 3, path 4, HIL 10, license 20, sandbox 30, AI 40, deps 50, internal 70) and
 * the render is `printStitchError` (code + message + hint + next step, stack
 * under `--trace`/`-V`). `write` is injected so the mapping is assertable
 * without capturing stdout.
 */
export function exitCodeForResult(
  result: Result<void, StitchError>,
  write: (line: string) => void
): number {
  if (result.isOk()) return ExitCode.OK;
  write(printStitchError(result.error));
  return exitFor(result.error);
}

/** Is this the commander fault we expect from `exitOverride`? */
function isCommanderError(value: unknown): value is CommanderError {
  return value instanceof CommanderError;
}

/**
 * Run the CLI and return the process exit code.
 *
 * Takes the argv explicitly (defaulting to the process's) so a test can drive it with
 * `['stitch', 'nope']` and assert the code, instead of spawning a process.
 */
export async function main(
  argv: readonly string[] = process.argv,
  build: (() => Command) | undefined = undefined
): Promise<number> {
  // The program builder is injected so this stays testable and so `program.ts`
  // (which owns the command list) is not imported here into a cycle.
  const program = buildCLI(build === undefined ? await defaultProgram() : build());
  // P-202/P-203: fresh process state per run — color mode and diagnostic
  // switches are sticky module state, and tests (or an embedded runner) may
  // call main() multiple times.
  resetColorMode();
  resetDiagnostics();
  // P-323 — a command may set process.exitCode itself (the eval harness
  // reports "a pair failed" with exit 1). Reset it per run so a previous run
  // in the same process cannot leak into this one.
  process.exitCode = undefined;
  try {
    // Default `from` is 'node': `process.argv` carries the [node, script, ...args]
    // prefix, which is exactly what this receives.
    await program.parseAsync([...argv]);
    return process.exitCode === undefined ? EXIT_OK : process.exitCode;
  } catch (cause: unknown) {
    if (isCommanderError(cause)) {
      const plan = classifyCommanderError(cause);
      // commander has already written its own message; only surface ours when it
      // produced none, so an error is never printed twice.
      if (plan.message !== undefined && plan.code === ExitCode.ERROR) {
        process.stderr.write(`${plan.message}\n`);
      }
      return plan.code;
    }
    if (cause instanceof ExitError) return cause.exitCode;
    // P-203: an escape from the no-throw world is internal by definition —
    // rendered through the one entrypoint, WITH its stack (spec: 70 + stack).
    process.stderr.write(`${printStitchError(cause, { trace: true })}\n`);
    return ExitCode.INTERNAL;
  }
}

/** The default program: the root command list from `program.ts`. */
async function defaultProgram(): Promise<Command> {
  const { createProgram } = await import('./program.js');
  return createProgram();
}
