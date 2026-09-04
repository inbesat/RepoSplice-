import { defineProject } from 'vitest/config';
import { resolve } from 'node:path';

export default defineProject({
  test: {
    name: '@repo-stitcher/cli',
    include: ['src/**/*.{test,spec}.ts', 'src/**/*.{test,spec}.tsx'],
    environment: 'node',
  },
  resolve: {
    alias: {
      '@repo-stitcher/core': resolve(import.meta.dirname, '../core/src'),
    },
  },
});
