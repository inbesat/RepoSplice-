// P-204 — `perfFlags`: the shared parse/validate for the optimization flags.
//
// `stitch merge` and `stitch serve` accept `--jobs`, `--memory`, `--timeout`,
// `--max-files`, `--max-size` and `--concurrency`. This module is the ONE place
// that coerces them into a typed `PerfConfig`, validates the ranges, and formats
// the effective values for the user — so merge/serve cannot drift apart.
//
// ON THE ERROR CLASS: the phase names `err('BAD_OPTION')` for out-of-range flags
// (usage, exit 2). BAD_OPTION does NOT exist in `StitchError` (grepped; adding a
// code is the coordinated change ADR-072 measured), so out-of-range values are a
// `CONFIG_ERROR` on `field: 'perf.<flag>'` — the P-239/P-246 phantom precedent.
// The CLI face keeps the spec's exit 2 for MALFORMED values by the commander
// `parseArg` guard in `cli.ts` (non-integer → `InvalidArgumentError` → the
// usage/exit-2 path of P-203); a well-formed integer that violates a range is a
// config-class error (exit 3).

import { cpus } from 'node:os';
import { err, ok, type Result } from 'neverthrow';
import type { StitchError } from '@repo-stitcher/core';

/** The typed outcome: every knob the pipeline can consume (P-243/P-176/P-148). */
export interface PerfConfig {
  /** Parallel sandbox/build jobs. */
  jobs: number;
  /** Sandbox/agent memory cap in MB. */
  memoryMb: number;
  /** Whole-operation cap in seconds; 0 = unlimited. */
  timeoutSec: number;
  /** Selection file-count cap. */
  maxFiles: number;
  /** Selection byte cap in MB. */
  maxSizeMb: number;
  /** AI/dependency async-call concurrency. */
  concurrency: number;
}

/**
 * The code-level defaults. The spec says "defaults from `[perf]` config", but
 * core's `ConfigSchema` has no `[perf]` section (grepped), so the defaults live
 * here; `parsePerfFlags(raw, overrides)` lets callers layer config-derived
 * values on top when a section ever grows.
 */
export const DEFAULT_PERF: PerfConfig = {
  jobs: Math.max(1, cpus().length),
  memoryMb: 2048,
  timeoutSec: 0,
  maxFiles: 50_000,
  maxSizeMb: 512,
  concurrency: 8,
};

/** What a command hands over: raw flag values, before coercion. */
export interface PerfFlagsInput {
  /** `--jobs`: parallel sandbox/build jobs. */
  jobs?: number | string | undefined;
  /** `--memory`: sandbox/agent memory cap in MB. */
  memory?: number | string | undefined;
  /** `--timeout`: whole-operation cap in seconds; 0 = unlimited. */
  timeout?: number | string | undefined;
  /** `--max-files`: selection file-count cap. */
  maxFiles?: number | string | undefined;
  /** `--max-size`: selection byte cap in MB. */
  maxSize?: number | string | undefined;
  /** `--concurrency`: AI/dependency async-call concurrency. */
  concurrency?: number | string | undefined;
}

/** One raw perf flag: where it lives in `PerfConfig`, its flag spelling, its floor. */
const FLAGS: ReadonlyArray<
  readonly [raw: keyof PerfFlagsInput, target: keyof PerfConfig, flag: string, min: number]
> = [
  ['jobs', 'jobs', '--jobs', 1],
  ['memory', 'memoryMb', '--memory', 1],
  ['timeout', 'timeoutSec', '--timeout', 0],
  ['maxFiles', 'maxFiles', '--max-files', 1],
  ['maxSize', 'maxSizeMb', '--max-size', 1],
  ['concurrency', 'concurrency', '--concurrency', 1],
];

/**
 * One number out of a raw flag. Empty-string → `undefined` (the flag was given
 * no value and falls to the default) — this also guards the `Number('') === 0`
 * trap, which would otherwise let `--timeout ''` slip through as valid 0.
 */
function coerce(raw: number | string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const text = typeof raw === 'string' ? raw.trim() : String(raw);
  // Empty-string → the flag was given no value; fall to the default. Also
  // guards the `Number('') === 0` trap (`--timeout ''` would pass as valid 0).
  if (text === '') return undefined;
  const value = Number(text);
  return Number.isFinite(value) ? value : NaN; // NaN ⇒ rejected by the range check
}

/**
 * Validate and merge the perf flags.
 *
 * Chain: `DEFAULT_PERF` ← `overrides` (config-derived values) ← `raw` (flags).
 * Every well-formed integer must respect its range; anything else is a
 * `CONFIG_ERROR` whose `field` names the exact flag and whose message states
 * the bound.
 */
export function parsePerfFlags(
  raw: PerfFlagsInput,
  overrides: Partial<PerfConfig> = {}
): Result<PerfConfig, StitchError> {
  const config = { ...DEFAULT_PERF, ...overrides };
  for (const [key, target, flag, min] of FLAGS) {
    const value = coerce(raw[key]);
    if (value === undefined) continue;
    if (!Number.isInteger(value) || value < min) {
      return err({
        code: 'CONFIG_ERROR',
        field: `perf.${flag.slice(2)}`,
        message: `${flag} must be an integer, ${min === 0 ? '>= 0' : `>= ${min}`}; got ${JSON.stringify(raw[key] ?? null)}`,
      });
    }
    config[target] = value;
  }
  return ok(config);
}

/**
 * Enforce the selection caps BEFORE any work happens (the phase's "hard
 * guardrail"). The `EXCEEDS_MAX_FILES` / `EXCEEDS_MAX_SIZE` phantoms resolve to
 * `CONFIG_ERROR` on `field: 'perf.max-files'` / `'perf.max-size'`, each message
 * naming the flag that clears it.
 */
export function checkCaps(
  count: number,
  totalBytes: number,
  perf: PerfConfig
): Result<void, StitchError> {
  if (count > perf.maxFiles) {
    return err({
      code: 'CONFIG_ERROR',
      field: 'perf.max-files',
      message: `selection resolves to ${count} files, exceeding the --max-files ${perf.maxFiles} cap`,
    });
  }
  if (totalBytes > perf.maxSizeMb * 1024 * 1024) {
    return err({
      code: 'CONFIG_ERROR',
      field: 'perf.max-size',
      message: `selection is ${totalBytes} bytes, exceeding the --max-size ${perf.maxSizeMb} cap`,
    });
  }
  return ok(undefined);
}

/** The effective values, one line — what the user's flags actually bought. */
export function describePerf(perf: PerfConfig): string {
  const timeout = perf.timeoutSec === 0 ? 'unlimited' : `${perf.timeoutSec}s`;
  return (
    `perf: jobs=${perf.jobs} memory=${perf.memoryMb}MB timeout=${timeout}` +
    ` max-files=${perf.maxFiles} max-size=${perf.maxSizeMb}MB concurrency=${perf.concurrency}`
  );
}
