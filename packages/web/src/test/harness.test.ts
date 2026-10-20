// P-236 — the harness self-test. If a shared mock goes missing (or the
// setup file stops loading), this file fails loudly instead of letting the
// whole suite depend on an accident.

import { describe, expect, it } from 'vitest';

describe('web test harness (P-236)', () => {
  it('answers media queries', () => {
    expect(typeof window.matchMedia).toBe('function');
    expect(window.matchMedia('(prefers-reduced-motion: reduce)').matches).toBe(false);
    expect(window.matchMedia('(min-width: 1px)').media).toBe('(min-width: 1px)');
  });

  it('provides observer stubs', () => {
    expect(typeof window.ResizeObserver).toBe('function');
    expect(typeof window.IntersectionObserver).toBe('function');
    const resize = new window.ResizeObserver(() => undefined);
    resize.observe(document.body);
    resize.disconnect();
    const intersect = new window.IntersectionObserver(() => undefined);
    intersect.observe(document.body);
    intersect.disconnect();
  });

  it('creates object URLs', () => {
    expect(typeof URL.createObjectURL).toBe('function');
    expect(URL.createObjectURL(new Blob(['stitch']))).toContain('blob:');
    expect(() => URL.revokeObjectURL('blob:stitch/mock')).not.toThrow();
  });

  it('silences scrolling', () => {
    expect(() => window.scrollTo(0, 120)).not.toThrow();
  });

  it('registers the jest-dom matchers', () => {
    const element = document.createElement('div');
    document.body.appendChild(element);
    expect(element).toBeInTheDocument();
    element.remove();
    expect(element).not.toBeInTheDocument();
  });
});
