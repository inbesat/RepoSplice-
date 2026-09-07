import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import { StatusIcon, type StatusKind } from './StatusIcon.js';

describe('status icon (P-054 lucide)', () => {
  it('renders icon', () => {
    const html = renderToString(<StatusIcon status="ok" />);
    expect(html).toContain('<svg');
    expect(html).toContain('width="16"');
    expect(html).toContain('height="16"');
    expect(html).toContain('aria-hidden="true"');
  });

  it('maps statuses to distinct icons with size and class props', () => {
    const kinds: StatusKind[] = ['ok', 'warn', 'err', 'idle'];
    const rendered = kinds.map(status =>
      renderToString(<StatusIcon status={status} size={24} className={`st-${status}`} />)
    );
    for (const [i, html] of rendered.entries()) {
      expect(html).toContain('<svg');
      expect(html).toContain('width="24"');
      expect(html).toContain(`st-${kinds[i]}`);
    }
    // All four glyphs differ (no two statuses share artwork).
    expect(new Set(rendered).size).toBe(4);
  });
});
