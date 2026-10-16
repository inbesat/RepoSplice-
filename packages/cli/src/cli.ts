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
//   3. ERRORS ARE RENDERED, NOT DUMPED. A command's `StitchError` goes through core's
//      `friendlyError` (P-163) so the user sees the rule's hint, and the raw code
//      never reaches stdout.
//
// No-throw: `main` returns a NUMBER (the exit code) and never throws outward; a
// `Result` maps to a code via {@link exitCodeForResult}. The only `throw` is the one
// commander raises internally, which `main` catches.

import { CommanderError, type Command } from 'commander';
import { friendlyError } from '@repo-stitcher/core';
import type { Result } from 'neverthrow';
import type { StitchError } from '@repo-stitcher/core';
import { parseGlobal, type GlobalOptions } from './globals.js';
import { init } from './commands/init.js';
import { openStore } from './config.js';

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
 * Attach the global options, the exit convention, and the `init` command.
 *
 * `program.ts` remains the registry for the commands it owns (`status`, `doctor`).
 * `init` is registered HERE because P-190 step 4 says so and because `program.ts`
 * importing this module would close a cycle (`this` already imports `STITCH_VERSION`
 * from `program.ts`). Registration is additive, so the globals stay testable on their
 * own via {@link buildCLI} on a bare `Command`.
 */
export function buildCLI(program: Command): Command {
  program
    // Name, description and version are already set by the program's owner
    // (`program.ts`). Re-declaring `version` here would register the flag twice and
    // commander throws on a duplicate — so this function owns only the GLOBAL
    // OPTIONS and the exit convention, which is the part P-189 is about.
    .option('-V, --verbose', 'increase log verbosity')
    .option('-c, --config <path>', 'override the config file')
    .option('-y, --yes', 'assume yes for prompts')
    .option('--offline', 'do not reach the network')
    .option('-C, --cwd <dir>', 'working directory override')
    .option('--no-color', 'disable coloured output')
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

  return program;
}

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
 * Map a command's `Result` to an exit code, writing the friendly line on failure.
 *
 * `write` is injected so the mapping is assertable without capturing stdout.
 */
export function exitCodeForResult(
  result: Result<void, StitchError>,
  write: (line: string) => void
): number {
  if (result.isOk()) return EXIT_OK;
  write(friendlyError(result.error));
  return EXIT_ERROR;
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
  try {
    // Default `from` is 'node': `process.argv` carries the [node, script, ...args]
    // prefix, which is exactly what this receives.
    await program.parseAsync([...argv]);
    return EXIT_OK;
  } catch (cause: unknown) {
    if (isCommanderError(cause)) {
      const plan = classifyCommanderError(cause);
      // commander has already written its own message; only surface ours when it
      // produced none, so an error is never printed twice.
      if (plan.message !== undefined && plan.code === EXIT_ERROR) {
        process.stderr.write(`${plan.message}\n`);
      }
      return plan.code;
    }
    const detail = cause instanceof Error ? cause.message : String(cause);
    process.stderr.write(`${detail}\n`);
    return EXIT_ERROR;
  }
}

/** The default program: the root command list from `program.ts`. */
async function defaultProgram(): Promise<Command> {
  const { createProgram } = await import('./program.js');
  return createProgram();
}
