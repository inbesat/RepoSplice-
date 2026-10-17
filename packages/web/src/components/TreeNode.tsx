// P-213 — one virtualized tree row: expand toggle (dirs), tri-state checkbox,
// icon, name, size. The row is rendered by react-arborist (which owns the
// expand state and indent); the CHECK state lives in FileTree and flows down.

import { useEffect, useRef } from 'react';
import type { JSX } from 'react';
import type { NodeRendererProps } from 'react-arborist';
import { ChevronDown, ChevronRight, FileText, Folder } from 'lucide-react';

/** A node in the derived hierarchy FileTree builds from the flat entry list. */
export interface TreeNodeData {
  /** Unique id — the repo-relative path. */
  readonly id: string;
  /** Display name (last segment) — react-arborist's typeahead reads it. */
  readonly name: string;
  /** Repo-relative path (== id). */
  readonly path: string;
  readonly type: 'file' | 'dir';
  /** Files: bytes. Directories: 0. */
  readonly size: number;
  readonly children?: readonly TreeNodeData[];
}

/** `512` → `"512 B"`, `2048` → `"2 KB"`, `1.5e6` → `"1.5 MB"`. */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.max(1, Math.round(kb))} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

interface CheckState {
  kind: 'file';
  checked: boolean;
  onToggle: (path: string) => void;
}
interface CheckDirState {
  kind: 'dir';
  /** all / some / none — rendered as checked / indeterminate / unchecked. */
  state: 'all' | 'some' | 'none';
  onToggle: (path: string) => void;
}

export type TreeNodeProps = NodeRendererProps<TreeNodeData> & {
  check: CheckState | CheckDirState;
};

/** Tri-state native checkbox: `indeterminate` is a DOM property, not an attr. */
function Check({
  state,
  onCheck,
  label,
}: {
  state: 'all' | 'some' | 'none';
  onCheck: () => void;
  label: string;
}) {
  const ref = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = state === 'some';
  }, [state]);
  return (
    <input
      ref={ref}
      type="checkbox"
      aria-label={label}
      checked={state === 'all'}
      onChange={onCheck}
      className="h-4 w-4 shrink-0 cursor-pointer"
    />
  );
}

export function TreeNode({ style, node, check }: TreeNodeProps): JSX.Element {
  const isDir = !node.isLeaf;
  const data = node.data;
  return (
    <div style={style} className="flex h-full items-center gap-1 text-body">
      {isDir ? (
        <>
          <button
            type="button"
            aria-label={`Toggle ${data.name}`}
            onClick={event => {
              event.stopPropagation();
              node.toggle();
            }}
            className="shrink-0 cursor-pointer rounded p-0.5 text-muted hover:text-text"
          >
            {node.isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
          <Check
            state={check.kind === 'dir' ? check.state : 'none'}
            onCheck={() => check.kind === 'dir' && check.onToggle(data.path)}
            label={data.path}
          />
          <Folder size={14} className="shrink-0 text-primary" />
          <span>{data.name}</span>
        </>
      ) : (
        <>
          {/* Spacer keeps file rows aligned with dir rows (no toggle). */}
          <span className="w-5 shrink-0" />
          <Check
            state={check.kind === 'file' && check.checked ? 'all' : 'none'}
            onCheck={() => check.kind === 'file' && check.onToggle(data.path)}
            label={data.path}
          />
          <FileText size={14} className="shrink-0 text-muted" />
          <span>{data.name}</span>
          <span className="ml-auto text-caption text-muted">{formatSize(data.size)}</span>
        </>
      )}
    </div>
  );
}
