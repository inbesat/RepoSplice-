// P-217 — mandated DiffViewer tests. Same mock-fetch posture as
// SourcesPage/FileTree tests: local spy + vi.stubGlobal; NO setupFiles, so
// cleanup + unstubAllGlobals run manually in afterEach.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DiffViewer } from './DiffViewer.js';

const File = {
  added: { path: 'src/new.ts', kind: 'add', newText: 'export const x = 1;\n' },
  deleted: { path: 'src/gone.ts', kind: 'delete', oldText: 'const gone = true;\n' },
  modified: { path: 'README.md', kind: 'modify', oldText: '# hello\n', newText: '# hello world\n' },
} as const;

const FILES_CHANGED = [File.added, File.deleted, File.modified];

let fetchMock: ReturnType<typeof vi.fn>;

function mockOk(files: readonly object[]): void {
  fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ files }) });
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('DiffViewer', () => {
  it('renders kinds', async () => {
    mockOk(FILES_CHANGED);
    render(<DiffViewer />);
    expect(await screen.findByText('Added (1)')).toBeDefined();
    expect(screen.getByText('Modified (1)')).toBeDefined();
    expect(screen.getByText('Deleted (1)')).toBeDefined();
    expect(screen.getByText(/3 files · 1 added · 1 modified · 1 deleted/)).toBeDefined();
  });

  it('toggles unified split', async () => {
    mockOk(FILES_CHANGED);
    render(<DiffViewer />);
    const section = await screen.findByRole('region', { name: 'proposed diff' });
    expect(section.dataset.view).toBe('unified');
    const toggle = screen.getByTestId('toggle-split');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(toggle);
    expect(section.dataset.view).toBe('split');
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
  });

  it('toggles whitespace', async () => {
    const wsOnly = {
      path: 'ws.txt',
      kind: 'modify' as const,
      oldText: 'alpha\nbeta\n',
      newText: 'alpha \nbeta\n',
    };
    mockOk([wsOnly]);
    render(<DiffViewer />);
    await screen.findByRole('region', { name: 'proposed diff' });
    // With whitespace counted, one line changed (and the trailing empty
    // lines match, so it's +1 -1). Ignoring whitespace, zero changes.
    expect(screen.getByText(/\+1 -1/)).toBeDefined();
    const toggle = screen.getByTestId('toggle-whitespace');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText(/0 added · 1 modified · 0 deleted · \+0 -0/)).toBeDefined();
  });

  it('navigates files', async () => {
    mockOk(FILES_CHANGED);
    render(<DiffViewer />);
    await screen.findByRole('region', { name: 'proposed diff' });
    // Active file defaults to the first loaded; rail click switches it.
    expect(screen.getByTestId('diff-src/new.ts')).toBeDefined();
    fireEvent.click(screen.getByTestId('rail-src/gone.ts'));
    expect(screen.getByTestId('diff-src/gone.ts')).toBeDefined();
    expect(screen.queryByTestId('diff-src/new.ts')).toBeNull();
  });

  it('errors inline', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ message: 'dry-run failed' }),
    });
    render(<DiffViewer />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('dry-run failed');
  });
});

describe('useProposedDiff plumbing', () => {
  it('accepts a bare array body', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => FILES_CHANGED });
    render(<DiffViewer />);
    await waitFor(() => expect(screen.getByTestId('rail-README.md')).toBeDefined());
  });
});
