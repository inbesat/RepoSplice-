import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postcss from 'postcss';
import tailwindcss from '@tailwindcss/postcss';
import autoprefixer from 'autoprefixer';

describe('tailwind styles (P-049)', () => {
  it('styles resolve', async () => {
    // Same plugin list as postcss.config.cjs (which `vite build` consumes,
    // making `it('builds')` the config-validity proof). Asserts on output
    // features: utilities for App.tsx classes (v4 auto content detection),
    // emitted token variables, the class-based dark variant, and vendor
    // prefixes from the combined pipeline.
    const cssPath = resolve(import.meta.dirname, 'index.css');
    const input = readFileSync(cssPath, 'utf8');
    const result = await postcss([tailwindcss(), autoprefixer()]).process(input, {
      from: cssPath,
    });
    const out = result.css;
    expect(out).toContain('.bg-stitch-50');
    expect(out).toContain('.text-stitch-700');
    expect(out).toContain('--color-stitch-900:');
    expect(out).toContain('.dark');
    expect(out).toMatch(/-webkit-/);
  }, 120000);
});
