// P-231 — the axe gate: key screens scan clean, and the two keyboard
// models (tree arrows, diff tabs) behave like native widgets.
//
// jsdom has no layout engine, so 'color-contrast' is disabled for the
// scan (P-209's token tests own contrast); any further exclusion gets
// recorded in ADR-116 rather than silently dropped.

import 'axe-core';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DiffViewer } from '../components/DiffViewer.js';
import { FileTree } from '../components/FileTree.js';
import { AppShellRoutes } from '../router.js';

interface AxeViolation {
  id: string;
  impact: string | null;
}

interface AxeLike {
  run: (
    context: Element,
    options?: Record<string, unknown>
  ) => Promise<{ violations: AxeViolation[] }>;
}

const axeOf = (): AxeLike => (window as unknown as { axe?: AxeLike }).axe as AxeLike;

async function scan(): Promise<AxeViolation[]> {
  const engine = axeOf();
  const res = await engine.run(document.body, {
    rules: { 'color-contrast': { enabled: false } },
  });
  return res.violations;
}

const SOURCE = { id: 'r1', kind: 'local', path: '/tmp/rA', status: 'ready' } as const;

const TREE = [
  { path: 'src', type: 'dir', size: 0 },
  { path: 'src/a.ts', type: 'file', size: 512 },
];

const DIFF_FILES = {
  files: [
    { path: 'src/new.ts', kind: 'add', newText: 'export const x = 1;\n' },
    { path: 'src/gone.ts', kind: 'delete', oldText: 'const gone = true;\n' },
  ],
};

describe('a11y (P-231)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    document.documentElement.lang = 'en';
    document.title = 'stitch';
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ sources: [], entries: [], files: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('axe clean sources', async () => {
    render(
      <MemoryRouter initialEntries={['/sources']}>
        <AppShellRoutes />
      </MemoryRouter>
    );
    await screen.findByText('Welcome to stitch');
    const violations = await scan();
    expect(violations).toEqual([]);
  });

  it('axe clean select', async () => {
    render(
      <MemoryRouter initialEntries={['/select']}>
        <AppShellRoutes />
      </MemoryRouter>
    );
    await screen.findByText(/file tree loads here/);
    const violations = await scan();
    expect(violations).toEqual([]);
  });

  it('tree keyboard', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ entries: TREE }),
    });
    render(<FileTree source={SOURCE} height={300} />);
    await screen.findByText('src');
    const tree = screen.getByRole('tree');
    const rowSrc = within(tree).getAllByRole('treeitem')[0] as HTMLElement;
    // ArrowRight expands the focused directory.
    fireEvent.keyDown(rowSrc, { key: 'ArrowRight' });
    expect(rowSrc.getAttribute('aria-expanded')).toBe('true');
    await screen.findByText('a.ts');
    // ArrowDown moves focus to the next visible row.
    const rows = within(tree).getAllByRole('treeitem');
    rows[1]?.focus();
    fireEvent.keyDown(rows[0] as HTMLElement, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(rows[1]);
    // ArrowUp moves back.
    fireEvent.keyDown(rows[1] as HTMLElement, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(rows[0]);
  });

  it('tabs keyboard', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => DIFF_FILES,
    });
    render(<DiffViewer />);
    await screen.findByTestId('diff-src/new.ts');
    let tabs = screen.getAllByRole('tab');
    expect(tabs.length).toBe(2);
    expect(tabs[0]?.getAttribute('aria-selected')).toBe('true');
    // ArrowRight moves selection to the second tab.
    fireEvent.keyDown(tabs[0] as HTMLElement, { key: 'ArrowRight' });
    await screen.findByTestId('diff-src/gone.ts');
    tabs = screen.getAllByRole('tab');
    expect(tabs[1]?.getAttribute('aria-selected')).toBe('true');
    expect(tabs[0]?.getAttribute('aria-selected')).toBe('false');
    // ArrowLeft wraps selection back.
    fireEvent.keyDown(tabs[1] as HTMLElement, { key: 'ArrowLeft' });
    await screen.findByTestId('diff-src/new.ts');
  });
});
