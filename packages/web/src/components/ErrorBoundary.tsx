// P-228 — React error boundary: never a white screen.
//
// One class, mounted twice per route tree: ROOT (wraps the whole app; a crash
// here means the shell itself failed) and PER-ROUTE (wraps each page so one
// failing panel keeps the rest of the app alive). The fallback shows a
// generated error id for tracing, a friendly mapped message (toUiError), a
// reload button, and a copy-id button. Logging is console.error with the id —
// the web logger is a later phase (ADR-113).

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { TriangleAlert } from 'lucide-react';
import { scanFromError, toUiError } from '../lib/errors.js';

interface BoundaryState {
  error: Error | null;
  id: string;
}

export interface ErrorBoundaryProps {
  readonly children: ReactNode;
  /** Which boundary caught it — for the log line and the trace footer. */
  readonly label?: string;
}

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, BoundaryState> {
  override state: BoundaryState = { error: null, id: '' };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error, id: newId() };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Web logger deferred (ADR-113): console with a tracable id.
    console.error(
      `[stitch] boundary ${this.props.label ?? 'root'} error ${this.state.id}:`,
      error.message,
      info.componentStack
    );
  }

  private readonly handleReload = (): void => {
    window.location.reload();
  };

  private readonly handleCopyId = (): void => {
    void navigator.clipboard?.writeText(this.state.id).catch(() => undefined);
  };

  override render(): ReactNode {
    const { error, id } = this.state;
    if (error === null) {
      return this.props.children;
    }
    const ui = toUiError(scanFromError(error), error);
    return (
      <section aria-label="error fallback" className="p-4">
        <TriangleAlert aria-hidden="true" className="text-warning h-6 w-6" />
        <h2 className="text-title text-danger">{ui.title}</h2>
        <p className="text-body text-muted">{ui.message}</p>
        <p className="text-caption text-muted">{ui.recovery}</p>
        <p className="text-caption text-muted" data-testid="error-id">
          error id: {id}
        </p>
        <div className="mt-2 flex gap-2">
          <button type="button" className="text-primary underline" onClick={this.handleReload}>
            reload
          </button>
          <button type="button" className="text-primary underline" onClick={this.handleCopyId}>
            copy error id
          </button>
        </div>
      </section>
    );
  }
}
