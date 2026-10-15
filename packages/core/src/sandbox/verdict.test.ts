// P-176 — verdict + flaky-detection tests.
//
// The runner is a THUNK with scripted outcomes (the phase spec's "fake runner"),
// so no container and no network are involved: the tests assert the asymmetric
// repeat rules, the bound, the default-off posture, and the warnings.
//
// The six required scenarios from the phase spec:
//
//   it('passes cleanly')       it('flags flaky on flip')  it('retries failing')
//   it('bounds repeats')       it('disabled by default')  it('warns on flaky file')

import { describe, it, expect } from 'vitest';
import { ok, err, type Result } from 'neverthrow';
import { type StitchError } from '../result/index.js';
import type { BuildResult } from './build.js';
import type { TestResult } from './test.js';
import {
  DEFAULT_FLAKY_REPEAT,
  MAX_FLAKY_REPEAT,
  assessVerdict,
  buildWarnings,
  checkFlaky,
  flakySameFileSeen,
  logsDiffer,
  resolveRepeat,
  type AttemptDetail,
  type RunOutcome,
} from './verdict.js';

/** A scripted test result. */
function testRun(
  pass: boolean,
  failures: { name: string; file?: string }[] = [],
  stdout: string[] = ['ok']
): TestResult {
  return {
    pass,
    command: 'bun test',
    exitCode: pass ? 0 : 1,
    durationMs: 5,
    passed: pass ? 3 : 0,
    failed: pass ? 0 : failures.length,
    skipped: 0,
    failures: failures.map(f => ({
      name: f.name,
      message: 'boom',
      ...(f.file ? { file: f.file } : {}),
    })),
    logs: { stdout, stderr: [] },
  };
}

function buildRun(pass: boolean): BuildResult {
  return {
    pass,
    command: 'bun run build',
    exitCode: pass ? 0 : 1,
    durationMs: 4,
    logs: { stdout: ['built'], stderr: [] },
  };
}

/** A scripted runner: each entry is served per attempt (the last repeats). */
function scriptedRunner(
  script: (Result<RunOutcome, StitchError> | RunOutcome)[],
  attempts: number[] = []
): (attempt: number) => Promise<Result<RunOutcome, StitchError>> {
  return async (attempt: number) => {
    attempts.push(attempt);
    const entry = script[Math.min(attempt - 1, script.length - 1)];
    if (entry === undefined) throw new Error('script exhausted');
    return 'isOk' in entry ? (entry as Result<RunOutcome, StitchError>) : ok(entry as RunOutcome);
  };
}

const ENABLED = { enabled: true } as const;

describe('P-176 verdict', () => {
  it('passes cleanly', () => {
    const verdict = assessVerdict(buildRun(true));
    expect(verdict.pass).toBe(true);
    expect(verdict.flaky).toBe(false);
    expect(verdict.attempts).toEqual([{ exitCode: 0, pass: true }]);
    expect(verdict.stableSince).toBe('first');

    const red = assessVerdict(testRun(false, [{ name: 'a', file: 'src/a.test.ts' }]));
    expect(red.pass).toBe(false);
    expect(red.flaky).toBe(false);
    expect(red.stableSince).toBe('none');

    // A sequence passes only when the FIRST attempt passed; two greens are
    // stable since the first.
    const twice = assessVerdict([buildRun(true), buildRun(true)]);
    expect(twice.pass).toBe(true);
    expect(twice.flaky).toBe(false);
    expect(twice.stableSince).toBe('first');

    // An empty sequence is evidence of nothing, so it is not a pass.
    expect(assessVerdict([]).pass).toBe(false);
  });

  it('flags flaky on flip', async () => {
    // A green base that flips red on the confirmation run is flaky, and the
    // pass still stands (one green is what the caller asked for).
    const attempts: number[] = [];
    const flipped = await checkFlaky(
      'node',
      '/c',
      'test',
      ENABLED,
      scriptedRunner(
        [testRun(true), testRun(false, [{ name: 'x', file: 'src/x.test.ts' }])],
        attempts
      )
    );
    expect(flipped.isOk()).toBe(true);
    if (flipped.isOk()) {
      expect(flipped.value.pass).toBe(true);
      expect(flipped.value.flaky).toBe(true);
      expect(flipped.value.stableSince).toBe('none');
      // Exactly one confirmation run for a passing base.
      expect(flipped.value.attempts).toHaveLength(2);
    }
    expect(attempts).toEqual([1, 2]);

    // Red → green on the first retry: flaky but STILL not a pass.
    const recovered = await checkFlaky(
      'node',
      '/c',
      'test',
      ENABLED,
      scriptedRunner([testRun(false, [{ name: 'a' }]), testRun(true)])
    );
    expect(recovered.isOk() && recovered.value.flaky).toBe(true);
    expect(recovered.isOk() && recovered.value.pass).toBe(false);
    expect(recovered.isOk() && recovered.value.stableSince).toBe('last');
  });

  it('retries failing', async () => {
    // A failing base does NOT get a pass out of a lucky retry, but the retries
    // are used: default 2 extra attempts → 3 total.
    const attempts: number[] = [];
    const verdict = await checkFlaky(
      'python',
      '/c',
      'test',
      ENABLED,
      scriptedRunner([testRun(false, [{ name: 'a' }]), testRun(true), testRun(true)], attempts)
    );
    expect(verdict.isOk()).toBe(true);
    if (verdict.isOk()) {
      expect(verdict.value.attempts).toHaveLength(3);
      expect(verdict.value.pass).toBe(false);
      expect(verdict.value.flaky).toBe(true);
      expect(verdict.value.stableSince).toBe('last');
    }
    expect(attempts).toEqual([1, 2, 3]);
    expect(DEFAULT_FLAKY_REPEAT).toBe(2);

    // An infrastructure failure on a retry ends the check: a repeat that never
    // ran cannot be evidence about stability.
    const broke = await checkFlaky(
      'node',
      '/c',
      'test',
      ENABLED,
      scriptedRunner([
        testRun(false, [{ name: 'a' }]),
        err({ code: 'SANDBOX_TIMEOUT', timeoutMs: 5, message: 'x' }),
      ])
    );
    expect(broke.isErr()).toBe(true);
    if (broke.isErr()) expect(broke.error.code).toBe('SANDBOX_TIMEOUT');

    // Consistency: three identical reds are not flaky.
    const allRed = await checkFlaky(
      'node',
      '/c',
      'test',
      ENABLED,
      scriptedRunner([testRun(false, [{ name: 'a' }])])
    );
    expect(allRed.isOk() && allRed.value.flaky).toBe(false);
    expect(allRed.isOk() && allRed.value.attempts).toHaveLength(3);
  });

  it('bounds repeats', async () => {
    expect(resolveRepeat({})).toBe(DEFAULT_FLAKY_REPEAT);
    expect(resolveRepeat({ repeat: 99 })).toBe(MAX_FLAKY_REPEAT);
    expect(resolveRepeat({ repeat: -5 })).toBe(0);
    expect(resolveRepeat({ repeat: 1.7 })).toBe(1);
    expect(MAX_FLAKY_REPEAT).toBeLessThanOrEqual(3);

    // A repeat of 0 means "no retries": one attempt only.
    const attempts: number[] = [];
    const noRetry = await checkFlaky(
      'node',
      '/c',
      'build',
      { enabled: true, repeat: 0 },
      scriptedRunner([buildRun(false)], attempts)
    );
    expect(noRetry.isOk() && noRetry.value.attempts).toHaveLength(1);
    expect(attempts).toEqual([1]);

    // The cap really caps.
    const capped: number[] = [];
    await checkFlaky(
      'node',
      '/c',
      'build',
      { enabled: true, repeat: 99 },
      scriptedRunner([buildRun(false)], capped)
    );
    expect(capped).toEqual([1, 2, 3, 4]);
  });

  it('disabled by default', async () => {
    // No `enabled: true` → a single attempt, no repeats, and no flakiness
    // claim (the config default is off).
    const attempts: number[] = [];
    const off = await checkFlaky(
      'node',
      '/c',
      'build',
      {},
      scriptedRunner([buildRun(false), buildRun(true)], attempts)
    );
    expect(off.isOk()).toBe(true);
    if (off.isOk()) {
      expect(off.value.attempts).toHaveLength(1);
      expect(off.value.flaky).toBe(false);
    }
    expect(attempts).toEqual([1]);

    // Even a green base is not re-run when the check is off.
    const green: number[] = [];
    const greenOff = await checkFlaky(
      'node',
      '/c',
      'build',
      { enabled: false },
      scriptedRunner([buildRun(true)], green)
    );
    expect(greenOff.isOk() && greenOff.value.stableSince).toBe('first');
    expect(green).toEqual([1]);
  });

  it('warns on flaky file', async () => {
    const attempts: AttemptDetail[] = [
      {
        exitCode: 1,
        pass: false,
        failures: [{ name: 't1', file: 'src/a.test.ts' }],
        logs: { stdout: ['x'], stderr: [] },
      },
      { exitCode: 0, pass: true, failures: [], logs: { stdout: ['y'], stderr: [] } },
      {
        exitCode: 1,
        pass: false,
        failures: [{ name: 't1', file: 'src/a.test.ts' }],
        logs: { stdout: ['x'], stderr: [] },
      },
    ];
    expect(flakySameFileSeen(attempts)).toEqual(['src/a.test.ts']);
    // A file that fails in EVERY attempt is broken, not flaky.
    expect(
      flakySameFileSeen([
        { exitCode: 1, pass: false, failures: [{ name: 't1', file: 'src/b.test.ts' }] },
        { exitCode: 1, pass: false, failures: [{ name: 't1', file: 'src/b.test.ts' }] },
      ])
    ).toEqual([]);
    expect(logsDiffer(['a'], ['a'])).toBe(false);
    expect(logsDiffer(['a'], ['b'])).toBe(true);
    expect(logsDiffer(['a'], ['a', 'b'])).toBe(true);

    const warnings = buildWarnings('node', 'test', attempts);
    expect(warnings.some(w => w.includes('src/a.test.ts') && w.includes('flaky'))).toBe(true);
    expect(warnings.some(w => w.includes('timing-dependent'))).toBe(true);

    // …and the warnings ride on the verdict the caller receives.
    const verdict = await checkFlaky(
      'node',
      '/c',
      'test',
      ENABLED,
      scriptedRunner([
        testRun(false, [{ name: 't1', file: 'src/a.test.ts' }], ['x']),
        testRun(true, [], ['y']),
        testRun(false, [{ name: 't1', file: 'src/a.test.ts' }], ['x']),
      ])
    );
    expect(verdict.isOk()).toBe(true);
    if (verdict.isOk()) {
      expect(verdict.value.warnings?.some(w => w.includes('src/a.test.ts'))).toBe(true);
      expect(verdict.value.pass).toBe(false);
      expect(verdict.value.flaky).toBe(true);
    }

    // A stable green run produces no warnings at all.
    expect(buildWarnings('go', 'build', [{ exitCode: 0, pass: true }])).toEqual([]);
  });
});
