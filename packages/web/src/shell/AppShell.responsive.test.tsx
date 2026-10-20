// P-227 tests — responsive shell + split view at three viewport bands.
//
// jsdom has no `window.matchMedia`, so tests install a width-driven mock
// (mirrors the ThemeProvider.test stub). The viewport hook is data-driven
// rather than CSS-media-query driven precisely so these assertions work in
// jsdom (ADR-112). Plain toBe/toBeTruthy style (no jest-dom matchers).

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { AppShell } from './AppShell.js';
import { SplitTreeView } from '../components/SplitTreeView.js';

type Mq = {
  matches: boolean;
  media: string;
  addEventListener: () => void;
  removeEventListener: () => void;
};

/** Width in px -> the queries a real browser would match. */
function installMatchMedia(width: number): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string): Mq => {
      const max = /max-width:\s*(\d+)px/.exec(query);
      return {
        matches: max !== null && width <= Number(max[1]),
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      };
    },
  });
}

// Sources are placeholders: the shell tests only exercise nav/layout forms.
const SOURCE_A = { id: 'r1', kind: 'local' as const, path: '/tmp/rA', status: 'ready' as const };
const SOURCE_B = { id: 'r2', kind: 'local' as const, path: '/tmp/rB', status: 'ready' as const };
const noop = (): void => undefined;

function renderShell(): void {
  render(
    <MemoryRouter initialEntries={['/sources']}>
      <AppShell />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true, json: async () => ({ entries: [] }) })
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete (window as { matchMedia?: unknown }).matchMedia;
});

describe('responsive shell (P-227)', () => {
  it('compact nav form', () => {
    installMatchMedia(375); // mobile
    renderShell();
    // Sidebar yields; the stepper moves into the fixed bottom bar.
    expect(screen.queryByLabelText('sources and selection')).toBeNull();
    expect(screen.getByTestId('bottom-stepper')).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'stitch steps' })).toBeTruthy();
    // Header compact: the tagline row is gone, brand + controls stay.
    expect(screen.queryByText('AI-augmented multi-repo composition')).toBeNull();
    expect(screen.getByText('stitch')).toBeTruthy();
    expect(screen.getByTestId('settings-link')).toBeTruthy();
  });

  it('stacks split view', () => {
    installMatchMedia(375); // mobile
    render(
      <SplitTreeView
        sourceA={SOURCE_A}
        sourceB={SOURCE_B}
        onSelectionA={noop}
        onSelectionB={noop}
      />
    );
    const container = screen.getByLabelText('repo A tree').parentElement as HTMLElement;
    // Single column below md: the verdict is stamped and A sits before B.
    expect(container.getAttribute('data-viewport')).toBe('mobile');
    expect(container.className).toContain('grid-cols-1');
    const a = container.querySelector('[aria-label="repo A tree"]');
    const b = container.querySelector('[aria-label="repo B tree"]');
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    expect(
      (b as HTMLElement).compareDocumentPosition(a as Node) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBe(0);
  });

  it('touch targets', () => {
    installMatchMedia(1280); // any width — targets apply everywhere
    renderShell();
    // 44px minimums are additive utility classes (min-h-11 = 2.75rem); jsdom
    // cannot compute stylesheet geometry, so class presence is the proxy.
    expect(screen.getByTestId('dark-toggle').className).toContain('min-h-11');
    expect(screen.getByTestId('settings-link').className).toContain('min-h-11');
    for (const link of screen.getAllByRole('link')) {
      if (
        ['/sources', '/select', '/stitch', '/review', '/results'].includes(
          link.getAttribute('href') ?? ''
        )
      ) {
        expect(link.className).toContain('min-h-11');
      }
    }
  });

  it('desktop unchanged', () => {
    installMatchMedia(1280); // wide
    renderShell();
    // Wide keeps the P-210 layout: sidebar rail, inline vertical stepper,
    // tagline — and no bottom bar.
    expect(screen.getByLabelText('sources and selection')).toBeTruthy();
    expect(screen.getByText('AI-augmented multi-repo composition')).toBeTruthy();
    expect(screen.queryByTestId('bottom-stepper')).toBeNull();
  });
});
