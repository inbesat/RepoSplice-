import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import { App } from './App.js';

describe('web root (P-047 react)', () => {
  it('renders root', () => {
    const html = renderToString(<App />);
    expect(html).toBe('<main><h1>stitch</h1><p>AI-augmented multi-repo composition</p></main>');
  });
});
