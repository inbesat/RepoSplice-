// P-211 — the repo picker: known sources (store + API list), the add form,
// and the error surface (P-228's pattern — a role="alert" that states the
// server's message instead of crashing).
//
// SLOT-AGNOSTIC BY CONTRACT (the handoff note): `slot: 'A' | 'B'` picks the
// store list and the form's aria-label; P-212 mounts the same component with
// `slot="B"`.

import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import { listSources, type SourceRecord } from '../api/repos.js';
import { useSourcesStore, type SourceSlot } from '../store/sources.js';
import { RepoSourceForm } from './RepoSourceForm.js';

export interface RepoPickerProps {
  readonly slot: SourceSlot;
  /** The picker calls back with every resolved source (page owns navigation). */
  readonly onResolved?: (record: SourceRecord) => void;
}

export function RepoPicker({ slot, onResolved }: RepoPickerProps): JSX.Element {
  const records = useSourcesStore(state => (slot === 'A' ? state.sourcesA : state.sourcesB));
  const addSource = useSourcesStore(state => state.addSource);
  const [error, setError] = useState<string | null>(null);
  const [known, setKnown] = useState<readonly SourceRecord[]>([]);

  // The CLI's own known sources, best-effort: a failure here is a note, not a
  // crash (the form's own errors are the loud path).
  useEffect(() => {
    let cancelled = false;
    listSources()
      .then(sources => {
        if (!cancelled) setKnown(sources);
      })
      .catch(() => {
        if (!cancelled) setKnown([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // A source counts when the store has it or the API listed it.
  const seen = new Set(records.map(record => record.id));
  const merged = [...records, ...known.filter(record => !seen.has(record.id))];

  function resolve(record: SourceRecord): void {
    addSource(slot, record);
    setError(null);
    onResolved?.(record);
  }

  async function wrappedOnSuccess(record: SourceRecord): Promise<void> {
    try {
      resolve(record);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  return (
    <section aria-label={`repo ${slot} picker`}>
      <h2 className="text-title font-semibold">Repo {slot}</h2>
      <p className="text-muted text-sm">Sources feeding the {slot} side of the stitch.</p>

      {merged.length === 0 ? (
        <p className="text-muted py-2 text-sm">No sources yet — add one below.</p>
      ) : (
        <ul className="py-2 text-sm" aria-label={`known sources ${slot}`}>
          {merged.map(record => (
            <li key={record.id} className="flex items-center gap-2 py-0.5">
              <span className="font-mono">
                {record.repo ?? record.path ?? record.id}
                {record.ref !== undefined ? `@${record.ref}` : ''}
              </span>
              <span className="text-muted text-xs">{record.kind}</span>
              <span className="text-success text-xs">{record.status}</span>
            </li>
          ))}
        </ul>
      )}

      {error !== null && (
        <div role="alert" className="text-danger py-1 text-sm">
          {error}
        </div>
      )}

      <RepoSourceForm
        slot={slot}
        onSuccess={record => void wrappedOnSuccess(record)}
        onError={message => setError(message)}
      />
    </section>
  );
}
