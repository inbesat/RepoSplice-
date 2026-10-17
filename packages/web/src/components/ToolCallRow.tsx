// P-216 — one tool call row: chip with name + status + collapsed JSON args.
// Spec note: keep this reusable — the review screen (P-218) renders the same
// rows, so it stays event-agnostic apart from the ToolCall payload.

import { ChevronDown, ChevronRight, Check, Loader2, X } from 'lucide-react';
import { useState, type JSX } from 'react';

export interface ToolCall {
  readonly toolName: string;
  readonly args: Record<string, unknown>;
  readonly status: 'running' | 'done' | 'failed';
}

const STATUS_LABEL: Record<ToolCall['status'], string> = {
  running: 'running',
  done: 'done',
  failed: 'failed — check the merge log and retry',
};

/** Status icon; the running spinner respects reduced motion via motion-reduce. */
function StatusIcon({ status }: { status: ToolCall['status'] }): JSX.Element {
  if (status === 'running')
    return <Loader2 aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />;
  if (status === 'done') return <Check aria-hidden className="size-4 text-success" />;
  return <X aria-hidden className="size-4 text-danger" />;
}

export function ToolCallRow({ call }: { call: ToolCall }): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="text-body" data-testid={`tool-${call.toolName}`} data-status={call.status}>
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded(value => !value)}
        className="flex w-full items-center gap-2 rounded px-2 py-1 text-left hover:bg-surface"
      >
        {expanded ? (
          <ChevronDown aria-hidden className="size-4 shrink-0" />
        ) : (
          <ChevronRight aria-hidden className="size-4 shrink-0" />
        )}
        <StatusIcon status={call.status} />
        <span className="font-medium">{call.toolName}</span>
        <span className="text-muted">{STATUS_LABEL[call.status]}</span>
      </button>
      {expanded && (
        <pre className="mx-2 mt-1 overflow-auto rounded bg-surface p-2 text-caption text-muted">
          {JSON.stringify(call.args, null, 2)}
        </pre>
      )}
    </div>
  );
}
