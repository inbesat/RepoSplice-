// P-230 — export/import buttons for the session bundle.
//
// Export downloads the server bundle as stitch-session.json (Blob + programmatic
// anchor). Import reads a .json file, coerces + POSTs it, restores the client
// stores, then routes to Select (the stepper unlocks on landing, P-210). Warnings
// from the server (refs that no longer resolve) render as P-228 warning Alerts —
// a mismatch never fails the import.

import { useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import type { JSX } from 'react';
import { useNavigate } from 'react-router';
import { Alert } from './Alert.js';
import { applyBundle, coerceBundle, exportSession, importSession } from '../api/session.js';

export function SessionBar(): JSX.Element {
  const navigate = useNavigate();
  const fileInput = useRef<HTMLInputElement>(null);
  const [warnings, setWarnings] = useState<readonly string[]>([]);
  const [failure, setFailure] = useState('');
  const [busy, setBusy] = useState(false);

  const handleExport = (): void => {
    setFailure('');
    void exportSession()
      .then(bundle => {
        // jsdom lacks URL.createObjectURL; exported bundles are still fetchable
        // from the panel — the guard keeps the page alive in test/SSR-like hosts.
        if (typeof URL.createObjectURL !== 'function')
          throw new Error('downloads unavailable in this host');
        const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = 'stitch-session.json';
        anchor.click();
        URL.revokeObjectURL(url);
      })
      .catch((error: unknown) =>
        setFailure(error instanceof Error ? error.message : String(error))
      );
  };

  const handleImport = async (file: File): Promise<void> => {
    setWarnings([]);
    setFailure('');
    setBusy(true);
    try {
      const bundle = coerceBundle(JSON.parse(await file.text()));
      const { warnings: serverWarnings } = await importSession(bundle);
      applyBundle(bundle);
      setWarnings(serverWarnings);
      navigate('/select');
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const onFilePicked = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file !== undefined) void handleImport(file);
  };

  return (
    <div
      aria-label="session export import"
      className="border-border flex flex-wrap items-center gap-2 rounded border p-2"
    >
      <button
        type="button"
        className="text-primary flex min-h-11 items-center px-2 text-sm underline"
        onClick={handleExport}
      >
        Export
      </button>
      <button
        type="button"
        className="text-primary flex min-h-11 items-center px-2 text-sm underline"
        disabled={busy}
        aria-busy={busy}
        onClick={() => fileInput.current?.click()}
      >
        Import
      </button>
      <input
        ref={fileInput}
        type="file"
        accept=".json,application/json"
        className="hidden"
        aria-label="import session"
        onChange={onFilePicked}
      />
      {warnings.map(warning => (
        <Alert key={warning} severity="warning">
          {warning}
        </Alert>
      ))}
      {failure !== '' && <Alert severity="error">✘ {failure}</Alert>}
    </div>
  );
}
