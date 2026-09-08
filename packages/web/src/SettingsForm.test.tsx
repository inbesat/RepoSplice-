import { describe, it, expect } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { SettingsForm, type SettingsFormValues } from './SettingsForm.js';

async function renderForm(
  onSubmit: (values: SettingsFormValues) => void
): Promise<{ container: HTMLElement; root: Root }> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<SettingsForm onSubmit={onSubmit} />);
  });
  return { container, root };
}

function unmount(container: HTMLElement, root: Root): void {
  root.unmount();
  container.remove();
}

/** Bounded poll: RHF validation + React state settle asynchronously. */
async function waitForText(container: HTMLElement, text: string): Promise<void> {
  for (let i = 0; i < 40; i++) {
    if (container.textContent?.includes(text) === true) return;
    await new Promise(r => setTimeout(r, 50));
  }
}

function named<T extends Element>(container: HTMLElement, name: string): T | null {
  return container.querySelector<T>(`[name="${name}"]`);
}

/**
 * Drive React 19's delegated listeners without testing-library: set the DOM
 * property through the native setter (so React's value tracker notices) then
 * dispatch the bubbled native events React subscribes to.
 */
function setTextValue(el: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

function setSelectValue(el: HTMLSelectElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

function setChecked(el: HTMLInputElement, checked: boolean): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'checked')?.set;
  setter?.call(el, checked);
  el.dispatchEvent(new Event('click', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

async function submitForm(container: HTMLElement): Promise<void> {
  const form = container.querySelector('form');
  expect(form).not.toBeNull();
  await act(async () => {
    form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
}

describe('settings form (P-056 react-hook-form + zod)', () => {
  it('form registers', async () => {
    const seen: SettingsFormValues[] = [];
    const { container, root } = await renderForm(values => {
      seen.push(values);
    });
    try {
      // Mounting registers every scaffold field under its expected name.
      const provider = named<HTMLSelectElement>(container, 'provider');
      const model = named<HTMLInputElement>(container, 'model');
      const theme = named<HTMLSelectElement>(container, 'theme');
      const tokenBudget = named<HTMLInputElement>(container, 'tokenBudget');
      const offline = named<HTMLInputElement>(container, 'offline');
      expect(provider).not.toBeNull();
      expect(model).not.toBeNull();
      expect(theme).not.toBeNull();
      expect(tokenBudget).not.toBeNull();
      expect(offline).not.toBeNull();
      // Defaults land in the DOM: provider openrouter, budget 64000.
      expect(provider?.value).toBe('openrouter');
      expect(tokenBudget?.value).toBe('64000');

      await act(async () => {
        if (provider !== null) setSelectValue(provider, 'anthropic');
        if (model !== null) setTextValue(model, 'claude-sonnet-4-5');
        if (theme !== null) setSelectValue(theme, 'dark');
        if (tokenBudget !== null) setTextValue(tokenBudget, '32000');
        if (offline !== null) setChecked(offline, true);
      });
      await submitForm(container);

      // Valid data passes the zod resolver and reaches onSubmit verbatim.
      expect(seen).toHaveLength(1);
      expect(seen[0]).toEqual({
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
        theme: 'dark',
        tokenBudget: 32000,
        offline: true,
      });
      expect(container.querySelector('[role="alert"]')).toBeNull();
    } finally {
      unmount(container, root);
    }
  });

  it('zod rejects', async () => {
    let calls = 0;
    const { container, root } = await renderForm(() => {
      calls += 1;
    });
    try {
      const model = named<HTMLInputElement>(container, 'model');
      const tokenBudget = named<HTMLInputElement>(container, 'tokenBudget');
      expect(model).not.toBeNull();
      expect(tokenBudget).not.toBeNull();

      // model defaults to '' (min 1 fails); force the budget below min 1.
      await act(async () => {
        if (model !== null) setTextValue(model, '');
        if (tokenBudget !== null) setTextValue(tokenBudget, '0');
      });
      await submitForm(container);

      // The resolver blocks onSubmit and surfaces one alert per bad field.
      await waitForText(container, 'Model is required');
      expect(calls).toBe(0);
      expect(container.textContent?.includes('Model is required')).toBe(true);
      expect(container.textContent?.includes('Token budget must be at least 1')).toBe(true);
      expect(container.querySelectorAll('[role="alert"]')).toHaveLength(2);
    } finally {
      unmount(container, root);
    }
  });
});
