// P-217 — the diff review surface: rail of proposed files grouped by kind +
// the active file's diff pane + unified/split and ignore-whitespace toggles
// + inline errors. Deliberately decoupled from merge mutation — P-218 mounts
// this viewer (locked) for the approve/reject gate.

import { useMemo, useState, type JSX } from 'react';
import { useProposedDiff, type DiffKind, type ProposedDiffFile } from '../hooks/useProposedDiff.js';
import { DiffHunk, countChanges, normalizeText } from './DiffHunk.js';

const GROUPS: ReadonlyArray<{ kind: DiffKind; label: string }> = [
  { kind: 'add', label: 'Added' },
  { kind: 'modify', label: 'Modified' },
  { kind: 'delete', label: 'Deleted' },
];

function groupOf(files: readonly ProposedDiffFile[]): Record<DiffKind, ProposedDiffFile[]> {
  const grouped: Record<DiffKind, ProposedDiffFile[]> = { add: [], modify: [], delete: [] };
  for (const file of files) grouped[file.kind].push(file);
  return grouped;
}

export function DiffViewer(): JSX.Element {
  const { files, loading, error } = useProposedDiff();
  const [activePath, setActivePath] = useState<string | null>(null);
  const [splitView, setSplitView] = useState(false);
  const [ignoreWs, setIgnoreWs] = useState(false);

  const grouped = useMemo(() => groupOf(files), [files]);
  const active: ProposedDiffFile | undefined =
    files.find(file => file.path === activePath) ?? files[0];

  const totals = useMemo(() => {
    let added = 0;
    let deleted = 0;
    for (const file of files) {
      const changes = countChanges(
        normalizeText(file.oldText ?? '', ignoreWs),
        normalizeText(file.newText ?? '', ignoreWs)
      );
      added += changes.added;
      deleted += changes.deleted;
    }
    return { added, deleted };
  }, [files, ignoreWs]);

  if (loading) return <p className="text-muted">Loading proposed diff…</p>;
  if (error !== null)
    return (
      <div role="alert" className="text-body text-danger">
        ✘ {error}
      </div>
    );
  if (files.length === 0) return <p className="text-muted">No proposed changes.</p>;

  return (
    <section aria-label="proposed diff" data-view={splitView ? 'split' : 'unified'}>
      <header className="mb-2 flex items-center gap-3">
        <p className="text-caption text-muted">
          {files.length} files · {grouped.add.length} added · {grouped.modify.length} modified ·{' '}
          {grouped.delete.length} deleted · +{totals.added} -{totals.deleted}
        </p>
        <button
          type="button"
          onClick={() => setSplitView(value => !value)}
          aria-pressed={splitView}
          data-testid="toggle-split"
        >
          Toggle split view
        </button>
        <button
          type="button"
          onClick={() => setIgnoreWs(value => !value)}
          aria-pressed={ignoreWs}
          data-testid="toggle-whitespace"
        >
          Toggle ignore whitespace
        </button>
      </header>
      <div className="md:grid md:grid-cols-[16rem_1fr] md:gap-4">
        <nav aria-label="changed files" className="space-y-2">
          {GROUPS.map(({ kind, label }) => {
            const group = grouped[kind];
            if (group.length === 0) return null;
            return (
              <div key={kind}>
                <p className="text-caption font-semibold text-muted">
                  {label} ({group.length})
                </p>
                {group.map(file => (
                  <button
                    key={file.path}
                    type="button"
                    onClick={() => setActivePath(file.path)}
                    aria-pressed={file.path === (active?.path ?? null)}
                    data-testid={`rail-${file.path}`}
                    className="block w-full truncate text-left text-caption text-muted hover:text-text"
                  >
                    {file.path}
                  </button>
                ))}
              </div>
            );
          })}
        </nav>
        <div>
          {active !== undefined && (
            <DiffHunk file={active} splitView={splitView} ignoreWs={ignoreWs} />
          )}
        </div>
      </div>
    </section>
  );
}
