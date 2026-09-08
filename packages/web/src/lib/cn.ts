import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * cn: the standard className composer for every styled component (P-209
 * tokens, P-210 shell, P-226 dark mode). `clsx` handles conditional
 * composition (strings, arrays, `{flag: boolean}` objects, falsy skips);
 * `twMerge` then dedupes conflicting Tailwind utilities so the LAST one
 * wins. Verified against the installed tailwind-merge v3 default config:
 * project `stitch-*` tokens and `dark:` variants merge correctly with no
 * `extendTailwindMerge` needed. Pure and total — never throws.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(...inputs));
}
