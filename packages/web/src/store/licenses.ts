// P-220 — license outcome slice. LicensePanel emits whether the loaded report
// is free of hard denies and pending unknowns; ReviewPage (P-218) reads
// `blockers` for its approve gate. Unloaded (loaded=false) does NOT block
// approve: the server is the final authority at POST /api/merge/approve
// (same rule as the deps slice, ADR-104).

import { devtools } from 'zustand/middleware';
import { create } from 'zustand';

export interface LicensesState {
  readonly loaded: boolean;
  readonly clear: boolean;
  readonly blockers: readonly string[];
  setLicensesOutcome: (outcome: { clear: boolean; blockers: readonly string[] }) => void;
  reset: () => void;
}

export const useLicensesStore = create<LicensesState>()(
  devtools(
    set => ({
      loaded: false,
      clear: true,
      blockers: [],
      setLicensesOutcome: ({ clear, blockers }) => set({ loaded: true, clear, blockers }),
      reset: () => set({ loaded: false, clear: true, blockers: [] }),
    }),
    { name: 'stitch-licenses' }
  )
);
