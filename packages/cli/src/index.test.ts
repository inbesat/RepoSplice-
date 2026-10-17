// P-189 — the CLI shell tests.
//
// Commander is driven with a CAPTURED output and `exitOverride` (never a spawned
// process), so the exit codes and the printed text are asserted directly. That is the
// point of the shell: the exit-code convention should be a value a test can read, not
// a side effect of parsing.
//
// The five required scenarios from the phase spec:
//
//   it('prints version')  it('lists help')  it('unknown command exits 1')
//   it('parses global flags')                it('maps exit codes')

import { describe, it, expect } from 'vitest';
import { CommanderError } from 'commander';
import { err, ok } from 'neverthrow';
import { CLI_NAME, CORE_NAME } from './index';
import {
  buildCLI,
  classifyCommanderError,
  exitCodeForResult,
  globalOptionsOf,
  EXIT_ERROR,
  EXIT_OK,
  EXIT_USAGE,
} from './cli.js';
import { parseGlobal } from './globals.js';
import { createProgram, STITCH_VERSION } from './program.js';

/** Run argv through the real shell, capturing output and the exit code. */
async function run(argv: readonly string[]): Promise<{ code: number; out: string; err: string }> {
  const out: string[] = [];
  const errLines: string[] = [];
  const program = buildCLI(createProgram());
  program.configureOutput({
    writeOut: text => void out.push(text),
    writeErr: text => void errLines.push(text),
  });
  try {
    await program.parseAsync(['node', 'stitch', ...argv], { from: 'node' });
    return { code: EXIT_OK, out: out.join(''), err: errLines.join('') };
  } catch (cause: unknown) {
    // `exitOverride` turns commander's exits into throws; the shell's classifier is
    // what turns them back into a code.
    if (cause instanceof CommanderError) {
      return {
        code: classifyCommanderError(cause).code,
        out: out.join(''),
        err: errLines.join(''),
      };
    }
    throw cause;
  }
}

describe('@repo-stitcher/cli', () => {
  it('exports CLI_NAME', () => {
    expect(CLI_NAME).toBe('@repo-stitcher/cli');
  });

  it('re-exports CORE_NAME from @repo-stitcher/core', () => {
    expect(CORE_NAME).toBe('@repo-stitcher/core');
  });
});

describe('P-189 CLI shell', () => {
  it('prints version', async () => {
    const result = await run(['--version']);
    expect(result.code).toBe(EXIT_OK);
    expect(result.out).toContain(STITCH_VERSION);
  });

  it('lists help', async () => {
    const result = await run(['--help']);
    expect(result.code).toBe(EXIT_OK);
    expect(result.out).toContain('Usage:');
    // The commands that exist today are listed, and the global flags with them.
    expect(result.out).toContain('status');
    expect(result.out).toContain('doctor');
    expect(result.out).toContain('--offline');
  });

  it('unknown command exits 1', async () => {
    // Exit 1, not 2: the phase's acceptance criteria say an unknown command is a
    // reported failure, and its own test names that number.
    const result = await run(['definitely-not-a-command']);
    expect(result.code).toBe(EXIT_ERROR);
  });

  it('parses global flags', async () => {
    const program = buildCLI(createProgram());
    // P-194: `status` is a real command now — stub its registered action so this
    // test exercises only the GLOBAL FLAG parsing, never the machine reads.
    program.commands.find(c => c.name() === 'status')?.action(() => undefined);
    await program.parseAsync(
      [
        'node',
        'stitch',
        '-V',
        '--offline',
        '-y',
        '-c',
        'x.json',
        '-C',
        '/tmp/here',
        // A command is required, or commander prints help for a bare invocation.
        'status',
        '--json',
      ],
      { from: 'node' }
    );
    expect(globalOptionsOf(program)).toEqual({
      verbose: true,
      configPath: 'x.json',
      yes: true,
      offline: true,
      cwd: '/tmp/here',
      color: true,
      trace: false,
    });

    // Defaults: everything off, colour on, and no optional path set at all. Asserted
    // on the pure mapper — parsing a command-less program makes commander print help,
    // which `exitOverride` turns into a throw, so the defaults belong to `parseGlobal`.
    expect(parseGlobal({})).toEqual({
      verbose: false,
      yes: false,
      offline: false,
      color: true,
      trace: false,
    });

    // `--no-color` arrives as `color: false` and flips exactly one thing.
    expect(parseGlobal({ color: false }).color).toBe(false);

    // A blank `-c ''` is "not supplied", so it cannot shadow the default config.
    expect(parseGlobal({ config: '   ' })).toEqual({
      verbose: false,
      yes: false,
      offline: false,
      color: true,
      trace: false,
    });
  });

  it('maps exit codes', () => {
    const lines: string[] = [];
    const write = (line: string): void => void lines.push(line);

    // Success: 0, nothing written.
    expect(exitCodeForResult(ok(undefined), write)).toBe(EXIT_OK);
    expect(lines).toEqual([]);

    // A known error renders through printStitchError (one write, multiline:
    // code + message + hint + next step) and exits by its CLASS — P-203's
    // config class is 3 (was the general 1 before the typed map landed).
    const code = exitCodeForResult(
      err({ code: 'CONFIG_ERROR', field: 'project', message: 'raw detail' }),
      write
    );
    expect(code).toBe(3); // ExitCode.CONFIG
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toBe('raw detail'); // labeled and decorated, never a bare dump
    expect(lines[0]).toContain('✘ CONFIG_ERROR');
    expect(lines[0]).toContain('raw detail');
    expect(lines[0]).toContain('next:');

    // And the commander classifier covers the three conventions directly.
    expect(classifyCommanderError(new CommanderError(1, 'commander.helpDisplayed', '')).code).toBe(
      EXIT_OK
    );
    expect(
      classifyCommanderError(new CommanderError(1, 'commander.unknownCommand', 'nope')).code
    ).toBe(EXIT_ERROR);
    expect(
      classifyCommanderError(new CommanderError(1, 'commander.unknownOption', '--bad')).code
    ).toBe(EXIT_USAGE);
  });
});
