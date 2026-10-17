// P-219 — deps outcome slice. DepsPanel emits whether the loaded report is
// free of unresolved error-level conflicts; ReviewPage (P-218) reads
// `blockers` for its approve gate. Unloaded (loaded=false) does NOT block
// approve: the server is the final authority at POST /api/merge/approve.

import { devtools } from 'zustand/middleware';
import { create } from 'zustand';

export interface DepsState {
  readonly loaded: boolean;
  readonly resolved: boolean;
  readonly blockers: readonly string[];
  setDepsOutcome: (outcome: { resolved: boolean; blockers: readonly string[] }) => void;
  reset: () => void;
}

export const useDepsStore = create<DepsState>()(
  devtools(
    set => ({
      loaded: false,
      resolved: false,
      blockers: [],
      setDepsOutcome: ({ resolved, blockers }) => set({ loaded: true, resolved, blockers }),
      reset: () => set({ loaded: false, resolved: false, blockers: [] }),
    }),
    { name: 'stitch-deps' }
  )
);
