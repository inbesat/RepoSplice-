// P-226 — the shell theme toggle: cycles auto -> light -> dark, honors auto
// via the provider's resolved mode, and keeps the P-210 shell pin's
// data-testid ('dark-toggle') so the shell tests stay untouched.

import type { JSX } from 'react';
import { useTheme } from '../hooks/useTheme.js';
import type { ThemeChoice } from '../api/settings.js';

const NEXT: Record<ThemeChoice, ThemeChoice> = { auto: 'light', light: 'dark', dark: 'auto' };
const GLYPH: Record<ThemeChoice, string> = { auto: '◐', light: '☀', dark: '☾' };

export function ThemeToggle(): JSX.Element {
  const { theme, resolved, setTheme } = useTheme();
  const next = NEXT[theme];
  const attributes = {
    type: 'button' as const,
    'data-testid': 'dark-toggle',
    // P-227: 44px touch target.
    className: 'flex min-h-11 min-w-11 items-center justify-center',
    'aria-label': `theme: ${theme} (resolved ${resolved}); switch to ${next}`,
    'aria-pressed': resolved === 'dark',
    onClick: () => setTheme(next),
  } as const;
  return <button {...attributes}>{GLYPH[theme]}</button>;
}
