// P-203 — the error/exit contract: the code→code map, the renderer's shape
// (code + message + hint + next step; stack only under trace/verbose), the
// commander-usage convention, and the 70-for-unknown rule. Pure functions —
// no process state is touched; the diagnostic switches are reset around the
// delegation cases.
import { afterEach, describe, expect, it } from 'vitest';
import {
  ExitError,
  exitFor,
  printStitchError,
  resetDiagnostics,
  setDiagnostics,
  toHuman,
} from './errors.js';
import { ExitCode } from './errors.js';

afterEach(() => {
  resetDiagnostics();
});

describe('P-203 error messages + exit codes', () => {
  it('maps exit codes', () => {
    // config class → 3 (both loader faults)
    expect(exitFor({ code: 'CONFIG_INVALID', issues: [], message: 'no' })).toBe(ExitCode.CONFIG);
    expect(exitFor({ code: 'CONFIG_ERROR', field: 'x', message: 'no' })).toBe(ExitCode.CONFIG);
    // path class → 4
    expect(exitFor({ code: 'FILE_NOT_FOUND', path: 'p', message: 'no' })).toBe(ExitCode.PATH);
    expect(
      exitFor({ code: 'SELECT_PATH_NOT_FOUND', repo: 'A', missing: ['x'], message: 'no' })
    ).toBe(ExitCode.PATH);
    // HIL class → 10 (a human — or their surface — ended the run)
    expect(exitFor({ code: 'ABORTED', message: 'no' })).toBe(ExitCode.HIL);
    expect(exitFor({ code: 'USER_CANCELLED', reason: 'esc' })).toBe(ExitCode.HIL);
    expect(exitFor({ code: 'SANDBOX_ABORTED', message: 'no' })).toBe(ExitCode.HIL);
    // license → 20 ONLY on a deny verdict; a warn verdict is a general error
    expect(exitFor({ code: 'LICENSE_VIOLATION', license: 'GPL-3.0', policy: 'deny' })).toBe(
      ExitCode.LICENSE
    );
    expect(exitFor({ code: 'LICENSE_VIOLATION', license: 'MIT', policy: 'warn' })).toBe(
      ExitCode.ERROR
    );
    // sandbox → 30, AI → 40, deps → 50
    expect(exitFor({ code: 'SANDBOX_UNAVAILABLE', message: 'no docker' })).toBe(ExitCode.SANDBOX);
    expect(exitFor({ code: 'AI_PROVIDER_ERROR', provider: 'openrouter', message: '502' })).toBe(
      ExitCode.AI
    );
    expect(exitFor({ code: 'DEPENDENCY_CONFLICT', packages: ['a', 'b'], details: 'semver' })).toBe(
      ExitCode.DEPS
    );
    // internal → 70; unlisted codes → general 1
    expect(exitFor({ code: 'INTERNAL', message: 'boom' })).toBe(ExitCode.INTERNAL);
    expect(exitFor({ code: 'UNKNOWN_LICENSE', id: 'weirdware' })).toBe(ExitCode.ERROR);
  });

  it('.unknown and shapeless failures map to 70', () => {
    expect(exitFor(new Error('thrown in a boundary'))).toBe(ExitCode.INTERNAL);
    expect(exitFor('a bare string')).toBe(ExitCode.INTERNAL);
    expect(exitFor(null)).toBe(ExitCode.INTERNAL);
    expect(exitFor({ code: 42 })).toBe(ExitCode.INTERNAL);
  });

  it('formats with hint', () => {
    const text = printStitchError({
      code: 'DEPENDENCY_CONFLICT',
      packages: ['left-pad'],
      details: 'two majors wanted',
    });
    // code + message on ONE line, then the core hint, then an actionable next step
    expect(text).toContain('✘ DEPENDENCY_CONFLICT');
    expect(text).toContain('two majors wanted');
    expect(text).toContain('↳'); // the P-163 hint line is present
    expect(text).toContain('next: run `stitch deps --auto`');
    // no stack unless asked
    expect(text).not.toContain('trace:');
    // plain in no-color environments is implied by the theme lane; here assert
    // the hint did NOT replace the message (both are present)
    expect(text.length).toBeGreaterThan('✘ DEPENDENCY_CONFLICT'.length);
  });

  it('trace shows stack', () => {
    const cause = new Error('root cause');
    const text = printStitchError(
      { code: 'INTERNAL', message: 'pipeline exploded', cause },
      { trace: true }
    );
    expect(text).toContain('trace:');
    expect(text).toContain('root cause'); // the cause's stack rides along
    expect(text).toContain('error-json:'); // full shape for a bug report

    // a typed error with no stack says so instead of going silent
    const none = printStitchError(
      { code: 'CONFIG_ERROR', field: 'project', message: 'bad' },
      { verbose: true }
    );
    expect(none).toContain('(typed error — no stack attached)');
    // ...and without trace/verbose neither appears
    const quiet = printStitchError({
      code: 'INTERNAL',
      message: 'boom',
      cause: new Error('x'),
    });
    expect(quiet).not.toContain('trace:');
  });

  it('usage exit 2 and unknown exit 70 through the carriers', () => {
    // the two commander-mapped conventions are the ExitCode constants
    expect(ExitCode.USAGE).toBe(2);
    expect(ExitCode.INTERNAL).toBe(70);
    // ExitError carries a decision across a throw boundary; main() converts it
    const carrier = new ExitError(ExitCode.USAGE, 'bad option');
    expect(carrier.exitCode).toBe(2);
    expect(carrier.name).toBe('ExitError');
    // the diagnostic switches route through printStitchError's defaults
    setDiagnostics(true, false);
    expect(printStitchError({ code: 'CONFIG_ERROR', field: 'x', message: 'bad' })).toContain(
      '(typed error — no stack attached)'
    );
    resetDiagnostics();
    expect(printStitchError({ code: 'CONFIG_ERROR', field: 'x', message: 'bad' })).not.toContain(
      'trace:'
    );
  });

  it('toHuman stays data-driven and falls back to null', () => {
    expect(toHuman({ code: 'DEPENDENCY_CONFLICT', packages: [], details: '' })).toBe(
      'run `stitch deps --auto` to apply the resolver suggestions'
    );
    expect(toHuman({ code: 'SANDBOX_UNAVAILABLE', message: '' })).toContain('stitch doctor');
    expect(toHuman({ code: 'UNKNOWN_LICENSE', id: 'x' })).toBeNull();
  });
});
