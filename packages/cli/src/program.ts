import { Command } from 'commander';

/** CLI version. Keep in sync with packages/cli/package.json until P-062 stamps it at build. */
export const STITCH_VERSION = '0.0.0';

/** Typed options for the `status` scaffold subcommand. */
export type StatusOptions = {
  json?: boolean;
};

/**
 * runStatus: pure scaffold behind `stitch status`. Returns the text the
 * command prints; the real workspace-status implementation lands with the
 * CLI epic (P-189+). Pure so tests assert without capturing stdout.
 */
export function runStatus(options: StatusOptions): string {
  if (options.json === true) {
    return JSON.stringify({ ok: true, scaffold: true });
  }
  return 'stitch status: scaffold (full implementation in P-189+)';
}

/**
 * createProgram: the root `stitch` program (P-189 owner). Registers global
 * flags and subcommands; later phases (init/add/merge/serve/status/doctor/
 * license/deps, P-189–P-207) attach their commands here. Callers parse with
 * `program.parse(argv, { from: 'user' })`; tests use `exitOverride()` to
 * keep `--help` from calling process.exit.
 */
export function createProgram(): Command {
  const program = new Command();
  program.name('stitch').description('AI-augmented multi-repo composition').version(STITCH_VERSION);

  program
    .command('status')
    .description('Show stitch workspace status (scaffold)')
    .option('--json', 'emit status as JSON')
    // console is allowed in CLI commands (AGENTS.md §4); logic stays in runStatus.
    .action((options: StatusOptions) => {
      console.log(runStatus(options));
    });

  return program;
}
