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
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { AppShellRoutes, STEPS } from '../router.js';
import { useFlowStore } from '../store/flow.js';

function shell(initial: string): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <AppShellRoutes />
    </MemoryRouter>
  );
}

describe('P-210 shell layout', () => {
  beforeEach(() => {
    useFlowStore.getState().reset();
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
    shell('/sources');
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
    expect(screen.getByRole('heading', { level: 2, name: 'Select' })).toBeTruthy();
  });

  it('locked blocks nav', () => {
    shell('/sources');
    // With only Sources visited, Review is NOT a link — an inert
    // aria-disabled span with no navigation affordance.
    expect(screen.queryByRole('link', { name: /Review/ })).toBeNull();
    const locked = screen.getByText('Review').closest('span');
    expect(locked?.getAttribute('aria-disabled')).toBe('true');
    // Clicking it changes nothing: the Sources page is still shown.
    fireEvent.click(locked ?? document.body);
    expect(screen.getByRole('heading', { level: 2, name: 'Sources' })).toBeTruthy();
    expect(useFlowStore.getState().visited).toEqual(['sources']);
  });

  it('routes placeholders', () => {
    // Deep links render every placeholder directly (route access stays open;
    // the stepper's lock is the UI gate).
    const expected = [
      ['/sources', 'coming in phase P-211'],
      ['/select', 'coming in phases P-213/P-214'],
      ['/stitch', 'coming in phases P-217/P-218'],
      ['/review', 'coming in phases P-219/P-220'],
      ['/results', 'coming in phase P-221'],
    ] as const;
    for (const [path, marker] of expected) {
      shell(path);
      // The marker is a substring of the placeholder paragraph — match loosely.
      expect(screen.getByText(marker, { exact: false })).toBeTruthy();
    }
    expect(STEPS).toHaveLength(5);
  });
});
