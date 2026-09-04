import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: '@repo-stitcher/core',
    include: ['src/**/*.{test,spec}.ts'],
    environment: 'node',
  },
});
