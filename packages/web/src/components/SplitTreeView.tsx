// P-214 — the Select step's side-by-side A/B layout. Two instances of the
// slot-agnostic FileTree, independent scroll, stacked on small widths (the
// P-212 `md:grid-cols-2` pattern). The cross-highlight toggle spotlights
// paths present in BOTH sources (the P-217/P-219 conflict preview's seed).

import { useCallback, useMemo, useState } from 'react';
import type { JSX } from 'react';
import type { SourceRecord } from '../api/repos.js';
import type { TreeEntry } from '../api/tree.js';
import { useViewport } from '../hooks/useViewport.js';
import { FileTree } from './FileTree.js';

export interface SplitTreeViewProps {
  readonly sourceA?: SourceRecord;
  readonly sourceB?: SourceRecord;
  readonly onSelectionA: (paths: readonly string[]) => void;
  readonly onSelectionB: (paths: readonly string[]) => void;
}

export function SplitTreeView({
  sourceA,
  sourceB,
  onSelectionA,
  onSelectionB,
}: SplitTreeViewProps): JSX.Element {
  const [entriesA, setEntriesA] = useState<readonly TreeEntry[]>([]);
  const [entriesB, setEntriesB] = useState<readonly TreeEntry[]>([]);
  const [cross, setCross] = useState(false);
  const viewport = useViewport();

  const handleLoadedA = useCallback((entries: readonly TreeEntry[]) => setEntriesA(entries), []);
  const handleLoadedB = useCallback((entries: readonly TreeEntry[]) => setEntriesB(entries), []);

  const sharedPaths = useMemo(() => {
    const a = new Set(entriesA.filter(entry => entry.type === 'file').map(entry => entry.path));
    return entriesB
      .filter(entry => entry.type === 'file' && a.has(entry.path))
      .map(entry => entry.path);
  }, [entriesA, entriesB]);

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2" data-viewport={viewport}>
      <section aria-label="repo A tree" className="stitch-scroll min-w-0 overflow-y-auto">
        {sourceA === undefined ? (
          <p className="text-muted">Pick a repo A source first.</p>
        ) : (
          <FileTree
            key={sourceA.id}
            source={sourceA}
            onSelectionChange={onSelectionA}
            {...(sharedPaths.length > 0 && cross ? { highlightPaths: sharedPaths } : {})}
            onLoaded={handleLoadedA}
          />
        )}
      </section>
      <section aria-label="repo B tree" className="stitch-scroll min-w-0 overflow-y-auto">
        {sourceB === undefined ? (
          <p className="text-muted">Pick a repo B source first.</p>
        ) : (
          <FileTree
            key={sourceB.id}
            source={sourceB}
            onSelectionChange={onSelectionB}
            {...(sharedPaths.length > 0 && cross ? { highlightPaths: sharedPaths } : {})}
            onLoaded={handleLoadedB}
          />
        )}
      </section>
      {sharedPaths.length > 0 && (
        <div className="md:col-span-2">
          <label className="flex items-center gap-2 text-caption text-muted">
            <input
              type="checkbox"
              checked={cross}
              onChange={event => setCross(event.target.checked)}
              className="h-4 w-4 cursor-pointer"
            />
            {sharedPaths.length} shared path{sharedPaths.length === 1 ? '' : 's'} — highlight
          </label>
        </div>
      )}
    </div>
  );
}
