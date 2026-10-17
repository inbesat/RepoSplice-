// P-215 — the run slice: lifecycle of the merge run plus the step it is on.
// P-216 grows this slice with progress events and the AI stream state; today it
// carries the minimum the P-215 selectors (`canStartMerge`) and later screens
// read: the status and the current pipeline step.

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type { RunStatus } from './types.js';

export interface RunState {
  readonly status: RunStatus;
  /** The pipeline step the run is currently on (undefined while idle). */
  readonly currentStep: string | undefined;
  /**
   * Transition the run. An omitted `currentStep` leaves the previous step in
   * place (status-only updates); `reset()` clears both back to the start.
   */
  setRunStatus: (status: RunStatus, currentStep?: string) => void;
  reset: () => void;
}

export const useRunStore = create<RunState>()(
  devtools(
    set => ({
      status: 'idle',
      currentStep: undefined,
      setRunStatus: (status, currentStep) =>
        set({ status, ...(currentStep !== undefined ? { currentStep } : {}) }),
      reset: () => set({ status: 'idle', currentStep: undefined }),
    }),
    { name: 'stitch-run' }
  )
);
