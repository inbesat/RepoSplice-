// P-210 — the collapsible mini-status: sources + selection counts.
//
// The REAL counts come from P-215's selection store; P-210 hosts the panel —
// a static placeholder (0 · 0) with the collapse affordance, so the later
// phase only swaps the numbers' source.

import { useState } from 'react';
import type { JSX } from 'react';

export function Sidebar(): JSX.Element {
  const [open, setOpen] = useState(true);

  return (
    <aside className="border-border w-56 shrink-0 border-r p-3">
      <button
        type="button"
        className="text-muted w-full text-left text-sm"
        aria-expanded={open}
        onClick={() => setOpen(value => !value)}
      >
        Selection summary {open ? '▾' : '▸'}
      </button>
      {open && (
        <dl className="text-muted mt-2 space-y-1 text-sm" aria-label="sources and selection">
          <div className="flex justify-between">
            <dt>sources</dt>
            <dd data-testid="sources-count">0</dd>
          </div>
          <div className="flex justify-between">
            <dt>files</dt>
            <dd data-testid="files-count">0</dd>
          </div>
        </dl>
      )}
      <p className="text-muted mt-3 text-xs">Counts fill in when selections land (P-215).</p>
    </aside>
  );
}
