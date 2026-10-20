// P-226 — the theme provider: one resolution rule, applied at the root.
//
// THE SPEC'S SHAPE: ThemeProvider reads the persisted choice
// (auto | light | dark — P-225's appearance.theme), applies BOTH a
// `data-theme` attribute (the spec's contract) AND the `.dark` class
// (what P-209's tokens.css @custom-variant actually keys on — deviation
// recorded in ADR-111), and in `auto` follows prefers-color-scheme live.
// setTheme persists via the P-225 settings PATCH, with localStorage as
// the guaranteed fallback — the PATCH is fire-and-forget (serve may be
// unwired; a failed PATCH must never break theming).

import { createContext, type JSX, type ReactNode, useEffect, useMemo, useState } from 'react';
import { patchSettings, type ThemeChoice } from '../api/settings.js';

/** Theme context: the raw choice, the persistence setter, the resolved mode. */
export interface ThemeState {
  readonly theme: ThemeChoice;
  setTheme: (next: ThemeChoice) => void;
  readonly resolved: 'light' | 'dark';
}

export const ThemeContext = createContext<ThemeState | null>(null);

const THEME_KEY = 'stitch-theme';
const CHOICES: readonly ThemeChoice[] = ['auto', 'light', 'dark'];

function readStored(): ThemeChoice {
  try {
    const raw = localStorage.getItem(THEME_KEY);
    return raw !== null && (CHOICES as readonly string[]).includes(raw)
      ? (raw as ThemeChoice)
      : 'auto';
  } catch {
    return 'auto';
  }
}

function systemDark(): boolean {
  return typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)').matches
    : false;
}

export function ThemeProvider({ children }: { children: ReactNode }): JSX.Element {
  const [theme, setChoice] = useState<ThemeChoice>(readStored);
  const [osDark, setOsDark] = useState(systemDark);
  const resolved: 'light' | 'dark' = theme === 'auto' ? (osDark ? 'dark' : 'light') : theme;

  // Live OS flips while in auto.
  useEffect(() => {
    if (theme !== 'auto' || typeof window.matchMedia !== 'function') return undefined;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent): void => setOsDark(e.matches);
    mq.addEventListener('change', onChange);
    setOsDark(mq.matches);
    return () => mq.removeEventListener('change', onChange);
  }, [theme]);

  // One application point: attribute for the spec, class for the tokens.
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme', resolved);
    root.classList.toggle('dark', resolved === 'dark');
  }, [resolved]);

  const value = useMemo<ThemeState>(
    () => ({
      theme,
      resolved,
      setTheme: next => {
        setChoice(next);
        try {
          localStorage.setItem(THEME_KEY, next);
        } catch {
          // storage unavailable — the PATCH below is still authoritative
        }
        // shortcut: fire-and-forget PATCH; serve persistence lands with P-192 wiring.
        void patchSettings({ appearance: { theme: next } }).catch(() => undefined);
      },
    }),
    [theme, resolved]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
