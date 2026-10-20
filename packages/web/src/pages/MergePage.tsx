// P-216 — the Stitch page: gate the merge on canStartMerge (P-215), POST
// /api/merge, and surface the live AI stream (reasoning/tool/progress) plus
// the final summary or the HIL denial. Summary/denied payloads are the client
// contract from api/merge.ts; the endpoint itself lands with the P-192
// handler-map work.

import { useState, type JSX } from 'react';
import { runMerge, type MergeSummary } from '../api/merge.js';
import { useMergeStream, type Connector, type MergeStream } from '../hooks/useMergeStream.js';
import { ThinkingStream } from '../components/ThinkingStream.js';
import { useRunStore } from '../store/run.js';
import { useSourcesStore, type SourcesState } from '../store/selection.js';
import { canStartMerge } from '../store/selectors.js';
import type { RunState } from '../store/run.js';

export function MergePage(props?: { connect?: Connector }): JSX.Element {
  // connect is never set in production mounts (AppShell renders <MergePage/>);
  // tests inject an event pump through it. Spread-conditional keeps the
  // hook call stable across renders.
  const sources: SourcesState = useSourcesStore();
  const run: RunState = useRunStore();
  const stream: MergeStream = useMergeStream({
    ...(props?.connect !== undefined ? { connect: props.connect } : {}),
    // The socket opens only while a run is live — idle pages hold no connection.
    active: run.status === 'running',
  });
  const [summary, setSummary] = useState<MergeSummary | undefined>(undefined);
  const [denied, setDenied] = useState<string | undefined>(undefined);
  const [failure, setFailure] = useState<string | undefined>(undefined);
  const ready = canStartMerge(sources, run);

  const runNow = (): void => {
    setSummary(undefined);
    setDenied(undefined);
    setFailure(undefined);
    stream.reset();
    run.setRunStatus('running');
    void runMerge({ selectionA: sources.selectionA, selectionB: sources.selectionB })
      .then(result => {
        setSummary(result);
        run.setRunStatus('succeeded');
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        // shortcut: denial is message-sniffed until P-160/P-120 emit a
        // typed denial payload the server can pass through; upgrade then.
        if (/denie[sd]/.test(message.toLowerCase())) setDenied(message);
        else setFailure(message);
        run.setRunStatus('failed');
      });
  };

  return (
    <section>
      <h2 className="text-title font-semibold">Stitch</h2>
      <p className="text-muted">
        Run the merge — the AI stream below shows reasoning and tool calls live.
      </p>
      <button
        type="button"
        data-tour="run-merge"
        data-testid="run-merge"
        onClick={runNow}
        disabled={!ready}
        className="mt-2 rounded bg-primary px-3 py-1.5 text-body font-medium text-white disabled:opacity-50"
      >
        Run Merge
      </button>
      {!ready && run.status !== 'running' && (
        <p className="mt-1 text-caption text-muted">
          Add repo A and B with at least one file selected before starting.
        </p>
      )}
      {denied !== undefined && (
        <p role="alert" className="mt-2 text-body text-danger">
          Merge denied — {denied}
        </p>
      )}
      {failure !== undefined && (
        <p role="alert" className="mt-2 text-body text-danger">
          ✘ {failure}
        </p>
      )}
      <div className="mt-3">
        <ThinkingStream events={stream.events} />
      </div>
      {summary !== undefined && (
        <div
          aria-label="merge summary"
          className="mt-3 rounded border border-border bg-surface p-3"
        >
          <p className="text-body font-medium">Merge complete</p>
          <p className="text-body">
            {summary.files} files · {summary.deps.length} deps · {summary.licenses.length} licenses
          </p>
        </div>
      )}
    </section>
  );
}
