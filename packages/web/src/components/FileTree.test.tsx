import { describe, it, expect } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { FileTree, type FileNode } from './FileTree.js';

const fixture: FileNode[] = [
  {
    id: 'src',
    name: 'src',
    children: [
      { id: 'src/a.ts', name: 'a.ts' },
      { id: 'src/b.ts', name: 'b.ts' },
      {
        id: 'src/nested',
        name: 'nested',
        children: [{ id: 'src/nested/c.ts', name: 'c.ts' }],
      },
    ],
  },
  { id: 'readme', name: 'README.md' },
];

async function renderTree(
  data: FileNode[],
  onSelectionChange: (ids: string[]) => void,
  height = 400
): Promise<{ container: HTMLElement; root: Root }> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<FileTree data={data} onSelectionChange={onSelectionChange} height={height} />);
  });
  return { container, root };
}

function unmount(container: HTMLElement, root: Root): void {
  root.unmount();
  container.remove();
}

/** Bounded poll: arborist redux updates + React rendering settle asynchronously. */
async function waitForText(container: HTMLElement, text: string): Promise<void> {
  for (let i = 0; i < 40; i++) {
    if (container.textContent?.includes(text) === true) return;
    await new Promise(r => setTimeout(r, 50));
  }
}

function checkbox(container: HTMLElement, name: string): HTMLInputElement | null {
  return container.querySelector<HTMLInputElement>(`input[aria-label="Select ${name}"]`);
}

async function toggle(container: HTMLElement, name: string): Promise<void> {
  const box = checkbox(container, name);
  expect(box).not.toBeNull();
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'checked'
    )?.set;
    setter?.call(box, box?.checked !== true);
    box?.dispatchEvent(new Event('click', { bubbles: true }));
    box?.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

describe('file tree (P-058 react-arborist)', () => {
  it('renders tree', async () => {
    const { container, root } = await renderTree(fixture, () => {});
    try {
      // Open by default: roots, children, and nested grandchildren all render.
      await waitForText(container, 'c.ts');
      expect(container.textContent?.includes('src')).toBe(true);
      expect(container.textContent?.includes('a.ts')).toBe(true);
      expect(container.textContent?.includes('README.md')).toBe(true);
      expect(container.textContent?.includes('c.ts')).toBe(true);

      // Collapsing a folder hides its descendants but keeps the folder row.
      const collapse = container.querySelector('button[aria-label="Collapse src"]');
      expect(collapse).not.toBeNull();
      await act(async () => {
        collapse?.dispatchEvent(new Event('click', { bubbles: true }));
      });
      await waitForText(container, '0 selected');
      expect(container.textContent?.includes('src')).toBe(true);
      expect(container.textContent?.includes('a.ts')).toBe(false);

      // Expanding brings the children back.
      const expand = container.querySelector('button[aria-label="Expand src"]');
      expect(expand).not.toBeNull();
      await act(async () => {
        expand?.dispatchEvent(new Event('click', { bubbles: true }));
      });
      await waitForText(container, 'a.ts');
      expect(container.textContent?.includes('a.ts')).toBe(true);
    } finally {
      unmount(container, root);
    }
  });

  it('selects', async () => {
    const seen: string[][] = [];
    const { container, root } = await renderTree(fixture, ids => {
      seen.push(ids);
    });
    try {
      await waitForText(container, 'c.ts');

      await toggle(container, 'a.ts');
      expect(seen[seen.length - 1]).toEqual(['src/a.ts']);
      await waitForText(container, '1 selected');

      // Checking a second box ADDS (selectMulti) instead of replacing.
      await toggle(container, 'b.ts');
      expect(seen[seen.length - 1]).toEqual(['src/a.ts', 'src/b.ts']);
      await waitForText(container, '2 selected');

      // Unchecking removes just that id.
      await toggle(container, 'a.ts');
      expect(seen[seen.length - 1]).toEqual(['src/b.ts']);
      await waitForText(container, '1 selected');
      expect(checkbox(container, 'a.ts')?.checked).toBe(false);
      expect(checkbox(container, 'b.ts')?.checked).toBe(true);
    } finally {
      unmount(container, root);
    }
  });

  it('virtualizes', async () => {
    const big: FileNode[] = Array.from({ length: 5000 }, (_, i) => ({
      id: `file-${i}`,
      name: `file-${i}.ts`,
    }));
    const seen: string[][] = [];
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    try {
      await act(async () => {
        root.render(<FileTree data={big} onSelectionChange={ids => seen.push(ids)} height={300} />);
      });
      await waitForText(container, 'file-0.ts');
      const rows = container.querySelectorAll('[data-file-row]');
      // A 300px window over 5000 x 30px rows renders a small slice, not all.
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.length).toBeLessThan(100);
      expect(container.querySelector('[data-file-row="file-4999"]')).toBeNull();
    } finally {
      unmount(container, root);
    }
  });
});
