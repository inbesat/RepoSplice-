// P-044 picocolors seed, extended by P-202 into the single style source: a
// semantic token set (hex, tunable), dark/light resolution with explicit
// override, and — via the legacy `theme()` delegation — one palette for the
// pickers (P-198), progress (P-199), status (P-194) and doctor (P-195) with
// no hardcoded ANSI anywhere else. The handoff note is binding: `theme()` is
// the only paint surface; `color.ts` holds the primitives.
import pc from 'picocolors';
import { ansi16m, ansi256, rgbToAnsi256, supportsColor, supportsTruecolor } from './color.js';

/** Semantic status levels (P-206 owner of the full palette). */
export type ThemeLevel = 'ok' | 'warn' | 'err';

/**
 * The semantic tokens (P-202): role-named, never channel-named, so a theme
 * swap never touches a call site. `spinner`/`hl`/`border` are the ink-side
 * accents; the rest paint plain text.
 */
export type ThemeToken =
  'primary' | 'success' | 'warn' | 'error' | 'muted' | 'hl' | 'border' | 'spinner';

/** Dark-theme defaults (the terminal norm). All hex, all tunable. */
export const DARK_TOKENS: Readonly<Record<ThemeToken, string>> = {
  primary: '#7c3aed',
  success: '#22c55e',
  warn: '#eab308',
  error: '#ef4444',
  muted: '#9ca3af',
  hl: '#60a5fa',
  border: '#374151',
  spinner: '#22d3ee',
};

/**
 * Light-theme defaults. Same roles, DARKER hex — light backgrounds need
 * darker ink for the accessible contrast the phase mandates (warn/error
 * ≥ 4.5:1 on white; the #2xx-family of the dark palette is too pale).
 */
export const LIGHT_TOKENS: Readonly<Record<ThemeToken, string>> = {
  primary: '#6d28d9',
  success: '#15803d',
  warn: '#b45309',
  error: '#b91c1c',
  muted: '#4b5563',
  hl: '#1d4ed8',
  border: '#9ca3af',
  spinner: '#0e7490',
};

/** How color is decided: explicit mode wins, `auto` sniffs the environment. */
export type ColorMode = 'auto' | 'dark' | 'light' | 'off';

type Env = Record<string, string | undefined>;

type Paint = (text: string) => string;

const LEVEL_COLORS = {
  ok: pc.green,
  warn: pc.yellow,
  err: pc.red,
} as const satisfies Record<ThemeLevel, Paint>;

/** Token each legacy level maps to (the P-044 call sites keep their names). */
const LEVEL_TOKENS: Record<ThemeLevel, ThemeToken> = {
  ok: 'success',
  warn: 'warn',
  err: 'error',
};

/**
 * colorsEnabled: the explicit opt-outs — NO_COLOR, --no-color (spelled the
 * same), TERM=dumb — checked at call time so tests can stub the env. Full
 * capability detection (TTY, FORCE_COLOR) lives in {@link resolveTheme}.
 */
export function colorsEnabled(): boolean {
  return process.env['NO_COLOR'] === undefined && process.env['TERM'] !== 'dumb';
}

/** Parse `#rrggbb` to channels; unparseable values fall back to the defaults' entry. */
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const match = /^#([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (match === null) return null;
  const value = Number.parseInt(match[1]!, 16);
  return { r: (value >> 16) & 0xff, g: (value >> 8) & 0xff, b: value & 0xff };
}

/**
 * isDarkBackground: `COLORFGBG` ("fg;bg", e.g. "15;0") is the only portable
 * in-process signal. Unset/ambiguous → dark (the terminal norm). The spec's
 * `tput bg` subprocess query is deliberately NOT spawned — a query per paint
 * resolution is I/O in a pure path (ADR-087).
 */
export function isDarkBackground(env: Env): boolean {
  const fgbg = env['COLORFGBG'];
  if (fgbg === undefined) return true;
  const parts = fgbg.split(';');
  const bg = parts[parts.length - 1]?.trim();
  return bg !== '7' && bg !== '15'; // light background presets
}

/**
 * The theme a resolved palette paints with: role → paint function, and the
 * facts (dark? enabled?) tests and callers reason about.
 */
export type ResolvedTheme = {
  dark: boolean;
  enabled: boolean;
  paint: (token: ThemeToken, text: string) => string;
  tokens: Readonly<Record<ThemeToken, string>>;
};

/**
 * resolveTheme: mode (`auto`/`dark`/`light`/`off` — the `--color` override)
 * → token hexes (with per-token overrides applied LAST, the future
 * `[cli] primary` hook) → ANSI paints, truecolor when COLORTERM says so,
 * else the 256 palette, identity when color is off. Never throws.
 * An explicit `dark`/`light` mode forces PAST the TTY check (it is an
 * explicit opt-in) but NO_COLOR and TERM=dumb still win — the de-facto
 * precedence. `off` always disables.
 */
export function resolveTheme(
  env: Env,
  opts: {
    mode?: ColorMode;
    stream?: { isTTY?: boolean };
    overrides?: Partial<Record<ThemeToken, string>>;
  } = {}
): ResolvedTheme {
  const mode = opts.mode ?? 'auto';
  if (mode === 'off') {
    const dark = isDarkBackground(env);
    return {
      dark,
      enabled: false,
      paint: (_token, text) => text,
      tokens: dark ? DARK_TOKENS : LIGHT_TOKENS,
    };
  }
  const checkEnv = mode === 'auto' ? env : { ...env, FORCE_COLOR: env['FORCE_COLOR'] ?? '1' };
  const enabled = supportsColor(opts.stream ?? process.stdout, checkEnv);
  const dark = mode === 'dark' || (mode === 'auto' && isDarkBackground(env));
  const base = dark ? DARK_TOKENS : LIGHT_TOKENS;
  const tokens: Record<ThemeToken, string> = { ...base };
  for (const [token, hex] of Object.entries(opts.overrides ?? {})) {
    if (typeof hex === 'string' && hexToRgb(hex) !== null) {
      tokens[token as ThemeToken] = hex;
    }
  }

  if (!enabled) {
    return { dark, enabled: false, paint: (_token, text) => text, tokens };
  }

  const truecolor = supportsTruecolor(env);
  const cache = new Map<ThemeToken, Paint>();
  const paintFor = (token: ThemeToken): Paint => {
    const hit = cache.get(token);
    if (hit !== undefined) return hit;
    const rgb = hexToRgb(tokens[token]);
    const paint =
      rgb === null
        ? (text: string): string => text
        : truecolor
          ? (text: string): string => ansi16m(text, rgb.r, rgb.g, rgb.b)
          : (text: string): string => ansi256(text, rgbToAnsi256(rgb.r, rgb.g, rgb.b));
    cache.set(token, paint);
    return paint;
  };
  return { dark, enabled: true, paint: (token, text) => paintFor(token)(text), tokens };
}

/**
 * The process-wide mode override `--color <mode>` installs (via cli.ts's
 * preAction hook). `undefined` until then; tests reset via
 * {@link resetColorMode}. The module-level seam is what lets P-044's
 * zero-argument `theme()` honor a per-invocation flag.
 */
let colorModeOverride: ColorMode | undefined;

/** Install the `--color <mode>` override for this process (last call wins). */
export function applyColorMode(mode: ColorMode): void {
  colorModeOverride = mode;
}

/** Clear the `--color` override (test seam). */
export function resetColorMode(): void {
  colorModeOverride = undefined;
}

/**
 * theme: paint `text` for a semantic level (status output P-194, progress
 * P-199, error UX P-201). Returns the text unchanged when colors are
 * disabled — callers never branch on TTY themselves.
 *
 * P-202, two lanes on purpose: WITHOUT a `--color <mode>` override this is
 * byte-for-byte the P-044 picocolors surface (its enablement and codes are
 * pinned by test, and every existing ink/plain call site keeps them); WITH
 * an override it paints through {@link resolveTheme}'s token palette
 * (ok→success, warn→warn, err→error) — one palette source for every surface.
 */
export function theme(level: ThemeLevel, text: string): string {
  if (colorModeOverride !== undefined) {
    if (colorModeOverride === 'off') return text;
    const resolved = resolveTheme(process.env, { mode: colorModeOverride });
    if (!resolved.enabled) return text;
    return resolved.paint(LEVEL_TOKENS[level], text);
  }
  if (!colorsEnabled()) return text;
  return LEVEL_COLORS[level](text);
}
