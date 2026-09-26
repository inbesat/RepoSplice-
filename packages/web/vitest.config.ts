import { defineProject } from 'vitest/config';
import { resolve } from 'node:path';

export default defineProject({
  test: {
    name: '@repo-stitcher/web',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    environment: 'jsdom',
    // Restated from the root config — child projects do not inherit it.
    testTimeout: 30000,
    hookTimeout: 180000,
  },
  resolve: {
    alias: {
      '@repo-stitcher/core': resolve(import.meta.dirname, '../core/src'),
    },
  },
});
