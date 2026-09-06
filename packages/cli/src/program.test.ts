import { describe, it, expect, vi } from 'vitest';
import { createProgram, runStatus, STITCH_VERSION } from './program.js';

describe('stitch program (P-041 commander)', () => {
  it('parses subcommand options', () => {
    // status --json reaches the action with a typed options object.
    const program = createProgram();
    let seen: unknown;
    const status = program.commands.find(c => c.name() === 'status');
    expect(status).toBeDefined();
    status?.action((options: unknown) => {
      seen = options;
    });
    program.parse(['status', '--json'], { from: 'user' });
    expect(seen).toMatchObject({ json: true });
    // And the pure scaffold renders the parsed flag.
    expect(runStatus(seen as { json?: boolean })).toBe('{"ok":true,"scaffold":true}');
  });

  it('status action prints plain scaffold text by default', () => {
    // Runs the registered (non-overridden) action: covers the default
    // action callback and the non---json branch of runStatus.
    const program = createProgram();
    const lines: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(' '));
    });
    try {
      program.parse(['status'], { from: 'user' });
    } finally {
      spy.mockRestore();
    }
    expect(lines).toEqual(['stitch status: scaffold (full implementation in P-189+)']);
    expect(runStatus({})).toBe(lines[0]);
  });

  it('help lists', () => {
    // --help must list the program + subcommands without killing the runner.
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
    expect(out).toContain('status');
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
