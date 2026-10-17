// P-219 — one conflict row: package, severity, upstream versions, and a
// resolution picker. Suggestions come from P-109's semver resolver via
// conflict.suggestedResolution; each upstream source value is also an
// allowed choice. Apply POSTs {package, resolution}.

import { useState } from 'react';
import type { JSX } from 'react';

import type { DependencyReport } from '../api/deps.js';

export type DepsConflict = DependencyReport['conflicts'][number];

export interface ConflictRowProps {
  readonly conflict: DepsConflict;
  /** True when resolve-all (or a prior POST) covered this package. */
  readonly resolvedOverride?: boolean;
  readonly onResolve: (pkg: string, resolution: string) => void;
}

export function ConflictRow(props: ConflictRowProps): JSX.Element {
  const { conflict, onResolve, resolvedOverride } = props;
  const resolved =
    conflict.status === 'auto-resolved' ||
    conflict.resolution !== undefined ||
    resolvedOverride === true;
  const suggested = conflict.suggestedResolution ?? undefined;
  const upstreams = Object.entries(conflict.values);
  const [picked, setPicked] = useState('');
  const [applied, setApplied] = useState<string | null>(null);
  const [failed, setFailed] = useState('');
  const isResolved = resolved || applied !== null;

  const apply = (): void => {
    if (picked === '') {
      return;
    }
    setFailed('');
    try {
      onResolve(conflict.package, picked);
      setApplied(picked);
    } catch (err) {
      setFailed(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <tr data-testid={`conflict-${conflict.package}`}>
      <td className="text-body">
        {conflict.package}
        {conflict.type !== 'version' ? (
          <span className="text-caption text-muted"> ({conflict.type})</span>
        ) : null}
      </td>
      <td>
        <span
          className={`text-caption ${conflict.severity === 'error' ? 'text-danger' : 'text-warning'}`}
        >
          {conflict.severity}
        </span>
      </td>
      <td className="text-caption text-muted">
        {upstreams.map(([label, spec]) => (
          <span key={label} className="mr-2">
            {label}: {spec}
          </span>
        ))}
      </td>
      <td>
        {isResolved ? (
          <span className="text-body text-success">resolved ✓</span>
        ) : (
          <span className="flex items-center gap-2">
            <select
              aria-label={`resolution-${conflict.package}`}
              className="rounded border px-1 py-0.5 text-caption"
              value={picked}
              onChange={e => setPicked(e.target.value)}
            >
              <option value="">Pick a resolution…</option>
              {suggested !== undefined ? (
                <option value={suggested}>Use suggested: {suggested}</option>
              ) : null}
              {upstreams.map(([label, spec]) => (
                <option key={label} value={spec}>
                  {label}: {spec}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="px-2 py-0.5 rounded border text-caption disabled:opacity-50"
              onClick={apply}
              disabled={picked === ''}
            >
              Apply
            </button>
            {failed !== '' ? (
              <span role="alert" className="text-caption text-danger">
                ✘ {failed}
              </span>
            ) : null}
          </span>
        )}
        {applied !== null && !resolved ? (
          <span className="text-caption text-muted"> ({applied})</span>
        ) : null}
      </td>
    </tr>
  );
}
