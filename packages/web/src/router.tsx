// P-210 — the router: step ↔ route ↔ page, centralized.
//
// THE HANDOFF NOTE LIVES HERE: "keep step id ↔ route key mapping centralized
// in router.tsx for the stepper" — `STEPS` is that mapping, and Stepper.tsx
// imports it rather than re-declaring its own list.
//
// Route access is OPEN in P-210 (deep links render, per `routes placeholders`);
// the stepper's locked affordance is a UI gate. Route guards (can-proceed from
// P-215's selectors) bind in later phases — a placeholder page today beats a
// dead deep link.
//
// RouteErrorBoundary: the spec's P-228 boundary, landed now because React
// Router's errorElement IS the catch — a route render-throw must show a
// prefixable message, not a white page.

import { Component, type ComponentType, type ErrorInfo, type JSX, type ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { AppShell } from './shell/AppShell.js';
import { ThemeProvider } from './theme/ThemeProvider.js';
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

interface BoundaryState {
  error: Error | null;
}

/**
 * Route-level error boundary: catches a render throw inside any route and
 * shows the message instead of unmounting the whole tree (P-228's contract,
 * wired into the route table from P-210 onward).
 */
export class RouteErrorBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  override state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // The real reporting lands with P-228; the boundary must exist first.
    console.error('route render failed:', error.message, info.componentStack);
  }

  override render(): ReactNode {
    if (this.state.error !== null) {
      return (
        <div role="alert" className="p-4">
          <h2 className="text-danger">Something went wrong</h2>
          <p className="text-muted">{this.state.error.message}</p>
        </div>
      );
    }
    return this.props.children;
  }
}

/** Error boundary per route + the shell wrapping the five pages. */
export function AppShellRoutes(): JSX.Element {
  return (
    <ThemeProvider>
      <RouteErrorBoundary>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<Navigate to="/sources" replace />} />
            {STEPS.map(step => (
              <Route key={step.id} path={step.path.slice(1)} element={<step.Page />} />
            ))}
            <Route path="settings" element={<SettingsPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/sources" replace />} />
        </Routes>
      </RouteErrorBoundary>
    </ThemeProvider>
  );
}
