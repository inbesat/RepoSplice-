// P-222 — CreditsPreview tests. All fetches mocked (client contract — the
// /api/provenance/* endpoints do not exist yet); state asserted through the
// provenance store where effects matter.

import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CreditsPreview } from './CreditsPreview.js';
import { useProvenanceStore } from '../store/provenance.js';

const CREDITS = {
  text: '# CREDITS\n\n## A\n\n- src/a.ts\n',
  groups: [
    { label: 'A', files: ['src/a.ts'] },
    { label: 'B', files: ['lib/b.ts'] },
  ],
};

const MAP = {
  'src/a.ts': { repo: 'A', commit: 'abcdef1234567890', author: 'Ann' },
  'lib/b.ts': { repo: 'B', commit: '1234567890abcdef', author: 'Bob' },
};

const SBOM = { format: 'cyclonedx', components: [{ name: 'a', version: '1.0.0' }] };

const fetchMock = vi.fn();

function mockDispatch(url: string): { ok: boolean; status?: number; json: () => Promise<unknown> } {
  if (url.includes('/api/provenance/credits')) return { ok: true, json: async () => CREDITS };
  if (url.includes('/api/provenance/map')) return { ok: true, json: async () => MAP };
  if (url.includes('/api/provenance/sbom')) return { ok: true, json: async () => SBOM };
  return { ok: false, status: 500, json: async () => ({ message: 'not found' }) };
}

async function showAttribution() {
  // The tablist renders only after all three fetches resolve.
  await screen.findByRole('tab', { name: 'CREDITS.md' });
  fireEvent.click(screen.getByRole('tab', { name: 'Per-file attribution' }));
}

beforeEach(() => {
  useProvenanceStore.getState().reset();
  fetchMock.mockReset();
  fetchMock.mockImplementation((input: unknown) => {
    const url = String(input instanceof Request ? input.url : input);
    return Promise.resolve(mockDispatch(url));
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('CreditsPreview', () => {
  it('renders groups', async () => {
    render(<CreditsPreview />);
    await showAttribution();
    expect(await screen.findByText('src/a.ts')).toBeTruthy();
    expect(screen.getByTestId('origin-src/a.ts').textContent).toContain('abcdef1');
    expect(screen.getByTestId('origin-src/a.ts').textContent).toContain('Ann');
    expect(screen.getByTestId('origin-lib/b.ts').textContent).toContain('Bob');
    expect(screen.getByLabelText('group A').textContent).toContain('(1)');
    expect(screen.getByLabelText('group B').textContent).toContain('(1)');
  });

  it('filters', async () => {
    render(<CreditsPreview />);
    await showAttribution();
    await screen.findByText('src/a.ts');
    fireEvent.change(screen.getByLabelText('filter files'), { target: { value: 'lib' } });
    expect(screen.queryByTestId('origin-src/a.ts')).toBeNull();
    expect(screen.getByTestId('origin-lib/b.ts')).toBeTruthy();
  });

  it('copies credits', async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<CreditsPreview />);
    fireEvent.click(await screen.findByRole('button', { name: 'Copy CREDITS' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(CREDITS.text));
    expect(screen.getByRole('button', { name: 'Copy CREDITS' }).textContent).toContain('Copied');
  });

  it('sbom view', async () => {
    render(<CreditsPreview />);
    await screen.findByRole('tab', { name: 'CREDITS.md' });
    fireEvent.click(screen.getByRole('tab', { name: 'SBOM' }));
    const view = await screen.findByTestId('sbom-view');
    expect(view.textContent).toContain('"cyclonedx"');
    expect(view.textContent).toContain('"components"');
  });

  it('confirmation flag', async () => {
    render(<CreditsPreview />);
    const box = await screen.findByLabelText('attribution looks correct');
    expect(useProvenanceStore.getState().creditsConfirmed).toBe(false);
    fireEvent.click(box);
    await waitFor(() => expect(useProvenanceStore.getState().creditsConfirmed).toBe(true));
    fireEvent.click(box);
    await waitFor(() => expect(useProvenanceStore.getState().creditsConfirmed).toBe(false));
  });
});
