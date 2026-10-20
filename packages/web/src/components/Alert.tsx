// P-228 — the standard error surface. One component for every inline
// error/warning/success announcement, colored by severity from P-209 tokens.
//
// shortcut: panels still render inline role=alert blocks; sweep them to
// <Alert> next time each is touched — one-line swaps (ADR-113 records the
// deferral).

import type { JSX, ReactNode } from 'react';

export type AlertSeverity = 'error' | 'warning' | 'success';

const SEVERITY: Readonly<Record<AlertSeverity, string>> = {
  error: 'text-danger',
  warning: 'text-warning',
  success: 'text-success',
};

export function Alert({
  severity,
  children,
}: {
  readonly severity: AlertSeverity;
  readonly children: ReactNode;
}): JSX.Element {
  return (
    <div role="alert" className={`text-body ${SEVERITY[severity]}`}>
      {children}
    </div>
  );
}
