// P-225 — SettingsPage tests. Fetch is mocked; the GET /api/settings payload
// intentionally carries a fake key value which must NEVER render (masks test).

import { fireEvent, render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsPage } from './SettingsPage.js';

const SECRET = 'sk-secret-value-123';

const OK_BODY = {
  openrouter: { defaultModel: 'openrouter/anthropic/claude-3.5-sonnet', apiKey: SECRET },
  agent: { maxTokens: 1234 },
  ai: { stream: false },
  appearance: { theme: 'light' },
  licensePolicy: { allow: ['MIT'], warn: [], deny: ['GPL-3.0-only'] },
  sandbox: { limits: { timeout: 600, memory: '2g' } },
  network: { offline: false },
  keys: { openrouter: true, anthropic: false },
};

const fetchMock = vi.fn();

function jsonOk(body: unknown): { ok: true; status: number; json: () => Promise<unknown> } {
  return { ok: true, status: 200, json: async () => body };
}

function mockDispatch(): void {
  fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url === '/api/settings' && method === 'PATCH') return Promise.resolve(jsonOk({}));
    if (url === '/api/settings') return Promise.resolve(jsonOk(OK_BODY));
    if (url === '/api/sandbox/capabilities') return Promise.resolve(jsonOk({ backend: 'docker' }));
    return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
  });
}

function renderPage(): void {
  render(
    <MemoryRouter initialEntries={['/settings']}>
      <Routes>
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/sources" element={<p>sources screen</p>} />
      </Routes>
    </MemoryRouter>
  );
}

function patchBodies(): unknown[] {
  return fetchMock.mock.calls
    .filter(
      ([input, init]) => String(input) === '/api/settings' && (init?.method ?? 'GET') === 'PATCH'
    )
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)) as unknown);
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  mockDispatch();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('SettingsPage', () => {
  it('loads sections', async () => {
    renderPage();
    expect(await screen.findByLabelText('ai settings')).toBeTruthy();
    expect(screen.getByLabelText('license settings')).toBeTruthy();
    expect(screen.getByLabelText('sandbox settings')).toBeTruthy();
    expect(screen.getByLabelText('appearance settings')).toBeTruthy();
    expect(screen.getByLabelText('network settings')).toBeTruthy();
    expect((screen.getByLabelText('provider') as HTMLSelectElement).value).toBe('openrouter');
    expect(screen.getByTestId('key-openrouter').textContent).toBe('openrouter key: set');
  });

  it('saves ai', async () => {
    renderPage();
    await screen.findByLabelText('ai settings');
    fireEvent.change(screen.getByLabelText('max tokens'), { target: { value: '4096' } });
    fireEvent.click(screen.getByTestId('save-ai'));
    await screen.findByTestId('saved-note');
    expect(patchBodies()).toContainEqual({
      openrouter: { defaultModel: 'openrouter/anthropic/claude-3.5-sonnet' },
      agent: { maxTokens: 4096 },
    });
  });

  it('edits license policy', async () => {
    renderPage();
    await screen.findByLabelText('license settings');
    const input = screen.getByLabelText('add allow');
    fireEvent.keyDown(input, { key: 'Enter' }); // empty — ignored
    fireEvent.change(input, { target: { value: 'Apache-2.0' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByText('Apache-2.0')).toBeTruthy();
    fireEvent.click(screen.getByTestId('save-licenses'));
    await screen.findByTestId('saved-note');
    expect(patchBodies()).toContainEqual({
      licensePolicy: { allow: ['MIT', 'Apache-2.0'], warn: [], deny: ['GPL-3.0-only'] },
    });
  });

  it('unsaved guard', async () => {
    renderPage();
    await screen.findByLabelText('ai settings');
    fireEvent.change(screen.getByLabelText('max tokens'), { target: { value: '8192' } });
    expect(screen.getByTestId('unsaved-note')).toBeTruthy();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    fireEvent.click(screen.getByText('back to sources'));
    expect(confirmSpy).toHaveBeenCalled();
    expect(screen.getByLabelText('ai settings')).toBeTruthy(); // stayed
    confirmSpy.mockReturnValue(true);
    fireEvent.click(screen.getByText('back to sources'));
    expect(await screen.findByText('sources screen')).toBeTruthy();
    confirmSpy.mockRestore();
  });

  it('validates', async () => {
    renderPage();
    await screen.findByLabelText('sandbox settings');
    fireEvent.change(screen.getByLabelText('timeout'), { target: { value: '-5' } });
    fireEvent.click(screen.getByTestId('save-sandbox'));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('timeout must be a positive integer');
    // no PATCH went out on a validation failure
    expect(patchBodies()).toHaveLength(0);
  });

  it('masks key status', async () => {
    renderPage();
    await screen.findByTestId('key-anthropic');
    expect(screen.getByTestId('key-anthropic').textContent).toBe('anthropic key: not set');
    // the secret value from the payload is NEVER rendered anywhere
    expect(screen.queryByText(SECRET)).toBeNull();
    expect(document.body.textContent?.includes(SECRET)).toBe(false);
  });
});
