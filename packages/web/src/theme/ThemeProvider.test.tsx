// P-226 tests — theme provider: attribute, OS-follow, persistence, toggle.
//
// jsdom has no `window.matchMedia`, so tests install a controllable mock
// that captures the `change` listener the provider registers. Assertions
// use plain toBe/toBeTruthy style (no jest-dom matchers in this repo).

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from './ThemeProvider.js';
import { useTheme } from '../hooks/useTheme.js';
import { ThemeToggle } from '../shell/ThemeToggle.js';

type ChangeListener = (event: { matches: boolean }) => void;

let changeListener: ChangeListener | null = null;

/** jsdom lacks matchMedia — define a controllable one and capture the listener. */
function installMatchMedia(startsDark: boolean): void {
  changeListener = null;
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: startsDark && query.includes('dark'),
      media: query,
      addEventListener: (_: string, fn: ChangeListener) => {
        changeListener = fn;
      },
      removeEventListener: () => {},
    }),
  });
}

/** A child button setting an explicit theme through the real context. */
function Probe({ next }: { next: 'light' | 'dark' }) {
  const { setTheme } = useTheme();
  return (
    <button type="button" onClick={() => setTheme(next)}>
      set {next}
    </button>
  );
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.classList.remove('dark');
  changeListener = null;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.classList.remove('dark');
});

describe('ThemeProvider', () => {
  it('applies theme attribute', () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <ThemeProvider>
        <Probe next="dark" />
      </ThemeProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: 'set dark' }));

    const html = document.documentElement;
    expect(html.getAttribute('data-theme')).toBe('dark');
    expect(html.classList.contains('dark')).toBeTruthy();
    // PATCH rides the P-225 settings contract, fire-and-forget.
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/settings',
      expect.objectContaining({ method: 'PATCH' })
    );
  });

  it('auto follows os', () => {
    installMatchMedia(false); // OS currently light
    render(
      <ThemeProvider>
        <span>theme host</span>
      </ThemeProvider>
    );

    const html = document.documentElement;
    expect(html.getAttribute('data-theme')).toBe('light');

    // OS flips to dark while the choice is 'auto' — the update is live.
    // act(): the listener triggers a state update, so React must flush it.
    act(() => {
      changeListener?.({ matches: true });
    });
    expect(html.getAttribute('data-theme')).toBe('dark');
    expect(html.classList.contains('dark')).toBeTruthy();
    act(() => {
      changeListener?.({ matches: false });
    });
    expect(html.getAttribute('data-theme')).toBe('light');
  });

  it('persists choice', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <ThemeProvider>
        <Probe next="light" />
      </ThemeProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: 'set light' }));

    expect(localStorage.getItem('stitch-theme')).toBe('light');
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
      const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(String(call[1].body)).toBe(JSON.stringify({ appearance: { theme: 'light' } }));
    });
  });

  it('toggle accessible', () => {
    installMatchMedia(false);
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>
    );

    const toggle = screen.getByTestId('dark-toggle');
    // starts on 'auto' (resolved light) -> not pressed; cycles auto -> light -> dark.
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(toggle); // auto -> light
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(toggle); // light -> dark
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(toggle.getAttribute('aria-label')).toBeTruthy();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });
});
