// P-211/P-212 — the Sources screen tests.
//
// P-211's six mandated scenarios, now over the TWO-picker layout (P-212):
// every locator is scoped to its picker region (`repo A picker` / `repo B
// picker`) because both slots render identical markup. 'advances on success'
// now means the FULL two-slot flow: A alone does not advance (the merge needs
// both — the P-212 gate); B completing flips `canProceed` and the page
// navigates.
//
//   it('renders sources')      it('validates owner repo')   it('adds from url')
//   it('adds local path')      it('advances on success')    it('surfaces error')

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { AppShellRoutes } from '../router.js';
import { useSourcesStore } from '../store/sources.js';
import { useFlowStore } from '../store/flow.js';

type FetchMock = ReturnType<typeof vi.fn>;
type PickerRegion = ReturnType<typeof within>;

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

/** A picker's region — all per-slot locators go through this. */
function picker(slot: 'A' | 'B'): PickerRegion {
  return within(screen.getByLabelText(`repo ${slot} picker`));
}

/** Fill the GitHub form and its optional ref, then submit. */
async function submitGithub(ownerRepo: string, ref = '', slot: 'A' | 'B' = 'A'): Promise<void> {
  const region = picker(slot);
  fireEvent.change(region.getByPlaceholderText('vercel/ai'), { target: { value: ownerRepo } });
  if (ref !== '') {
    fireEvent.change(region.getByPlaceholderText('main'), { target: { value: ref } });
  }
  fireEvent.click(region.getByRole('button', { name: /Add source/ }));
}

/** Fill the local-path form and submit. */
function submitLocal(path: string, slot: 'A' | 'B' = 'A'): void {
  const region = picker(slot);
  fireEvent.click(region.getByRole('tab', { name: 'Local path' }));
  fireEvent.change(region.getByPlaceholderText('repos/team-a'), { target: { value: path } });
  fireEvent.click(region.getByRole('button', { name: /Add source/ }));
}

describe('P-211/P-212 repo pickers', () => {
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
    // here) would render identically. Both pickers show the known catalog;
    // the store slots stay EMPTY until a source is added to that slot.
    const fetchMock = mockFetch(url =>
      url.includes('/api/repos/sources') ? OK({ sources: [RECORD] }) : FAIL(404, 'unexpected')
    );
    page();
    expect(await picker('A').findByText('vercel/ai@main')).toBeTruthy();
    expect(screen.getByLabelText('repo B picker')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalled();
    // The P-212 gate: known-but-not-added sources do NOT advance the flow.
    expect(useSourcesStore.getState().sourcesA).toHaveLength(0);
  });

  it('validates owner repo', () => {
    mockFetch(() => FAIL(500, 'must not be called'));
    page();
    fireEvent.change(picker('A').getByPlaceholderText('vercel/ai'), {
      target: { value: 'no-slash' },
    });
    fireEvent.click(picker('A').getByRole('button', { name: /Add source/ }));
    // The validation note shows (scoped to the A region) and NO fetch POST
    // fired (the store-list GET is fine).
    expect(picker('A').getByRole('note').textContent).toContain('owner/repo');
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
    picker('A').getByText('No sources yet', { exact: false });
    await submitGithub('vercel/ai', 'v2');
    // The record lands after the async POST chain — the rendered row is the
    // waitable effect.
    await picker('A').findByText('vercel/ai@v2');
    // The record is in the A-slot store (the page does NOT advance — B is
    // still empty, the P-212 gate).
    expect(useSourcesStore.getState().sourcesA).toEqual([
      { id: 'src-1', kind: 'github', repo: 'vercel/ai', ref: 'v2', status: 'ready' },
    ]);
    expect(screen.queryByRole('heading', { level: 2, name: 'Select' })).toBeNull();
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
    picker('A').getByText('No sources yet', { exact: false });
    submitLocal('repos/a');
    expect(await picker('A').findByText('repos/a')).toBeTruthy();
    expect(useSourcesStore.getState().sourcesA[0]?.kind).toBe('local');
    const post = vi
      .mocked(fetch)
      .mock.calls.find(call => String(call[0]).includes('/api/repos/local'));
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({ path: 'repos/a' });
  });

  it('advances on success', async () => {
    mockFetch(url => (url.includes('/api/repos/sources') ? OK({ sources: [] }) : OK(RECORD)));
    page();
    picker('A').getByText('No sources yet', { exact: false });

    // A resolves: the store holds it, and the page STAYS (B is still empty —
    // the merge flow needs both; this is the P-212 gate made observable).
    await submitGithub('vercel/ai');
    await picker('A').findByText('vercel/ai@main');
    expect(useSourcesStore.getState().sourcesA).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 2, name: 'Repo B' })).toBeTruthy();

    // B resolves: now BOTH slots hold a resolved source, and the page
    // advances to Select (the canProceed effect).
    await submitGithub('vercel/ai', 'main', 'B');
    // P-213 SUPERSEDED: the Select page now hosts repo A's file tree, so its
    // h2 is the per-source title, not the bare 'Select' placeholder. The 5s
    // timeout rides out suite-load lag (auto-advance is an async effect).
    expect(
      await screen.findByRole(
        'heading',
        { level: 2, name: 'Select files — repo A' },
        { timeout: 5000 }
      )
    ).toBeTruthy();
    // MemoryRouter owns the location — window.location is NOT the router's,
    // so the advance is asserted through the rendered page + the flow store.
    expect(useFlowStore.getState().visited).toContain('select');
    expect(useSourcesStore.getState().sourcesB).toHaveLength(1);
  });

  it('surfaces error', async () => {
    mockFetch(url =>
      url.includes('/api/repos/sources') ? OK({ sources: [] }) : FAIL(404, 'repository not found')
    );
    page();
    picker('A').getByText('No sources yet', { exact: false });
    await submitGithub('ghost/nope');
    // The server's message is surfaced in the alert region, and the page
    // stays put (no navigation, no crash).
    expect(await (await picker('A').findByRole('alert')).textContent).toContain(
      'repository not found'
    );
    expect(useSourcesStore.getState().sourcesA).toHaveLength(0);
    expect(screen.getByRole('heading', { level: 2, name: 'Repo A' })).toBeTruthy();
  });
});
