import { defineProject } from 'vitest/config';
import { resolve } from 'node:path';

export default defineProject({
  test: {
    name: '@repo-stitcher/mcp',
    // The mandated P-357 test file is `mcp/test_server.ts`, so it is listed
    // explicitly: the default glob would only collect suffixed test files.
    include: ['src/**/*.{test,spec}.ts', 'test_server.ts'],
    environment: 'node',
    // Restated from the root config - child projects do not inherit it.
    testTimeout: 30000,
    hookTimeout: 180000,
  },
  resolve: {
    alias: {
      '@repo-stitcher/core': resolve(import.meta.dirname, '../core/src'),
    },
  },
});
