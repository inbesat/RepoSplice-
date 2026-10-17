// P-215 — the store contract tests: one per slice/action family plus the
// derived selectors, using the spec's mandated names. Slices under test:
// sources+selection (selection.ts), run (run.ts), flow (via the downstream
// prune), and selectors (selectors.ts).

import { beforeEach, describe, expect, it } from 'vitest';
import type { SourceRecord } from '../api/repos.js';
import { useFlowStore } from './flow.js';
import { useRunStore } from './run.js';
import { hasResolvedSource, useSourcesStore } from './selection.js';
import {
  canProceedSelection,
  canProceedSources,
  canStartMerge,
  conflictPaths,
  fileCount,
} from './selectors.js';

const READY_A: SourceRecord = { id: 'r1', kind: 'local', path: '/tmp/rA', status: 'ready' };
const READY_B: SourceRecord = { id: 'r2', kind: 'local', path: '/tmp/rB', status: 'ready' };

describe('store', () => {
  beforeEach(() => {
    useSourcesStore.getState().reset();
    useRunStore.getState().reset();
    useFlowStore.getState().reset();
  });

  it('sources slice', () => {
    const initial = useSourcesStore.getState();
    expect(initial.sourcesA).toEqual([]);
    expect(initial.sourcesB).toEqual([]);
    expect(hasResolvedSource(initial.sourcesA)).toBe(false);

    useSourcesStore.getState().addSource('A', READY_A);
    expect(useSourcesStore.getState().sourcesA).toEqual([READY_A]);
    useSourcesStore.getState().addSource('A', READY_A); // same id — deduped
    expect(useSourcesStore.getState().sourcesA).toHaveLength(1);
    expect(hasResolvedSource(useSourcesStore.getState().sourcesA)).toBe(true);

    useSourcesStore.getState().addSource('B', READY_B);
    expect(canProceedSources(useSourcesStore.getState())).toBe(true);
  });

  it('selection toggle', () => {
    useSourcesStore.getState().togglePath('A', 'src/b.ts');
    useSourcesStore.getState().togglePath('A', 'a.ts'); // sorts ahead of src/b.ts
    expect(useSourcesStore.getState().selectionA).toEqual(['a.ts', 'src/b.ts']);

    useSourcesStore.getState().togglePath('A', 'a.ts');
    expect(useSourcesStore.getState().selectionA).toEqual(['src/b.ts']);

    useSourcesStore.getState().togglePath('B', 'keep.md');
    expect(useSourcesStore.getState().selectionB).toEqual(['keep.md']); // other slot untouched
    expect(useSourcesStore.getState().selectionA).toEqual(['src/b.ts']);
  });

  it('run status', () => {
    expect(useRunStore.getState().status).toBe('idle');
    expect(useRunStore.getState().currentStep).toBeUndefined();

    useRunStore.getState().setRunStatus('running', 'compose');
    expect(useRunStore.getState().status).toBe('running');
    expect(useRunStore.getState().currentStep).toBe('compose');

    useRunStore.getState().setRunStatus('succeeded'); // step omitted — stays
    expect(useRunStore.getState().status).toBe('succeeded');
    expect(useRunStore.getState().currentStep).toBe('compose');

    useRunStore.getState().reset();
    expect(useRunStore.getState().status).toBe('idle');
    expect(useRunStore.getState().currentStep).toBeUndefined();
  });

  it('selectors can proceed', () => {
    const empty = useSourcesStore.getState();
    expect(canProceedSources(empty)).toBe(false);
    expect(canProceedSelection(empty)).toBe(false);
    expect(canStartMerge(empty, useRunStore.getState())).toBe(false);

    useSourcesStore.getState().addSource('A', READY_A);
    useSourcesStore.getState().addSource('B', READY_B);
    const sources = useSourcesStore.getState();
    expect(canProceedSources(sources)).toBe(true);
    expect(canProceedSelection(sources)).toBe(false); // sources resolved, nothing checked yet

    useSourcesStore.getState().setSelection('A', ['a.ts']);
    useSourcesStore.getState().setSelection('B', ['b.ts']);
    const seeded = useSourcesStore.getState();
    expect(canProceedSelection(seeded)).toBe(true);
    expect(canStartMerge(seeded, useRunStore.getState())).toBe(true);

    useRunStore.getState().setRunStatus('running');
    expect(canStartMerge(seeded, useRunStore.getState())).toBe(false);

    expect(fileCount('A')(seeded)).toBe(1);
    expect(fileCount('B')(seeded)).toBe(1);
  });

  it('conflict paths', () => {
    useSourcesStore.getState().setSelection('A', ['a.md', 'shared.md', 'zz.md']);
    useSourcesStore.getState().setSelection('B', ['b.md', 'shared.md', 'zz.md']);
    expect(conflictPaths(useSourcesStore.getState())).toEqual(['shared.md', 'zz.md']);

    useSourcesStore.getState().setSelection('B', ['only-b.md']);
    expect(conflictPaths(useSourcesStore.getState())).toEqual([]);
  });

  it('reset', () => {
    useSourcesStore.getState().addSource('A', READY_A);
    useSourcesStore.getState().setSelection('A', ['a.ts']);
    useFlowStore.getState().complete('sources');
    useFlowStore.getState().complete('select');
    useRunStore.getState().setRunStatus('failed');

    useSourcesStore.getState().reset();
    expect(useSourcesStore.getState().sourcesA).toEqual([]);
    expect(useSourcesStore.getState().selectionA).toEqual([]);

    useRunStore.getState().reset();
    expect(useRunStore.getState().status).toBe('idle');

    // Source changes clear downstream state: the visited set is pruned to Sources.
    useFlowStore.getState().complete('sources');
    useFlowStore.getState().complete('select');
    useSourcesStore.getState().addSource('B', READY_B);
    expect(useFlowStore.getState().visited).toEqual(['sources']);
  });
});
