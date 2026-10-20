// P-324 — the build-pass scoring contract, mirrored for the bun CI (the
// python side drives the real runner through the fixture harness).
//
// The score maps a verification run onto the scorable fields: the exit code
// becomes build_pass, stdout+stderr become the logs, and a failed build
// stops the run before the tests (they could not run against a broken tree).

import { describe, expect, it } from 'vitest';
import { err, ok } from 'neverthrow';
import { scoreBuild, type VerifyPort } from '../eval/scoring.js';
import { evalResultSchema } from '../eval/types.js';
import type { BuildResult } from '../sandbox/build.js';

const run = (pass: boolean, stdout: string[], stderr: string[]): BuildResult => ({
  pass,
  command: 'fixture build',
  exitCode: pass ? 0 : 1,
  durationMs: 12,
  logs: { stdout, stderr },
});

describe('eval scoring (P-324)', () => {
  it('records the build pass and the logs', async () => {
    const verify: VerifyPort = async kind =>
      ok(kind === 'build' ? run(true, ['build ok'], []) : run(true, ['tests ok'], ['a warning']));
    const score = await scoreBuild({
      ecosystem: 'js',
      repoPath: '/tmp/merged',
      verify,
    });
    expect(score.isOk()).toBeTruthy();
    if (score.isErr()) return;
    expect(score.value.buildPass).toBe(true);
    expect(score.value.buildLogs).toEqual(['build ok']);
    expect(score.value.testLogs).toEqual(['tests ok', 'a warning']);
    expect(score.value.buildDurationMs).toBe(12);
    expect(score.value.testDurationMs).toBe(12);
  });

  it('a failing build stops before the tests', async () => {
    let testCalls = 0;
    const verify: VerifyPort = async kind => {
      if (kind === 'test') {
        testCalls += 1;
        return ok(run(true, ['tests ok'], []));
      }
      return ok(run(false, [], ['compile error']));
    };
    const score = await scoreBuild({
      ecosystem: 'python',
      repoPath: '/tmp/merged',
      verify,
    });
    expect(score.isOk()).toBeTruthy();
    if (score.isErr()) return;
    expect(score.value.buildPass).toBe(false);
    expect(score.value.buildLogs).toEqual(['compile error']);
    expect(score.value.testLogs).toEqual([]);
    expect(score.value.testDurationMs).toBe(0);
    expect(testCalls).toBe(0);
  });

  it('the verify error is propagated', async () => {
    const verify: VerifyPort = async () =>
      err({ code: 'SANDBOX_UNAVAILABLE', message: 'no docker here' });
    const score = await scoreBuild({
      ecosystem: 'go',
      repoPath: '/tmp/merged',
      verify,
    });
    expect(score.isErr()).toBeTruthy();
    if (score.isOk()) return;
    expect(score.error.code).toBe('SANDBOX_UNAVAILABLE');
  });

  it('the result schema carries the logs', () => {
    const parsed = evalResultSchema.safeParse({
      pair_id: 'fixture-spot-js',
      status: 'succeeded',
      build_pass: true,
      build_logs: ['build ok'],
      test_logs: ['tests ok'],
      rubric_score: null,
      resolve_rate: null,
      tokens: 12,
      cost: 0.01,
      duration: 30,
      error_code: null,
      error_message: null,
    });
    expect(parsed.success).toBeTruthy();
  });
});
