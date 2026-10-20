// P-232 — the virtual-tree data layer. The flat `/api/repos/:id/tree` list
// (P-213) becomes a flat node map with parent links; expanding a directory
// whose children were never shipped fires the paginated `getTreePage`
// contract on demand (and a dir that hydrates empty is remembered so the
// client never loops). react-arborist stays the RENDERER (P-213 choice);
// this hook owns the data model so P-217+ consumers and provedance tables
// can reuse the same flat-map + window model if they grow.
//
// No fetch on expand when the flat list already carries the children —
// only a childless (huge, server-paged) dir triggers `onDemand`.

import { useMemo, useRef, useState } from 'react';
import type { TreeEntry } from '../api/tree.js';

export interface FlatNode {
  readonly id: string;
  readonly name: string;
  readonly type: 'file' | 'dir';
  readonly size: number;
  readonly parent: string | null;
  readonly childIds: readonly string[];
}

export interface SiblingInfo {
  readonly pos: number;
  readonly size: number;
}

export interface VirtualTreeOptions {
  /** Hydrate one directory's children (the paginated contract). */
  readonly onDemand?: (dir: string) => Promise<readonly TreeEntry[]>;
}

export interface VirtualTree {
  readonly flat: ReadonlyMap<string, FlatNode>;
  /** 1-based position among siblings + sibling count (aria-posinset/aria-setsize). */
  siblingInfo: (id: string) => SiblingInfo | undefined;
  /**
   * Called for EVERY arborist toggle. Mirrors open state, and when a
   * directory opens without recorded children, hydrates it once.
   */
  handleToggled: (id: string) => void;
}

export function useVirtualTree(
  entries: readonly TreeEntry[],
  options?: VirtualTreeOptions
): VirtualTree {
  const parentOf = (path: string): string | null => {
    const cut = path.lastIndexOf('/');
    return cut === -1 ? null : path.slice(0, cut);
  };

  const flat = useMemo(() => {
    const map = new Map<string, FlatNode>();
    const ensure = (path: string): Map<string, FlatNode> => {
      if (!map.has(path)) {
        const parent = parentOf(path);
        if (parent !== null) ensure(parent);
        map.set(path, {
          id: path,
          name: path.split('/').at(-1) ?? path,
          type: 'dir',
          size: 0,
          parent: parentOf(path),
          childIds: [],
        });
      }
      return map;
    };
    for (const entry of entries) {
      const parent = parentOf(entry.path);
      if (parent !== null) ensure(parent);
      map.set(entry.path, {
        id: entry.path,
        name: entry.path.split('/').at(-1) ?? entry.path,
        type: entry.type,
        size: entry.size,
        parent,
        childIds: [],
      });
    }
    for (const node of map.values()) {
      const parent = node.parent === null ? undefined : map.get(node.parent);
      if (parent !== undefined) (parent.childIds as string[]).push(node.id);
    }
    return map;
  }, [entries]);

  const siblingIndex = useMemo(() => {
    const byParent = new Map<string, string[]>();
    for (const node of flat.values()) {
      const key = node.parent ?? '';
      const list = byParent.get(key);
      if (list !== undefined) list.push(node.id);
      else byParent.set(key, [node.id]);
    }
    return byParent;
  }, [flat]);

  const siblingInfo = (id: string): SiblingInfo | undefined => {
    const node = flat.get(id);
    if (node === undefined) return undefined;
    const siblings = siblingIndex.get(node.parent ?? '') ?? [];
    return { pos: siblings.indexOf(id) + 1, size: siblings.length };
  };

  // Mirrors arborist's open state (openByDefault=false => nothing open).
  // `emptyDirs` remembers hydrated-but-empty dirs so expand never refetches.
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  const emptyDirs = useRef<ReadonlySet<string>>(new Set());

  const handleToggled = (id: string): void => {
    const wasOpen = opened.has(id);
    if (wasOpen) {
      const next = new Set(opened);
      next.delete(id);
      setOpened(next);
      return;
    }
    const next = new Set(opened);
    next.add(id);
    setOpened(next);
    const node = flat.get(id);
    if (node === undefined || node.type !== 'dir') return;
    if (node.childIds.length > 0) return; // flat list already has the children
    if (emptyDirs.current.has(id)) return; // hydrated empty once — never again
    const onDemand = options?.onDemand;
    if (onDemand === undefined) return;
    void onDemand(id)
      .then(fetched => {
        if (fetched.every(entry => !entry.path.startsWith(`${id}/`))) {
          emptyDirs.current = new Set([...emptyDirs.current, id]);
        }
      })
      .catch(() => {
        // Hydration is best-effort: the dir stays closed, a re-expand retries.
      });
  };

  return { flat, siblingInfo, handleToggled };
}
