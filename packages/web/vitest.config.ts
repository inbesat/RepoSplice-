import { defineProject } from 'vitest/config';
import { resolve } from 'node:path';

export default defineProject({
  test: {
    name: '@repo-stitcher/web',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    environment: 'jsdom',
    // P-236 — the shared harness: jest-dom matchers plus the browser APIs
    // jsdom does not implement (matchMedia, observers, object URLs).
    setupFiles: ['./src/test/setup.ts'],
    // Restated from the root config — child projects do not inherit it.
    testTimeout: 30000,
    hookTimeout: 180000,
  },
  resolve: {
    alias: {
      '@repo-stitcher/core': resolve(import.meta.dirname, '../core/src'),
      '@': resolve(import.meta.dirname, 'src'),
    },
  },
  // P-236 — the standalone coverage run (`bun run test:cov`). The ROOT
  // config keeps the authoritative glob thresholds for the workspace run;
  // the package script pins the same numbers so a local run cannot drift.
  coverage: {
    provider: 'v8',
    include: ['src/**/*.{ts,tsx}'],
    exclude: ['src/**/*.test.{ts,tsx}', 'src/test/**', 'src/**/*.d.ts', 'src/main.tsx'],
    reporter: ['text', 'json', 'html'],
    // P-236 — the gate. Glob-keyed like the root config so a workspace run
    // and a package run enforce the same shape. The measured numbers
    // (84.5 stmts / 72.4 branches / 88.2 funcs / 87.0 lines) sit above
    // these floors.
    thresholds: {
      'src/**/*.{ts,tsx}': {
        statements: 75,
        branches: 65,
        functions: 70,
        lines: 75,
      },
    },
  },
});
