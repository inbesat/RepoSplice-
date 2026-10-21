// P-236 — the shared web test harness.
//
// jsdom does not implement several browser APIs the web surface touches
// (matchMedia, observers, object URLs, scrolling). They are stubbed HERE,
// once, so every web test file behaves the same way — and `harness.test.ts`
// fails loudly if a stub ever goes missing.
//
// The stubs are deliberately configurable/writable: a test that needs a
// different answer (P-226 dark mode, P-227 breakpoints, P-229 reduced
// motion) overrides `window.matchMedia` itself.

import '@testing-library/jest-dom/vitest';

// P-330 — the P-229 onboarding tour auto-queues on a first visit. It
// mounts in an effect, so under load it can land between a render and an
// assertion: the overlay then swallows a click (the SourcesPage flow) or
// trips an axe rule (the sources scan). The marker keeps the tour out of
// every other test file; Tour.test.tsx starts it explicitly.
localStorage.setItem('stitch-tour-auto', '1');

/** The shape of the matchMedia stub. */
export interface MediaStub {
  matches: boolean;
  media: string;
  onchange: null | (() => void);
  addEventListener: () => void;
  removeEventListener: () => void;
  addListener: () => void;
  removeListener: () => void;
  dispatchEvent: () => boolean;
}

/** Install a matchMedia stub; `resolve` maps a media query to its answer. */
export function installMatchMediaStub(resolve: (query: string) => boolean = () => false): void {
  const stub = (query: string): MediaStub => ({
    matches: resolve(query),
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  });
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: stub,
  });
}

/** A no-op observer; jsdom has no layout, so nothing ever intersects. */
class NoopObserver {
  observe(): void {
    // no layout in jsdom — nothing to observe
  }
  unobserve(): void {
    // no layout in jsdom — nothing to observe
  }
  disconnect(): void {
    // no layout in jsdom — nothing to observe
  }
  takeRecords(): [] {
    return [];
  }
}

function defineGlobal(name: string, value: unknown): void {
  Object.defineProperty(window, name, { configurable: true, writable: true, value });
}

if (typeof window.matchMedia !== 'function') {
  installMatchMediaStub();
}

if (typeof window.ResizeObserver !== 'function') {
  defineGlobal('ResizeObserver', NoopObserver);
}

if (typeof window.IntersectionObserver !== 'function') {
  defineGlobal('IntersectionObserver', NoopObserver);
}

if (typeof URL.createObjectURL !== 'function') {
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    writable: true,
    value: () => 'blob:stitch/mock',
  });
}

if (typeof URL.revokeObjectURL !== 'function') {
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    writable: true,
    value: () => undefined,
  });
}

// jsdom logs "Not implemented: window.scrollTo" on every call.
Object.defineProperty(window, 'scrollTo', {
  configurable: true,
  writable: true,
  value: () => undefined,
});
