// P-215 — the derived layer: every screen and the merge pipeline read gates
// from here instead of recomputing them, so the A/B trees, the stepper, and
// merge share ONE definition of "can proceed" (the phase's stated purpose).
//
// NAMES VERSUS THE SPEC: the spec's `canProceedSources` is P-212's
// `canProceedSourceSelection` re-exported under the phase's name (same
// predicate — both slots hold a resolved source); `canStartMerge` composes all
// three gates. The spec's `Record<path, SelectedEntry>` selection shape was
// superseded by the sorted-path contract ADR-099 finalized in P-214 (the core
// P-148 `FileSelection` is built at merge time by P-192/P-216).

import type { RunState } from './run.js';
import { canProceedSourceSelection, type SourceSlot, type SourcesState } from './selection.js';

export const canProceedSources = canProceedSourceSelection;

/** Both slots have at least one checked file. */
export function canProceedSelection(state: {
  readonly selectionA: readonly string[];
  readonly selectionB: readonly string[];
}): boolean {
  return state.selectionA.length > 0 && state.selectionB.length > 0;
}

/** The merge step may start: sources resolved, selections non-empty, not already running. */
export function canStartMerge(state: SourcesState, run: RunState): boolean {
  return canProceedSourceSelection(state) && canProceedSelection(state) && run.status !== 'running';
}

/** Number of checked files in the slot, as a selector for one slot. */
export function fileCount(
  slot: SourceSlot
): (state: {
  readonly selectionA: readonly string[];
  readonly selectionB: readonly string[];
}) => number {
  return state => (slot === 'A' ? state.selectionA.length : state.selectionB.length);
}

/**
 * Repo-relative paths checked in BOTH slots — the conflict surface P-217
 * consumes. Both inputs are stored sorted, so the result is sorted.
 */
export function conflictPaths(state: {
  readonly selectionA: readonly string[];
  readonly selectionB: readonly string[];
}): readonly string[] {
  const inB = new Set(state.selectionB);
  return state.selectionA.filter(path => inB.has(path));
}
