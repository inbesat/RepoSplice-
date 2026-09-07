import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { JSX } from 'react';
import axe from 'axe-core';
import { StitchDialog } from './Dialog.js';
import { StitchSelect } from './Select.js';
import { StitchTabs } from './Tabs.js';
import { StitchTooltip } from './Tooltip.js';
import { StitchDropdownMenu } from './DropdownMenu.js';
import { StitchScrollArea } from './ScrollArea.js';

// jsdom provides no ResizeObserver; Radix measures with it (falling back
// when measurement fails), so stub the constructor file-locally.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
}

// jsdom provides no Element.scrollIntoView; Radix Select calls it when the
// list opens (probed P-055: `candidate?.scrollIntoView is not a function`).
if (typeof Element.prototype.scrollIntoView === 'undefined') {
  Element.prototype.scrollIntoView = () => {};
}

/** Poll document body until `text` appears (bounded; Radix settles fast). */
async function waitForBodyText(text: string): Promise<void> {
  for (let i = 0; i < 40; i++) {
    if (document.body.textContent?.includes(text) === true) return;
    await new Promise(r => setTimeout(r, 50));
  }
}

/** Poll until `text` leaves the body (close paths), then assert absence. */
async function waitForBodyAbsent(text: string): Promise<void> {
  for (let i = 0; i < 40; i++) {
    if (document.body.textContent?.includes(text) !== true) return;
    await new Promise(r => setTimeout(r, 50));
  }
  expect(document.body.textContent?.includes(text) ?? false).toBe(false);
}

async function mount(ui: JSX.Element): Promise<{ container: HTMLElement; root: Root }> {
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

function keyDown(target: Element, key: string): void {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}

/** querySelector returns Element; interactions need HTMLElement. Fails loudly otherwise. */
function asHTMLElement(el: Element | null): HTMLElement | null {
  expect(el).toBeInstanceOf(HTMLElement);
  return el instanceof HTMLElement ? el : null;
}

describe('radix wrappers (P-055)', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('dialog', async () => {
    const onOpenChange = vi.fn();
    function Harness(): JSX.Element {
      const [open, setOpen] = useState(true);
      return (
        <StitchDialog
          open={open}
          onOpenChange={next => {
            setOpen(next);
            onOpenChange(next);
          }}
          title="Confirm merge"
          description="This stitches two repositories."
          closeLabel="Dismiss"
        >
          <p>dialog body</p>
        </StitchDialog>
      );
    }
    const { container, root } = await mount(<Harness />);
    try {
      await waitForBodyText('Confirm merge');
      expect(document.querySelector('[role="dialog"]')).not.toBeNull();
      expect(document.body.textContent).toContain('This stitches two repositories.');

      // Escape dismisses through Radix's dismiss layer.
      await act(async () => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      });
      expect(onOpenChange).toHaveBeenCalledWith(false);
      await waitForBodyAbsent('Confirm merge');
    } finally {
      unmount(container, root);
    }

    // Dismiss button path on a fresh mount.
    const onOpenChange2 = vi.fn();
    const second = await mount(
      <StitchDialog
        open
        onOpenChange={onOpenChange2}
        title="Second"
        description="Second dialog."
        closeLabel="Dismiss"
      />
    );
    try {
      await waitForBodyText('Second');
      const dismiss = document.querySelector('button[aria-label="Dismiss"]');
      expect(dismiss).not.toBeNull();
      await act(async () => {
        dismiss?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      expect(onOpenChange2).toHaveBeenCalledWith(false);
    } finally {
      unmount(second.container, second.root);
    }
  });

  it('select', async () => {
    const onValueChange = vi.fn();
    function Harness(): JSX.Element {
      const [value, setValue] = useState('');
      return (
        <StitchSelect
          label="Pick"
          placeholder="Choose"
          value={value}
          onValueChange={next => {
            setValue(next);
            onValueChange(next);
          }}
          options={[
            { value: 'a', label: 'Alpha' },
            { value: 'b', label: 'Bravo' },
          ]}
        />
      );
    }
    const { container, root } = await mount(<Harness />);
    try {
      expect(container.textContent).toContain('Choose');
      const trigger = container.querySelector('button[aria-label="Pick"]');
      expect(trigger).not.toBeNull();

      // Keyboard open (pointer events are unreliable in jsdom).
      const triggerEl = asHTMLElement(trigger);
      await act(async () => {
        triggerEl?.focus();
        if (triggerEl) keyDown(triggerEl, 'ArrowDown');
      });
      await waitForBodyText('Bravo');

      const items = [...document.querySelectorAll('[role="option"]')];
      const bravo = items.find(el => el.textContent === 'Bravo');
      expect(bravo).not.toBeNull();
      await act(async () => {
        (bravo as HTMLElement).click();
      });
      expect(onValueChange).toHaveBeenCalledWith('b');
      await waitForBodyText('Bravo');
      expect(container.textContent).toContain('Bravo');
    } finally {
      unmount(container, root);
    }
  });

  it('tabs', async () => {
    function Harness(): JSX.Element {
      const [value, setValue] = useState('a');
      return (
        <StitchTabs
          label="Wizard"
          value={value}
          onValueChange={setValue}
          tabs={[
            { value: 'a', label: 'Tab A', content: <p>Content A</p> },
            { value: 'b', label: 'Tab B', content: <p>Content B</p> },
          ]}
        />
      );
    }
    const { container, root } = await mount(<Harness />);
    try {
      expect(container.textContent).toContain('Content A');
      expect(container.textContent).not.toContain('Content B');
      const triggers = [...container.querySelectorAll('[role="tab"]')];
      const tabB = triggers.find(el => el.textContent === 'Tab B');
      expect(tabB).not.toBeNull();
      // Radix Tabs selects on mousedown (left button, no ctrl) — jsdom's
      // .click() never dispatches it (read the TabsTrigger source, P-055),
      // so mirror a genuine press: mousedown, then click.
      await act(async () => {
        (tabB as HTMLElement).dispatchEvent(
          new MouseEvent('mousedown', { button: 0, bubbles: true, cancelable: true })
        );
        (tabB as HTMLElement).click();
      });
      expect(container.textContent).toContain('Content B');
      expect(container.textContent).not.toContain('Content A');
    } finally {
      unmount(container, root);
    }
  });

  it('tooltip', async () => {
    const { container, root } = await mount(
      <StitchTooltip content="More info" delayDuration={0}>
        <button type="button">Hover me</button>
      </StitchTooltip>
    );
    try {
      const trigger = container.querySelector('button');
      const triggerEl = asHTMLElement(trigger);
      await act(async () => {
        triggerEl?.focus();
      });
      await waitForBodyText('More info');
    } finally {
      unmount(container, root);
    }

    // Omitted delayDuration selects the Radix default (700ms): slower but
    // working — this covers the pass-through branch and the production shape.
    const second = await mount(
      <StitchTooltip content="Slow info">
        <button type="button">Hover slow</button>
      </StitchTooltip>
    );
    try {
      const trigger2 = asHTMLElement(second.container.querySelector('button'));
      await act(async () => {
        trigger2?.focus();
      });
      await waitForBodyText('Slow info');
    } finally {
      unmount(second.container, second.root);
    }
  });

  it('dropdown opens and selects', async () => {
    const onSelect = vi.fn();
    const { container, root } = await mount(
      <StitchDropdownMenu
        triggerLabel="Actions"
        options={[
          { value: 'run', label: 'Run job' },
          { value: 'del', label: 'Delete' },
        ]}
        onSelect={onSelect}
      />
    );
    try {
      const trigger = container.querySelector('button[aria-label="Actions"]');
      expect(trigger).not.toBeNull();
      const triggerEl = asHTMLElement(trigger);
      await act(async () => {
        triggerEl?.focus();
        if (triggerEl) keyDown(triggerEl, 'Enter');
      });
      await waitForBodyText('Run job');

      const items = [...document.querySelectorAll('[role="menuitem"]')];
      const run = items.find(el => el.textContent === 'Run job');
      expect(run).not.toBeNull();
      await act(async () => {
        (run as HTMLElement).click();
      });
      expect(onSelect).toHaveBeenCalledWith('run');
      await waitForBodyAbsent('Run job');
    } finally {
      unmount(container, root);
    }
  });

  it('scroll area renders', async () => {
    const { container, root } = await mount(
      <StitchScrollArea>
        <p>tall content</p>
      </StitchScrollArea>
    );
    try {
      expect(container.textContent).toContain('tall content');
    } finally {
      unmount(container, root);
    }
  });

  it('a11y clean', async () => {
    const { container, root } = await mount(
      <>
        <StitchDialog
          open
          onOpenChange={() => {}}
          title="Audit dialog"
          description="Audited description."
          closeLabel="Dismiss"
        />
        <StitchTabs
          label="Audit tabs"
          value="a"
          onValueChange={() => {}}
          tabs={[{ value: 'a', label: 'Tab A', content: <p>Audited panel</p> }]}
        />
      </>
    );
    try {
      await waitForBodyText('Audit dialog');
      const results = await axe.run(document.body);
      expect(results.violations).toEqual([]);
    } finally {
      unmount(container, root);
    }
  });
});
