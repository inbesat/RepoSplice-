// P-213 — the slot-agnostic file tree. Loads the flat entry list for a source
// via api/tree.ts, derives the hierarchy here (the flat list stays the single
// source of truth), and renders it through react-arborist's virtualized Tree.
//
// OWNERSHIP: the LIB owns expand/collapse state (its open-slice) and the
// indent; this component owns only the CHECKED file paths. P-214 binds a
// second instance to slot B unchanged. Selection changes are emitted from the
// click handlers (not an effect) so the parent store update can't loop back
// into this component's state.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { HTMLAttributes, JSX, KeyboardEvent, ReactNode } from 'react';
import { Tree } from 'react-arborist';
import type { NodeApi, NodeRendererProps, TreeApi } from 'react-arborist';
import type { SourceRecord } from '../api/repos.js';
import { getTree, getTreePage } from '../api/tree.js';
import type { TreeEntry } from '../api/tree.js';
import { useVirtualTree } from '../hooks/useVirtualTree.js';
import { TreeNode } from './TreeNode.js';
import type { TreeNodeData } from './TreeNode.js';

export interface FileTreeProps {
  readonly source: SourceRecord;
  /** Called with the sorted list of checked FILE paths after every change. */
  readonly onSelectionChange?: (paths: readonly string[]) => void;
  /** Called once per successful load with the flat entry list (P-214 cross-highlight). */
  readonly onLoaded?: (entries: readonly TreeEntry[]) => void;
  /** FILE paths to spotlight (present in both sources — P-214 cross-highlight). */
  readonly highlightPaths?: readonly string[];
  /** Viewport height in px (virtualization) — default 400. */
  readonly height?: number;
  /**
   * P-232: receives the arborist TreeApi instance (programmatic control —
   * filter scroll today, general use later).
   */
  readonly apiRef?: { current: TreeApi<TreeNodeData> | null };
}

/** Derive the hierarchy from the flat list: dirs synthesized from segments,
 * explicit dir entries merged in, dirs before files, alphabetical. */
export function buildTree(entries: readonly TreeEntry[]): TreeNodeData[] {
  const nodes = new Map<string, TreeNodeData>();
  const ensureDir = (path: string): TreeNodeData => {
    let dir = nodes.get(path);
    if (!dir) {
      dir = { id: path, name: lastSegment(path), path, type: 'dir', size: 0, children: [] };
      nodes.set(path, dir);
    }
    return dir;
  };
  for (const entry of entries) {
    const segments = entry.path.split('/');
    segments.forEach((segment, index) => {
      const path = segments.slice(0, index + 1).join('/');
      if (index === segments.length - 1 && entry.type === 'file') {
        nodes.set(path, { id: path, name: segment, path, type: 'file', size: entry.size });
      } else {
        ensureDir(path);
      }
    });
  }
  const childrenOf = (prefix: string): TreeNodeData[] => {
    const own = [...nodes.values()].filter(node => {
      const relative =
        prefix === ''
          ? node.path
          : node.path.startsWith(`${prefix}/`)
            ? node.path.slice(prefix.length + 1)
            : null;
      return relative !== null && !relative.includes('/');
    });
    return own
      .sort(dirsFirst)
      .map(node => (node.type === 'dir' ? { ...node, children: childrenOf(node.path) } : node));
  };
  return childrenOf('');
}

function lastSegment(path: string): string {
  return path.split('/').at(-1) ?? path;
}

function dirsFirst(a: TreeNodeData, b: TreeNodeData): number {
  if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
  return a.name.localeCompare(b.name);
}

export function FileTree({
  source,
  onSelectionChange,
  onLoaded,
  highlightPaths,
  height = 400,
  apiRef,
}: FileTreeProps): JSX.Element {
  const [entries, setEntries] = useState<readonly TreeEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  // P-232: debounced 'find file' filter + the arborist ref for programmatic
  // open/scroll (filter auto-navigation and tests).
  const [rawFilter, setRawFilter] = useState('');
  const [query, setQuery] = useState('');
  const treeRef = useRef<TreeApi<TreeNodeData> | null>(null);

  useEffect(() => {
    let cancelled = false;
    setEntries(null);
    setError(null);
    getTree(source.id, source.ref)
      .then(result => {
        if (cancelled) return;
        setEntries(result);
        onLoaded?.(result);
      })
      .catch(cause => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      cancelled = true;
    };
    // onLoaded is omitted from deps on purpose: the parent's handler is
    // stable and a re-call on its identity change would double-fire the
    // load report.
  }, [source.id, source.ref]);

  // P-232: 200 ms debounce between typing and filtering.
  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(rawFilter.trim().toLowerCase()), 200);
    return () => window.clearTimeout(timer);
  }, [rawFilter]);

  // P-232: lazy dir hydration — the paginated contract fetches one dir and
  // the fetched entries MERGE into the flat list; the hook's handleToggled
  // only fires this when the dir had no recorded children.
  const vtree = useVirtualTree(entries ?? [], {
    onDemand: dir =>
      getTreePage(source.id, dir).then(page => {
        setEntries(prev => {
          const known = new Set((prev ?? []).map(entry => entry.path));
          const fresh = page.entries.filter(entry => !known.has(entry.path));
          return [...(prev ?? []), ...fresh];
        });
        return page.entries;
      }),
  });

  // P-232: when a filter is active, the tree contains only matching files
  // plus their ancestor dirs; ancestors auto-open and the first match is
  // scrolled into the fixed-size window.
  const filteredEntries = useMemo(() => {
    if (query === '') return entries ?? [];
    const list = entries ?? [];
    const matches = list.filter(
      entry => entry.type === 'file' && entry.path.toLowerCase().includes(query)
    );
    const keep = new Set<string>();
    for (const entry of matches) {
      keep.add(entry.path);
      const segments = entry.path.split('/');
      for (let index = 1; index < segments.length; index += 1) {
        keep.add(segments.slice(0, index).join('/'));
      }
    }
    return list.filter(entry => entry.type === 'dir' || keep.has(entry.path));
  }, [entries, query]);

  // Ancestors open + first match scrolls (a moment after the data lands so
  // the fresh rows exist in arborist's index).
  const firstMatch = useMemo(() => {
    if (query === '') return undefined;
    return filteredEntries.find(
      entry => entry.type === 'file' && entry.path.toLowerCase().includes(query)
    );
  }, [filteredEntries, query]);
  useEffect(() => {
    const api = treeRef.current;
    if (api === null || firstMatch === undefined) return;
    const segments = firstMatch.path.split('/');
    for (let index = 1; index < segments.length; index += 1) {
      api.open(segments.slice(0, index).join('/'));
    }
    try {
      void api.scrollTo(firstMatch.path);
    } catch {
      // jsdom has no layout — scroll position is best-effort.
    }
  }, [firstMatch, query]);

  // Publish the api instance for the caller (tests use it to force scrolls).
  useEffect(() => {
    if (apiRef !== undefined) apiRef.current = treeRef.current;
  });

  const treeData = useMemo(() => buildTree(filteredEntries), [filteredEntries]);
  const fileEntries = useMemo(
    () => filteredEntries.filter(entry => entry.type === 'file'),
    [filteredEntries]
  );

  const applyChecked = (next: ReadonlySet<string>): void => {
    setChecked(next);
    onSelectionChange?.([...next].sort());
  };

  const toggleFile = (path: string): void => {
    const next = new Set(checked);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    applyChecked(next);
  };

  const descendantsOf = (dirPath: string): string[] =>
    fileEntries.filter(entry => entry.path.startsWith(`${dirPath}/`)).map(entry => entry.path);

  const toggleDir = (dirPath: string): void => {
    const descendants = descendantsOf(dirPath);
    const allChecked = descendants.every(path => checked.has(path));
    const next = new Set(checked);
    for (const path of descendants) {
      if (allChecked) next.delete(path);
      else next.add(path);
    }
    applyChecked(next);
  };

  const filePaths = fileEntries.map(entry => entry.path);
  const highlightSet = useMemo(() => new Set(highlightPaths ?? []), [highlightPaths]);
  const allSelected = filePaths.length > 0 && filePaths.every(path => checked.has(path));
  const toggleAll = (): void => {
    applyChecked(allSelected ? new Set() : new Set(filePaths));
  };

  if (error !== null) {
    return (
      <div role="alert" className="text-danger">
        ✘ {error}
      </div>
    );
  }
  if (entries === null) {
    return <p className="text-muted">Loading tree…</p>;
  }
  if (entries !== null && entries.length === 0) {
    return <p className="text-muted">No files in this source.</p>;
  }
  if (fileEntries.length === 0 && query !== '') {
    return <p className="text-muted">No files match the filter.</p>;
  }

  const selectedBytes = fileEntries
    .filter(entry => checked.has(entry.path))
    .reduce((sum, entry) => sum + entry.size, 0);
  const header = (
    <div className="mb-2 flex items-center gap-2">
      <input
        type="checkbox"
        aria-label="Select all"
        checked={allSelected}
        onChange={toggleAll}
        className="h-4 w-4 cursor-pointer"
      />
      <span className="text-body text-muted" data-testid="tree-counts">
        {fileEntries.length} files, {checked.size} selected, {formatBytes(selectedBytes)}
      </span>
      <input
        type="search"
        aria-label="find file"
        placeholder="Find a file…"
        value={rawFilter}
        onChange={event => setRawFilter(event.target.value)}
        className="ml-auto min-h-11 rounded border border-border bg-surface px-2 text-body text-text"
      />
    </div>
  );

  const rowRenderer = (rowProps: NodeRendererProps<TreeNodeData>): JSX.Element => {
    const { node } = rowProps;
    if (node.isLeaf) {
      return (
        <TreeNode
          {...rowProps}
          check={{ kind: 'file', checked: checked.has(node.data.path), onToggle: toggleFile }}
          cross={highlightSet.has(node.data.path)}
        />
      );
    }
    const descendants = descendantsOf(node.data.path);
    const state =
      descendants.length > 0 && descendants.every(path => checked.has(path))
        ? 'all'
        : descendants.some(path => checked.has(path))
          ? 'some'
          : 'none';
    return <TreeNode {...rowProps} check={{ kind: 'dir', state, onToggle: toggleDir }} />;
  };

  // P-231: the row wrapper owns the treeitem semantics (arborist's attrs)
  // plus native tree keyboard nav — Up/Down move focus between rows,
  // Right/Left expand/collapse a directory.
  const handleRowKeys = (
    event: KeyboardEvent<HTMLDivElement>,
    node: NodeApi<TreeNodeData>
  ): void => {
    const tree = event.currentTarget.closest<HTMLElement>('[role="tree"]');
    if (tree === null) return;
    const rows = [...tree.querySelectorAll<HTMLElement>('[role="treeitem"]')];
    const index = rows.indexOf(event.currentTarget);
    if (event.key === 'ArrowDown' && index >= 0) {
      event.preventDefault();
      rows[index + 1]?.focus();
    } else if (event.key === 'ArrowUp' && index > 0) {
      event.preventDefault();
      rows[index - 1]?.focus();
    } else if (event.key === 'ArrowRight' && !node.isLeaf && !node.isOpen) {
      event.preventDefault();
      node.toggle();
    } else if (event.key === 'ArrowLeft' && !node.isLeaf && node.isOpen) {
      event.preventDefault();
      node.toggle();
    }
  };

  const rowWrapper = ({
    node,
    attrs,
    innerRef,
    children,
  }: {
    node: NodeApi<TreeNodeData>;
    attrs: HTMLAttributes<HTMLDivElement>;
    innerRef: (n: HTMLDivElement | null) => void;
    children: ReactNode;
  }): JSX.Element => {
    // P-232: aria-posinset/aria-setsize from the hook's sibling map (keeps
    // SR navigation honest under virtualization).
    const info = vtree.siblingInfo(node.id);
    return (
      <div
        {...attrs}
        {...(info !== undefined ? { 'aria-posinset': info.pos, 'aria-setsize': info.size } : {})}
        ref={innerRef}
        onKeyDown={event => handleRowKeys(event, node)}
        onFocus={event => event.stopPropagation()}
        onClick={event => node.handleClick(event)}
      >
        {children}
      </div>
    );
  };

  return (
    <div>
      {header}
      <Tree
        ref={treeRef}
        data={treeData}
        openByDefault={false}
        onToggle={id => {
          if (id !== null) vtree.handleToggled(id);
        }}
        rowHeight={28}
        indent={16}
        height={height}
        width="100%"
        disableDrag
        disableDrop
        disableEdit
        disableMultiSelection
        aria-label="File tree"
        renderRow={rowWrapper}
      >
        {rowRenderer}
      </Tree>
    </div>
  );
}

/** Same formatting as TreeNode's file rows, reused for the header total. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.max(1, Math.round(kb))} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}
