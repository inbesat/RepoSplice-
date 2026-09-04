import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    projects: ['packages/*'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      thresholds: {
        'packages/core/src/**/*.ts': {
          statements: 80,
          branches: 70,
          functions: 80,
          lines: 80,
        },
        'packages/cli/src/**/*.{ts,tsx}': {
          statements: 70,
          branches: 60,
          functions: 70,
          lines: 70,
        },
        'packages/web/src/**/*.{ts,tsx}': {
          statements: 60,
          branches: 50,
          functions: 60,
          lines: 60,
        },
      },
    },
    testTimeout: 30000,
    hookTimeout: 10000,
  },
  resolve: {
    alias: {
      '@repo-stitcher/core': resolve(import.meta.dirname, 'packages/core/src'),
      '@repo-stitcher/cli': resolve(import.meta.dirname, 'packages/cli/src'),
      '@repo-stitcher/web': resolve(import.meta.dirname, 'packages/web/src'),
    },
  },
});
