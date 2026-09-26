import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: '@repo-stitcher/core',
    // `ai.suite.ts` is the P-147 full-stack integration suite; it is named
    // `.suite.ts` per the phase spec, so it is matched explicitly alongside
    // the ordinary `*.test.ts` / `*.spec.ts` unit tests.
    include: ['src/**/*.{test,spec}.ts', 'src/**/*.suite.ts'],
    environment: 'node',
    // Child projects do not inherit the root config's `test` block, so the
    // gate's timeouts are restated here. Without them the default 5s
    // testTimeout flakes git/sandbox/provider tests under full-suite load.
    testTimeout: 30000,
    hookTimeout: 180000,
  },
});
