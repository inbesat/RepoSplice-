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
import { cloneRepo, friendlyError, listFiles, toPosix } from '@repo-stitcher/core';
import { err, ok, type Result } from 'neverthrow';
import type { StitchError } from '@repo-stitcher/core';
import { join, relative, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { parseGlobal, type GlobalOptions } from './globals.js';
import { init } from './commands/init.js';
import { add, looksRemote } from './commands/add.js';
import { serve } from './commands/serve.js';
import { status } from './commands/status.js';
import {
  license,
  type LicensePromptContext,
  type LicensePromptResult,
} from './commands/license.js';
import { defaultStoreDir, openStore, readSources, type JsonValue } from './config.js';

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
 * P-198 stand-in for the license prompt: one plain readline question per
 * pending unknown. A closed/EOF stdin degrades to 'skip' — the entry stays
 * pending rather than the process dying mid-question.
 */
async function defaultLicensePrompt(ctx: LicensePromptContext): Promise<LicensePromptResult> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(
      `license: ${ctx.package}@${ctx.version} declares "${ctx.rawLicense}" — [a]llow, [d]eny, [s]kip? `
    );
    const normalized = answer.trim().toLowerCase();
    if (normalized.startsWith('a')) return 'allow';
    if (normalized.startsWith('d')) return 'deny';
    return 'skip';
  } catch {
    return 'skip';
  } finally {
    rl.close();
  }
}

/** Repeatable-option collector: `--allow A --allow B` → ['A','B']. */
function collectFlag(value: string, previous: string[] | undefined): string[] {
  return [...(previous ?? []), value];
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
 * `serve`, `status`, and `license` commands.
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
    .action(async (options: ServeCommandOptions) => {
      const result = await serve(
        {
          ...globalOptionsOf(program),
          ...(options.host !== undefined ? { host: options.host } : {}),
          ...(options.port !== undefined ? { port: options.port } : {}),
          ...(options.web === false ? { web: false } : {}),
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
      // the prompt surface itself is the P-198 stand-in (readline).
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

  return program;
}

/** The options commander hands `stitch license`. */
interface LicenseCommandOptions {
  json?: boolean;
  allow?: string[];
  deny?: string[];
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
