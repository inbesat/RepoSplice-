// P-209 — the semantic tokens as typed constants.
//
// ONE source of truth would be CSS (tokens.css); TS constants are the MIRROR
// that code can import without parsing CSS, and tokens.test.ts guards the two
// stay in sync (every hex below must appear in tokens.css). Values match the
// `.dark`-class palette chosen for P-226's class-based variant (see the tokens
// header comment for the light/dark split).

export interface SizeLeading {
  readonly size: string;
  readonly leading: string;
}

/** The nine semantic roles (the CSS custom properties they map to is mechanical: `--${role}`). */
export type TokenRole =
  'bg' | 'surface' | 'text' | 'muted' | 'border' | 'primary' | 'success' | 'warning' | 'danger';

export const LIGHT_TOKENS: Readonly<Record<TokenRole, string>> = {
  bg: '#ffffff',
  surface: '#f5f7ff',
  text: '#1c2540',
  muted: '#5c6579',
  border: '#d8dfef',
  primary: '#3a5bd0',
  success: '#1a7f37',
  warning: '#9a6700',
  danger: '#b42318',
};

export const DARK_TOKENS: Readonly<Record<TokenRole, string>> = {
  bg: '#10142a',
  surface: '#1c2342',
  text: '#e8edff',
  muted: '#97a1c0',
  border: '#303a5e',
  primary: '#7095f2',
  success: '#3fb950',
  warning: '#d29922',
  danger: '#f85149',
};

/** The four-step type scale: CSS vars `--text-*` / `--lh-*`. */
export const TYPOGRAPHY: Readonly<Record<'display' | 'title' | 'body' | 'caption', SizeLeading>> = {
  display: { size: '2.25rem', leading: '2.75rem' },
  title: { size: '1.25rem', leading: '1.75rem' },
  body: { size: '1rem', leading: '1.5rem' },
  caption: { size: '0.875rem', leading: '1.25rem' },
};

/** The eight-step 4px-base spacing ramp: CSS vars `--space-1..8`. */
export const SPACING: Readonly<Record<'1' | '2' | '3' | '4' | '5' | '6' | '7' | '8', string>> = {
  1: '0.25rem',
  2: '0.5rem',
  3: '0.75rem',
  4: '1rem',
  5: '1.5rem',
  6: '2rem',
  7: '3rem',
  8: '4rem',
};

/** Corner radii: CSS vars `--radius-sm/md/lg`. */
export const RADIUS: Readonly<Record<'sm' | 'md' | 'lg', string>> = {
  sm: '0.25rem',
  md: '0.5rem',
  lg: '0.75rem',
};

/** Elevation steps: CSS vars `--shadow-sm/md/lg` (alpha grows with depth). */
export const SHADOWS: Readonly<Record<'sm' | 'md' | 'lg', string>> = {
  sm: '0 1px 2px rgb(28 37 64 / 0.08)',
  md: '0 2px 8px rgb(28 37 64 / 0.12)',
  lg: '0 8px 24px rgb(28 37 64 / 0.16)',
};

/** The single sans stack (Inter variable, loaded in main.tsx). */
export const FONT_SANS = "'Inter Variable', 'Inter', ui-sans-serif, system-ui, sans-serif";
