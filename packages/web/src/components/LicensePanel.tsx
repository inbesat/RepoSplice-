// P-220 — the license compliance panel (web face of `stitch license`).
// Loads the P-128 report, renders the verdict banner + package table +
// GPL/dual/unknown sections, and POSTs unknown-license decisions
// (POST /api/licenses/decide, P-127). Emits the license outcome to
// useLicensesStore so ReviewPage's approve gate reflects it: approve
// requires no hard matrix denies outstanding and no pending unknowns
// (spec step 5). Unloaded reports do NOT block (ADR-104 rule).

import { useEffect, useState } from 'react';
import type { JSX } from 'react';

import {
  fetchLicenseReport,
  decideUnknown,
  type LicenseReportData,
  type LicenseVerdict,
  type UnknownVerdict,
} from '../api/licenses.js';
import { useLicensesStore } from '../store/licenses.js';
import { LicenseUnknownRow, licenseIdOf } from './LicenseUnknownRow.js';

const VERDICT_CLASS: Record<LicenseVerdict, string> = {
  allow: 'text-success',
  review: 'text-warning',
  deny: 'text-danger',
};

export function LicensePanel(): JSX.Element {
  const setLicensesOutcome = useLicensesStore(s => s.setLicensesOutcome);
  const [report, setReport] = useState<LicenseReportData | null>(null);
  const [error, setError] = useState('');
  const [decided, setDecided] = useState<ReadonlyMap<string, UnknownVerdict>>(new Map());
  const [rowError, setRowError] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetchLicenseReport()
      .then(r => {
        if (cancelled) return;
        setReport(r);
        emit(r, new Map());
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const emit = (r: LicenseReportData, done: ReadonlyMap<string, UnknownVerdict>): void => {
    const denies = r.rows.filter(row => row.decision === 'deny');
    const pending = r.unknown.filter(u => u.decision === 'pending' && !done.has(licenseIdOf(u)));
    const blockers = [
      ...denies.map(d => `hard matrix deny: ${d.package} — ${d.normalized} cannot be allowed`),
      ...pending.map(u => `unknown license ${licenseIdOf(u)} (${u.rawLicense}) needs a decision`),
    ];
    setLicensesOutcome({ clear: blockers.length === 0, blockers });
  };

  const decide = (licenseId: string, verdict: UnknownVerdict): void => {
    setRowError('');
    void decideUnknown(licenseId, verdict)
      .then(() => {
        const next = new Map(decided);
        next.set(licenseId, verdict);
        setDecided(next);
        if (report !== null) emit(report, next);
      })
      .catch((err: unknown) => {
        setRowError(err instanceof Error ? err.message : String(err));
      });
  };

  if (error !== '') {
    return (
      <section aria-label="license compliance">
        <h2 className="text-title font-semibold">Licenses</h2>
        <p role="alert" className="text-body text-danger">
          ✘ {error}
        </p>
      </section>
    );
  }
  if (report === null) {
    return (
      <section aria-label="license compliance">
        <h2 className="text-title font-semibold">Licenses</h2>
        <p className="text-muted">Loading license report…</p>
      </section>
    );
  }

  const denyRows = report.rows.filter(row => row.decision === 'deny');
  const pendingUnknowns = report.unknown.filter(
    u => u.decision === 'pending' && !decided.has(licenseIdOf(u))
  );

  return (
    <section aria-label="license compliance">
      <h2 className="text-title font-semibold">Licenses</h2>
      <p
        data-testid="license-verdict"
        className={`text-body font-semibold ${VERDICT_CLASS[report.verdict]}`}
      >
        Verdict: {report.verdict}
        {report.blocking ? ' (blocking)' : ''}
      </p>
      <p data-testid="license-counts" className="text-body text-muted">
        {report.summary.total} packages · {report.summary.allow} allow · {report.summary.review}{' '}
        review · {report.summary.deny} deny · {report.summary.unknown} unknown ·{' '}
        {report.summary.gplWarnings} GPL warnings
      </p>

      {denyRows.length > 0 ? (
        <p role="alert" className="text-body text-warning">
          Blocked: {denyRows.length} hard deny row(s) cannot be allowed — approve stays gated.
        </p>
      ) : null}
      {pendingUnknowns.length > 0 ? (
        <p role="alert" className="text-body text-warning">
          Blocked: {pendingUnknowns.length} unknown license(s) need an allow/deny decision.
        </p>
      ) : null}
      {rowError !== '' ? (
        <p role="alert" className="text-body text-danger">
          ✘ {rowError}
        </p>
      ) : null}

      <table className="mt-2 w-full">
        <thead>
          <tr className="text-caption text-muted">
            <th className="text-left">Package</th>
            <th className="text-left">Declared</th>
            <th className="text-left">Normalized</th>
            <th className="text-left">Category</th>
            <th className="text-left">Decision</th>
          </tr>
        </thead>
        <tbody>
          {report.rows.map(row => (
            <tr
              key={`${row.package}-${row.version}`}
              data-testid={`license-${row.package}`}
              data-decision={row.decision}
            >
              <td className="text-body">
                {row.package} {row.version}
              </td>
              <td className="text-caption">{row.declared}</td>
              <td className="text-caption">{row.normalized}</td>
              <td className="text-caption">{row.category}</td>
              <td className={`text-caption ${row.decision === 'deny' ? 'text-danger' : ''}`}>
                {row.decision}
                {row.decision === 'deny' ? ' — locked: hard matrix deny cannot be allowed' : ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {report.gplWarnings.length > 0 ? (
        <section aria-label="gpl warnings">
          <h3 className="text-body font-semibold">GPL warnings</h3>
          <ul>
            {report.gplWarnings.map(w => (
              <li
                key={`${w.package}-${w.license}`}
                className="text-body"
                data-testid={`gpl-${w.package}`}
              >
                {w.package} {w.version} — {w.license} ({w.severity}): {w.suggestion}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {report.dualLicenses.length > 0 ? (
        <section aria-label="dual licenses">
          <h3 className="text-body font-semibold">Dual-license options</h3>
          <ul>
            {report.dualLicenses.map(d => (
              <li key={d.expression} className="text-body">
                {d.expression} → use {d.recommended}
                {d.alternatives.length > 0 ? ` (alternatives: ${d.alternatives.join(', ')})` : ''}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {report.unknown.length > 0 ? (
        <section aria-label="pending unknowns">
          <h3 className="text-body font-semibold">Unknown licenses</h3>
          <ul>
            {report.unknown.map(u => (
              <LicenseUnknownRow
                key={licenseIdOf(u)}
                entry={u}
                {...(decided.get(licenseIdOf(u)) !== undefined
                  ? { override: decided.get(licenseIdOf(u)) as UnknownVerdict }
                  : {})}
                onDecide={decide}
              />
            ))}
          </ul>
        </section>
      ) : null}
    </section>
  );
}
