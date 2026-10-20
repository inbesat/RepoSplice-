// P-224 — HistoryPage tests. Jobs + WS mocked: fetch is stubbed, the live
// feed is injected via the `feed` prop (no WsClient machinery here — P-223
// tested the transport itself).

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JobSummary } from '../api/jobs.js';
import { HistoryPage, type JobFeed } from './HistoryPage.js';

const J1: JobSummary = {
  id: 'j1',
  kind: 'merge',
  status: 'succeeded',
  started: '2026-10-20T10:00:00Z',
  finished: '2026-10-20T10:01:30Z',
  durationMs: 90_000,
  result: '12 files · 3 deps · 2 licenses',
};

const J2: JobSummary = {
  id: 'j2',
  kind: 'verify',
  status: 'running',
  started: '2026-10-20T11:00:00Z',
};

const J3: JobSummary = {
  id: 'j3',
  kind: 'merge',
  status: 'running',
  started: '2026-10-20T12:00:00Z',
};

let list: JobSummary[];

function jsonOk(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response;
}

function jsonFail(status: number, message: string): Response {
  return { ok: false, status, json: async () => ({ message }) } as Response;
}

const fetchMock = vi.fn();

function mockDispatch(): void {
  fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/rerun')) {
      return jsonOk({
        id: 'j3-run',
        kind: 'merge',
        status: 'running',
        started: '2026-10-20T13:00:00Z',
      });
    }
    if (url === '/api/jobs') return jsonOk({ jobs: list });
    return jsonFail(500, 'jobs store unavailable');
  });
}

function renderPage(feed?: JobFeed): void {
  render(<HistoryPage {...(feed !== undefined ? { feed } : {})} />);
}

beforeEach(() => {
  list = [J1, J2];
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  mockDispatch();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('HistoryPage', () => {
  it('renders history', async () => {
    renderPage();
    await screen.findByText('j1');
    expect(screen.getByText('j2')).toBeDefined();
    expect(screen.getByText('1m 30s')).toBeDefined();
    // expand-to-detail with result + links
    fireEvent.click(screen.getByRole('button', { name: 'toggle j1' }));
    const detail = await screen.findByTestId('detail-j1');
    expect(detail.textContent).toContain('12 files · 3 deps · 2 licenses');
    expect(detail.querySelector('a[href="/review"]')).not.toBeNull();
    // a running row has no detail links until a result lands
    fireEvent.click(screen.getByRole('button', { name: 'toggle j2' }));
    const detail2 = screen.getByTestId('detail-j2');
    expect(detail2.textContent).toContain('No result summary yet.');
    expect(detail2.querySelector('a')).toBeNull();
  });

  it('live ws update', async () => {
    let handler: ((job: JobSummary) => void) | undefined;
    const feed: JobFeed = h => {
      handler = h;
      return () => undefined;
    };
    list = [J1];
    renderPage(feed);
    await screen.findByText('j1');
    // a brand-new running job is prepended…
    act(() => {
      handler?.(J3);
    });
    await screen.findByText('j3');
    const rows = document.querySelectorAll('[data-testid^="job-"]');
    expect(rows[0]?.getAttribute('data-testid')).toBe('job-j3');
    // …then patched in place when it finishes
    act(() => {
      handler?.({ ...J3, status: 'succeeded', durationMs: 2_500, result: '7 files' });
    });
    const row = await screen.findByTestId('job-j3');
    expect(row.querySelector('[data-status]')?.getAttribute('data-status')).toBe('succeeded');
    expect(row.textContent).toContain('2.5s');
  });

  it('filters', async () => {
    renderPage();
    await screen.findByText('j1');
    expect(screen.getByText('j2')).toBeDefined();
    fireEvent.change(screen.getByLabelText('filter kind'), { target: { value: 'verify' } });
    expect(screen.queryByText('j1')).toBeNull();
    expect(screen.getByText('j2')).toBeDefined();
    fireEvent.change(screen.getByLabelText('filter kind'), { target: { value: 'all' } });
    fireEvent.change(screen.getByLabelText('filter status'), { target: { value: 'succeeded' } });
    expect(screen.getByText('j1')).toBeDefined();
    expect(screen.queryByText('j2')).toBeNull();
  });

  it('rerun', async () => {
    list = [J2];
    renderPage();
    await screen.findByText('j2');
    fireEvent.click(screen.getByRole('button', { name: 'rerun j2' }));
    await screen.findByText('j3-run');
    const call = fetchMock.mock.calls.find(c => String(c[0]).includes('/rerun'));
    expect(call).toBeDefined();
    expect((call?.[1] as RequestInit).method).toBe('POST');
    expect(JSON.parse(String((call?.[1] as RequestInit).body))).toEqual({ jobId: 'j2' });
  });

  it('empty error', async () => {
    list = [];
    renderPage();
    await screen.findByText('No jobs yet.');
    cleanup();
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => jsonFail(500, 'jobs store unavailable'));
    renderPage();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('jobs store unavailable');
    // the empty-state line must not coexist with an error
    expect(screen.queryByText('No jobs yet.')).toBeNull();
  });
});
