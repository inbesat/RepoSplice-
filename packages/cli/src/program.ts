import { Command } from 'commander';
import { registerDoctorCommand } from './commands/doctor.js';

/** CLI version. Keep in sync with packages/cli/package.json until P-062 stamps it at build. */
export const STITCH_VERSION = '0.0.0';

/**
 * createProgram: the root `stitch` program (P-189 owner). Registers global
 * flags and the commands program.ts owns (`doctor`). The workspace commands
 * (init/add/serve/status — P-190/P-191/P-193/P-194) attach in `cli.ts`'s
 * {@link buildCLI}, which also owns the global options; P-194 moved `status`
 * out of the scaffold that used to live here into its command module.
 * Callers parse with `program.parse(argv, { from: 'user' })`; tests use
 * `exitOverride()` to keep `--help` from calling process.exit.
 */
export function createProgram(): Command {
  const program = new Command();
  program
    .name('stitch')
    .description('AI-augmented multi-repo composition')
    // `-V` belongs to P-189's `--verbose`, so version is long-form only.
    .version(STITCH_VERSION, '--version');

  registerDoctorCommand(program);

  return program;
}
