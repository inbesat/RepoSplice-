// P-210 — shell layout tests.
//
// The four required scenarios from the phase spec:
//
//   it('renders shell')    it('stepper active states')
//   it('locked blocks nav')  it('routes placeholders')
//
// MemoryRouter Drives Every Case (deterministic location); the zustand flow
// store is module state, so each test resets it.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { AppShellRoutes, STEPS } from '../router.js';
import { Stepper } from './Stepper.js';
import { useFlowStore } from '../store/flow.js';
import { useSourcesStore } from '../store/selection.js';

function shell(initial: string): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <AppShellRoutes />
    </MemoryRouter>
  );
}

/** Render ONLY the stepper (no AppShell, no data gates, no Sources effect). */
function stepperOnly(initial: string): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <Stepper />
    </MemoryRouter>
  );
}

describe('P-210 shell layout', () => {
  beforeEach(() => {
    useFlowStore.getState().reset();
    useSourcesStore.getState().reset();
  });
  afterEach(cleanup);

  it('renders shell', () => {
    shell('/sources');
    // Chrome: header brand + tagline, stepper nav, sidebar, run badge, dark
    // toggle, settings link — and the routed main region.
    expect(screen.getByRole('heading', { level: 1, name: 'stitch' })).toBeTruthy();
    expect(screen.getByText('AI-augmented multi-repo composition')).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'stitch steps' })).toBeTruthy();
    expect(screen.getByLabelText('sources and selection')).toBeTruthy();
    expect(screen.getByTestId('run-status').textContent).toBe('idle');
    expect(screen.getByTestId('dark-toggle')).toBeTruthy();
    expect(screen.getByTestId('settings-link')).toBeTruthy();
  });

  it('stepper active states', () => {
    // P-212: inside the full shell, Select is ALSO data-gated — this test
    // exercises the SEQUENTIAL unlock in isolation (stepper + flow store only;
    // the AppShell gate is pinned separately in 'locked blocks nav').
    useFlowStore.getState().complete('sources');
    stepperOnly('/sources');
    // The current route's step carries aria-current="step"…
    const sources = screen.getByRole('link', { name: /Sources/ });
    expect(sources.getAttribute('aria-current')).toBe('step');
    // …later steps are locked UNTIL a predecessor is visited…
    expect(screen.getByRole('link', { name: /Select/ }).getAttribute('aria-current')).toBeNull();
    // …and navigating flips both: visit Select via its link.
    fireEvent.click(screen.getByRole('link', { name: /Select/ }));
    const select = screen.getByRole('link', { name: /Select/ });
    expect(select.getAttribute('aria-current')).toBe('step');
    // Visited steps stay unlocked (completed steps clickable).
    expect(screen.getByRole('link', { name: /Sources/ })).toBeTruthy();
  });

  it('locked blocks nav', () => {
    shell('/sources');
    // With only Sources visited, Review is NOT a link — an inert
    // aria-disabled span with no navigation affordance.
    expect(screen.queryByRole('link', { name: /Review/ })).toBeNull();
    const locked = screen.getByText('Review').closest('span');
    expect(locked?.getAttribute('aria-disabled')).toBe('true');
    // P-212: Select is gated on BOTH source slots (the store is empty here),
    // so it is locked EVEN THOUGH its sequential predecessor was visited —
    // and the lock hint names that reason.
    expect(screen.queryByRole('link', { name: /Select/ })).toBeNull();
    const gated = screen.getByText('Select').closest('span');
    expect(gated?.getAttribute('aria-disabled')).toBe('true');
    expect(gated?.getAttribute('title')).toBe('Add both repo A and B first');
    // Clicking it changes nothing: the A picker is still shown.
    fireEvent.click(locked ?? document.body);
    expect(screen.getByLabelText('repo A picker')).toBeTruthy();
    expect(useFlowStore.getState().visited).toEqual(['sources']);
  });

  it('routes placeholders', () => {
    // Deep links render every placeholder directly (route access stays open;
    // the stepper's lock is the UI gate).
    // P-213: /select renders the file-tree empty state — the marker is a
    // substring of the placeholder paragraph shown with no repo A source.
    // P-216: /stitch now renders the gated Run Merge page — the marker is a
    // substring of its paragraph (supersedes the P-217/P-218 placeholder pin;
    // on record in ADR-101).
    const expected = [
      ['/select', 'file tree loads here'],
      ['/stitch', 'Run the merge'],
      // P-218: /review renders the gate; the empty state shows when sources are missing.
      ['/review', 'review the proposed merge'],
      ['/results', 'coming in phase P-221'],
    ] as const;
    for (const [path, marker] of expected) {
      shell(path);
      // The marker is a substring of the placeholder paragraph — match loosely.
      expect(screen.getByText(marker, { exact: false })).toBeTruthy();
    }
    // P-212: /sources now renders BOTH pickers, each with the empty-state
    // paragraph — assert the marker per picker instead of globally.
    shell('/sources');
    for (const slot of ['A', 'B'] as const) {
      expect(
        within(screen.getByLabelText(`repo ${slot} picker`)).getByText('add one below', {
          exact: false,
        })
      ).toBeTruthy();
    }
    expect(STEPS).toHaveLength(5);
  });
});
