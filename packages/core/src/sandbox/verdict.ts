// P-176 — Sandbox: pass/fail verdict + flaky detection.
//
// A single green run is not proof. A flaky test, a network hiccup, or a
// timing-dependent assertion can produce a false red (the agent loops on noise)
// or a false green (the pipeline ships a broken child). This phase turns the
// backend's raw result into a VERDICT, with a BOUNDED repeat check that says so
// when the outcome is unstable.
//
// The rules are deliberately asymmetric, and that asymmetry is the whole point:
//
//   - a PASSING base is re-run ONCE to confirm stability (cheap) — a flip
//     marks `flaky`, and the pass still stands because one green is what the
//     caller asked for;
//   - a FAILING base is re-run up to `repeat` times, and if ANY retry passes
//     the verdict is `flaky: true, pass: false` — a retry that sometimes passes
//     is NOT evidence that the change is good, only that the suite is unstable,
//     and declaring success on it would hide a real failure.
//
// `repeat` is bounded (1..3 by {@link MAX_FLAKY_REPEAT}) because every attempt
// costs a container run or — on P-175's GitHub path — minutes of runner time.
//
// The repeat hook is a THUNK (`(attempt) => Result`), not a client: re-running
// means re-dispatching through P-175, and a thunk is what lets the mandated
// tests script outcomes without a daemon or the network while production passes
// `runVerification` itself.

import { ok, err, type Result } from 'neverthrow';
import { type StitchError } from '../result/index.js';
import type { BuildResult } from './build.js';
import type { TestResult } from './test.js';
import type { Ecosystem } from '../deps/index.js';

/** Either backend's result — the input to a verdict. */
export type RunOutcome = BuildResult | TestResult;

/** One attempt's outcome, as the verdict records it. */
export interface VerdictAttempt {
  exitCode: number;
  pass: boolean;
}

/** The verdict (phase step 1), plus additive warnings for the UI (P-220). */
export interface Verdict {
  pass: boolean;
  flaky: boolean;
  attempts: VerdictAttempt[];
  stableSince: 'first' | 'last' | 'none';
  /** Additive: flaky-file/timing warnings surfaced by the repeat check. */
  warnings?: string[];
}

/** How many extra runs a caller may ask for. */
export interface FlakyThreshold {
  /** Extra attempts. Clamped to 0..{@link MAX_FLAKY_REPEAT}. Default 2. */
  repeat?: number;
}

/** The most extra attempts allowed — each one is a full container/runner run. */
export const MAX_FLAKY_REPEAT = 3;

/** Extra attempts when the caller does not say (phase step 2). */
export const DEFAULT_FLAKY_REPEAT = 2;

/** What `checkFlaky` needs to re-run one attempt. */
export type FlakyRunner = (attempt: number) => Promise<Result<RunOutcome, StitchError>>;

/** The richer per-attempt record the heuristics read (not part of `Verdict`). */
export interface AttemptDetail {
  exitCode: number;
  pass: boolean;
  /** Test failures, when the attempt was a test run. */
  failures?: { name: string; file?: string }[];
  /** Captured lines, for the timing-dependence comparison (P-173). */
  logs?: { stdout: string[]; stderr: string[] };
}

/** Options for {@link checkFlaky}. */
export interface CheckFlakyOptions extends FlakyThreshold {
  /** Skip the repeat check entirely (the config default is off). */
  enabled?: boolean;
}

// ---------------------------------------------------------------------------
// assessVerdict
// ---------------------------------------------------------------------------

/** Normalize a repeat bound: absent → default, out-of-range → clamped. */
export function resolveRepeat(threshold: FlakyThreshold = {}): number {
  const raw = threshold.repeat ?? DEFAULT_FLAKY_REPEAT;
  if (!Number.isFinite(raw)) return DEFAULT_FLAKY_REPEAT;
  return Math.max(0, Math.min(MAX_FLAKY_REPEAT, Math.trunc(raw)));
}

/**
 * The verdict for one attempt or a sequence of them.
 *
 * `pass` comes from the FIRST attempt (the base run): a retry that passes does
 * not turn a red base green. Accepting an array as well as a single result is
 * additive — the spec's single-run call sites behave exactly as before — and
 * lets `checkFlaky` reuse this one implementation.
 *
 * `stableSince` has exactly three meanings:
 *   'first' — every attempt passed (stable from the start);
 *   'last'  — only the final attempt passed (flaky, then green);
 *   'none'  — the final attempt failed.
 */
export function assessVerdict(
  runs: RunOutcome | readonly RunOutcome[],
  threshold: FlakyThreshold = {}
): Verdict {
  void resolveRepeat(threshold); // bounds are validated here, not by the caller
  const list = Array.isArray(runs) ? (runs as readonly RunOutcome[]) : [runs as RunOutcome];
  const attempts: VerdictAttempt[] = list.map(run => ({
    exitCode: run.exitCode,
    pass: run.pass,
  }));
  const first = attempts[0];
  if (first === undefined) {
    // Defensive: an empty sequence has no verdict, so it is a failure with no
    // evidence rather than a silent pass.
    return { pass: false, flaky: false, attempts: [], stableSince: 'none' };
  }
  const last = attempts[attempts.length - 1];
  const allPassed = attempts.every(a => a.pass);
  const lastPassed = last?.pass === true;
  return {
    pass: first.pass,
    flaky: attempts.length > 1 && attempts.some(a => a.pass !== first.pass),
    attempts,
    stableSince: allPassed ? 'first' : lastPassed ? 'last' : 'none',
  };
}

// ---------------------------------------------------------------------------
// Flaky heuristics
// ---------------------------------------------------------------------------

/** The `file` or `name` a failure is attributed to. */
function failureKey(failure: { name: string; file?: string }): string {
  return failure.file !== undefined && failure.file !== '' ? failure.file : failure.name;
}

/**
 * Files that failed in SOME attempts but not all — the signature of a flaky
 * file rather than a genuinely broken one (phase step 4).
 */
export function flakySameFileSeen(attempts: readonly AttemptDetail[]): string[] {
  if (attempts.length < 2) return [];
  const perAttempt = attempts.map(attempt => {
    const keys = new Set<string>();
    for (const failure of attempt.failures ?? []) keys.add(failureKey(failure));
    return keys;
  });
  const everFailed = new Set<string>();
  const alwaysFailed = new Set(perAttempt[0] ?? []);
  for (const keys of perAttempt) {
    for (const key of keys) everFailed.add(key);
    for (const key of [...alwaysFailed]) if (!keys.has(key)) alwaysFailed.delete(key);
  }
  return [...everFailed].filter(key => !alwaysFailed.has(key)).sort();
}

/** Do two attempts' captured lines differ (timing-dependence signal)? */
export function logsDiffer(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return true;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return true;
  return false;
}

/** `detail` for one run outcome, keeping the fields the heuristics read. */
function detailOf(
  run: RunOutcome,
  attempt: number,
  prior: readonly AttemptDetail[]
): AttemptDetail {
  const test = run as TestResult;
  const hasFailures = Array.isArray((test as { failures?: unknown }).failures);
  void attempt;
  void prior;
  return {
    exitCode: run.exitCode,
    pass: run.pass,
    ...(hasFailures
      ? {
          failures: (test.failures ?? []).map(f => ({
            name: f.name,
            ...(f.file !== undefined ? { file: f.file } : {}),
          })),
        }
      : {}),
    logs: { stdout: run.logs.stdout, stderr: run.logs.stderr },
  };
}

// ---------------------------------------------------------------------------
// checkFlaky
// ---------------------------------------------------------------------------

/**
 * Run the base attempt plus a bounded set of repeats, and report a verdict.
 *
 * A passing base gets exactly ONE confirmation; a failing base gets up to
 * `repeat` retries. Warnings (flaky file, differing logs) ride on the verdict
 * so a single value carries everything the UI needs.
 *
 * An infrastructure failure on ANY attempt ends the check with `err`: a repeat
 * that never ran cannot be evidence about stability.
 */
export async function checkFlaky(
  ecosystem: Ecosystem,
  repoPath: string,
  kind: 'build' | 'test',
  opts: CheckFlakyOptions,
  run: FlakyRunner
): Promise<Result<Verdict, StitchError>> {
  void repoPath; // The runner thunk already closes over it (see the module header).
  if (opts.enabled !== true) {
    // Disabled (the default posture — `config.sandbox.flakyCheck` is false):
    // assess the single base run and stop; no repeats, no flakiness claim.
    const base = await run(1);
    if (base.isErr()) return err(base.error);
    return ok(assessVerdict(base.value, opts));
  }

  const base = await run(1);
  if (base.isErr()) return err(base.error);
  const details: AttemptDetail[] = [detailOf(base.value, 1, [])];
  const outcomes: RunOutcome[] = [base.value];

  // A green base needs one confirmation; a red base gets the caller's budget.
  const repeats = base.value.pass ? 1 : resolveRepeat(opts);
  for (let attempt = 2; attempt <= repeats + 1; attempt++) {
    const next = await run(attempt);
    if (next.isErr()) return err(next.error);
    outcomes.push(next.value);
    details.push(detailOf(next.value, attempt, details));
  }

  const verdict = assessVerdict(outcomes, opts);
  const warnings = buildWarnings(ecosystem, kind, details);
  return ok({
    ...verdict,
    ...(warnings.length > 0 ? { warnings } : {}),
  });
}

/** The warning lines the verdict carries for the UI/P-220. */
export function buildWarnings(
  ecosystem: Ecosystem,
  kind: 'build' | 'test',
  attempts: readonly AttemptDetail[]
): string[] {
  const warnings: string[] = [];
  if (attempts.length < 2) return warnings;

  const flakyFiles = flakySameFileSeen(attempts);
  for (const file of flakyFiles) {
    warnings.push(
      `${file} failed in some ${kind} attempts but not others for ${ecosystem} — treat it as flaky (P-267)`
    );
  }
  const anyDiffer = attempts.some((attempt, index) => {
    if (index === 0) return false;
    const previous = attempts[index - 1];
    if (previous?.logs === undefined || attempt.logs === undefined) return false;
    return logsDiffer(previous.logs.stdout, attempt.logs.stdout);
  });
  if (anyDiffer) {
    warnings.push(
      `${kind} output differed between attempts for ${ecosystem} — a timing-dependent test or a flaky network path is likely`
    );
  }
  return warnings;
}
