// P-211 — the source form: GitHub owner/repo (+ optional ref) or a local path.
//
// VALIDATION BEFORE POST (the phase's step 3): `owner/repo` must match the
// GitHub slug shape, a ref must be non-empty without whitespace. Submit is
// disabled while a request is pending; the pending state shows a spinner
// (aria-busy) rather than a second button state. Errors are NOT swallowed
// here — the thrown API error propagates to the picker's error surface.

import { useState, type FormEvent } from 'react';
import type { JSX } from 'react';
import { addSourcePath, addSourceUrl, type SourceRecord } from '../api/repos.js';
import type { SourceSlot } from '../store/sources.js';

/** GitHub slug: `owner/repo`, each side letters/digits/`.`,`_`,`-`. */
const OWNER_REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const REF_RE = /^\S+$/;

export interface RepoSourceFormProps {
  readonly slot: SourceSlot;
  readonly onSuccess: (record: SourceRecord) => void;
  /** API failures land here (the picker owns the error surface). */
  readonly onError: (message: string) => void;
}

export function RepoSourceForm({ slot, onSuccess, onError }: RepoSourceFormProps): JSX.Element {
  const [mode, setMode] = useState<'github' | 'local'>('github');
  const [ownerRepo, setOwnerRepo] = useState('');
  const [ref, setRef] = useState('');
  const [path, setPath] = useState('');
  const [validation, setValidation] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (pending) return;
    if (mode === 'github') {
      if (!OWNER_REPO_RE.test(ownerRepo)) {
        setValidation('Use the GitHub shape owner/repo (e.g. vercel/ai).');
        return;
      }
      if (ref !== '' && !REF_RE.test(ref)) {
        setValidation('A ref cannot contain whitespace.');
        return;
      }
    } else if (path.trim() === '') {
      setValidation('Enter a local repository path.');
      return;
    }
    setValidation(null);
    setPending(true);
    try {
      const record =
        mode === 'github'
          ? await addSourceUrl({ ownerRepo, ...(ref !== '' ? { ref } : {}) })
          : await addSourcePath({ path: path.trim() });
      onSuccess(record);
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(false);
    }
  }

  const fieldClass = 'border-border bg-surface text-text w-full rounded px-2 py-1 text-sm border';

  return (
    <form
      onSubmit={event => void submit(event)}
      aria-label={`add source ${slot}`}
      className="space-y-2"
    >
      <div role="tablist" className="flex gap-2 text-sm">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'github'}
          onClick={() => setMode('github')}
        >
          From GitHub
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'local'}
          onClick={() => setMode('local')}
        >
          Local path
        </button>
      </div>

      {mode === 'github' ? (
        <>
          <label className="text-muted block text-xs">
            owner/repo
            <input
              className={fieldClass}
              value={ownerRepo}
              onChange={event => setOwnerRepo(event.target.value)}
              placeholder="vercel/ai"
              autoComplete="off"
            />
          </label>
          <label className="text-muted block text-xs">
            ref (branch / tag / sha, optional)
            <input
              className={fieldClass}
              value={ref}
              onChange={event => setRef(event.target.value)}
              placeholder="main"
              autoComplete="off"
            />
          </label>
        </>
      ) : (
        <label className="text-muted block text-xs">
          local path
          <input
            className={fieldClass}
            value={path}
            onChange={event => setPath(event.target.value)}
            placeholder="repos/team-a"
            autoComplete="off"
          />
        </label>
      )}

      {validation !== null && (
        <p role="note" className="text-warning text-xs">
          {validation}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        aria-busy={pending}
        className="bg-primary text-bg rounded px-3 py-1 text-sm font-medium disabled:opacity-50"
      >
        {pending ? (
          <span
            className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent"
            aria-hidden="true"
          />
        ) : (
          'Add source'
        )}
      </button>
    </form>
  );
}
