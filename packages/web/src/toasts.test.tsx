import { describe, it, expect } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Toaster } from 'sonner';
import { notifyJob } from './toasts.js';

/** Bounded poll: sonner state updates + React rendering settle asynchronously. */
async function waitForText(container: HTMLElement, text: string): Promise<void> {
  for (let i = 0; i < 40; i++) {
    if (container.textContent?.includes(text) === true) return;
    await new Promise(r => setTimeout(r, 50));
  }
}

/** Bounded poll for a selector: the toaster host only exists once a toast does. */
async function waitForSelector(container: HTMLElement, selector: string): Promise<void> {
  for (let i = 0; i < 40; i++) {
    if (container.querySelector(selector) !== null) return;
    await new Promise(r => setTimeout(r, 50));
  }
}

/**
 * jsdom has no window.matchMedia, but sonner's Toaster reads it (theme
 * handling, verified in the installed dist). Stub the full MediaQueryList
 * shape so the component mounts exactly as in a browser.
 */
function ensureMatchMedia(): void {
  if (typeof window.matchMedia === 'function') return;
  const stub = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
  window.matchMedia = stub as typeof window.matchMedia;
}

describe('job toasts (P-057 sonner)', () => {
  it('toast promise', async () => {
    ensureMatchMedia();
    let resolveJob: (value: string) => void = () => {};
    const job = new Promise<string>(resolve => {
      resolveJob = resolve;
    });
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    try {
      await act(async () => {
        root.render(<Toaster />);
      });

      await act(async () => {
        notifyJob(job, {
          loading: 'Merging repos',
          success: 'Merge completed',
          error: 'Merge failed',
        });
      });
      // The toaster host mounts in place (no portal, per installed dist) —
      // but only once a toast exists, so it is asserted after notifyJob.
      await waitForSelector(container, '[data-sonner-toaster]');
      expect(container.querySelector('[data-sonner-toaster]')).not.toBeNull();
      await waitForText(container, 'Merging repos');
      expect(container.textContent?.includes('Merging repos')).toBe(true);

      // Deferred resolve flips the loading toast to the success toast.
      await act(async () => {
        resolveJob('ok');
        await job;
      });
      await waitForText(container, 'Merge completed');
      expect(container.textContent?.includes('Merge completed')).toBe(true);
      expect(container.querySelector('[data-sonner-toast]')).not.toBeNull();
    } finally {
      root.unmount();
      container.remove();
    }
  });
});
