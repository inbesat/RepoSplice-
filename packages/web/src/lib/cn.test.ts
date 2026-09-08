import { describe, it, expect } from 'vitest';
import { cn } from './cn.js';

describe('cn helper (P-059 clsx + tailwind-merge)', () => {
  it('cn merges', () => {
    // Last conflicting utility wins; the rest survive.
    expect(cn('px-2', 'px-4')).toBe('px-4');
    expect(cn('bg-red-500', 'bg-blue-500')).toBe('bg-blue-500');
    expect(cn('p-1', 'm-1')).toBe('p-1 m-1');
    // Project stitch tokens (P-209) merge under the default config.
    expect(cn('bg-stitch-50', 'bg-stitch-900')).toBe('bg-stitch-900');
    expect(cn('dark:bg-stitch-950', 'dark:bg-stitch-50')).toBe('dark:bg-stitch-50');
    // Base and dark: variants live in separate groups, so both are kept.
    expect(cn('text-stitch-700 dark:text-stitch-200', 'text-stitch-900')).toBe(
      'dark:text-stitch-200 text-stitch-900'
    );
    // clsx conditional composition feeds the merge.
    let compact = false;
    expect(cn('px-2', compact && 'px-4', { 'font-bold': true, hidden: false })).toBe(
      'px-2 font-bold'
    );
    compact = true;
    expect(cn('px-2', compact && 'px-4')).toBe('px-4');
    expect(cn('px-2', ['py-1', { 'py-2': true }])).toBe('px-2 py-2');
    // Empty / falsy inputs collapse to nothing, never to junk whitespace.
    expect(cn()).toBe('');
    expect(cn(null, undefined, false)).toBe('');
  });
});
