// P-210 — the app chrome: header + sidebar stepper + routed main region.
//
// LATER-PHASE HOOKS, present as thin affordances now:
//   run status — the header badge is static "idle" (P-216/P-224 bind the WS);
//   dark toggle — flips the `.dark` class on <html>, which is exactly the
//                 mechanism P-226's `@custom-variant dark (&:where(.dark,…))`
//                 responds to; that phase replaces the inline handler;
//   settings   — a placeholder anchor (P-225 owns the screen).
//
// The header keeps the P-208 tagline verbatim (`AI-augmented multi-repo
// composition`) — App.test's shell pins assert on it.

import { useEffect } from 'react';
import type { JSX } from 'react';
import { Outlet, useLocation } from 'react-router';
import { Stepper } from './Stepper.js';
import { Sidebar } from './Sidebar.js';
import { stepForPath } from '../router.js';
import { useFlowStore } from '../store/flow.js';

export function AppShell(): JSX.Element {
  const { pathname } = useLocation();
  const complete = useFlowStore(state => state.complete);
  const activeId = stepForPath(pathname)?.id;

  // Every route the user lands on becomes visited (drives the stepper unlock).
  useEffect(() => {
    if (activeId !== undefined) complete(activeId);
  }, [activeId, complete]);

  return (
    <div className="bg-bg text-text min-h-screen">
      <header className="bg-surface border-border flex items-center gap-4 border-b px-4 py-3">
        <h1 className="text-lg font-bold text-stitch-700 dark:text-stitch-200">stitch</h1>
        <p className="text-muted text-sm">AI-augmented multi-repo composition</p>
        <span
          className="ml-auto rounded px-2 py-0.5 text-xs"
          data-testid="run-status"
          aria-label="run status"
        >
          idle
        </span>
        <button
          type="button"
          className="text-muted px-2"
          data-testid="dark-toggle"
          aria-label="toggle dark mode"
          onClick={() => document.documentElement.classList.toggle('dark')}
        >
          ◐
        </button>
        <a href="#settings" className="text-muted px-2 text-sm" data-testid="settings-link">
          settings
        </a>
      </header>
      <div className="flex">
        <Stepper />
        <Sidebar />
        <main className="flex-1 p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
