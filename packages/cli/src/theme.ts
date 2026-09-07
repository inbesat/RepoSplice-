import pc from 'picocolors';

/** Semantic status levels (P-206 owner of the full palette). */
export type ThemeLevel = 'ok' | 'warn' | 'err';

type Paint = (text: string) => string;

const LEVEL_COLORS = {
  ok: pc.green,
  warn: pc.yellow,
  err: pc.red,
} as const satisfies Record<ThemeLevel, Paint>;

/**
 * colorsEnabled: true unless the user opted out via NO_COLOR. picocolors
 * itself auto-disables off-TTY, so this only encodes the explicit opt-out
 * (checked at call time, not import time, so tests can stub the env).
 */
export function colorsEnabled(): boolean {
  return process.env['NO_COLOR'] === undefined;
}

/**
 * theme: paint `text` for a semantic level (status output P-194, progress
 * P-199, error UX P-201). Returns the text unchanged when colors are
 * disabled — callers never branch on TTY themselves.
 */
export function theme(level: ThemeLevel, text: string): string {
  if (!colorsEnabled()) return text;
  return LEVEL_COLORS[level](text);
}
