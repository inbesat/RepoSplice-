// P-229 — the tour host: fixed overlay + centered card driven by the tour
// store's step index. Keys: Escape skips, ←/→ navigate, Tab stays inside the
// card (focus trap, no deps). prefers-reduced-motion (jsdom-safe typeof
// guard) tags the card `data-reduced` so CSS can drop transitions.

import { useEffect, useMemo, useRef } from 'react';
import type { JSX, KeyboardEvent as ReactKeyboardEvent } from 'react';
import { TOUR_STEPS } from './steps.js';
import { useTourStore } from '../../store/tour.js';

function systemReduced(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export function Tour(): JSX.Element | null {
  const active = useTourStore(state => state.active);
  const stepIdx = useTourStore(state => state.stepIdx);
  const next = useTourStore(state => state.next);
  const prev = useTourStore(state => state.prev);
  const skip = useTourStore(state => state.skip);
  const complete = useTourStore(state => state.complete);
  const cardRef = useRef<HTMLDivElement>(null);

  const step = TOUR_STEPS[stepIdx];
  const reduced = useMemo(() => systemReduced(), [active]);

  useEffect(() => {
    if (!active || step === undefined) return undefined;
    cardRef.current?.focus();
    return undefined;
  }, [active, stepIdx]);

  if (!active || step === undefined) return null;

  const last = stepIdx === TOUR_STEPS.length - 1;

  const handleKeys = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      skip();
      return;
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      if (last) complete();
      else next();
      return;
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      prev();
      return;
    }
    if (event.key === 'Tab') {
      // focus trap: cycle inside the card
      const focusables = event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled)');
      if (focusables.length === 0) return;
      const first = focusables[0] as HTMLElement;
      const lastEl = focusables[focusables.length - 1] as HTMLElement;
      const activeEl = document.activeElement;
      if (event.shiftKey && (activeEl === first || activeEl === event.currentTarget)) {
        event.preventDefault();
        lastEl.focus();
      } else if (!event.shiftKey && activeEl === lastEl) {
        event.preventDefault();
        first.focus();
      }
    }
  };

  return (
    <div
      className="fixed inset-0 z-20"
      style={{ background: 'color-mix(in srgb, var(--bg) 72%, transparent)' }}
      data-testid="tour-overlay"
    >
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Tour step ${stepIdx + 1} of ${TOUR_STEPS.length}: ${step.title}`}
        tabIndex={-1}
        data-reduced={reduced ? 'true' : 'false'}
        onKeyDown={handleKeys}
        className="bg-surface border-border focus:outline-primary fixed left-1/2 top-1/2 w-[26rem] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 rounded-lg border p-4 shadow-lg"
        data-testid="tour-card"
      >
        <p className="text-caption text-muted">
          step {stepIdx + 1} of {TOUR_STEPS.length}
        </p>
        <h2 className="text-title mt-1">{step.title}</h2>
        <p className="text-body text-muted mt-2">{step.body}</p>
        <p className="text-caption text-muted mt-2">
          {step.route} — {step.target}
        </p>
        <div className="mt-4 flex items-center gap-2">
          <button
            type="button"
            className="text-muted min-h-11 px-2"
            onClick={prev}
            disabled={stepIdx === 0}
          >
            Back
          </button>
          <button
            type="button"
            className="text-muted min-h-11 px-2"
            onClick={skip}
            aria-label="skip tour"
          >
            Skip
          </button>
          <button
            type="button"
            className="text-primary ml-auto min-h-11 px-3 underline"
            onClick={() => (last ? complete() : next())}
          >
            {last ? (step.nextLabel ?? 'Finish') : 'Next'}
          </button>
        </div>
      </div>
    </div>
  );
}
