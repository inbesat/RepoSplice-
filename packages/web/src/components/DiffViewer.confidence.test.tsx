// P-352 — the mandated diff-viewer confidence integration test.
//
// The plan names `web/test_diff_viewer.tsx::test_confidence_integration`; the web vitest glob
// collects `src/**/*.test.tsx`, so the case lives here verbatim (the path mapping is in ADR-161).

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DiffViewer } from './DiffViewer.js';

const FILES = [
  {
    path: 'src/strong.ts',
    kind: 'modify',
    oldText: 'a\n',
    newText: 'b\n',
    confidence: { score: 77, flags: [], components: { sandbox_pass: 1, self_confidence: 82 } },
  },
  {
    path: 'src/weak.ts',
    kind: 'add',
    oldText: '',
    newText: 'c\n',
    confidence: { score: 16, flags: ['sandbox_failed', 'high_license_risk'] },
  },
  { path: 'src/legacy.ts', kind: 'delete', oldText: 'd\n', newText: '' },
];

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('P-352 diff viewer confidence integration', () => {
  it('test_confidence_integration', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => FILES }))
    );
    render(<DiffViewer />);

    for (const file of FILES) {
      await screen.findByTestId(`rail-${file.path}`);
    }
    await waitFor(() => {
      expect(screen.getByTestId('rail-src/strong.ts').querySelector('[data-band]')).toBeTruthy();
    });

    const strong = screen.getByTestId('rail-src/strong.ts');
    expect(strong.querySelector('[data-band="medium"]')).toBeTruthy();
    expect(strong.textContent).toContain('77');
    // the badge sits INSIDE the tab, so the tab stays the accessible control
    expect(strong.getAttribute('role')).toBe('tab');

    const weak = screen.getByTestId('rail-src/weak.ts');
    expect(weak.querySelector('[data-band="low"]')).toBeTruthy();
    expect(weak.textContent).toContain('sandbox_failed, high_license_risk');
    expect(weak.querySelector('[role="status"]')?.getAttribute('aria-label')).toBe(
      'confidence 16/100, low'
    );

    // a file with no recorded confidence renders the honest N/A state
    const legacy = screen.getByTestId('rail-src/legacy.ts');
    expect(legacy.querySelector('[data-band="unknown"]')).toBeTruthy();
    expect(legacy.textContent).toContain('N/A');
  });
});
