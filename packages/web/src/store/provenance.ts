// P-222 — Provenance confirmation slice.
//
// The 'attribution looks correct' checkbox in CreditsPreview publishes
// here; the P-218 approve gate reads `creditsConfirmed` as its
// provenance-completeness condition once the panel is mounted.

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

export interface ProvenanceState {
  /** True once the user confirmed the attribution preview. */
  readonly creditsConfirmed: boolean;
  setCreditsConfirmed: (confirmed: boolean) => void;
  reset: () => void;
}

export const useProvenanceStore = create<ProvenanceState>()(
  devtools(
    set => ({
      creditsConfirmed: false,
      setCreditsConfirmed: confirmed => set({ creditsConfirmed: confirmed }),
      reset: () => set({ creditsConfirmed: false }),
    }),
    { name: 'stitch-provenance' }
  )
);
