// P-213 — file selection for the sources step. Slot A's tree mounts when a
// resolved source exists (P-214 adds slot B beside it).

import type { JSX } from 'react';
import { FileTree } from '../components/FileTree.js';
import { useSourcesStore } from '../store/selection.js';

export function SelectPage(): JSX.Element {
  const sourceA = useSourcesStore(state => state.sourcesA[0]);
  const setFiles = useSourcesStore(state => state.setFiles);

  if (sourceA === undefined) {
    return (
      <section>
        <h2 className="text-title font-semibold">Select</h2>
        <p className="text-muted">Pick a source first — the file tree loads here once you do.</p>
      </section>
    );
  }
  return (
    <section aria-label={`Source ${sourceA.repo ?? sourceA.path ?? sourceA.id}`}>
      <h2 className="text-title font-semibold">Select files — repo A</h2>
      <FileTree
        key={sourceA.id}
        source={sourceA}
        onSelectionChange={paths => setFiles('A', paths)}
      />
    </section>
  );
}
