import { describe, it, expect } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { JSX } from 'react';
import { DiffView } from './DiffView.js';

// jsdom provides no ResizeObserver; the viewer measures with it on mount
// (falling back when measurement fails), so stub the constructor.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
}

const OLD_TEXT = 'line one\nline two\nline three';
const NEW_TEXT = 'line one\nline TWO\nline three\nline four';

async function renderDiffView(ui: JSX.Element): Promise<{ container: HTMLElement; root: Root }> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(ui);
  });
  return { container, root };
}

function unmount(container: HTMLElement, root: Root): void {
  root.unmount();
  container.remove();
}

describe('diff view (P-052)', () => {
  it('renders diff', async () => {
    // Unified view: changed, added, and removed lines all render, with
    // +/- markers in the gutter (summary bar hidden, so bare +/- can only
    // come from markers — the fixture itself contains neither).
    const { container, root } = await renderDiffView(
      <DiffView oldValue={OLD_TEXT} newValue={NEW_TEXT} />
    );
    try {
      const text = container.textContent ?? '';
      expect(text).toContain('line one');
      expect(text).toContain('line TWO');
      expect(text).toContain('line two');
      expect(text).toContain('line four');
      expect(text).toContain('+');
      expect(text).toContain('-');
    } finally {
      unmount(container, root);
    }
  });

  it('renders split view', async () => {
    const { container, root } = await renderDiffView(
      <DiffView oldValue={OLD_TEXT} newValue={NEW_TEXT} splitView />
    );
    try {
      const text = container.textContent ?? '';
      expect(text).toContain('line TWO');
      expect(text).toContain('line four');
      expect(text).toContain('Before');
      expect(text).toContain('After');
    } finally {
      unmount(container, root);
    }
  });
});
