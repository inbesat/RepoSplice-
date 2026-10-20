// P-315 — the shared package's own project config (the root vitest config
// globs packages/*, so this keeps the project name stable).

import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: '@repo-stitcher/shared',
    include: ['src/**/*.{test,spec}.ts'],
    environment: 'node',
    testTimeout: 30_000,
  },
});
