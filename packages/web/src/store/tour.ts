// P-229 — the onboarding tour's persisted state: dismissed / completed /
// live step index. Persisted in localStorage ('stitch-tour') so the tour
// auto-runs at most one time; the P-225 settings PATCH carries the same
// dismissal to the server config (fire-and-forget — localStorage is the
// guaranteed fallback, same pattern as P-226's theme persistence).

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { patchSettings } from '../api/settings.js';

export const TOUR_KEY = 'stitch-tour';
export const TOUR_AUTOSTART_KEY = 'stitch-tour-auto';

interface Persisted {
  dismissed: boolean;
  completed: boolean;
}

function readPersisted(): Persisted {
  try {
    const raw = localStorage.getItem(TOUR_KEY);
    if (raw === null) return { dismissed: false, completed: false };
    const parsed = JSON.parse(raw) as Partial<Persisted>;
    return { dismissed: parsed.dismissed === true, completed: parsed.completed === true };
  } catch {
    return { dismissed: false, completed: false };
  }
}

function persist(next: Persisted): void {
  try {
    localStorage.setItem(TOUR_KEY, JSON.stringify(next));
  } catch {
    // storage unavailable (private mode) — session-only dismissal is fine
  }
  // fire-and-forget server sync; localStorage above is the guaranteed copy
  void patchSettings({ tour: { dismissed: next.dismissed } }).catch(() => undefined);
}

interface TourState {
  readonly active: boolean;
  readonly stepIdx: number;
  readonly dismissed: boolean;
  readonly completed: boolean;
  start: () => void;
  next: () => void;
  prev: () => void;
  skip: () => void;
  complete: () => void;
  reset: () => void;
}

export const useTourStore = create<TourState>()(
  devtools(
    (set, get) => ({
      active: false,
      stepIdx: 0,
      ...readPersisted(),
      start: () => set({ active: true, stepIdx: 0 }, false, 'tour/start'),
      next: () => {
        set(state => ({ stepIdx: state.stepIdx + 1 }), false, 'tour/next');
      },
      prev: () => {
        set(state => ({ stepIdx: Math.max(0, state.stepIdx - 1) }), false, 'tour/prev');
      },
      skip: () => {
        persist({ dismissed: true, completed: get().completed });
        set({ active: false, dismissed: true }, false, 'tour/skip');
      },
      complete: () => {
        persist({ dismissed: true, completed: true });
        set({ active: false, dismissed: true, completed: true }, false, 'tour/complete');
      },
      reset: () => {
        try {
          localStorage.removeItem(TOUR_KEY);
          localStorage.removeItem(TOUR_AUTOSTART_KEY);
        } catch {
          // ignore
        }
        set({ active: false, stepIdx: 0, dismissed: false, completed: false }, false, 'tour/reset');
      },
    }),
    { name: 'stitch-tour' }
  )
);
