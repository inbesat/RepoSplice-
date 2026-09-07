// PostCSS pipeline (P-049): Tailwind v4 engine via its PostCSS bridge plus
// autoprefixer. Loaded automatically by Vite for `dev`/`build` (which is
// also what makes the committed `it('builds')` a validity proof for this
// file); mirrored explicitly in styles.test.ts for the output contract.
module.exports = {
  plugins: {
    '@tailwindcss/postcss': {},
    autoprefixer: {},
  },
};
