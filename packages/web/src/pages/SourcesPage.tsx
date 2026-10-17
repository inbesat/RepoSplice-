// P-211/P-212 — the Sources screen: BOTH pickers on one screen, bound to their
// store slots. The page owns the advance (not the pickers): navigation to
// Select happens when BOTH slots hold a resolved source (`canProceed`), so a
// single completed picker never yanks the user off the screen mid-setup.
// The swap control (P-212) serves the "entered the sources in the wrong
// order" case; the A/B order is what merge (P-192) and provenance (P-181) see.

import { useEffect } from 'react';
import type { JSX } from 'react';
import { useNavigate } from 'react-router';
import { RepoPicker } from '../components/RepoPicker.js';
import { canProceedSourceSelection, useSourcesStore } from '../store/selection.js';

export function SourcesPage(): JSX.Element {
  const navigate = useNavigate();
  const canProceed = useSourcesStore(state => canProceedSourceSelection(state));
  const swapAB = useSourcesStore(state => state.swapAB);
  const sourcesA = useSourcesStore(state => state.sourcesA);
  const sourcesB = useSourcesStore(state => state.sourcesB);

  // Both slots resolved: the flow advances to the Select step.
  useEffect(() => {
    if (canProceed) navigate('/select');
  }, [canProceed, navigate]);

  // A swap with an empty half is a no-op shape (exchanging with []), so the
  // control stays disabled until both slots hold something.
  const swappable = sourcesA.length > 0 && sourcesB.length > 0;

  return (
    <div>
      <div className="mb-3 flex items-center">
        <button
          type="button"
          className="border-border text-muted hover:text-text ml-auto rounded border px-2 py-1 text-xs"
          aria-label="Swap A and B"
          title="Exchange the repo A and repo B source lists"
          disabled={!swappable}
          onClick={swapAB}
        >
          ⇄ Swap A/B
        </button>
      </div>
      {/* Paired pickers: A is the base, B the overlay (the A/B order is what
          merge and provenance record). */}
      <div className="grid gap-6 md:grid-cols-2">
        <RepoPicker slot="A" />
        <RepoPicker slot="B" />
      </div>
    </div>
  );
}
