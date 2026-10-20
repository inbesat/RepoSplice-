// P-234 — the i18n layer: a typed catalog, `t(key, params?)` with
// interpolation, locale detection (navigator + persisted choice + explicit
// override) and RTL support.
//
// NO HARD DEPENDENCY: components call `useT()`, which falls back to the
// English catalog when no provider is mounted — every screen renders
// correctly without the provider.

import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { JSX, ReactNode } from 'react';
import { en } from './en.js';
import type { Catalog, Keys } from './en.js';
import { es } from './es.js';
import type { ErrorFamily } from '../lib/errors.js';

export type { Catalog, Keys };

/** Locales the app ships a catalog for. `ar` is an RTL sample: no strings of
 * its own yet (they fall back to en) but the direction flips. */
export const SUPPORTED_LOCALES = ['en', 'es', 'ar'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

/** Locales rendered right-to-left. */
export const RTL_LOCALES: readonly string[] = ['ar'];

/** Where the chosen locale is persisted in the browser. */
export const LOCALE_KEY = 'stitch-locale';

const CATALOGS: Readonly<Record<string, Catalog>> = {
  en,
  es,
  ar: {},
};

/** Replace `{name}` placeholders; unknown placeholders stay as they are. */
export function interpolate(template: string, params?: Record<string, string | number>): string {
  if (params === undefined) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

/** Normalise a locale candidate ('es-ES' → 'es'); unknown → 'en'. */
export function resolveLocale(candidate: string | null | undefined): string {
  const base = (candidate ?? '').split('-')[0]?.toLowerCase() ?? '';
  return SUPPORTED_LOCALES.includes(base as SupportedLocale) ? base : 'en';
}

/** The browser's preferred locale, normalised. */
export function detectLocale(): string {
  if (typeof navigator === 'undefined') return 'en';
  return resolveLocale(navigator.language);
}

/** Look a key up in `locale`, falling back to en, then to the key itself. */
export function translate(
  locale: string,
  key: Keys,
  params?: Record<string, string | number>
): string {
  const catalog = CATALOGS[locale] ?? {};
  const template = catalog[key] ?? en[key] ?? key;
  return interpolate(template, params);
}

const ERROR_TITLE_KEYS: Readonly<Record<ErrorFamily, Keys>> = {
  config: 'error.config.title',
  license: 'error.license.title',
  sandbox: 'error.sandbox.title',
  ai: 'error.ai.title',
  deps: 'error.deps.title',
  hil: 'error.hil.title',
  path: 'error.path.title',
  internal: 'error.internal.title',
};

const ERROR_RECOVERY_KEYS: Readonly<Record<ErrorFamily, Keys>> = {
  config: 'error.config.recovery',
  license: 'error.license.recovery',
  sandbox: 'error.sandbox.recovery',
  ai: 'error.ai.recovery',
  deps: 'error.deps.recovery',
  hil: 'error.hil.recovery',
  path: 'error.path.recovery',
  internal: 'error.internal.recovery',
};

/** The catalog key holding an error family's title. */
export function errorTitleKey(family: ErrorFamily): Keys {
  return ERROR_TITLE_KEYS[family] ?? 'error.internal.title';
}

/** The catalog key holding an error family's recovery line. */
export function errorRecoveryKey(family: ErrorFamily): Keys {
  return ERROR_RECOVERY_KEYS[family] ?? 'error.internal.recovery';
}

export interface I18nValue {
  readonly locale: string;
  readonly setLocale: (locale: string) => void;
  readonly t: (key: Keys, params?: Record<string, string | number>) => string;
}

const noop = (): void => undefined;

/** Default context: English strings — the provider is optional. */
const DEFAULT: I18nValue = {
  locale: 'en',
  setLocale: noop,
  t: (key, params) => translate('en', key, params),
};

const I18nContext = createContext<I18nValue>(DEFAULT);

export interface I18nProviderProps {
  /** Optional so the provider can be built with createElement too. */
  readonly children?: ReactNode;
  /** Explicit override (config/settings); wins over the persisted choice. */
  readonly locale?: string;
}

export function I18nProvider({ children, locale }: I18nProviderProps): JSX.Element {
  const [current, setCurrent] = useState<string>(() => {
    if (locale !== undefined) return resolveLocale(locale);
    try {
      const stored = window.localStorage.getItem(LOCALE_KEY);
      if (stored !== null) return resolveLocale(stored);
    } catch {
      // storage unavailable — fall through to detection
    }
    return detectLocale();
  });

  const setLocale = useCallback((next: string): void => {
    setCurrent(resolveLocale(next));
  }, []);

  // Persist the choice and apply the direction/language to the document.
  useEffect(() => {
    try {
      window.localStorage.setItem(LOCALE_KEY, current);
    } catch {
      // storage unavailable — the choice lives for this session only
    }
    const dir = RTL_LOCALES.includes(current) ? 'rtl' : 'ltr';
    document.documentElement.setAttribute('dir', dir);
    document.documentElement.setAttribute('lang', current);
  }, [current]);

  const value = useMemo<I18nValue>(
    () => ({
      locale: current,
      setLocale,
      t: (key, params) => translate(current, key, params),
    }),
    [current, setLocale]
  );

  // createElement (not JSX): the phase file names this module `i18n/index.ts`.
  return createElement(I18nContext.Provider, { value }, children ?? null);
}

/** The translation hook — works with or without a provider. */
export function useT(): I18nValue {
  return useContext(I18nContext);
}
