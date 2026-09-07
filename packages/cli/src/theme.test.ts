import { describe, it, expect, vi, afterEach } from 'vitest';
import pc from 'picocolors';
import { theme, colorsEnabled, type ThemeLevel } from './theme.js';

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
