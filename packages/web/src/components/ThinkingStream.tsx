// P-216 — the transparency panel: live reasoning tokens, tool-call rows, and
// pipeline progress for the current merge run. The stream log grows for the
// length of one run; the RENDER is capped (spec: last ~2000 tokens) so a long
// run can't stall the page. Dark mode needs nothing special — colors come from
// the P-209 semantic tokens; reduced motion is handled per animated element.
//
// P-237 — the rows are memoized so a burst of streamed events re-renders only
// the row that changed instead of the whole list. The event TIMING is
// unchanged (the hook applies every event synchronously, which the P-216 pins
// assert), so the DOM and the semantics stay exactly as before.

import { Sparkles } from 'lucide-react';
import { memo, type JSX } from 'react';
import { ToolCallRow } from './ToolCallRow.js';
import { MAX_STREAM_EVENTS } from '../hooks/useMergeStream.js';
import type { StreamEvent } from '../hooks/useMergeStream.js';

/** Cap on rendered stream entries (the full log stays in the hook). */
export { MAX_STREAM_EVENTS };

/** One reasoning token — memoized so a burst only re-renders the new row. */
const ReasoningRow = memo(function ReasoningRow({ text }: { readonly text: string }): JSX.Element {
  return (
    <p className="text-body" data-testid="reasoning-line">
      {text}
    </p>
  );
});

/** One pipeline progress line — memoized like the reasoning row. */
const ProgressRow = memo(function ProgressRow({
  step,
  status,
}: {
  readonly step: string;
  readonly status: string;
}): JSX.Element {
  return (
    <p className="text-caption text-muted" data-testid={`progress-${step}`}>
      {step}: {status}
    </p>
  );
});

export function ThinkingStream({ events }: { events: readonly StreamEvent[] }): JSX.Element {
  const visible = events.slice(-MAX_STREAM_EVENTS);
  // A tool emits running → done/failed: coalesce by toolName so the row
  // updates in place instead of stacking duplicate entries.
  const items: Array<{ seq: number; event: StreamEvent }> = [];
  visible.forEach((event, seq) => {
    if (event.type === 'tool') {
      const prev = items.findIndex(
        it => it.event.type === 'tool' && it.event.toolName === event.toolName
      );
      if (prev >= 0) {
        items[prev] = { seq, event };
        return;
      }
    }
    items.push({ seq, event });
  });
  if (visible.length === 0) return <p className="text-muted">No merge activity yet.</p>;
  const thinking = visible.at(-1)?.type === 'reasoning';
  return (
    <div aria-label="merge activity stream">
      {thinking && (
        <p className="flex items-center gap-1 text-body" data-testid="thinking-indicator">
          <Sparkles
            aria-hidden
            className="size-4 animate-pulse text-primary motion-reduce:animate-none"
          />
          <span className="text-muted">thinking…</span>
        </p>
      )}
      {items.map(({ seq, event }) => {
        if (event.type === 'reasoning') return <ReasoningRow text={event.text} key={event.id} />;
        if (event.type === 'tool') return <ToolCallRow key={seq} call={event} />;
        return <ProgressRow step={event.step} status={event.status} key={seq} />;
      })}
    </div>
  );
}
