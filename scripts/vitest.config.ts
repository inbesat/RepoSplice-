// P-314 — the repo tooling's own vitest project.
//
// The root vitest.config.ts is a frozen file, so the scripts suite gets its
// own config instead of a root-level edit. Run it from the repo root:
//   bunx vitest run --config scripts/vitest.config.ts

import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: '@repo-stitcher/scripts',
    include: ['scripts/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30000,
  },
});
