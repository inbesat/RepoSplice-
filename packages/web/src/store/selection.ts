// P-212 — the selection slice of the P-215 store: the sources for BOTH slots
// plus the A/B symmetry the merge flow needs. This is the phase's own file
// name; P-211's `sources.ts` (the A-only seed) is re-exported through it.
//
// THE 'CHOSEN REF' RECONCILIATION: the spec's `canProceedSourceSelection =
// sourcesA.some(chosen ref) && sourcesB.some(...)` is read as "each slot holds
// a RESOLVED source" — `status === 'ready'`. A local source carries a `path`,
// not a `ref`, so counting refs alone would deadlock the local-path flow.
//
// STALE DOWNSTREAM STATE (spec step 5): refs changing invalidates anything
// built on them. P-215's files/resolutions don't exist yet, so the carrier
// being cleared today is the flow's visited set: any slot change or swap
// un-visits everything after Sources, and P-215 extends the same prune to its
// own state when it lands.

import { create } from 'zustand';
import type { SourceRecord } from '../api/repos.js';
import { useFlowStore } from './flow.js';

// P-214 SELECTIONS: `selectionA`/`selectionB` hold the repo-relative FILE
// paths the user checked per slot (sorted) — the path-keyed, slot-keyed
// contract finalized HERE per the handoff ("keep the store keys stable for
// merge P-192/provenance P-181"). Core's P-148 `FileSelection`
// (`files: SelectedFile[]` with a `SourceRepo` each) is built at MERGE time by
// P-192/P-216; the store carries the stable raw shape. Clearing a slot's
// source also clears its selection (a selection without a source is
// meaningless).

export type SourceSlot = 'A' | 'B';

export interface SourcesState {
  readonly sourcesA: readonly SourceRecord[];
  readonly sourcesB: readonly SourceRecord[];
  /** Repo-relative checked file paths per slot (sorted). */
  readonly selectionA: readonly string[];
  readonly selectionB: readonly string[];
  /** Append a resolved source to the slot's list (first call per record wins). */
  addSource: (slot: SourceSlot, record: SourceRecord) => void;
  /** Exchange the two slots (used when the sources were entered in the wrong order). */
  swapAB: () => void;
  /** P-215's `reset` seed. */
  reset: () => void;
  /** Replace the slot's checked file paths (sorted). */
  setSelection: (slot: SourceSlot, paths: readonly string[]) => void;
}

/** A slot is usable when it holds at least one RESOLVED source. */
export function hasResolvedSource(list: readonly SourceRecord[]): boolean {
  return list.some(record => record.status === 'ready');
}

/** The Select step opens only when BOTH slots hold a resolved source. */
export function canProceedSourceSelection(state: {
  readonly sourcesA: readonly SourceRecord[];
  readonly sourcesB: readonly SourceRecord[];
}): boolean {
  return hasResolvedSource(state.sourcesA) && hasResolvedSource(state.sourcesB);
}

/** Un-visit everything after Sources: the downstream state is stale now. */
function pruneDownstream(): void {
  useFlowStore.setState(state => ({ visited: state.visited.filter(id => id === 'sources') }));
}

export const useSourcesStore = create<SourcesState>()(set => ({
  sourcesA: [],
  sourcesB: [],
  selectionA: [],
  selectionB: [],
  addSource: (slot, record) =>
    set(state => {
      const list = slot === 'A' ? state.sourcesA : state.sourcesB;
      if (list.some(existing => existing.id === record.id)) return state;
      pruneDownstream();
      const cleared = { selectionA: [], selectionB: [] }; // source changed — selections are stale
      return slot === 'A'
        ? { sourcesA: [...state.sourcesA, record], ...cleared }
        : { sourcesB: [...state.sourcesB, record], ...cleared };
    }),
  swapAB: () => {
    pruneDownstream();
    set(state => ({
      sourcesA: state.sourcesB,
      sourcesB: state.sourcesA,
      selectionA: [],
      selectionB: [],
    }));
  },
  reset: () => set({ sourcesA: [], sourcesB: [], selectionA: [], selectionB: [] }),
  setSelection: (slot, paths) =>
    set(state => {
      const next = [...paths].sort();
      const current = slot === 'A' ? state.selectionA : state.selectionB;
      if (current.length === next.length && current.every((path, index) => path === next[index])) {
        return state; // identical content — skip the re-render loop
      }
      return slot === 'A' ? { selectionA: next } : { selectionB: next };
    }),
}));
