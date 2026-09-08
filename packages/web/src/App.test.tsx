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
});
