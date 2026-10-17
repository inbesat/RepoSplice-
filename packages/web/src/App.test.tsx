import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import { App } from './App.js';

describe('web root (P-047 react)', () => {
  // PIN SUPERSEDED (P-210; the ADR-088 update-a-pinned-test precedent): the
  // phase replaces the scaffold's placeholder <main> with the ROUTED SHELL —
  // header (brand + tagline + run status + dark toggle + settings), stepper
  // sidebar and the routed region. The old byte-exact markup cannot survive a
  // router mount, so the pin's INTENT is re-asserted structurally: brand,
  // chrome and providers all render. The stitch-scale brand classes live in
  // AppShell.tsx (h1), keeping the P-208 styles pins true.
  it('renders root', () => {
    const html = renderToString(<App />);
    expect(html).toContain('<h1');
    expect(html).toContain('text-stitch-700'); // the brand accent from the scale
    expect(html).toContain('>stitch<');
    expect(html).toContain('AI-augmented multi-repo composition');
    // The chrome: stepper nav, sidebar aside, run-status badge, dark toggle,
    // settings link — and the routed region the steps load into.
    expect(html).toContain('aria-label="stitch steps"');
    expect(html).toContain('<aside');
    expect(html).toContain('run-status');
    expect(html).toContain('toggle dark mode');
    expect(html).toContain('settings');
  });

  // P-208's mandated name, layered on the pin above.
  it('renders shell placeholder', () => {
    const html = renderToString(<App />);
    expect(html).toContain('<h1');
    expect(html).toContain('stitch');
    expect(html).toContain('AI-augmented multi-repo composition');
  });

  it('mounts providers', () => {
    // The Toaster is mounted INSIDE the provider tree — its region in the
    // server markup is the observable proof that the root providers wrapped.
    const html = renderToString(<App />);
    expect(html).toContain('aria-label="Notifications');
    expect(html).toContain('bg-bg'); // the P-209 semantic shell renders under the providers
  });
});
