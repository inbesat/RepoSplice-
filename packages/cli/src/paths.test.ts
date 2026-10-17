// P-205 — path/naming convention tests.
//
// The six required scenarios from the phase spec:
//
//   it('validates names')    it('slugifies with dedupe')   it('rejects traversal')
//   it('containment check')  it('default out dir')         it('deny list')

import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import {
  MAX_SLUG_LENGTH,
  defaultOutDir,
  isDeniedWritePath,
  safeJoin,
  slugify,
  validateName,
} from './paths.js';

describe('P-205 paths', () => {
  it('validates names', () => {
    // The convention itself.
    expect(validateName('my-lib')).toBe(true);
    expect(validateName('lib2_component')).toBe(true);
    // Leading digit, uppercase, empty, whitespace, dot, and a second-dash rule
    // all fall outside `^[a-z][a-z0-9-_]*$`.
    expect(validateName('1lib')).toBe(false);
    expect(validateName('MyLib')).toBe(false);
    expect(validateName('')).toBe(false);
    expect(validateName('my lib')).toBe(false);
    expect(validateName('my.lib')).toBe(false);
    // Windows reserved devices are rejected in any case, even with an extension.
    expect(validateName('con')).toBe(false);
    expect(validateName('CON')).toBe(false);
    expect(validateName('Nul.txt')).toBe(false);
    // Control characters can never pass.
    expect(validateName('a\u0000b')).toBe(false);
    expect(validateName('a\u001fb')).toBe(false);
  });

  it('slugifies with dedupe', () => {
    // Lowercase, ASCII-folded, runs collapsed, trimmed.
    expect(slugify('My Lib!')).toBe('my-lib');
    expect(slugify('  Héllo  Wörld ')).toBe('s-hello-world'.replace(/^s-/, ''));
    expect(slugify('CamelCase')).toBe('camelcase');
    // A digit-leading name is given the `s-` prefix so it starts alpha.
    expect(slugify('1st lib')).toBe('s-1st-lib');
    // Length is capped.
    expect(slugify('x'.repeat(100)).length).toBeLessThanOrEqual(MAX_SLUG_LENGTH); // 64
    // Deterministic without a set.
    expect(slugify('My Lib!')).toBe(slugify('My Lib!'));
    // With a `used` set, collisions number and the set records the result.
    const used = new Set<string>();
    expect(slugify('My Lib!', used)).toBe('my-lib');
    expect(slugify('My Lib!', used)).toBe('my-lib-2');
    expect(slugify('My Lib!', used)).toBe('my-lib-3');
    expect(used.has('my-lib-2')).toBe(true);
    // Even a name that already equals a taken slug gets numbered.
    expect(slugify('other', new Set(['other', 'other-2']))).toBe('other-3');
  });

  it('rejects traversal', () => {
    // `..` in any position.
    expect(safeJoin('base', '..', 'escape').isErr()).toBe(true);
    expect(safeJoin('base', 'src', '..', '..', 'out').isErr()).toBe(true);
    // Absolute and drive-qualified parts.
    expect(safeJoin('base', '/abs').isErr()).toBe(true);
    expect(safeJoin('base', 'C:\\Windows\\x').isErr()).toBe(true);
    expect(safeJoin('base', 'C:something').isErr()).toBe(true);
    // Control characters.
    expect(safeJoin('base', 'a\u0000b').isErr()).toBe(true);
    // A clean relative part is fine, and the error names the offender.
    expect(safeJoin('base', 'src', 'a.ts').isOk()).toBe(true);
    const bad = safeJoin('base', '../escape');
    if (bad.isErr() && bad.error.code === 'CONFIG_ERROR') {
      expect(bad.error.message).toContain('../escape');
    }
  });

  it('containment check', () => {
    // Even without an explicit `..`, resolving can escape `base` — the
    // containment check is the last line, not a duplicate of the above.
    expect(safeJoin('base', 'a', '../../../escape').isErr()).toBe(true);
    // Inside stays inside: resolved relative to the base, not the cwd.
    const okJoin = safeJoin('base', 'src', 'a.ts');
    expect(okJoin.isOk()).toBe(true);
    if (okJoin.isOk()) expect(okJoin.value).toBe(resolve('base', 'src', 'a.ts'));
  });

  it('default out dir', () => {
    expect(defaultOutDir('/work')).toBe(resolve('/work', 'stitch-out'));
    // Absent a cwd, the process cwd anchors it — same as merge computes it.
    expect(defaultOutDir()).toBe(resolve(process.cwd(), 'stitch-out'));
  });

  it('deny list', () => {
    // System roots and their children.
    expect(isDeniedWritePath('/etc')).toBe(true);
    expect(isDeniedWritePath('/etc/passwd')).toBe(true);
    expect(isDeniedWritePath('/usr/local/bin/x')).toBe(true);
    expect(isDeniedWritePath('C:\\Windows\\System32\\cmd.exe')).toBe(true);
    expect(isDeniedWritePath('c:\\program files\\X')).toBe(true); // case-insensitive
    // Project paths and benign siblings are NOT denied.
    expect(isDeniedWritePath('C:\\work\\proj\\src\\a.ts')).toBe(false);
    expect(isDeniedWritePath('/etcetera')).toBe(false); // prefix must be a boundary
    expect(isDeniedWritePath(resolve('src', 'out.ts'))).toBe(false);
    // The home `.ssh` fence.
    expect(isDeniedWritePath('~/.ssh')).toBe(true);
  });
});
