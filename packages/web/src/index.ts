export const WEB_NAME = '@repo-stitcher/web';

// P-209 — the design tokens, mirrored as typed constants (tokens.css is the
// source of truth; the test guards the two stay in sync).
export {
  LIGHT_TOKENS,
  DARK_TOKENS,
  TYPOGRAPHY,
  SPACING,
  RADIUS,
  SHADOWS,
  FONT_SANS,
  type TokenRole,
  type SizeLeading,
} from './theme/tokens.js';
