// P-218 — ReviewPage gate tests. `blockers` is injected until P-219/220/221
// wire the real panels; approve/reject endpoints are client contracts.

import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ReviewPage } from './ReviewPage.js';
import { useSourcesStore } from '../store/selection.js';
import { useRunStore } from '../store/run.js';

const SOURCE_A = { id: 'r1', kind: 'local' as const, path: '/tmp/rA', status: 'ready' as const };
const SOURCE_B = { id: 'r2', kind: 'local' as const, path: '/tmp/rB', status: 'ready' as const };

const fetchMock = vi.fn();

function mockDispatch(): void {
  fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/merge/approve')) {
      return { ok: true, json: async () => ({ files: 3, deps: [], licenses: [] }) };
    }
    if (url.includes('/api/merge/reject')) {
      return { ok: true, json: async () => ({}) };
    }
    // proposed-diff (DiffViewer internals are not under test here)
    return { ok: true, json: async () => ({ files: [] }) };
  });
}

function seedStores(): void {
  const s = useSourcesStore.getState();
  s.addSource('A', SOURCE_A);
  s.addSource('B', SOURCE_B);
  s.setSelection('A', ['a.ts', 'shared.ts']);
  s.setSelection('B', ['shared.ts', 'b.ts']);
}

function renderPage(blockers?: readonly string[]): void {
  render(
    <MemoryRouter initialEntries={['/review']}>
      <Routes>
        <Route
          path="/review"
          element={<ReviewPage {...(blockers !== undefined ? { blockers } : {})} />}
        />
        <Route path="/results" element={<p>Results screen</p>} />
        <Route path="/select" element={<p>Select screen</p>} />
      </Routes>
    </MemoryRouter>
  );
}

async function approveThroughConfirm(): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: /Approve & Create C/ }));
  fireEvent.click(screen.getByRole('button', { name: /Confirm & Create C/ }));
}

function postedBody(callIndex: number): Record<string, unknown> {
  const call = fetchMock.mock.calls[callIndex] as [RequestInfo | URL, RequestInit?];
  return JSON.parse(String(call[1]?.body)) as Record<string, unknown>;
}

describe('ReviewPage', () => {
  beforeEach(() => {
    useSourcesStore.getState().reset();
    useRunStore.getState().reset();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    mockDispatch();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('approve posts include exclude', async () => {
    seedStores();
    renderPage();
    await approveThroughConfirm();
    expect(fetchMock).toHaveBeenCalledTimes(2); // proposed-diff + approve
    const body = postedBody(1);
    expect(body).toEqual({ include: ['a.ts', 'b.ts', 'shared.ts'], exclude: [], note: '' });
  });

  it('reject posts reason', async () => {
    seedStores();
    renderPage();
    fireEvent.change(screen.getByLabelText('Rejection reason'), {
      target: { value: 'license policy denies GPL' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Reject merge' }));
    await screen.findByRole('alert');
    const rejectCall = fetchMock.mock.calls.find(c =>
      String(c[0]).includes('/api/merge/reject')
    ) as [RequestInfo | URL, RequestInit?];
    expect(JSON.parse(String(rejectCall[1]?.body))).toEqual({
      reason: 'license policy denies GPL',
    });
    expect(screen.getByText(/Merge rejected — license policy denies GPL/)).toBeTruthy();
  });

  it('blocking blocks approve', () => {
    seedStores();
    renderPage(['GPL license conflict']);
    const approve = screen.getByRole('button', { name: /Approve & Create C/ }) as HTMLButtonElement;
    expect(approve.disabled).toBe(true);
    expect(screen.getByRole('alert').textContent).toContain('Blocked: GPL license conflict');
  });

  it('per file exclude', async () => {
    seedStores();
    renderPage();
    fireEvent.click(screen.getByLabelText('shared.ts'));
    expect(screen.getByTestId('review-counts').textContent).toContain('2 to merge · 1 excluded');
    await approveThroughConfirm();
    const body = postedBody(1);
    expect(body.include).toEqual(['a.ts', 'b.ts']);
    expect(body.exclude).toEqual(['shared.ts']);
  });

  it('routes on success', async () => {
    seedStores();
    renderPage();
    await approveThroughConfirm();
    expect(await screen.findByText('Results screen')).toBeTruthy();
  });
});

describe('ReviewPage plumbing', () => {
  beforeEach(() => {
    useSourcesStore.getState().reset();
    useRunStore.getState().reset();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('empty sources render the placeholder', () => {
    vi.stubGlobal('fetch', fetchMock);
    render(
      <MemoryRouter initialEntries={['/review']}>
        <Routes>
          <Route path="/review" element={<ReviewPage />} />
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByText(/review the proposed merge/)).toBeTruthy();
  });
});
