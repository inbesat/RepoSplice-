// P-210 — the app chrome: header + sidebar stepper + routed main region.
//
// LATER-PHASE HOOKS, present as thin affordances now:
//   run status — the header badge is static "idle" (P-216/P-224 bind the WS);
//   dark toggle — P-226's <ThemeToggle /> (auto/light/dark, persisted);
//   settings   — links to /settings (P-225's screen).
//
// The header keeps the P-208 tagline verbatim (`AI-augmented multi-repo
// composition`) — App.test's shell pins assert on it.

import { useEffect } from 'react';
import type { JSX } from 'react';
import { Link, Outlet, useLocation } from 'react-router';
import { SkipLink } from '../a11y/index.js';
import { useT } from '../i18n/index.js';
import { ThemeToggle } from './ThemeToggle.js';
import { Stepper } from './Stepper.js';
import { Sidebar } from './Sidebar.js';
import { Tour } from '../components/tour/Tour.js';
import { stepForPath } from '../router.js';
import { useFlowStore } from '../store/flow.js';
import { canProceedSourceSelection, useSourcesStore } from '../store/selection.js';
import { useViewport } from '../hooks/useViewport.js';

export function AppShell(): JSX.Element {
  const { pathname } = useLocation();
  const { t } = useT();
  const complete = useFlowStore(state => state.complete);
  const activeId = stepForPath(pathname)?.id;
  // P-212: the Select step is data-gated — both source slots must hold a
  // resolved source (the stepper also keeps its sequential visited unlock).
  const selectReady = useSourcesStore(state => canProceedSourceSelection(state));
  // P-227: one shared breakpoint verdict drives nav + header shape (the
  // store-hint contract — data-driven, not CSS-media-query driven, so the
  // responsive tests can assert it in jsdom).
  const viewport = useViewport();
  const compact = viewport === 'mobile' || viewport === 'narrow';

  // Every route the user lands on becomes visited (drives the stepper unlock).
  useEffect(() => {
    if (activeId !== undefined) complete(activeId);
  }, [activeId, complete]);

  return (
    <div className="bg-bg text-text min-h-screen">
      <SkipLink />
      <header className="bg-surface border-border flex items-center gap-4 border-b px-4 py-3">
        <h1 className="text-lg font-bold text-stitch-700 dark:text-stitch-200">stitch</h1>
        {/* P-227: brand tagline yields its row space on narrow screens. */}
        {viewport === 'wide' && <p className="text-muted text-sm">{t('shell.tagline')}</p>}
        <span
          className="ml-auto rounded px-2 py-0.5 text-xs"
          data-testid="run-status"
          aria-label="run status"
        >
          {t('shell.runStatus.idle')}
        </span>
        <ThemeToggle />
        <Link
          to="/settings"
          className="text-muted flex min-h-11 items-center px-2 text-sm"
          data-testid="settings-link"
        >
          {t('shell.settings')}
        </Link>
      </header>
      <div className="flex">
        {viewport === 'wide' && <Stepper gates={{ select: selectReady }} />}
        {viewport === 'wide' && <Sidebar />}
        <main id="main" tabIndex={-1} className="flex-1 p-6">
          <Outlet />
        </main>
      </div>
      {/* P-227: below lg the five-step flow becomes a fixed bottom bar. */}
      {compact && (
        <div
          data-testid="bottom-stepper"
          className="bg-surface border-border fixed inset-x-0 bottom-0 z-10 border-t"
        >
          <Stepper gates={{ select: selectReady }} horizontal />
        </div>
      )}
      {/* P-229: the onboarding tour overlay (renders null when inactive). */}
      <Tour />
    </div>
  );
}
