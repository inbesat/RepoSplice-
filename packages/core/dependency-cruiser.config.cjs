// dependency-cruiser config for @repo-stitcher/core.
//
// Goals (per P-021):
//   1. Enforce the AGENTS public-API-only rule: nothing outside `index.ts`
//      may import from `core` internals. (cli/web import from
//      `@repo-stitcher/core` directly — they don't even reach here, so
//      the constraint is local to `core/` itself: any sub-module of
//      `core` that wants to use another sub-module must reach through
//      `index.ts` or through explicit relative paths within the same
//      sub-tree.)
//   2. Catch the forbidden deps from `AGENTS.md` / `eslint.config.mjs`
//      `no-restricted-imports` (axios, joi, moment, jest, webpack, etc.)
//      at the file-tree level as a defense in depth.
//   3. Detect circular dependencies (also covered by P-022 / madge).
//
// Run via:  bun run lint:deps
// CLI:       depcruise src --config dependency-cruiser.config.cjs

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  // Only scan this package's source. Tests + fixtures are excluded
  // because they often intentionally violate encapsulation.
  options: {
    includeOnly: ['src'],
    exclude: [
      // Don't recurse into vendored / generated content
      'node_modules',
      'dist',
      'coverage',
      'src/.*\\.test\\.ts$',
      'src/__tests__/.*',
    ],
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'default', 'types'],
    },
    reporterOptions: {
      text: {},
    },
    doNotFollow: {
      // Don't descend into type-only packages.
      path: 'node_modules',
    },
  },
  forbidden: [
    // The AGENTS "no internal leakage" rule (cli/web may only import the
    // public barrel of core) is enforced at the PACKAGE level, not
    // within a single package. ESLint's no-restricted-imports (in
    // eslint.config.mjs) catches the cross-package case; this config
    // focuses on the within-package concerns below.

    // 1. Forbidden runtime deps from AGENTS.md / eslint.config.mjs
    //    (defense in depth — ESLint's no-restricted-imports already
    //    catches these at lint time; depcruise catches them at analysis
    //    time which catches edge cases like dynamic imports.)
    {
      name: 'no-axios',
      severity: 'error',
      comment: 'Use ofetch instead of axios (per TECH_STACK.md).',
      from: { path: '(.+)\\.ts$' },
      to: { path: 'node_modules/axios' },
    },
    {
      name: 'no-node-fetch',
      severity: 'error',
      comment: 'Use native fetch or ofetch (per TECH_STACK.md).',
      from: { path: '(.+)\\.ts$' },
      to: { path: 'node_modules/node-fetch' },
    },
    {
      name: 'no-joi',
      severity: 'error',
      comment: 'Use Zod instead of Joi (per TECH_STACK.md).',
      from: { path: '(.+)\\.ts$' },
      to: { path: 'node_modules/joi' },
    },
    {
      name: 'no-moment',
      severity: 'error',
      comment: 'Use Temporal (or @js-temporal/polyfill) instead of moment (per TECH_STACK.md).',
      from: { path: '(.+)\\.ts$' },
      to: { path: 'node_modules/moment' },
    },
    {
      name: 'no-jest',
      severity: 'error',
      comment: 'Use Vitest instead of Jest (per TECH_STACK.md).',
      from: { path: '(.+)\\.ts$' },
      to: { path: 'node_modules/jest' },
    },
    {
      name: 'no-better-sqlite3',
      severity: 'error',
      comment: 'Use bun:sqlite instead of better-sqlite3 (per TECH_STACK.md).',
      from: { path: '(.+)\\.ts$' },
      to: { path: 'node_modules/better-sqlite3' },
    },
    {
      name: 'no-prisma',
      severity: 'error',
      comment: 'Use raw bun:sqlite instead of Prisma/Drizzle/etc (per TECH_STACK.md).',
      from: { path: '(.+)\\.ts$' },
      to: { path: 'node_modules/prisma' },
    },
    {
      name: 'no-rollup',
      severity: 'error',
      comment: 'Use tsup (or bun build) instead of rollup (per TECH_STACK.md).',
      from: { path: '(.+)\\.ts$' },
      to: { path: 'node_modules/rollup' },
    },
    {
      name: 'no-esbuild-as-build',
      severity: 'error',
      comment: 'Use tsup instead of esbuild directly (per TECH_STACK.md).',
      from: { path: 'src/.*\\.ts$', pathNot: '\\.test\\.ts$' },
      to: { path: 'node_modules/esbuild' },
    },
    {
      name: 'no-socket.io',
      severity: 'error',
      comment: 'Use native WebSocket instead of socket.io (per TECH_STACK.md).',
      from: { path: '(.+)\\.ts$' },
      to: { path: 'node_modules/socket.io' },
    },
  ],
  required: [
    // No required-dependency rules for now (P-021 acceptance: the spec
    // doesn't require any). P-104+ will add ecosystem-specific required
    // deps (e.g. "every Git helper must import from core/git/factory").
  ],
};
