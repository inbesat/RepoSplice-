// P-230 — session export/import.
//
// SessionBundle is the wire type shared by exportSession/importSession/coerceBundle —
// ONE shape so export and import cannot drift (the P-230 handoff rule). The server
// endpoints (/api/session/export, /api/session/import) do not exist yet (P-192
// deferred): both are client contracts in the established repos.ts pattern — plain
// async, throw new Error(await describeFailure(response)) on !ok.
//
// resolutions / licenseDecisions are wire-level records the SERVER applies at restore
// time (P-200/P-215): the client holds no granular store for them (deps store is a
// boolean; license panel decisions are local state), so applyBundle restores only
// sources + selections — the parts the client owns.

import { describeFailure } from './repos.js';
import type { SourceRecord } from './repos.js';
import { useSourcesStore } from '../store/selection.js';

export interface SessionBundle {
  version: 1;
  exportedAt: string;
  sources: { A: SourceRecord[]; B: SourceRecord[] };
  selection: { A: string[]; B: string[] };
  resolutions: Record<string, string>;
  licenseDecisions: Record<string, 'allow' | 'deny'>;
}

/** Older bundles import with defaults (P-200 coercion rule). */
export function coerceBundle(raw: unknown): SessionBundle {
  const source = (raw ?? {}) as Record<string, unknown>;
  const version = typeof source['version'] === 'number' ? source['version'] : 1;
  if (version !== 1) throw new Error(`unsupported session bundle version: ${String(version)}`);
  const sources = (source['sources'] ?? {}) as Record<string, unknown>;
  const selection = (source['selection'] ?? {}) as Record<string, unknown>;
  const asRecords = (value: unknown): SourceRecord[] =>
    Array.isArray(value) ? (value as SourceRecord[]) : [];
  const asPaths = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((p): p is string => typeof p === 'string') : [];
  const asRecord = (value: unknown): Record<string, string> =>
    value !== null && typeof value === 'object' ? (value as Record<string, string>) : {};
  const licences = asRecord(source['licenseDecisions']);
  return {
    version: 1,
    exportedAt:
      typeof source['exportedAt'] === 'string' ? source['exportedAt'] : new Date().toISOString(),
    sources: { A: asRecords(sources['A']), B: asRecords(sources['B']) },
    selection: { A: asPaths(selection['A']), B: asPaths(selection['B']) },
    resolutions: asRecord(source['resolutions']),
    licenseDecisions: licences as Record<string, 'allow' | 'deny'>,
  };
}

/** Restore the client-owned slices into the stores (id-dedupe is addSource's). */
export function applyBundle(bundle: SessionBundle): void {
  const store = useSourcesStore.getState();
  for (const record of bundle.sources.A) store.addSource('A', record);
  for (const record of bundle.sources.B) store.addSource('B', record);
  if (bundle.selection.A.length > 0) store.setSelection('A', bundle.selection.A);
  if (bundle.selection.B.length > 0) store.setSelection('B', bundle.selection.B);
}

export async function exportSession(): Promise<SessionBundle> {
  const response = await fetch('/api/session/export');
  if (!response.ok) throw new Error(await describeFailure(response));
  return coerceBundle(await response.json());
}

/** Returns the server's restoration warnings (e.g. refs that no longer resolve). */
export async function importSession(bundle: SessionBundle): Promise<{ warnings: string[] }> {
  const response = await fetch('/api/session/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(bundle),
  });
  if (!response.ok) throw new Error(await describeFailure(response));
  const body = (await response.json()) as { warnings?: unknown };
  return {
    warnings: Array.isArray(body.warnings)
      ? body.warnings.filter((w): w is string => typeof w === 'string')
      : [],
  };
}
