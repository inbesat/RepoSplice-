// P-220 — one pending unknown license (P-123) with its allow/deny/skip
// decisions. Allow/deny POST via the parent (which persists through
// /api/licenses/decide, P-127) and flip the row into a resolved state.
// Skip is UI-only: core has no 'skip' verdict, so it dismisses the row
// without a POST (deviation on record, ADR-105).

import { useState } from 'react';
import type { JSX } from 'react';

import type { UnknownLicense, UnknownVerdict } from '../api/licenses.js';

export function licenseIdOf(entry: UnknownLicense): string {
  return `${entry.package}@${entry.version}`;
}

interface LicenseUnknownRowProps {
  entry: UnknownLicense;
  /** Verdict POSTed and confirmed by the parent — row is resolved when present. */
  override?: UnknownVerdict;
  onDecide: (licenseId: string, verdict: UnknownVerdict) => void;
}

export function LicenseUnknownRow({
  entry,
  override,
  onDecide,
}: LicenseUnknownRowProps): JSX.Element {
  const [skipped, setSkipped] = useState(false);
  const id = licenseIdOf(entry);
  const resolved = override !== undefined;

  return (
    <li
      className="text-body"
      data-testid={`unknown-${id}`}
      data-decision={override ?? entry.decision}
    >
      <span className="font-medium">{entry.package}</span> {entry.version} —{' '}
      <span className="text-caption text-muted">{entry.rawLicense}</span>
      {entry.path !== undefined ? (
        <span className="text-caption text-muted"> ({entry.path})</span>
      ) : null}
      {resolved ? (
        <span className={override === 'allow' ? 'ml-2 text-success' : 'ml-2 text-danger'}>
          decided: {override}
        </span>
      ) : skipped ? (
        <span className="ml-2 text-caption text-muted">skipped — decision still pending</span>
      ) : (
        <span className="ml-2 inline-flex gap-1">
          <button
            type="button"
            aria-label={`allow ${id}`}
            className="px-2 py-0.5 rounded border text-caption"
            onClick={() => onDecide(id, 'allow')}
          >
            Allow
          </button>
          <button
            type="button"
            aria-label={`deny ${id}`}
            className="px-2 py-0.5 rounded border text-caption"
            onClick={() => onDecide(id, 'deny')}
          >
            Deny
          </button>
          <button
            type="button"
            aria-label={`skip ${id}`}
            className="px-2 py-0.5 rounded border text-caption text-muted"
            onClick={() => setSkipped(true)}
          >
            Skip
          </button>
        </span>
      )}
    </li>
  );
}
