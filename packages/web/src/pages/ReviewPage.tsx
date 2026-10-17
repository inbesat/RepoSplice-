// P-218 — the HIL approve/reject gate around the P-217 diff viewer.
// include[] = sorted dedupe of selectionA U selectionB (ADR-099 faithful
// paths); per-file checkboxes subtract from include. Blocking conditions
// arrive via the injectable `blockers` prop until P-219/220/221 wire the
// deps/license/sandbox panels (ADR-103).

import { useMemo, useState } from 'react';
import type { JSX } from 'react';
import { useNavigate } from 'react-router';

import { approveMerge, rejectMerge } from '../api/merge.js';
import { DiffViewer } from '../components/DiffViewer.js';
import { ApprovalBar } from '../components/ApprovalBar.js';
import { useDepsStore } from '../store/deps.js';
import { useSourcesStore } from '../store/selection.js';
import { useRunStore } from '../store/run.js';

export interface ReviewPageProps {
  /** Gate conditions from P-219/220/221 panels (tests inject for now). */
  readonly blockers?: readonly string[];
}

export function ReviewPage(props: ReviewPageProps = {}): JSX.Element {
  const { sourcesA, sourcesB, selectionA, selectionB } = useSourcesStore();
  const setRunStatus = useRunStore(s => s.setRunStatus);
  const depsBlockers = useDepsStore(s => s.blockers);
  const navigate = useNavigate();

  const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set());
  const [rejected, setRejected] = useState('');
  const [failure, setFailure] = useState('');

  const union = useMemo(
    () => [...new Set([...selectionA, ...selectionB])].sort(),
    [selectionA, selectionB]
  );
  const include = useMemo(() => union.filter(p => !excluded.has(p)), [union, excluded]);
  const blockers = [
    ...(props.blockers ?? []),
    // P-219: an unloaded deps report does not block (server is the final
    // authority at POST /api/merge/approve) — only a loaded report's
    // unresolved error-level conflicts do.
    ...depsBlockers,
  ];
  const blocked = blockers.length > 0;

  if (sourcesA.length === 0 || sourcesB.length === 0) {
    return (
      <section>
        <h2 className="text-title font-semibold">Review</h2>
        <p className="text-muted">Complete the previous steps to review the proposed merge.</p>
      </section>
    );
  }

  const exclude = [...excluded].sort();

  const approve = async (): Promise<void> => {
    setFailure('');
    try {
      await approveMerge({ include, exclude, note: '' });
      setRunStatus('approved');
      navigate('/results');
    } catch (err) {
      setFailure(err instanceof Error ? err.message : String(err));
    }
  };

  const reject = async (reason: string): Promise<void> => {
    setFailure('');
    try {
      await rejectMerge({ reason });
      setRunStatus('rejected');
      setRejected(reason);
    } catch (err) {
      setFailure(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <section>
      <h2 className="text-title font-semibold">Review</h2>
      <p data-testid="review-counts" className="text-body text-muted">
        A: {selectionA.length} · B: {selectionB.length} · {include.length} to merge ·{' '}
        {excluded.size} excluded
      </p>

      {rejected !== '' ? (
        <div>
          <p role="alert" className="text-body text-warning">
            Merge rejected — {rejected}
          </p>
          <button
            type="button"
            className="mt-2 px-3 py-1.5 rounded border text-body"
            onClick={() => navigate('/select')}
          >
            Edit selection
          </button>
        </div>
      ) : (
        <>
          <ul aria-label="merge file list" className="my-2">
            {union.map(path => (
              <li key={path} className="flex items-center gap-2 text-body">
                <input
                  type="checkbox"
                  aria-label={path}
                  checked={!excluded.has(path)}
                  onChange={() => {
                    setExcluded(prev => {
                      const next = new Set(prev);
                      if (next.has(path)) {
                        next.delete(path);
                      } else {
                        next.add(path);
                      }
                      return next;
                    });
                  }}
                />
                <span>{path}</span>
              </li>
            ))}
          </ul>

          <DiffViewer />

          {failure !== '' && (
            <p role="alert" className="text-body text-danger">
              ✘ {failure}
            </p>
          )}

          <ApprovalBar
            canApprove={!blocked}
            {...(blocked
              ? {
                  blockedText: `Blocked: ${blockers.join('; ')} — open the relevant panel to resolve.`,
                }
              : {})}
            onApprove={() => void approve()}
            onReject={reason => void reject(reason)}
          />
        </>
      )}
    </section>
  );
}
