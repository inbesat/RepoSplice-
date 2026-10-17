// P-214 — SelectPage's split A/B view: both trees render, per-slot counts,
// the Continue-to-Merge gate, and the cross-highlight toggle. Fetches are
// mocked per source id (the serve endpoint is still a client contract).

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useFlowStore } from '../store/flow.js';
import { useSourcesStore } from '../store/selection.js';
import { SelectPage } from './SelectPage.js';

const SOURCE_A = { id: 'r1', kind: 'local' as const, path: '/tmp/rA', status: 'ready' as const };
const SOURCE_B = { id: 'r2', kind: 'local' as const, path: '/tmp/rB', status: 'ready' as const };

/** Per-slot fixtures: one root file unique to each, plus a SHARED path. */
const ENTRIES_A = [
  { path: 'alpha.md', type: 'file', size: 100 },
  { path: 'README.md', type: 'file', size: 1024 },
];
const ENTRIES_B = [
  { path: 'beta.md', type: 'file', size: 200 },
  { path: 'README.md', type: 'file', size: 2048 },
];

const mockFetch = vi.fn(async (input: RequestInfo | URL) => {
  const url = String(input);
  const entries = url.includes('/r1/') ? ENTRIES_A : ENTRIES_B;
  return { ok: true, json: async () => ({ entries }) } as Response;
});

function renderPage(): void {
  render(
    <MemoryRouter>
      <SelectPage />
    </MemoryRouter>
  );
}

const paneA = (): ReturnType<typeof within> => within(screen.getByLabelText('repo A tree'));
const paneB = (): ReturnType<typeof within> => within(screen.getByLabelText('repo B tree'));

describe('SelectPage', () => {
  beforeEach(() => {
    useFlowStore.getState().reset();
    useSourcesStore.getState().reset();
    useSourcesStore.getState().addSource('A', SOURCE_A);
    useSourcesStore.getState().addSource('B', SOURCE_B);
    vi.stubGlobal('fetch', mockFetch as unknown as typeof fetch);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('renders both trees', async () => {
    renderPage();
    expect(await paneA().findByText('alpha.md', { exact: false })).toBeDefined();
    expect(await paneB().findByText('beta.md', { exact: false })).toBeDefined();
  });

  it('counts per slot', async () => {
    renderPage();
    fireEvent.click(await paneA().findByLabelText('alpha.md'));
    fireEvent.click(await paneB().findByLabelText('beta.md'));
    expect(await screen.findByText('A: 1 selected', { exact: false })).toBeDefined();
    expect(screen.getByText('B: 1 selected', { exact: false })).toBeDefined();
  });

  it('gates continue', async () => {
    renderPage();
    const gate = () => screen.getByRole('button', { name: 'Continue to Merge' });
    expect((gate() as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Select at least one file from/)).toBeDefined();
    fireEvent.click(await paneA().findByLabelText('alpha.md'));
    expect((gate() as HTMLButtonElement).disabled).toBe(true); // repo B still empty
    fireEvent.click(await paneB().findByLabelText('beta.md'));
    expect((gate() as HTMLButtonElement).disabled).toBe(false);
    // Persisted per slot — the stable keys P-216/P-192 consume.
    expect(useSourcesStore.getState().selectionA).toEqual(['alpha.md']);
    expect(useSourcesStore.getState().selectionB).toEqual(['beta.md']);
  });

  it('cross highlight toggle', async () => {
    renderPage();
    // README.md exists in BOTH fixtures → the toggle appears.
    const toggle = await screen.findByRole('checkbox', { name: /shared path/ });
    expect((toggle as HTMLInputElement).checked).toBe(false);
    expect(document.querySelectorAll('[data-cross="true"]').length).toBe(0);
    fireEvent.click(toggle);
    expect((toggle as HTMLInputElement).checked).toBe(true);
    // Both panes spotlight the shared row.
    expect(document.querySelectorAll('[data-cross="true"]').length).toBe(2);
  });
});
