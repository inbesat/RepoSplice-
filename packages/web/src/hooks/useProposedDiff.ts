// P-217 — client contract for the proposed-diff dry run (`--dry-run`,
// P-192 handler-map). The endpoint does NOT exist yet; same posture as the
// rest of api/: shapes below are what the server must implement, tests mock
// global fetch.

import { describeFailure } from '../api/repos.js';
import { useEffect, useState } from 'react';
import type { ConfidenceView } from '../api/confidence.js';

export type DiffKind = 'add' | 'modify' | 'delete';

/** One proposed file change (flattened; missing text side = empty). */
export interface ProposedDiffFile {
  readonly path: string;
  readonly kind: DiffKind;
  readonly oldText?: string;
  readonly newText?: string;
  /** P-352: this file's composite confidence, when the dry run reports one. */
  readonly confidence?: ConfidenceView;
}

export async function fetchProposedDiff(): Promise<ProposedDiffFile[]> {
  const response = await fetch('/api/merge/proposed-diff');
  if (!response.ok) throw new Error(await describeFailure(response));
  const body: unknown = await response.json();
  if (Array.isArray(body)) return body as ProposedDiffFile[];
  const files = (body as { files?: ProposedDiffFile[] }).files;
  return files ?? [];
}

export interface ProposedDiffState {
  readonly files: readonly ProposedDiffFile[];
  readonly loading: boolean;
  readonly error: string | null;
}

/** P-217 hook: fetch the proposed diff once per mount. */
export function useProposedDiff(): ProposedDiffState {
  const [state, setState] = useState<ProposedDiffState>({
    files: [],
    loading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    setState({ files: [], loading: true, error: null });
    fetchProposedDiff()
      .then(files => {
        if (!cancelled) setState({ files, loading: false, error: null });
      })
      .catch((error: unknown) => {
        if (!cancelled)
          setState({
            files: [],
            loading: false,
            error: error instanceof Error ? error.message : String(error),
          });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
