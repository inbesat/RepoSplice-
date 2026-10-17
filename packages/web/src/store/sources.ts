// P-211 — the sources slice of the P-215 store, seeded with ONLY what the
// pickers need. P-215 formalizes `store/` (combine + selectors); this file is
// its `sources` slice (the spec's "sourcesA/sourcesB (refs, status)") and will
// sit under that umbrella unchanged — the same seed pattern as flow.ts (P-210).

import { create } from 'zustand';
import type { SourceRecord } from '../api/repos.js';

export type SourceSlot = 'A' | 'B';

export interface SourcesState {
  readonly sourcesA: readonly SourceRecord[];
  readonly sourcesB: readonly SourceRecord[];
  /** Append a resolved source to the slot's list (first call per record wins). */
  addSource: (slot: SourceSlot, record: SourceRecord) => void;
  /** P-215's `reset` seed. */
  reset: () => void;
}

export const useSourcesStore = create<SourcesState>()(set => ({
  sourcesA: [],
  sourcesB: [],
  addSource: (slot, record) =>
    set(state => {
      const list = slot === 'A' ? state.sourcesA : state.sourcesB;
      if (list.some(existing => existing.id === record.id)) return state;
      return slot === 'A'
        ? { sourcesA: [...state.sourcesA, record] }
        : { sourcesB: [...state.sourcesB, record] };
    }),
  reset: () => set({ sourcesA: [], sourcesB: [] }),
}));
