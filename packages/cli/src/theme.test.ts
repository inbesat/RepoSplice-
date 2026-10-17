import { describe, it, expect, vi, afterEach } from 'vitest';
import pc from 'picocolors';
import {
  DARK_TOKENS,
  theme,
  colorsEnabled,
  resolveTheme,
  resetColorMode,
  type ThemeLevel,
} from './theme.js';
import { stripColor, supportsColor } from './color.js';

describe('theme helper (P-044 picocolors)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('theme colors', () => {
    // Delegation check: each level maps to its picocolor, whatever the
    // terminal supports (vitest runs off-TTY, where pc.* are identity —
    // asserting equality with pc.* keeps this meaningful everywhere).
    const cases: Array<[ThemeLevel, (s: string) => string]> = [
      ['ok', pc.green],
      ['warn', pc.yellow],
      ['err', pc.red],
    ];
    for (const [level, paint] of cases) {
      expect(theme(level, 'hi')).toBe(paint('hi'));
    }
  });

  it('no color', () => {
    vi.stubEnv('NO_COLOR', '1');
    expect(colorsEnabled()).toBe(false);
    expect(theme('ok', 'plain')).toBe('plain');
    expect(theme('err', 'plain')).toBe('plain');
  });
});

describe('P-202 theme + color', () => {
  afterEach(() => {
    resetColorMode();
    vi.unstubAllEnvs();
  });

  it('resolves dark and light', () => {
    const dark = resolveTheme({}, { mode: 'dark', stream: { isTTY: false } });
    expect(dark.dark).toBe(true);
    expect(dark.enabled).toBe(true); // an explicit mode is an explicit opt-in
    const light = resolveTheme({}, { mode: 'light', stream: { isTTY: false } });
    expect(light.dark).toBe(false);
    // the palettes differ: light ink is darker for contrast on white
    expect(light.tokens.success).not.toBe(dark.tokens.success);
    // auto: COLORFGBG "fg;bg" — a light bg preset flips the palette
    expect(resolveTheme({ COLORFGBG: '0;15' }, { mode: 'auto' }).dark).toBe(false);
    expect(resolveTheme({ COLORFGBG: '15;0' }, { mode: 'auto' }).dark).toBe(true);
    expect(resolveTheme({}, { mode: 'auto' }).dark).toBe(true); // the terminal norm
  });

  it('no color env', () => {
    const disabled = resolveTheme({ NO_COLOR: '1' }, { mode: 'dark', stream: { isTTY: true } });
    expect(disabled.enabled).toBe(false);
    expect(disabled.paint('error', 'plain')).toBe('plain');
    const dumb = resolveTheme({ TERM: 'dumb' }, { mode: 'auto', stream: { isTTY: true } });
    expect(dumb.enabled).toBe(false);
    // the legacy surface honors the opt-outs too
    vi.stubEnv('TERM', 'dumb');
    expect(colorsEnabled()).toBe(false);
    expect(theme('ok', 'x')).toBe('x');
  });

  it('strips ansi', () => {
    const painted = resolveTheme({}, { mode: 'dark', stream: { isTTY: true } }).paint(
      'error',
      'boom'
    );
    expect(painted).not.toBe('boom');
    expect(stripColor(painted)).toBe('boom');
    expect(stripColor('\x1B[38;5;196mred\x1B[0m plain')).toBe('red plain');
  });

  it('custom primary', () => {
    const base = resolveTheme({}, { mode: 'dark', stream: { isTTY: true } });
    const themed = resolveTheme(
      {},
      { mode: 'dark', stream: { isTTY: true }, overrides: { primary: '#123456' } }
    );
    expect(themed.tokens.primary).toBe('#123456');
    expect(themed.paint('primary', 'x')).not.toBe(base.paint('primary', 'x'));
    // unparseable hex is ignored, never invented
    const bad = resolveTheme(
      {},
      { mode: 'dark', stream: { isTTY: true }, overrides: { primary: 'purple!' } }
    );
    expect(bad.tokens.primary).toBe(base.tokens.primary);
    expect(bad.tokens.primary).toBe(DARK_TOKENS.primary);
  });

  it('force color', () => {
    expect(supportsColor({ isTTY: false }, { FORCE_COLOR: '1' })).toBe(true);
    expect(supportsColor({ isTTY: false }, { FORCE_COLOR: '0' })).toBe(false);
    // NO_COLOR outranks FORCE_COLOR (de-facto standard precedence)
    expect(supportsColor({ isTTY: true }, { FORCE_COLOR: '1', NO_COLOR: '1' })).toBe(false);
    const forced = resolveTheme({ FORCE_COLOR: '1' }, { stream: { isTTY: false } });
    expect(forced.enabled).toBe(true);
    expect(forced.paint('warn', 'w')).not.toBe('w');
  });
});
