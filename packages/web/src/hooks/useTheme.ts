// P-226 — the theme hook. Falls back to safe no-op defaults when no
// provider is mounted (tests, isolated components) — useTheme never throws.

import { useContext } from 'react';
import { ThemeContext, type ThemeState } from '../theme/ThemeProvider.js';
import type { ThemeChoice } from '../api/settings.js';

const FALLBACK: ThemeState = {
  theme: 'auto',
  setTheme: () => undefined,
  resolved: 'light',
};

export function useTheme(): ThemeState {
  return useContext(ThemeContext) ?? FALLBACK;
}

export type { ThemeChoice };
