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
import { SessionBar } from '../components/SessionBar.js';
import { canProceedSourceSelection, useSourcesStore } from '../store/selection.js';
import { useTourStore, TOUR_AUTOSTART_KEY } from '../store/tour.js';
import { useT } from '../i18n/index.js';

export function SourcesPage(): JSX.Element {
  const navigate = useNavigate();
  const canProceed = useSourcesStore(state => canProceedSourceSelection(state));
  const swapAB = useSourcesStore(state => state.swapAB);
  const sourcesA = useSourcesStore(state => state.sourcesA);
  const sourcesB = useSourcesStore(state => state.sourcesB);
  const dismissed = useTourStore(state => state.dismissed);
  const startTour = useTourStore(state => state.start);
  const { t } = useT();

  // P-229: the hero shares the empty-state condition and hides once the
  // tour (or the user) has dismissed onboarding.
  const showHero = sourcesA.length === 0 && sourcesB.length === 0 && !dismissed;

  // Both slots resolved: the flow advances to the Select step.
  useEffect(() => {
    if (canProceed) navigate('/select');
  }, [canProceed, navigate]);

  // P-229: the tour auto-queues exactly one time (localStorage marker),
  // only while the hero is showing.
  useEffect(() => {
    if (!showHero) return;
    try {
      if (localStorage.getItem(TOUR_AUTOSTART_KEY) !== null) return;
      localStorage.setItem(TOUR_AUTOSTART_KEY, '1');
    } catch {
      return;
    }
    startTour();
  }, [showHero, startTour]);

  // A swap with an empty half is a no-op shape (exchanging with []), so the
  // control stays disabled until both slots hold something.
  const swappable = sourcesA.length > 0 && sourcesB.length > 0;

  return (
    <div>
      {/* P-230: session export/import mounts first so bundles load even
          when the hero is dismissed. */}
      <SessionBar />
      {/* P-229 empty-state hero: shown while BOTH slots are empty and the
          tour hasn't been dismissed. Sits ABOVE the pickers (the P-212
          picker pins assert the pickers still render). */}
      {showHero && (
        <section
          aria-label="getting started"
          className="border-border bg-surface rounded-lg border p-6"
        >
          <h2 className="text-title">{t('tour.hero.title')}</h2>
          <ul className="text-body text-muted mt-3 list-disc space-y-1 pl-5">
            <li>{t('tour.hero.bullet.1')}</li>
            <li>{t('tour.hero.bullet.2')}</li>
            <li>{t('tour.hero.bullet.3')}</li>
          </ul>
          <button
            type="button"
            className="text-primary border-primary mt-4 min-h-11 rounded border px-3"
            onClick={() => startTour()}
          >
            {t('tour.hero.cta')}
          </button>
        </section>
      )}
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
          merge and provenance record). The data-tour anchors are the tour's
          always-rendered targets. */}
      <div className="grid gap-6 md:grid-cols-2">
        <div data-tour="add-a">
          <RepoPicker slot="A" />
        </div>
        <div data-tour="add-b">
          <RepoPicker slot="B" />
        </div>
      </div>
    </div>
  );
}
