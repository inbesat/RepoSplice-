// P-222 — Per-file attribution table.
//
// One table per source-repo group (file path | commit | author) with a
// shared filter input (path OR author substring, case-insensitive) and a
// per-group count. Order mirrors core P-182's repoRank: A, B, then others
// alphabetically, 'unknown' last.

import { useMemo, useState } from 'react';
import type { ProvenanceMap } from '../api/provenance.js';
import { ConfidenceBadge } from './ConfidenceBadge.js';

/** 'A' first, 'B' second, 'unknown' last, everything else alphabetical. */
function repoRank(label: string): number {
  if (label === 'A') return 0;
  if (label === 'B') return 1;
  if (label === 'unknown') return Number.MAX_SAFE_INTEGER;
  return 2;
}

function formatCommit(commit: string): string {
  if (commit === '' || commit === '-') return '—';
  return commit.slice(0, 7);
}

export function ProvenanceTable({ map }: { map: ProvenanceMap }) {
  const [filter, setFilter] = useState('');
  const needle = filter.trim().toLowerCase();

  const groups = useMemo(() => {
    const byRepo = new Map<string, string[]>();
    for (const path of Object.keys(map).sort()) {
      const row = map[path];
      if (row === undefined) continue;
      const author = row.author ?? '';
      if (
        needle !== '' &&
        !path.toLowerCase().includes(needle) &&
        !author.toLowerCase().includes(needle)
      ) {
        continue;
      }
      const list = byRepo.get(row.repo);
      if (list === undefined) byRepo.set(row.repo, [path]);
      else list.push(path);
    }
    return [...byRepo.entries()].sort(
      (a, b) => repoRank(a[0]) - repoRank(b[0]) || a[0].localeCompare(b[0])
    );
  }, [map, needle]);

  return (
    <div>
      <input
        type="search"
        aria-label="filter files"
        placeholder="Filter by path or author…"
        value={filter}
        onChange={e => setFilter(e.target.value)}
        className="mb-3 w-full max-w-sm rounded border border-border bg-surface px-2 py-1 text-body"
      />
      {groups.length === 0 ? (
        <p className="text-body text-muted">No files match this filter.</p>
      ) : (
        groups.map(([repo, paths]) => (
          <section key={repo} aria-label={`group ${repo}`} className="mb-4">
            <h3 className="text-title">
              {repo} <span className="text-caption text-muted">({paths.length})</span>
            </h3>
            <table className="w-full text-body">
              <thead>
                <tr className="text-left text-muted">
                  <th scope="col" className="py-1 pr-3 font-normal">
                    File
                  </th>
                  <th scope="col" className="py-1 pr-3 font-normal">
                    Commit
                  </th>
                  <th scope="col" className="py-1 font-normal">
                    Author
                  </th>
                  <th scope="col" className="py-1 font-normal">
                    Confidence
                  </th>
                </tr>
              </thead>
              <tbody>
                {paths.map(path => {
                  const row = map[path];
                  if (row === undefined) return null;
                  return (
                    <tr key={path} data-testid={`origin-${path}`}>
                      <td className="py-0.5 pr-3 font-mono text-caption">{path}</td>
                      <td className="py-0.5 pr-3 font-mono text-caption">
                        {formatCommit(row.commit)}
                      </td>
                      <td className="py-0.5 text-caption">{row.author ?? '—'}</td>
                      <td className="py-0.5 text-caption">
                        <ConfidenceBadge confidence={row.confidence} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        ))
      )}
    </div>
  );
}
