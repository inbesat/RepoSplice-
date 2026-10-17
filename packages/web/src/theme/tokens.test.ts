// P-209 — design-token tests.
//
// The four required scenarios from the phase spec:
//
//   it('defines all semantic roles')  it('contrast light vars')
//   it('contrast dark vars')          it('spacing monotonic')
//
// plus "the TS mirror stays in sync with tokens.css" (one guard for every hex).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  LIGHT_TOKENS,
  DARK_TOKENS,
  SPACING,
  RADIUS,
  SHADOWS,
  TYPOGRAPHY,
  FONT_SANS,
  type TokenRole,
} from './tokens.js';

const CSS = readFileSync(resolve(import.meta.dirname, 'tokens.css'), 'utf8');

/** The text-bearing roles the WCAG floor applies to. */
const TEXT_ROLES: readonly TokenRole[] = [
  'text',
  'muted',
  'primary',
  'success',
  'warning',
  'danger',
];

/** Relative luminance per WCAG 2.x (sRGB, 8-bit hex). */
function luminance(hex: string): number {
  const channels = [1, 3, 5].map(i => Number.parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}

/** WCAG contrast ratio between two hex colors. */
function contrast(fg: string, bg: string): number {
  const [a, b] = [luminance(fg), luminance(bg)].sort((x, y) => y - x);
  return ((a ?? 0) + 0.05) / ((b ?? 0) + 0.05);
}

describe('P-209 design tokens', () => {
  it('defines all semantic roles', () => {
    // Every role exists in both palettes, in TYPOGRAPHY/SPACING/RADIUS/SHADOWS,
    // and the CSS actually carries each block (both selectors present).
    const roles: readonly TokenRole[] = [
      'bg',
      'surface',
      'text',
      'muted',
      'border',
      'primary',
      'success',
      'warning',
      'danger',
    ];
    for (const role of roles) {
      expect(LIGHT_TOKENS[role]).toMatch(/^#[0-9a-f]{6}$/);
      expect(DARK_TOKENS[role]).toMatch(/^#[0-9a-f]{6}$/);
      expect(CSS).toContain(`--${role}:`);
    }
    expect(CSS).toContain(':root');
    expect(CSS).toContain('.dark');
    expect(CSS).toContain('@theme inline');
    expect(Object.keys(TYPOGRAPHY)).toEqual(['display', 'title', 'body', 'caption']);
    expect(Object.keys(SPACING)).toHaveLength(8);
    expect(Object.keys(RADIUS).sort()).toEqual(['lg', 'md', 'sm']);
    expect(Object.keys(SHADOWS).sort()).toEqual(['lg', 'md', 'sm']);
    // The @theme inline re-export hands Tailwind the utilities.
    expect(CSS).toContain('--color-primary: var(--primary)');
    // The font stack is one string in both worlds.
    expect(CSS).toContain(FONT_SANS);
  });

  it('contrast light vars', () => {
    const bg = LIGHT_TOKENS.bg;
    expect(bg).toBe('#ffffff');
    for (const role of TEXT_ROLES) {
      expect(contrast(LIGHT_TOKENS[role], bg)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('contrast dark vars', () => {
    const bg = DARK_TOKENS.bg;
    expect(bg).toBe('#10142a');
    for (const role of TEXT_ROLES) {
      expect(contrast(DARK_TOKENS[role], bg)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('spacing monotonic', () => {
    // Each step parses to a rem value strictly greater than the last.
    const steps = Object.entries(SPACING).map(([key, value]) => {
      const rem = Number.parseFloat(value);
      expect(Number.isFinite(rem)).toBe(true);
      return { key, rem };
    });
    for (let i = 1; i < steps.length; i += 1) {
      expect(steps[i - 1]?.rem ?? 0).toBeLessThan(steps[i]?.rem ?? 0);
    }
  });

  it('ts mirror matches tokens.css', () => {
    // The one-way sync guard: every hex in the TS palettes appears in the CSS
    // (per block — the light value of one role must not quietly become the
    // dark value of another).
    for (const tokens of [LIGHT_TOKENS, DARK_TOKENS]) {
      for (const hex of Object.values(tokens)) {
        expect(CSS).toContain(hex);
      }
    }
    // Type scale and non-role vars likewise.
    for (const { size, leading } of Object.values(TYPOGRAPHY)) {
      expect(CSS).toContain(size);
      expect(CSS).toContain(leading);
    }
    for (const [key, rem] of Object.entries(SPACING)) {
      expect(CSS).toContain(`--space-${key}: ${rem}`);
    }
    for (const radius of Object.values(RADIUS)) expect(CSS).toContain(radius);
    for (const shadow of Object.values(SHADOWS)) expect(CSS).toContain(shadow);
  });
});
