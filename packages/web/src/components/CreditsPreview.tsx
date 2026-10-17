// P-222 — CREDITS preview: attribution transparency before shipping.
//
// Three tabs (CREDITS.md text / per-file attribution / SBOM JSON), a copy
// button, the 'attribution looks correct' confirmation checkbox that feeds
// the P-218 approve gate (via store/provenance), and a counts footer.
// Component is self-fetching (SandboxPanel pattern) and NOT yet mounted —
// no screen owns it until P-192 wires the jobs/run plumbing (ADR-107).

import { useEffect, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import {
  getCredits,
  getProvenanceMap,
  getSbom,
  type CreditsDoc,
  type ProvenanceMap,
} from '../api/provenance.js';
import { useProvenanceStore } from '../store/provenance.js';
import { ProvenanceTable } from './ProvenanceTable.js';

type TabId = 'credits' | 'attribution' | 'sbom';

const TAB_LABELS: ReadonlyArray<{ id: TabId; label: string }> = [
  { id: 'credits', label: 'CREDITS.md' },
  { id: 'attribution', label: 'Per-file attribution' },
  { id: 'sbom', label: 'SBOM' },
];

export function CreditsPreview() {
  const [credits, setCredits] = useState<CreditsDoc | null>(null);
  const [map, setMap] = useState<ProvenanceMap | null>(null);
  const [sbom, setSbom] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>('credits');
  const [copied, setCopied] = useState(false);
  const creditsConfirmed = useProvenanceStore(s => s.creditsConfirmed);
  const setCreditsConfirmed = useProvenanceStore(s => s.setCreditsConfirmed);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getCredits(), getProvenanceMap(), getSbom()])
      .then(([c, m, s]) => {
        if (cancelled) return;
        setCredits(c);
        setMap(m);
        setSbom(s);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error !== null) {
    return (
      <div role="alert" className="text-body text-danger">
        ✘ {error}
      </div>
    );
  }
  if (credits === null || map === null || sbom === null) {
    return <p className="text-body text-muted">Loading provenance…</p>;
  }

  const fileCount = Object.keys(map).length;
  const repoCount = new Set(Object.values(map).map(row => row.repo)).size;

  const copyCredits = () => {
    navigator.clipboard
      ?.writeText(credits.text)
      ?.then(() => setCopied(true))
      ?.catch(() => undefined);
  };

  return (
    <section aria-label="provenance preview">
      <div role="tablist" aria-label="provenance tabs" className="mb-3 flex gap-2">
        {TAB_LABELS.map(({ id, label }) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`rounded border px-3 py-1 text-body ${
              tab === id ? 'border-border bg-surface text-text' : 'border-transparent text-muted'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'credits' && (
        <div aria-label="credits view">
          <button
            type="button"
            onClick={copyCredits}
            aria-label="Copy CREDITS"
            className="mb-2 inline-flex items-center gap-1 text-caption text-primary underline"
          >
            {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
            {copied ? 'Copied' : 'Copy CREDITS'}
          </button>
          <pre
            data-testid="credits-text"
            className="max-h-96 overflow-auto rounded bg-surface p-3 font-mono text-caption whitespace-pre-wrap"
          >
            {credits.text}
          </pre>
        </div>
      )}

      {tab === 'attribution' && (
        <div aria-label="attribution view">
          <ProvenanceTable map={map} />
        </div>
      )}

      {tab === 'sbom' && (
        <pre
          data-testid="sbom-view"
          className="max-h-96 overflow-auto rounded bg-surface p-3 font-mono text-caption"
        >
          {JSON.stringify(sbom, null, 2)}
        </pre>
      )}

      <p data-testid="provenance-counts" className="mt-3 text-caption text-muted">
        {fileCount} files · {repoCount} repos
      </p>

      <label className="mt-2 flex items-center gap-2 text-body">
        <input
          type="checkbox"
          aria-label="attribution looks correct"
          checked={creditsConfirmed}
          onChange={e => setCreditsConfirmed(e.target.checked)}
        />
        attribution looks correct
      </label>
    </section>
  );
}
