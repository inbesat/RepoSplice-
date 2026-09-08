import type { JSX } from 'react';
import { useCallback, useState } from 'react';
import { Tree, type NodeApi, type NodeRendererProps } from 'react-arborist';
import { ChevronDown, ChevronRight } from 'lucide-react';

/**
 * FileNode: the flat-entry hierarchy react-arborist consumes. The default
 * `id`/`children` accessors match these field names, so no accessor props
 * are needed. P-213 derives this shape from the flattened `/tree` API
 * entries (one source of truth: derive hierarchy in the component).
 */
export interface FileNode {
  id: string;
  name: string;
  children?: FileNode[];
}

export interface FileTreeProps {
  /** Forest roots; folders carry `children`, files omit it (leaf). */
  data: FileNode[];
  /** Fires with the full selected id set on every check/uncheck (P-215 binds this to the store). */
  onSelectionChange?: (ids: string[]) => void;
  ariaLabel?: string;
  /** Fixed viewport height in px — required for react-window virtualization (P-232). */
  height?: number;
  /** Fixed row height in px — virtualization needs uniform rows. */
  rowHeight?: number;
  /** Pixels of indent per tree level, applied by the row renderer. */
  indent?: number;
  /** Open every folder on mount (P-213 takes over expansion state later). */
  defaultOpen?: boolean;
}

/**
 * FileTree scaffold (P-058) for the repo A/B pickers (P-213/214). Thin over
 * react-arborist's `Tree`: checkbox multi-selection (additive selectMulti /
 * deselect, mirroring the library's own ctrl-click semantics), expand
 * toggles, a live selection count, and fixed-height virtualized rendering
 * so tens of thousands of nodes stay cheap. Drag, drop, and editing stay
 * disabled until a later phase needs them. Nothing here throws: selection
 * flows through callbacks, never exceptions.
 */
export function FileTree({
  data,
  onSelectionChange,
  ariaLabel = 'File tree',
  height = 400,
  rowHeight = 32,
  indent = 20,
  defaultOpen = true,
}: FileTreeProps): JSX.Element {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const handleSelect = useCallback(
    (nodes: NodeApi<FileNode>[]): void => {
      const ids = nodes.map(node => node.id);
      setSelectedIds(ids);
      onSelectionChange?.(ids);
    },
    [onSelectionChange]
  );

  const renderNode = useCallback(
    ({ node, style }: NodeRendererProps<FileNode>): JSX.Element => {
      const name = node.data.name;
      const checked = node.isSelected;
      const toggleSelection = (): void => {
        // Additive checkbox semantics: checking adds, unchecking removes.
        // node.select() would REPLACE the set — only selectMulti() adds.
        if (checked) node.deselect();
        else node.selectMulti();
      };
      return (
        <div
          style={{ ...style, paddingLeft: (node.level + 1) * indent }}
          role="treeitem"
          aria-selected={checked}
          aria-level={node.level + 1}
          aria-expanded={node.isLeaf ? undefined : node.isOpen}
          data-file-row={node.id}
          className="text-stitch-900 dark:text-stitch-50"
        >
          {node.isLeaf ? (
            <span aria-hidden="true" className="toggle-spacer" />
          ) : (
            <button
              type="button"
              aria-label={node.isOpen ? `Collapse ${name}` : `Expand ${name}`}
              aria-expanded={node.isOpen}
              onClick={() => node.toggle()}
              className="text-stitch-700 dark:text-stitch-200"
            >
              {node.isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
          )}
          {/*
            Stop the click here: the tree wraps every row in its default row,
            whose onClick is node.handleClick (plain click = REPLACE the
            selection). Without this, checking a box would add the id and the
            bubbled click would immediately replace the whole set with it.
          */}
          <input
            type="checkbox"
            aria-label={`Select ${name}`}
            checked={checked}
            onChange={toggleSelection}
            onClick={event => event.stopPropagation()}
          />
          <span>{name}</span>
        </div>
      );
    },
    [indent]
  );

  return (
    <div role="tree" aria-label={ariaLabel}>
      <p aria-live="polite">{`${selectedIds.length} selected`}</p>
      <Tree<FileNode>
        data={data}
        openByDefault={defaultOpen}
        width="100%"
        height={height}
        rowHeight={rowHeight}
        indent={indent}
        disableDrag
        disableDrop
        disableEdit
        onSelect={handleSelect}
        aria-label={ariaLabel}
      >
        {renderNode}
      </Tree>
    </div>
  );
}
