// P-227 — the shared breakpoint hint.
//
// A module-level store (useSyncExternalStore): every consumer subscribes to
// the SAME evaluation, so all components see one viewport verdict per render.
// Deliberately matchMedia-driven rather than CSS-only — jsdom does not apply
// media queries, so data-driven layout is what the responsive TESTS assert
// (ADR-112). Without a matchMedia global (SSR, jsdom) the verdict is 'wide':
// every pre-P-227 consumer keeps today's desktop layout.

import { useSyncExternalStore } from 'react';

/** Three viewport bands: <768 mobile, <1024 narrow, else wide. */
export type Viewport = 'mobile' | 'narrow' | 'wide';

const MOBILE_Q = '(max-width: 767px)';
const NARROW_Q = '(max-width: 1023px)';
const QUERIES = [MOBILE_Q, NARROW_Q] as const;

function currentViewport(): Viewport {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'wide';
  if (window.matchMedia(MOBILE_Q).matches) return 'mobile';
  if (window.matchMedia(NARROW_Q).matches) return 'narrow';
  return 'wide';
}

const listeners = new Set<() => void>();
function notify(): void {
  for (const listener of listeners) listener();
}

function subscribe(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    for (const query of QUERIES) {
      // Side-matched listeners are idempotent across mounts; per-consumer
      // cleanup only removes the store subscription.
      window.matchMedia(query).addEventListener('change', notify);
    }
  }
  return () => {
    listeners.delete(onStoreChange);
  };
}

function getSnapshot(): Viewport {
  return currentViewport();
}

/** The shared breakpoint verdict: 'mobile' | 'narrow' | 'wide'. */
export function useViewport(): Viewport {
  return useSyncExternalStore(subscribe, getSnapshot, () => 'wide');
}
