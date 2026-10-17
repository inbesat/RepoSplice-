// P-189/P-194 — the root program tests.
//
// program.ts owns the ROOT (name/description/version) and the commands it
// registers (doctor). `status` was a pure scaffold here through P-189; P-194
// moved it into `commands/status.ts` (registered in `cli.ts`'s buildCLI), so
// its behavior is covered there and only root-level concerns remain.

import { describe, it, expect } from 'vitest';
import { createProgram, STITCH_VERSION } from './program.js';

describe('stitch program (P-041 commander)', () => {
  it('help lists', () => {
    // --help must list the program + the subcommands program.ts owns without
    // killing the runner.
    const program = createProgram();
    program.exitOverride();
    let out = '';
    program.configureOutput({ writeOut: s => (out += s), writeErr: () => {} });
    try {
      program.parse(['--help'], { from: 'user' });
    } catch (e) {
      // exitOverride throws CommanderError('commander.helpDisplayed') instead of exiting.
      expect((e as { code?: string }).code).toBe('commander.helpDisplayed');
    }
    expect(out).toContain('Usage: stitch');
    expect(out).toContain('doctor');
  });

  it('version flag prints STITCH_VERSION', () => {
    const program = createProgram();
    program.exitOverride();
    let out = '';
    program.configureOutput({ writeOut: s => (out += s), writeErr: () => {} });
    try {
      program.parse(['--version'], { from: 'user' });
    } catch (e) {
      expect((e as { code?: string }).code).toBe('commander.version');
    }
    expect(out.trim()).toBe(STITCH_VERSION);
  });
});
