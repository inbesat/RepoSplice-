// P-229 tests — the five mandated tour behaviors plus the handoff's
// selector-resolution guard. jsdom has no matchMedia (the hook guards
// return 'wide'); the reduced-motion test stubs window.matchMedia. No
// jest-dom helpers in this repo — toBeTruthy/toBeNull style.

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router';
import { Tour } from './Tour.js';
import { TOUR_STEPS } from './steps.js';
import { TOUR_KEY, useTourStore } from '../../store/tour.js';
import { useSourcesStore } from '../../store/selection.js';
import { useFlowStore } from '../../store/flow.js';
import { AppShellRoutes } from '../../router.js';

type Mq = {
  matches: boolean;
  media: string;
  addEventListener: () => void;
  removeEventListener: () => void;
};

function installMatchMedia(resolve: (query: string) => boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string): Mq => ({
      matches: resolve(query),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
}

describe('tour (P-229)', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    localStorage.clear();
    useTourStore.getState().reset();
    useSourcesStore.getState().reset();
    useFlowStore.getState().reset();
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    delete (window as { matchMedia?: unknown }).matchMedia;
    localStorage.clear();
  });

  it('empty state hero', async () => {
    const { SourcesPage } = await import('../../pages/SourcesPage.js');
    render(
      <MemoryRouter initialEntries={['/sources']}>
        <Routes>
          <Route path="/select" element={<p>select</p>} />
          <Route path="*" element={<SourcesPage />} />
        </Routes>
      </MemoryRouter>
    );
    // hero present above the pickers; the P-212 picker pins are untouched
    expect(screen.getByText('Welcome to stitch')).toBeTruthy();
    expect(screen.getByText(/Pick repo A, pick repo B/)).toBeTruthy();
    expect(screen.getAllByText(/add one below/).length === 2).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Take the tour' })).toBeTruthy();
  });

  it('advances steps', () => {
    useTourStore.getState().start();
    render(<Tour />);
    expect(screen.getByText('Pick repo A')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Pick repo B')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByText('Pick repo A')).toBeTruthy();
    for (let i = 0; i < 5; i += 1) fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('View the result')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
    expect(screen.queryByTestId('tour-overlay')).toBeNull();
    expect(useTourStore.getState().completed).toBeTruthy();
  });

  it('skip persists', () => {
    useTourStore.getState().start();
    render(<Tour />);
    fireEvent.click(screen.getByRole('button', { name: 'skip tour' }));
    expect(screen.queryByTestId('tour-overlay')).toBeNull();
    const raw = localStorage.getItem(TOUR_KEY);
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw as string)).toMatchObject({ dismissed: true });
    // the dismissal also rides the settings PATCH (fire-and-forget)
    const patch = fetchMock.mock.calls.find(call => String(call[0]).includes('/api/settings'));
    expect(patch).toBeTruthy();
  });

  it('focus trap', () => {
    useTourStore.getState().start();
    render(<Tour />);
    const card = screen.getByTestId('tour-card');
    expect(document.activeElement === card).toBeTruthy();
    fireEvent.keyDown(card, { key: 'Tab' });
    // focus stays inside the dialog
    expect(card.contains(document.activeElement)).toBeTruthy();
    fireEvent.keyDown(card, { key: 'Escape' });
    expect(screen.queryByTestId('tour-overlay')).toBeNull();
    expect(useTourStore.getState().dismissed).toBeTruthy();
  });

  it('reduced motion', () => {
    installMatchMedia(query => query.includes('prefers-reduced-motion'));
    useTourStore.getState().start();
    render(<Tour />);
    expect(screen.getByTestId('tour-card').getAttribute('data-reduced')).toBe('true');
    cleanup();
    installMatchMedia(() => false);
    useTourStore.getState().reset();
    useTourStore.getState().start();
    render(<Tour />);
    expect(screen.getByTestId('tour-card').getAttribute('data-reduced')).toBe('false');
  });

  it('tour targets resolve on their pages', async () => {
    for (const step of TOUR_STEPS) {
      cleanup();
      const { container } = render(
        <MemoryRouter initialEntries={[step.route]}>
          <AppShellRoutes />
        </MemoryRouter>
      );
      // P-237: the route chunk is lazy — the anchor lands asynchronously.
      // The 5s timeout rides out suite-load lag (the chunk import is I/O).
      await waitFor(
        () => {
          expect(container.querySelector(step.target) !== null).toBeTruthy();
        },
        { timeout: 5000 }
      );
    }
  });
});
