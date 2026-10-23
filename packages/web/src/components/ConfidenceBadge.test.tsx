// P-352 — the mandated confidence-badge tests.
//
// The plan names `web/test_confidence_badge.tsx`; the web vitest glob collects
// `src/**/*.{test,spec}.{ts,tsx}`, so the mandated case names live here verbatim (the path
// mapping is recorded in ADR-161).

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CONFIDENCE_THRESHOLDS,
  ConfidenceBadge,
  confidenceBand,
  confidenceBreakdown,
  confidenceFlags,
  confidenceScoreText,
  type ConfidenceView,
} from './ConfidenceBadge.js';

const STRONG: ConfidenceView = {
  score: 77,
  flags: [],
  components: {
    sandbox_pass: 1,
    self_confidence: 82,
    resolver_confidence: 60,
    license_risk: 40,
    test_coverage: 50,
  },
  rationale: 'the wiring is complete',
};

const WEAK: ConfidenceView = {
  score: 16,
  flags: ['sandbox_failed', 'high_license_risk'],
  components: {
    sandbox_pass: 0,
    self_confidence: 30,
    resolver_confidence: 20,
    license_risk: 80,
    test_coverage: 10,
  },
  rationale: 'the sandbox run failed',
};

afterEach(() => {
  cleanup();
});

describe('P-352 confidence badge', () => {
  it('test_colors', () => {
    // the cut points are inclusive at the top: 80 high, 79 medium, 60 medium, 59 low
    expect(confidenceBand(80)).toBe('high');
    expect(confidenceBand(79)).toBe('medium');
    expect(confidenceBand(60)).toBe('medium');
    expect(confidenceBand(59)).toBe('low');
    expect(confidenceBand(0)).toBe('low');
    expect(confidenceBand(undefined)).toBe('unknown');
    expect(confidenceBand(Number.NaN)).toBe('unknown');

    const { container: high } = render(<ConfidenceBadge confidence={{ score: 95 }} />);
    expect(high.querySelector('[data-band="high"]')).toBeTruthy();
    // the colour comes from the P-209 token role, never a literal hex
    expect(high.innerHTML).toContain('var(--success)');
    cleanup();

    const { container: medium } = render(<ConfidenceBadge confidence={{ score: 60 }} />);
    expect(medium.querySelector('[data-band="medium"]')).toBeTruthy();
    expect(medium.innerHTML).toContain('var(--warning)');
    cleanup();

    const { container: low } = render(<ConfidenceBadge confidence={{ score: 59 }} />);
    expect(low.querySelector('[data-band="low"]')).toBeTruthy();
    expect(low.innerHTML).toContain('var(--danger)');
    cleanup();

    const { container: unknown } = render(<ConfidenceBadge />);
    expect(unknown.querySelector('[data-band="unknown"]')).toBeTruthy();
    expect(unknown.textContent).toContain('N/A');
    cleanup();

    // the thresholds are theme-configurable
    const { container: custom } = render(
      <ConfidenceBadge confidence={{ score: 60 }} thresholds={{ high: 90, medium: 61 }} />
    );
    expect(custom.querySelector('[data-band="low"]')).toBeTruthy();
    expect(CONFIDENCE_THRESHOLDS).toEqual({ high: 80, medium: 60 });
  });

  it('test_tooltip', () => {
    const breakdown = confidenceBreakdown(STRONG, 'medium');
    expect(breakdown).toContain('77/100');
    expect(breakdown).toContain('sandbox 1');
    expect(breakdown).toContain('self 82');
    expect(breakdown).toContain('resolver 60');
    expect(breakdown).toContain('license 40');
    expect(breakdown).toContain('tests 50');
    expect(breakdown).toContain('the wiring is complete');
    expect(confidenceBreakdown(WEAK, 'low')).toContain('flags: sandbox_failed, high_license_risk');

    const { container } = render(<ConfidenceBadge confidence={WEAK} />);
    const badge = container.querySelector('[data-band="low"]');
    expect(badge).toBeTruthy();
    const title = badge?.getAttribute('title') ?? '';
    expect(title).toContain('self 30');
    expect(title).toContain('license 80');
    expect(title).toContain('sandbox_failed');
    // the flags are visible text too, and blank/non-string flags are ignored
    expect(container.textContent).toContain('sandbox_failed, high_license_risk');
    expect(confidenceFlags(['ok', ' ', 7, 'other'])).toEqual(['ok', 'other']);
    expect(confidenceFlags(undefined)).toEqual([]);
  });

  it('test_a11y', () => {
    const { container } = render(<ConfidenceBadge confidence={STRONG} />);
    const badge = screen.getByRole('status');
    // the accessible name carries the score AND the band - colour alone is never the signal
    expect(badge.getAttribute('aria-label')).toBe('confidence 77/100, medium');
    // the glyph and the score are real text, so the meaning survives without colour
    expect(container.textContent).toContain('!');
    expect(container.textContent).toContain('77');
    // the glyph and the score are decorative to assistive tech, the status role is exposed
    expect(container.querySelectorAll('[aria-hidden="true"]').length).toBe(2);
    expect(confidenceScoreText(STRONG.score)).toBe('77');
    expect(confidenceScoreText(undefined)).toBe('N/A');
  });
});
