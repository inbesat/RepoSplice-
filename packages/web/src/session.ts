import { create } from 'zustand';

/**
 * SessionState: reference client store (P-050). This is the *pattern*
 * P-215's `store/` slices (sources/selection/run/flow + selectors) follow —
 * typed state, pure actions, hook selectors — not the UI contract itself
 * (that lands in Wave 2 under aradhy). Kept deliberately small: wizard
 * step, chosen repos, session start.
 */
export type SessionState = {
  readonly stepIndex: number;
  readonly selectedRepos: readonly string[];
  readonly startedAt: number | null;
  advanceStep(): void;
  toggleRepo(path: string): void;
  reset(): void;
};

export const useSessionStore = create<SessionState>()(set => ({
  stepIndex: 0,
  selectedRepos: [],
  startedAt: null,
  advanceStep: () =>
    set(s => ({ stepIndex: s.stepIndex + 1, startedAt: s.startedAt ?? Date.now() })),
  toggleRepo: (path: string) =>
    set(s => ({
      selectedRepos: s.selectedRepos.includes(path)
        ? s.selectedRepos.filter(p => p !== path)
        : [...s.selectedRepos, path],
    })),
  reset: () => set({ stepIndex: 0, selectedRepos: [], startedAt: null }),
}));
