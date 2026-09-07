import { describe, it, expect } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { JSX } from 'react';
import { Highlight } from './Highlight.js';

/** Poll innerHTML until `fragment` appears (bounded; local work settles fast). */
async function waitForMarkup(container: HTMLElement, fragment: string): Promise<void> {
  for (let i = 0; i < 40; i++) {
    if (container.innerHTML.includes(fragment)) return;
    await new Promise(r => setTimeout(r, 50));
  }
}

async function renderHighlight(ui: JSX.Element): Promise<{ container: HTMLElement; root: Root }> {
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

describe('highlight (P-053 shiki)', () => {
  // Explicit 20s budget on every test: the first highlight in this file
  // pays shiki's one-time WASM compile (~0.4s standalone), which under
  // parallel jsdom load can exceed vitest's 5s default (P-055 gate flake).
  // Poll loops stay capped at 2s each.
  it('highlights code', async () => {
    const { container, root } = await renderHighlight(
      <Highlight code="const x: number = 1;" lang="typescript" />
    );
    try {
      await waitForMarkup(container, 'class="shiki');
      const html = container.innerHTML;
      expect(html).toContain('<pre');
      expect(html).toContain('background-color:#fff');
      expect(html).toContain('<span style=');
      expect(html).toContain('const');
    } finally {
      unmount(container, root);
    }
  }, 20000);

  it('highlights with the dark theme', async () => {
    const { container, root } = await renderHighlight(
      <Highlight code="const x: number = 1;" lang="typescript" dark />
    );
    try {
      await waitForMarkup(container, 'background-color:#24292e');
      expect(container.innerHTML).toContain('<span style=');
    } finally {
      unmount(container, root);
    }
  }, 20000);

  it('falls back to plain text for unknown languages', async () => {
    const { container, root } = await renderHighlight(
      <Highlight code="plain <b>text</b>" lang="not-a-lang-xyz" />
    );
    try {
      // The fallback renders immediately as text (angle brackets intact as
      // TEXT, never markup)...
      expect(container.textContent).toContain('plain <b>text</b>');
      // ...and stays put: give the doomed highlight a beat to (not) swap in.
      await new Promise(r => setTimeout(r, 500));
      expect(container.innerHTML).toContain('<pre>');
      expect(container.innerHTML).not.toContain('shiki');
    } finally {
      unmount(container, root);
    }
  }, 20000);

  it('escapes markup in highlighted output', async () => {
    // shiki encodes `<` as `&#x3C;` (probed P-053): raw angle brackets
    // never reach the innerHTML sink.
    const { container, root } = await renderHighlight(
      <Highlight code="<script>alert(1)</script>" lang="typescript" />
    );
    try {
      await waitForMarkup(container, '&#x3C;');
      expect(container.innerHTML).not.toContain('<script>alert');
    } finally {
      unmount(container, root);
    }
  }, 20000);
});
