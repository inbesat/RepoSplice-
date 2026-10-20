// P-234 — mandated tests VERBATIM: 'interpolates', 'falls back missing',
// 'detects locale', 'rtl dir'.
//
// The phase file names this file `i18n/index.test.ts`, so it stays a `.ts`
// file: elements are built with createElement instead of JSX.
//
// No jest-dom in this repo — plain assertions only.

import { createElement } from 'react';
import type { JSX } from 'react';
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  I18nProvider,
  LOCALE_KEY,
  detectLocale,
  interpolate,
  resolveLocale,
  translate,
  useT,
} from './index.js';

function Probe(): JSX.Element {
  const { locale, t } = useT();
  return createElement(
    'p',
    null,
    `${locale}|${t('shell.settings')}|${t('tour.step', { current: 2, total: 6 })}`
  );
}

function renderProbe(locale?: string): void {
  render(
    locale === undefined
      ? createElement(I18nProvider, null, createElement(Probe))
      : createElement(I18nProvider, { locale }, createElement(Probe))
  );
}

describe('i18n (P-234)', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('dir');
    document.documentElement.removeAttribute('lang');
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('interpolates', () => {
    expect(interpolate('step {current} of {total}', { current: 2, total: 6 })).toBe('step 2 of 6');
    expect(interpolate('no placeholders')).toBe('no placeholders');
    expect(translate('en', 'tour.step', { current: 1, total: 3 })).toBe('step 1 of 3');
    renderProbe();
    expect(document.body.textContent).toContain('step 2 of 6');
  });

  it('falls back missing', () => {
    // 'tour.hero.bullet.1' has no Spanish translation -> English fallback.
    expect(translate('es', 'tour.hero.bullet.1')).toBe('Pick repo A, pick repo B, click merge.');
    // an unknown locale falls back to English as well.
    expect(translate('xx', 'shell.settings')).toBe('settings');
    // a translated key stays translated.
    expect(translate('es', 'shell.settings')).toBe('ajustes');
  });

  it('detects locale', () => {
    Object.defineProperty(navigator, 'language', { value: 'es-ES', configurable: true });
    expect(detectLocale()).toBe('es');
    expect(resolveLocale('fr-FR')).toBe('en');
    expect(resolveLocale(undefined)).toBe('en');
    // the persisted choice wins over browser detection.
    Object.defineProperty(navigator, 'language', { value: 'fr-FR', configurable: true });
    localStorage.setItem(LOCALE_KEY, 'es');
    renderProbe();
    expect(document.body.textContent).toContain('es|');
  });

  it('rtl dir', async () => {
    renderProbe('ar');
    await waitFor(() => expect(document.documentElement.getAttribute('dir')).toBe('rtl'));
    cleanup();
    renderProbe('en');
    await waitFor(() => expect(document.documentElement.getAttribute('dir')).toBe('ltr'));
  });
});
