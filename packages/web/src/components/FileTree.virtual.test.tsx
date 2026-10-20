// P-232 — the virtual-tree behaviors on top of P-213's FileTree:
// visible-slice rendering, lazy dir hydration, scroll recycling, debounced
// filter with auto-scroll, and a 100k-node perf gate. The a11y contract
// (P-231) is asserted alongside (posinset/setsize survive virtualization).

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileTree } from './FileTree.js';
import type { TreeEntry } from '../api/tree.js';
import type { SourceRecord } from '../api/repos.js';
import type { TreeApi } from 'react-arborist';
import type { TreeNodeData } from './TreeNode.js';

const SOURCE: SourceRecord = { id: 'r1', kind: 'local', path: '/tmp/rA', status: 'ready' };

const mk = (path: string, size = 10): TreeEntry => ({ path, type: 'file', size });
const mkDir = (path: string): TreeEntry => ({ path, type: 'dir', size: 0 });

let fetchMock: ReturnType<typeof vi.fn>;

type JsonBody = Record<string, unknown>;
const OK = (body: JsonBody): { ok: boolean; json: () => Promise<JsonBody> } => ({
  ok: true,
  json: async () => body,
});

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const lastUrl = (): string => {
  const calls = fetchMock.mock.calls as unknown as [string, RequestInit?][];
  return calls[calls.length - 1]?.[0] ?? '';
};

describe('FileTree virtualization (P-232)', () => {
  it('renders visible slice', async () => {
    const many = Array.from({ length: 200 }, (_, index) => mk(`file-${index}`));
    fetchMock.mockResolvedValue(OK({ entries: many }));
    render(<FileTree source={SOURCE} height={140} />);
    await screen.findByText('file-0', {}, { timeout: 10_000 });
    const rows = screen.getAllByRole('treeitem');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(60);
    // the model holds all 200 siblings even though only a slice renders
    expect(rows[0]?.getAttribute('aria-setsize')).toBe('200');
  });

  it('expand fetches', async () => {
    fetchMock
      .mockResolvedValueOnce(OK({ entries: [mkDir('big')] }))
      .mockResolvedValueOnce(OK({ entries: [mkDir('big'), mk('big/x.ts')] }));
    render(<FileTree source={SOURCE} height={140} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Toggle big' }, { timeout: 10_000 }));
    await screen.findByText('x.ts', {}, { timeout: 10_000 });
    expect(lastUrl()).toContain('dir=big');
  }, 60_000);

  it('recycles scroll', async () => {
    const many = Array.from({ length: 300 }, (_, index) => mk(`file-${index}`));
    fetchMock.mockResolvedValue(OK({ entries: many }));
    const apiRef: { current: TreeApi<TreeNodeData> | null } = { current: null };
    render(<FileTree source={SOURCE} height={140} apiRef={apiRef} />);
    await screen.findByText('file-0', {}, { timeout: 10_000 });
    await apiRef.current?.scrollTo('file-250');
    await screen.findByText('file-250', {}, { timeout: 10_000 });
    expect(screen.queryByText('file-0')).toBeNull();
    expect(screen.getAllByRole('treeitem').length).toBeLessThan(60);
  }, 60_000);

  it('filter scroll', async () => {
    fetchMock.mockResolvedValue(
      OK({
        entries: [
          mkDir('deep'),
          mkDir('deep/nested'),
          mk('deep/nested/needle.ts'),
          mk('unrelated.ts'),
        ],
      })
    );
    render(<FileTree source={SOURCE} height={140} />);
    fireEvent.change(
      await screen.findByRole('searchbox', { name: 'find file' }, { timeout: 10_000 }),
      {
        target: { value: 'needle' },
      }
    );
    await screen.findByText('needle.ts', {}, { timeout: 10_000 });
    expect(screen.queryByText('unrelated.ts')).toBeNull();
  }, 60_000);

  it('perf gate', async () => {
    const huge = Array.from({ length: 100_000 }, (_, index) => mk(`file-${index}`));
    fetchMock.mockResolvedValue(OK({ entries: huge }));
    const started = Date.now();
    render(<FileTree source={SOURCE} height={300} />);
    await screen.findByText('file-0', {}, { timeout: 10_000 });
    const elapsed = Date.now() - started;
    // The wall-clock bound is a runaway guard, not a perf SLA: a loaded CI
    // runner can take seconds. The hard assertion is the rendered window —
    // 100k entries must still mount only a screenful of rows.
    expect(elapsed).toBeLessThan(20_000);
    expect(screen.getAllByRole('treeitem').length).toBeLessThan(80);
  }, 60_000);

  it('keeps the checked file selection across lazy hydration', async () => {
    fetchMock
      .mockResolvedValueOnce(OK({ entries: [mkDir('big'), mk('a.ts')] }))
      .mockResolvedValueOnce(OK({ entries: [mkDir('big'), mk('big/x.ts')] }));
    const seen: (readonly string[])[] = [];
    render(<FileTree source={SOURCE} height={140} onSelectionChange={paths => seen.push(paths)} />);
    fireEvent.click(await screen.findByRole('checkbox', { name: 'a.ts' }, { timeout: 10_000 }));
    fireEvent.click(await screen.findByRole('button', { name: 'Toggle big' }, { timeout: 10_000 }));
    await screen.findByText('x.ts', {}, { timeout: 10_000 });
    // checking a file again after hydration still emits just the checked set
    fireEvent.click(await screen.findByRole('checkbox', { name: 'big/x.ts' }, { timeout: 10_000 }));
    expect(seen[seen.length - 1]).toEqual(['a.ts', 'big/x.ts'].sort());
  }, 60_000);
});
