// P-219 — DepsPanel tests on a mocked /api/deps/report + /api/deps/resolve.
// The approve-gate assertions run against useDepsStore (the flag ReviewPage
// reads); ReviewPage itself stays untouched except reading the store.

import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DependencyReport } from '../api/deps.js';
import { DepsPanel } from './DepsPanel.js';
import { useDepsStore } from '../store/deps.js';

const fetchMock = vi.fn();

function conflict(extra: {
  package: string;
  severity: 'error' | 'warning';
  status: 'auto-resolved' | 'needs-attention' | 'warning';
  suggestedResolution?: string;
  resolution?: string;
}): DependencyReport['conflicts'][number] {
  return {
    type: 'version',
    package: extra.package,
    values: { 'repo-a': '^1.0.0', 'repo-b': '^2.0.0' },
    ...(extra.suggestedResolution !== undefined
      ? { suggestedResolution: extra.suggestedResolution }
      : {}),
    severity: extra.severity,
    status: extra.status,
    ...(extra.resolution !== undefined ? { resolution: extra.resolution } : {}),
  };
}

function report(conflicts: DependencyReport['conflicts']): DependencyReport {
  return {
    generatedAt: '2026-10-17T00:00:00.000Z',
    ecosystem: 'npm',
    inputSources: [{ repoName: 'rA', manifestPath: 'package.json' }],
    merged: {},
    dependencyCount: { direct: 3, dev: 1, peer: 0, total: 4 },
    conflicts,
    dedupe: [],
    scripts: { merged: {}, collisions: [] },
    lockfile: { status: 'generated' },
    summary: {
      mergeable: conflicts.every(c => c.severity !== 'error'),
      needsHuman: false,
      blockedBy: [],
    },
  };
}

function mockDispatch(r: DependencyReport | Error): void {
  fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/deps/resolve')) {
      return { ok: true, json: async () => ({}) };
    }
    if (r instanceof Error) {
      return { ok: false, status: 500, json: async () => ({ message: r.message }) };
    }
    return { ok: true, json: async () => r };
  });
}

const BASE = report([
  conflict({
    package: 'lodash',
    severity: 'warning',
    status: 'needs-attention',
    suggestedResolution: '^4.17.21',
  }),
]);

beforeEach(() => {
  useDepsStore.getState().reset();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('DepsPanel', () => {
  it('renders conflicts', async () => {
    mockDispatch(BASE);
    render(<DepsPanel />);
    expect(await screen.findByText('Dependencies')).toBeTruthy();
    expect(screen.getByTestId('deps-counts').textContent).toContain('4 deps');
    expect(screen.getByTestId('conflict-lodash').textContent).toContain('lodash');
    expect(screen.getByTestId('conflict-lodash').textContent).toContain('repo-a: ^1.0.0');
    expect(screen.getByTestId('conflict-lodash').textContent).toContain('warning');
  });

  it('per row resolve', async () => {
    mockDispatch(BASE);
    render(<DepsPanel />);
    await screen.findByTestId('conflict-lodash');
    fireEvent.change(screen.getByLabelText('resolution-lodash'), {
      target: { value: '^4.17.21' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await screen.findByText(/resolved/);
    const resolveCall = fetchMock.mock.calls.find(c =>
      String(c[0]).includes('/api/deps/resolve')
    ) as [RequestInfo | URL, RequestInit?];
    expect(JSON.parse(String(resolveCall[1]?.body))).toEqual({
      package: 'lodash',
      resolution: '^4.17.21',
    });
  });

  it('resolve all', async () => {
    mockDispatch(
      report([
        conflict({
          package: 'a',
          severity: 'warning',
          status: 'needs-attention',
          suggestedResolution: '^2.0.0',
        }),
        conflict({
          package: 'b',
          severity: 'warning',
          status: 'needs-attention',
          suggestedResolution: '^3.0.0',
        }),
      ])
    );
    render(<DepsPanel />);
    await screen.findByTestId('conflict-a');
    fireEvent.click(screen.getByRole('button', { name: 'Resolve all' }));
    await screen.findByText(
      (_, el) =>
        el?.textContent === 'resolved ✓' &&
        el.tagName === 'SPAN' &&
        el.closest('[data-testid="conflict-b"]') !== null
    );
    const resolveCalls = fetchMock.mock.calls.filter(c =>
      String(c[0]).includes('/api/deps/resolve')
    );
    expect(resolveCalls).toHaveLength(2);
    const bodies = resolveCalls.map(c =>
      JSON.parse(String((c as [RequestInfo, RequestInit])[1]?.body))
    );
    expect(bodies).toEqual(
      expect.arrayContaining([
        { package: 'a', resolution: '^2.0.0' },
        { package: 'b', resolution: '^3.0.0' },
      ])
    );
    expect(useDepsStore.getState().resolved).toBe(true);
  });

  it('error blocks', async () => {
    mockDispatch(
      report([conflict({ package: 'left-pad', severity: 'error', status: 'needs-attention' })])
    );
    render(<DepsPanel />);
    await screen.findByTestId('conflict-left-pad');
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('need manual resolution');
    expect(useDepsStore.getState().resolved).toBe(false);
    expect(useDepsStore.getState().blockers).toEqual([
      'error-level conflict on left-pad needs a manual resolution',
    ]);
  });

  it('flags approve gate', async () => {
    mockDispatch(
      report([
        conflict({
          package: 'left-pad',
          severity: 'error',
          status: 'needs-attention',
          suggestedResolution: '^1.3.0',
        }),
      ])
    );
    render(<DepsPanel />);
    await screen.findByTestId('conflict-left-pad');
    expect(useDepsStore.getState().resolved).toBe(false);
    fireEvent.change(screen.getByLabelText('resolution-left-pad'), {
      target: { value: '^1.3.0' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await screen.findByText(
      (_, el) =>
        el?.textContent === 'resolved ✓' &&
        el.tagName === 'SPAN' &&
        el.closest('[data-testid="conflict-left-pad"]') !== null
    );
    expect(useDepsStore.getState().resolved).toBe(true);
    expect(useDepsStore.getState().blockers).toEqual([]);
  });
});
