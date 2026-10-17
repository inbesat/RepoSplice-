// P-212 — the selection store (A/B symmetry) tests.
//
// The four required scenarios from the phase spec:
//
//   it('tracks a and b')   it('canProceed gate')   it('swap a b')   it('clears stale on change')

import { describe, it, expect, beforeEach } from 'vitest';
import { canProceedSourceSelection, useSourcesStore } from './selection.js';
import { useFlowStore } from './flow.js';
import type { SourceRecord } from '../api/repos.js';

const GITHUB: Omit<SourceRecord, 'id'> = {
  kind: 'github',
  repo: 'vercel/ai',
  ref: 'main',
  status: 'ready',
};
const LOCAL: Omit<SourceRecord, 'id'> = {
  kind: 'local',
  path: 'repos/a',
  status: 'ready',
};

describe('P-212 selection store', () => {
  beforeEach(() => {
    useSourcesStore.getState().reset();
    useFlowStore.getState().reset();
  });

  it('tracks a and b', () => {
    useSourcesStore.getState().addSource('A', { ...GITHUB, id: 'a-1' });
    useSourcesStore.getState().addSource('B', { ...LOCAL, id: 'b-1' });
    const state = useSourcesStore.getState();
    expect(state.sourcesA.map(record => record.id)).toEqual(['a-1']);
    expect(state.sourcesB.map(record => record.id)).toEqual(['b-1']);

    // The dedupe is PER SLOT: re-adding the same id to A changes nothing,…
    useSourcesStore.getState().addSource('A', { ...GITHUB, id: 'a-1' });
    expect(useSourcesStore.getState().sourcesA).toHaveLength(1);
    // …while the same id in B is a distinct slot's entry.
    useSourcesStore.getState().addSource('B', { ...LOCAL, id: 'a-1' });
    expect(useSourcesStore.getState().sourcesB.map(record => record.id)).toEqual(['b-1', 'a-1']);
  });

  it('canProceed gate', () => {
    // Neither slot: no.
    expect(canProceedSourceSelection(useSourcesStore.getState())).toBe(false);
    // A only: no — the merge needs both.
    useSourcesStore.getState().addSource('A', { ...GITHUB, id: 'a-1' });
    expect(canProceedSourceSelection(useSourcesStore.getState())).toBe(false);
    // B resolved: gate opens.
    useSourcesStore.getState().addSource('B', { ...LOCAL, id: 'b-1' });
    expect(canProceedSourceSelection(useSourcesStore.getState())).toBe(true);
    // A slot holding only UNRESOLVED records does not count ('chosen ref' =
    // a resolved source; local sources carry a path, not a ref).
    useSourcesStore.getState().reset();
    useSourcesStore.getState().addSource('A', { ...GITHUB, id: 'a-p', status: 'pending' });
    useSourcesStore.getState().addSource('B', { ...LOCAL, id: 'b-1' });
    expect(canProceedSourceSelection(useSourcesStore.getState())).toBe(false);
  });

  it('swap a b', () => {
    useSourcesStore.getState().addSource('A', { ...GITHUB, id: 'a-1' });
    useSourcesStore.getState().addSource('B', { ...LOCAL, id: 'b-1' });
    useSourcesStore.getState().swapAB();
    const state = useSourcesStore.getState();
    expect(state.sourcesA.map(record => record.id)).toEqual(['b-1']);
    expect(state.sourcesB.map(record => record.id)).toEqual(['a-1']);
  });

  it('clears stale on change', () => {
    // Anything built on the old refs is downstream state; today that is the
    // flow's visited set (P-215 extends the prune to its own state).
    const flow = useFlowStore.getState();
    flow.complete('sources');
    flow.complete('select');
    expect(useFlowStore.getState().visited).toEqual(['sources', 'select']);

    // A slot change un-visits the downstream steps (Sources stays visited).
    useSourcesStore.getState().addSource('A', { ...GITHUB, id: 'a-1' });
    expect(useFlowStore.getState().visited).toEqual(['sources']);

    // And so does the swap.
    useSourcesStore.getState().addSource('B', { ...LOCAL, id: 'b-1' });
    useFlowStore.getState().complete('select');
    useSourcesStore.getState().swapAB();
    expect(useFlowStore.getState().visited).toEqual(['sources']);
  });
});
