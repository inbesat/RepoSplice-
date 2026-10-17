// P-220 — LicensePanel: report render, unknown decisions POST + update,
// locked hard denies, verdict banner, and the approve-gate emission to
// useLicensesStore (P-218 consumes `blockers`). Fetch is mocked; the
// /api/licenses/* endpoints are client contracts until P-192/P-128 land.

import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LicenseReportData } from '../api/licenses.js';
import { useLicensesStore } from '../store/licenses.js';
import { LicensePanel } from './LicensePanel.js';

const REPORT: LicenseReportData = {
  reportVersion: 1,
  generatedAt: '2026-10-18T00:00:00.000Z',
  verdict: 'deny',
  blocking: true,
  rows: [
    {
      package: 'binutils',
      version: '2.42',
      declared: 'GPL-3.0',
      normalized: 'GPL-3.0-only',
      category: 'strong-copyleft',
      decision: 'deny',
      reason: 'target license excludes strong copyleft',
    },
    {
      package: 'lodash',
      version: '4.17.21',
      declared: 'MIT',
      normalized: 'MIT',
      category: 'permissive',
      decision: 'allow',
    },
  ],
  summary: { total: 2, allow: 1, review: 0, deny: 1, unknown: 1, gplWarnings: 1 },
  dualLicenses: [
    {
      expression: 'MIT OR Apache-2.0',
      recommended: 'MIT',
      alternatives: ['Apache-2.0'],
      allCompliant: true,
      reasons: ['both candidates compliant with target'],
    },
  ],
  gplWarnings: [
    {
      package: 'inquirer',
      version: '9.0.0',
      license: 'GPL-3.0',
      category: 'strong-copyleft',
      severity: 'warning',
      suggestion: 'replace or pin an MIT-licensed fork',
    },
  ],
  unknown: [
    {
      package: 'left-pad',
      version: '1.3.0',
      rawLicense: 'LicenseRef-Mystery',
      path: 'packages/left-pad/package.json',
      decision: 'pending',
    },
  ],
};

const fetchMock = vi.fn();

function mockDispatch(): void {
  fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/licenses/decide')) {
      return { ok: true, json: async () => ({}) };
    }
    return { ok: true, json: async () => REPORT };
  });
}

async function panel(): Promise<void> {
  render(<LicensePanel />);
  await screen.findByText(/binutils/);
}

beforeEach(() => {
  useLicensesStore.getState().reset();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  mockDispatch();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('LicensePanel', () => {
  it('renders report', async () => {
    await panel();
    expect(screen.getByTestId('license-counts').textContent).toContain(
      '2 packages · 1 allow · 0 review · 1 deny · 1 unknown · 1 GPL warnings'
    );
    // package table: declared -> normalized -> category -> decision
    const row = screen.getByTestId('license-binutils');
    expect(row.textContent).toContain('GPL-3.0');
    expect(row.textContent).toContain('GPL-3.0-only');
    expect(row.textContent).toContain('strong-copyleft');
    // GPL warnings + dual options + pending unknowns sections
    expect(screen.getByLabelText('gpl warnings').textContent).toContain('replace or pin');
    expect(screen.getByLabelText('dual licenses').textContent).toContain('MIT OR Apache-2.0');
    expect(screen.getByLabelText('pending unknowns').textContent).toContain('LicenseRef-Mystery');
  });

  it('decides unknown', async () => {
    await panel();
    fireEvent.click(screen.getByRole('button', { name: 'allow left-pad@1.3.0' }));
    const row = await vi.waitFor(() => {
      const el = screen.getByTestId('unknown-left-pad@1.3.0');
      if (el.getAttribute('data-decision') !== 'allow') throw new Error('not decided yet');
      return el;
    });
    expect(row.textContent).toContain('decided: allow');
    const post = fetchMock.mock.calls.find(c => String(c[0]).includes('/api/licenses/decide'));
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({
      licenseId: 'left-pad@1.3.0',
      verdict: 'allow',
    });
  });

  it('locks hard deny', async () => {
    await panel();
    const row = screen.getByTestId('license-binutils');
    expect(row.getAttribute('data-decision')).toBe('deny');
    expect(row.textContent).toContain('locked: hard matrix deny cannot be allowed');
    // no allow control exists for matrix rows — only unknowns have buttons
    expect(screen.queryByRole('button', { name: /allow binutils/ })).toBeNull();
  });

  it('verdict banner', async () => {
    await panel();
    const verdict = screen.getByTestId('license-verdict');
    expect(verdict.textContent).toContain('Verdict: deny');
    expect(verdict.className).toContain('text-danger');
  });

  it('gates approve', async () => {
    await panel();
    // deny row + pending unknown both block
    const blocked = useLicensesStore.getState();
    expect(blocked.clear).toBe(false);
    expect(blocked.blockers).toHaveLength(2);
    // deciding the unknown (through the UI) leaves only the hard deny outstanding
    fireEvent.click(screen.getByRole('button', { name: 'deny left-pad@1.3.0' }));
    await vi.waitFor(() => {
      expect(useLicensesStore.getState().blockers).toEqual([
        'hard matrix deny: binutils — GPL-3.0-only cannot be allowed',
      ]);
      expect(useLicensesStore.getState().clear).toBe(false);
    });
  });
});

describe('LicensePanel plumbing', () => {
  it('surfaces a failed report fetch inline', async () => {
    fetchMock.mockImplementation(async () => ({
      ok: false,
      status: 500,
      json: async () => ({ message: 'license scan failed' }),
    }));
    render(<LicensePanel />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('license scan failed');
  });
});
