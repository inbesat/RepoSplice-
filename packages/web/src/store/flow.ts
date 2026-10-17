// P-210 — the flow slice of the P-215 store, seeded with ONLY what the
// stepper needs. P-215 formalizes `store/` (combine + selectors + devtools);
// this file is its `flow` slice and will move under that umbrella unchanged:
// state shape (visited step ids) and the `complete` action are already the
// P-215 spec's ("steps metadata + activeStep, visited — powers P-210 stepper").

import { create } from 'zustand';
import type { StepDef } from '../router.js';

export interface FlowState {
  /** Ids of steps the user has been on, in first-visit order. */
  readonly visited: readonly StepDef['id'][];
  /** Mark a step visited (first call wins — order is preserved). */
  complete: (id: StepDef['id']) => void;
  /** P-215's `reset` seed: back to the first step only. */
  reset: () => void;
}

export const useFlowStore = create<FlowState>()(set => ({
  visited: [],
  complete: id =>
    set(state => (state.visited.includes(id) ? state : { visited: [...state.visited, id] })),
  reset: () => set({ visited: [] }),
}));
