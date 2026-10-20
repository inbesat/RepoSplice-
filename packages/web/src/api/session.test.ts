// P-230 — api/session tests: export, import, warnings, version coercion.
// Plain fetch mocks (no render) — client contracts per ADR-115; the bundle
// shape is the single shared schema between export and import.

import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  applyBundle,
  coerceBundle,
  exportSession,
  importSession,
  type SessionBundle,
} from './session.js';
import { useSourcesStore } from '../store/selection.js';

const mockFetch = vi.fn();
const OK = (body: unknown) => ({ ok: true, json: async () => body });

const BUNDLE: SessionBundle = {
  version: 1,
  exportedAt: '2026-10-20T00:00:00.000Z',
  sources: {
    A: [{ id: 'r1', kind: 'local', path: '/tmp/rA', status: 'ready' }],
    B: [],
  },
  selection: { A: ['a.ts'], B: [] },
  resolutions: {},
  licenseDecisions: {},
};

beforeEach(() => {
  useSourcesStore.getState().reset();
  mockFetch.mockReset();
  vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

it('exports bundle', async () => {
  mockFetch.mockResolvedValue(OK(BUNDLE));
  const bundle = await exportSession();
  expect(bundle).toEqual(BUNDLE);
  expect(mockFetch.mock.calls[0]?.[0]).toBe('/api/session/export');
});

it('imports valid', async () => {
  mockFetch.mockResolvedValue(OK({ warnings: [] }));
  const result = await importSession(BUNDLE);
  expect(result).toEqual({ warnings: [] });
  const call = mockFetch.mock.calls[0] as unknown as [string, RequestInit];
  expect(call[0]).toBe('/api/session/import');
  expect(call[1].method).toBe('POST');
  expect(call[1].body).toBe(JSON.stringify(BUNDLE));
});

it('warns ref mismatch', async () => {
  mockFetch.mockResolvedValue(OK({ warnings: ['ref main no longer resolves on r1'] }));
  const result = await importSession(BUNDLE);
  expect(result.warnings).toEqual(['ref main no longer resolves on r1']);
});

it('coerces version', () => {
  const bundle = coerceBundle({
    sources: { A: [{ id: 'r1', kind: 'local', path: '/tmp/rA', status: 'ready' }] },
    selection: { A: ['a.ts'] },
  });
  expect(bundle.version).toBe(1);
  expect(typeof bundle.exportedAt).toBe('string');
  expect(bundle.sources.B).toEqual([]);
  expect(bundle.selection.B).toEqual([]);
  expect(bundle.resolutions).toEqual({});
  expect(bundle.licenseDecisions).toEqual({});
  expect(() => coerceBundle({ version: 2 })).toThrow('unsupported session bundle version: 2');
});

it('import populates the stores', async () => {
  mockFetch.mockResolvedValue(OK({ warnings: [] }));
  await importSession(BUNDLE);
  applyBundle(BUNDLE);
  const state = useSourcesStore.getState();
  expect(state.sourcesA[0]?.id).toBe('r1');
  expect(state.selectionA).toEqual(['a.ts']);
});
