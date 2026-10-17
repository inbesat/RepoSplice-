// P-219 — the dependency conflict review panel (web face of `stitch deps`).
// Loads the P-116 report, renders summary + conflict table, and persists
// per-row or resolve-all decisions (POST /api/deps/resolve). Emits the
// deps outcome to useDepsStore so ReviewPage's approve gate reflects it:
// review-level (warning) conflicts resolve via the suggested P-109 range;
// error-level conflicts without a suggestion block approve (ADR-104).

import { useEffect, useState } from 'react';
import type { JSX } from 'react';

import { getDepsReport, resolveDep, type DependencyReport } from '../api/deps.js';
import { useDepsStore } from '../store/deps.js';
import { ConflictRow, type DepsConflict } from './ConflictRow.js';

function blockerFor(conflict: DepsConflict, resolved: ReadonlySet<string>): string | null {
  if (conflict.severity !== 'error') {
    return null;
  }
  if (conflict.status === 'auto-resolved' || conflict.resolution !== undefined) {
    return null;
  }
  if (resolved.has(conflict.package)) {
    return null;
  }
  return `error-level conflict on ${conflict.package} needs a manual resolution`;
}

export function DepsPanel(): JSX.Element {
  const setDepsOutcome = useDepsStore(s => s.setDepsOutcome);
  const [report, setReport] = useState<DependencyReport | null>(null);
  const [error, setError] = useState('');
  const [resolved, setResolved] = useState<ReadonlySet<string>>(new Set());
  const [resolveError, setResolveError] = useState('');

  useEffect(() => {
    let cancelled = false;
    getDepsReport()
      .then(r => {
        if (cancelled) return;
        setReport(r);
        emit(r, new Set());
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const apply = (pkg: string, resolution: string): void => {
    setResolveError('');
    void resolveDep(pkg, resolution)
      .then(() => {
        const next = new Set(resolved);
        next.add(pkg);
        setResolved(next);
        if (report !== null) emit(report, next);
      })
      .catch((err: unknown) => {
        setResolveError(err instanceof Error ? err.message : String(err));
      });
  };

  const emit = (r: DependencyReport, done: ReadonlySet<string>): void => {
    const blockers = r.conflicts
      .map(c => blockerFor(c, done))
      .filter((b): b is string => b !== null);
    setDepsOutcome({ resolved: blockers.length === 0, blockers });
  };

  const resolveAll = (): void => {
    if (report === null) return;
    setResolveError('');
    const pending = report.conflicts.filter(
      c =>
        c.severity !== 'error' &&
        c.status !== 'auto-resolved' &&
        c.resolution === undefined &&
        !resolved.has(c.package) &&
        c.suggestedResolution !== undefined
    );
    void Promise.all(pending.map(c => resolveDep(c.package, c.suggestedResolution as string)))
      .then(() => {
        const next = new Set(resolved);
        for (const c of pending) next.add(c.package);
        setResolved(next);
        emit(report, next);
      })
      .catch((err: unknown) => {
        setResolveError(err instanceof Error ? err.message : String(err));
      });
  };

  if (error !== '') {
    return (
      <section aria-label="deps conflicts">
        <h2 className="text-title font-semibold">Dependencies</h2>
        <p role="alert" className="text-body text-danger">
          ✘ {error}
        </p>
      </section>
    );
  }
  if (report === null) {
    return (
      <section aria-label="deps conflicts">
        <h2 className="text-title font-semibold">Dependencies</h2>
        <p className="text-muted">Loading dependency report…</p>
      </section>
    );
  }

  const unresolvedErrors = report.conflicts.filter(c => blockerFor(c, resolved) !== null);

  return (
    <section aria-label="deps conflicts">
      <h2 className="text-title font-semibold">Dependencies</h2>
      <p data-testid="deps-counts" className="text-body text-muted">
        {report.dependencyCount.total} deps ({report.dependencyCount.direct} direct ·{' '}
        {report.dependencyCount.dev} dev · {report.dependencyCount.peer} peer) ·{' '}
        {report.summary.needsHuman ? 'needs human review' : 'mergeable'} · {report.dedupe.length}{' '}
        dedupe notes · {report.scripts.collisions.length} script collisions · lockfile{' '}
        {report.lockfile === null ? 'skipped' : report.lockfile.status}
      </p>

      {unresolvedErrors.length > 0 ? (
        <p role="alert" className="text-body text-danger">
          {' '}
          Blocking: {unresolvedErrors.length} error-level conflict(s) need manual resolution before
          approve.
        </p>
      ) : null}

      <button type="button" className="px-3 py-1 rounded border text-body" onClick={resolveAll}>
        Resolve all
      </button>

      {resolveError !== '' ? (
        <p role="alert" className="text-body text-danger">
          ✘ {resolveError}
        </p>
      ) : null}

      <table className="mt-2 w-full">
        <thead>
          <tr className="text-caption text-muted">
            <th className="text-left">Package</th>
            <th className="text-left">Severity</th>
            <th className="text-left">Upstream versions</th>
            <th className="text-left">Resolution</th>
          </tr>
        </thead>
        <tbody>
          {report.conflicts
            .filter(c => c.type !== 'script')
            .map(c => (
              <ConflictRow
                key={`${c.package}-${c.type}`}
                conflict={c}
                resolvedOverride={resolved.has(c.package)}
                onResolve={apply}
              />
            ))}
        </tbody>
      </table>
    </section>
  );
}
