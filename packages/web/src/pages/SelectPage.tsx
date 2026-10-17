// P-214 — file selection for BOTH sources: the split A/B tree view, combined
// per-slot counts, and the sticky "Continue to Merge" gate (both selections
// non-empty). Selections live in the store (selectionA/selectionB) — the
// stable keys P-216/P-192 consume.

import type { JSX } from 'react';
import { useNavigate } from 'react-router';
import { SplitTreeView } from '../components/SplitTreeView.js';
import { canProceedSelection } from '../store/selectors.js';
import { useSourcesStore } from '../store/selection.js';

export function SelectPage(): JSX.Element {
  const navigate = useNavigate();
  const sourceA = useSourcesStore(state => state.sourcesA[0]);
  const sourceB = useSourcesStore(state => state.sourcesB[0]);
  const selectionA = useSourcesStore(state => state.selectionA);
  const selectionB = useSourcesStore(state => state.selectionB);
  const setSelection = useSourcesStore(state => state.setSelection);

  if (sourceA === undefined && sourceB === undefined) {
    return (
      <section>
        <h2 className="text-title font-semibold">Select</h2>
        <p className="text-muted">Pick a source first — the file tree loads here once you do.</p>
      </section>
    );
  }

  const ready = canProceedSelection({ selectionA, selectionB });
  return (
    <section aria-label="Select files">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-title font-semibold">Select files</h2>
        <p className="text-body text-muted" data-testid="slot-counts">
          A: {selectionA.length} selected · B: {selectionB.length} selected
        </p>
      </div>
      <SplitTreeView
        {...(sourceA !== undefined ? { sourceA } : {})}
        {...(sourceB !== undefined ? { sourceB } : {})}
        onSelectionA={paths => setSelection('A', paths)}
        onSelectionB={paths => setSelection('B', paths)}
      />
      <div className="sticky bottom-0 mt-4 flex items-center gap-3 border-t border-border bg-bg py-3">
        <button
          type="button"
          disabled={!ready}
          onClick={() => navigate('/stitch')}
          className="rounded-md bg-stitch-700 px-4 py-2 text-body text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          Continue to Merge
        </button>
        {!ready && (
          <p className="text-caption text-muted">
            Select at least one file from {selectionA.length === 0 ? 'repo A' : ''}
            {selectionA.length === 0 && selectionB.length === 0 ? ' and ' : ''}
            {selectionB.length === 0 ? 'repo B' : ''} to continue.
          </p>
        )}
      </div>
    </section>
  );
}
