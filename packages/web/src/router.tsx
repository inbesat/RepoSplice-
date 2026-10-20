// P-210 — the router: step ↔ route ↔ page, centralized. P-228 — every page
// sits inside its OWN <ErrorBoundary> inside a ROOT boundary on the shell, so
// one failing panel never white-screens the app (components/ErrorBoundary).
//
// THE HANDOFF NOTE LIVES HERE: "keep step id ↔ route key mapping centralized
// in router.tsx for the stepper" — `STEPS` is that mapping, and Stepper.tsx
// imports it rather than re-declaring its own list.
//
// Route access is OPEN in P-210 (deep links render, per `routes placeholders`);
// the stepper's locked affordance is a UI gate. Route guards (can-proceed from
// P-215's selectors) bind in later phases — a placeholder page today beats a
// dead deep link.

import { type ComponentType, type JSX } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { AppShell } from './shell/AppShell.js';
import { ThemeProvider } from './theme/ThemeProvider.js';
import { ErrorBoundary } from './components/ErrorBoundary.js';
import { SourcesPage } from './pages/SourcesPage.js';
import { SelectPage } from './pages/SelectPage.js';
import { MergePage } from './pages/MergePage.js';
import { ReviewPage } from './pages/ReviewPage.js';
import { ResultsPage } from './pages/ResultsPage.js';
import { SettingsPage } from './pages/SettingsPage.js';

/** One flow step: the id the store keys by, the route, the label, the page. */
export interface StepDef {
  readonly id: 'sources' | 'select' | 'stitch' | 'review' | 'results';
  readonly path: string;
  readonly label: string;
  readonly Page: ComponentType;
}

/** The five-step flow, in order (Sources → Select → Stitch → Review → Results). */
export const STEPS: readonly StepDef[] = [
  { id: 'sources', path: '/sources', label: 'Sources', Page: SourcesPage },
  { id: 'select', path: '/select', label: 'Select', Page: SelectPage },
  { id: 'stitch', path: '/stitch', label: 'Stitch', Page: MergePage },
  { id: 'review', path: '/review', label: 'Review', Page: ReviewPage },
  { id: 'results', path: '/results', label: 'Results', Page: ResultsPage },
];

/** The step whose route matches a pathname, or undefined. */
export function stepForPath(pathname: string): StepDef | undefined {
  return STEPS.find(step => step.path === pathname);
}

/** Root + per-route error boundaries (P-228) around the shell's pages. */
export function AppShellRoutes(): JSX.Element {
  return (
    <ThemeProvider>
      <ErrorBoundary label="root">
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<Navigate to="/sources" replace />} />
            {STEPS.map(step => (
              <Route
                key={step.id}
                path={step.path.slice(1)}
                element={
                  <ErrorBoundary label={step.id}>
                    <step.Page />
                  </ErrorBoundary>
                }
              />
            ))}
            <Route
              path="settings"
              element={
                <ErrorBoundary label="settings">
                  <SettingsPage />
                </ErrorBoundary>
              }
            />
          </Route>
          <Route path="*" element={<Navigate to="/sources" replace />} />
        </Routes>
      </ErrorBoundary>
    </ThemeProvider>
  );
}
