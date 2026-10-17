import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import { App } from './App.js';

describe('web root (P-047 react)', () => {
  it('renders root', () => {
    const html = renderToString(<App />);
    expect(html).toBe(
      '<main class="bg-stitch-50 text-stitch-900 dark:bg-stitch-950 dark:text-stitch-50"><h1 class="text-stitch-700 dark:text-stitch-200">stitch</h1><p>AI-augmented multi-repo composition</p></main><section aria-label="Notifications alt+T" tabindex="-1" aria-live="polite" aria-relevant="additions text" aria-atomic="false" data-react-aria-top-layer="true"></section>'
    );
  });

  // P-208's two mandated names, layered on the byte-exact pin above.
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
    expect(html).toContain('bg-stitch-50'); // the themed shell renders under the providers
  });
});
