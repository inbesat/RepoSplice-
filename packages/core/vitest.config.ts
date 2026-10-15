import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: '@repo-stitcher/core',
    // Projects share `sequence.groupOrder`; must be unique per-project when
    // `maxWorkers` differs, otherwise vitest refuses to start the run.
    sequence: { groupOrder: 1 },
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
    // Full-suite runs previously spawned one worker per file (135+), starving
    // each other under load (madge-based circular.smoke timed out at 60s).
    // Cap concurrency to half the CPUs so heavy git/madge/provider tests
    // still get real CPU time; per-file isolation is preserved.
    maxWorkers: '50%',
  },
});
