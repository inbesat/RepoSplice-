import { defineProject } from 'vitest/config';
import { resolve } from 'node:path';

export default defineProject({
  test: {
    name: '@repo-stitcher/web',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    environment: 'jsdom',
  },
  resolve: {
    alias: {
      '@repo-stitcher/core': resolve(import.meta.dirname, '../core/src'),
    },
  },
});
