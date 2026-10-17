// P-213 — the FileTree tests (the five mandated scenarios, fetch mocked per
// the P-211 pattern — the tree endpoint doesn't exist server-side yet).
//
//   it('expands collapses')  it('selects file')  it('selects folder')
//   it('shows counts')       it('error surface')
//
// The lib owns expand state (openByDefault=false): rows for children appear
// only after their dir's toggle button is clicked.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { FileTree } from './FileTree.js';
import type { TreeEntry } from '../api/tree.js';

type FetchMock = ReturnType<typeof vi.fn>;

function mockFetch(handler: (url: string) => unknown): FetchMock {
  const urlOf = (input: RequestInfo | URL): string =>
    typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  const spy = vi.fn((input: RequestInfo | URL): Promise<unknown> => {
    const body = handler(urlOf(input));
    if (body instanceof Error) return Promise.reject(body);
    return Promise.resolve(body);
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}

const OK = (body: unknown): Response =>
  ({ ok: true, status: 200, json: async () => body }) as unknown as Response;
const FAIL = (status: number, message: string): Response =>
  ({
    ok: false,
    status,
    statusText: 'Bad Request',
    json: async () => ({ message }),
  }) as unknown as Response;

const SOURCE = { id: 'r1', kind: 'local', path: '/tmp/r1', status: 'ready' } as const;

const ENTRIES: TreeEntry[] = [
  { path: 'README.md', type: 'file', size: 1024 },
  { path: 'src', type: 'dir', size: 0 },
  { path: 'src/a.ts', type: 'file', size: 512 },
  { path: 'src/sub', type: 'dir', size: 0 },
  { path: 'src/sub/b.ts', type: 'file', size: 512 },
];

function mockTree(): FetchMock {
  return mockFetch(url =>
    url.includes('/api/repos/r1/tree') ? OK({ entries: ENTRIES }) : FAIL(404, 'unexpected')
  );
}

/** Expand `src` so its children render (the tree starts fully collapsed). */
async function expandSrc(): Promise<void> {
  fireEvent.click(await screen.findByRole('button', { name: 'Toggle src' }));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('P-213 file tree', () => {
  it('expands collapses', async () => {
    mockTree();
    render(<FileTree source={SOURCE} />);
    // Collapsed by default: README.md (root row) is visible, a.ts is not.
    expect(await screen.findByText('README.md')).toBeTruthy();
    expect(screen.queryByText('a.ts')).toBeNull();
    await expandSrc();
    expect(screen.queryByText('a.ts')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Toggle src' }));
    expect(screen.queryByText('a.ts')).toBeNull();
  });

  it('selects file', async () => {
    mockTree();
    const onSelectionChange = vi.fn();
    render(<FileTree source={SOURCE} onSelectionChange={onSelectionChange} />);
    await expandSrc();
    fireEvent.click(screen.getByRole('checkbox', { name: 'src/a.ts' }));
    expect(onSelectionChange).toHaveBeenLastCalledWith(['src/a.ts']);
    fireEvent.click(screen.getByRole('checkbox', { name: 'src/a.ts' }));
    expect(onSelectionChange).toHaveBeenLastCalledWith([]);
  });

  it('selects folder', async () => {
    mockTree();
    const onSelectionChange = vi.fn();
    render(<FileTree source={SOURCE} onSelectionChange={onSelectionChange} />);
    // Folder select = ALL descendant files, no expansion needed.
    fireEvent.click(await screen.findByRole('checkbox', { name: 'src' }));
    expect(onSelectionChange).toHaveBeenLastCalledWith(['src/a.ts', 'src/sub/b.ts']);
    // Clicking again clears the whole subtree.
    fireEvent.click(screen.getByRole('checkbox', { name: 'src' }));
    expect(onSelectionChange).toHaveBeenLastCalledWith([]);
  });

  it('shows counts', async () => {
    mockTree();
    render(<FileTree source={SOURCE} />);
    const counts = await screen.findByTestId('tree-counts');
    // 3 files; the size shown is the SELECTION's size (the merge-relevant
    // number) — nothing selected → 0 B.
    expect(counts.textContent).toContain('3 files, 0 selected, 0 B');
    // Folder select flips the selected count and bytes.
    fireEvent.click(screen.getByRole('checkbox', { name: 'src' }));
    expect(counts.textContent).toContain('3 files, 2 selected, 1 KB');
  });

  it('error surface', async () => {
    mockFetch(url =>
      url.includes('/api/repos/r1/tree') ? FAIL(500, 'tree too large') : FAIL(404, 'unexpected')
    );
    render(<FileTree source={SOURCE} />);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('tree too large');
  });
});
