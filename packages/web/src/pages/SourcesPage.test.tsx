// P-211 — the Sources screen (repo A picker) tests.
//
// The six required scenarios from the phase spec (fetch mocked throughout):
//
//   it('renders sources')      it('validates owner repo')   it('adds from url')
//   it('adds local path')      it('advances on success')    it('surfaces error')

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { AppShellRoutes } from '../router.js';
import { useSourcesStore } from '../store/sources.js';
import { useFlowStore } from '../store/flow.js';

type FetchMock = ReturnType<typeof vi.fn>;

function mockFetch(handler: (url: string, init?: RequestInit) => unknown): FetchMock {
  const urlOf = (input: RequestInfo | URL): string =>
    typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  const spy = vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<unknown> => {
    const body = handler(urlOf(input), init);
    if (body instanceof Error) return Promise.reject(body);
    return Promise.resolve(body);
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}

const OK = (body: unknown): Response =>
  ({ ok: true, status: 200, json: async () => body }) as unknown as Response;
const FAIL = (status: number, message: string): Response =>
  ({
    ok: false,
    status,
    statusText: 'Bad Request',
    json: async () => ({ message }),
  }) as unknown as Response;

const RECORD = {
  id: 'src-1',
  kind: 'github',
  repo: 'vercel/ai',
  ref: 'main',
  status: 'ready',
} as const;

function page(): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={['/sources']}>
      <AppShellRoutes />
    </MemoryRouter>
  );
}

/** Fill the GitHub form and its optional ref, then submit. */
async function submitGithub(ownerRepo: string, ref = ''): Promise<void> {
  fireEvent.change(screen.getByPlaceholderText('vercel/ai'), { target: { value: ownerRepo } });
  if (ref !== '') {
    fireEvent.change(screen.getByPlaceholderText('main'), { target: { value: ref } });
  }
  fireEvent.click(screen.getByRole('button', { name: /Add source/ }));
}

describe('P-211 repo A picker', () => {
  beforeEach(() => {
    useSourcesStore.getState().reset();
    useFlowStore.getState().reset();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('renders sources', async () => {
    // The API's known sources merge into the list; the store's own (empty
    // here) would render identically.
    const fetchMock = mockFetch(url =>
      url.includes('/api/repos/sources') ? OK({ sources: [RECORD] }) : FAIL(404, 'unexpected')
    );
    page();
    expect(await screen.findByText('vercel/ai@main')).toBeTruthy();
    expect(screen.getByLabelText('repo A picker')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalled();
  });

  it('validates owner repo', () => {
    mockFetch(() => FAIL(500, 'must not be called'));
    page();
    fireEvent.change(screen.getByPlaceholderText('vercel/ai'), { target: { value: 'no-slash' } });
    fireEvent.click(screen.getByRole('button', { name: /Add source/ }));
    // The validation note shows and NO fetch POST fired (the store-list GET is fine).
    expect(screen.getByRole('note').textContent).toContain('owner/repo');
    const posts = vi
      .mocked(fetch)
      .mock.calls.filter(call => (call[1] as RequestInit | undefined)?.method === 'POST');
    expect(posts).toHaveLength(0);
  });

  it('adds from url', async () => {
    mockFetch(url =>
      url.includes('/api/repos/sources') ? OK({ sources: [] }) : OK({ ...RECORD, ref: 'v2' })
    );
    page();
    await screen.findByText('No sources yet', { exact: false });
    await submitGithub('vercel/ai', 'v2');
    // The submit chain is async: wait for its observable effect (the router
    // lands on Select), THEN the record is in the A-slot store.
    await screen.findByRole('heading', { level: 2, name: 'Select' });
    expect(useSourcesStore.getState().sourcesA).toEqual([
      { id: 'src-1', kind: 'github', repo: 'vercel/ai', ref: 'v2', status: 'ready' },
    ]);
    const post = vi
      .mocked(fetch)
      .mock.calls.find(call => String(call[0]).includes('/api/repos/from-url'));
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({ ownerRepo: 'vercel/ai', ref: 'v2' });
  });

  it('adds local path', async () => {
    mockFetch(url =>
      url.includes('/api/repos/sources')
        ? OK({ sources: [] })
        : OK({
            ...RECORD,
            id: 'src-2',
            kind: 'local',
            path: 'repos/a',
            repo: undefined,
            ref: undefined,
          })
    );
    page();
    await screen.findByText('No sources yet', { exact: false });
    fireEvent.click(screen.getByRole('tab', { name: 'Local path' }));
    fireEvent.change(screen.getByPlaceholderText('repos/team-a'), { target: { value: 'repos/a' } });
    fireEvent.click(screen.getByRole('button', { name: /Add source/ }));
    expect(await screen.findByText('repos/a')).toBeTruthy();
    expect(useSourcesStore.getState().sourcesA[0]?.kind).toBe('local');
    const post = vi
      .mocked(fetch)
      .mock.calls.find(call => String(call[0]).includes('/api/repos/local'));
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({ path: 'repos/a' });
  });

  it('advances on success', async () => {
    mockFetch(url => (url.includes('/api/repos/sources') ? OK({ sources: [] }) : OK(RECORD)));
    page();
    await screen.findByText('No sources yet', { exact: false });
    await submitGithub('vercel/ai');
    // The stepper's next step is the observable "advance": the router lands
    // on Select, and the flow store marks it visited (the P-210 effect).
    expect(await screen.findByRole('heading', { level: 2, name: 'Select' })).toBeTruthy();
    // MemoryRouter owns the location — window.location is NOT the router's,
    // so the advance is asserted through the rendered page + the flow store.
    expect(useFlowStore.getState().visited).toContain('select');
  });

  it('surfaces error', async () => {
    mockFetch(url =>
      url.includes('/api/repos/sources') ? OK({ sources: [] }) : FAIL(404, 'repository not found')
    );
    page();
    await screen.findByText('No sources yet', { exact: false });
    await submitGithub('ghost/nope');
    // The server's message is surfaced in the alert region, and the page
    // stays put (no navigation, no crash).
    expect(await screen.findByRole('alert').then(node => node.textContent)).toContain(
      'repository not found'
    );
    expect(useSourcesStore.getState().sourcesA).toHaveLength(0);
    expect(screen.getByRole('heading', { level: 2, name: 'Repo A' })).toBeTruthy();
  });
});
