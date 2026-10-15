// P-174 — Sandbox: timeout and resource limits.
//
// A merged repo can contain an infinite loop, a huge allocation, or a network
// spin, so the sandbox must enforce HARD limits rather than hope the build
// behaves. This module is the mapping and the clock:
//
//   - `applyLimits(spec, cfg)` turns a `LimitsConfig` into the container's
//     resource fields (memory bytes, CPU cores, network posture);
//   - `enforceTimeout(fn, timeoutMs, signal)` bounds any sandbox operation and
//     gives the two codes P-163 needs to route differently — a time budget
//     (`SANDBOX_TIMEOUT`, the runaway-build class) versus a human/loop cancel
//     (`SANDBOX_ABORTED`);
//   - `defaultLimits(config)` reads `config.sandbox`, and `strictLimits()` is
//     the untrusted-code profile.
//
// The container-level enforcement (kill + remove on the budget) is P-168's
// `run` guarantee: its `finally` removes the container on every exit path,
// including its own timeout and abort — which is why this module needs no
// container reference and does not double-kill. `run` reports the SAME two
// codes, so a caller sees one vocabulary whichever layer catches the stop.
//
// UNITS: `config.sandbox.limits` speaks Docker's own notation (`memory: '2g'`,
// `cpu: '1'`, `timeout: 600` SECONDS), while `ContainerSpec` wants bytes and
// cores. The parsers below are the conversion, and an unparseable value is a
// typed `CONFIG_ERROR` — never a silent 0, which would remove the very limit
// that protects the host. See ADR-047.

import { ok, err, type Result } from 'neverthrow';
import { type StitchError } from '../result/index.js';
import { DEFAULT_LOG_CAPACITY, DEFAULT_MAX_ARTIFACT_BYTES } from './capture.js';
import type { ContainerSpec } from './client.js';

/** One mebibyte, the unit `memMb` and `memory` are expressed in. */
const MB = 1024 * 1024;

/** Compose the limits one sandbox run is allowed (phase step 1). */
export interface LimitsConfig {
  /** Wall-clock budget for one step, milliseconds. */
  timeoutMs: number;
  /** Memory cap, mebibytes. */
  memMb: number;
  /** CPU allowance, in cores (fractions allowed). */
  cpuCount: number;
  /** Captured log lines, shared with P-173's ring buffer. */
  outputLines: number;
  /** Extracted artifact bytes, shared with P-173's extraction budget. */
  maxArtifactBytes: number;
  /** Whether the container may reach the network. */
  networkAllowed: boolean;
}

/**
 * The fallback profile.
 *
 * `outputLines`/`maxArtifactBytes` come from P-173's constants rather than
 * being restated, so the log bound and the artifact budget have ONE home
 * (phase step 5).
 */
export const DEFAULT_LIMITS: LimitsConfig = {
  timeoutMs: 300_000,
  memMb: 1536,
  cpuCount: 2,
  outputLines: DEFAULT_LOG_CAPACITY,
  maxArtifactBytes: DEFAULT_MAX_ARTIFACT_BYTES,
  networkAllowed: true,
};

/**
 * The untrusted-code profile: a tight clock, one core, 512 MB, NO network.
 *
 * Only time/memory/CPU/network are tightened; the log and artifact bounds are
 * the same constants, because those protect memory rather than constrain the
 * code under test.
 */
export const STRICT_LIMITS: LimitsConfig = {
  timeoutMs: 60_000,
  memMb: 512,
  cpuCount: 1,
  outputLines: DEFAULT_LOG_CAPACITY,
  maxArtifactBytes: DEFAULT_MAX_ARTIFACT_BYTES,
  networkAllowed: false,
};

/** The `config.sandbox` slice `defaultLimits` reads (no whole-Config import). */
export interface LimitsConfigSource {
  limits?: { memory?: string; cpu?: string; timeout?: number };
  networkAllow?: boolean;
  maxArtifactBytes?: number;
}

// ---------------------------------------------------------------------------
// Unit parsing
// ---------------------------------------------------------------------------

/**
 * Parse a Docker-style memory size into mebibytes.
 *
 * Accepts `2g`, `512m`, `1.5g`, `1024k`, `2gb`, `512mb` (case-insensitive) and
 * a bare number, which is read as mebibytes — the unit the rest of this module
 * uses. Rejects zero, negatives, and anything with an unknown suffix.
 */
export function parseMemoryToMb(value: string): Result<number, StitchError> {
  const match = /^\s*(\d+(?:\.\d+)?)\s*([kmgt]?)(?:i?b)?\s*$/i.exec(value);
  if (match === null) {
    return err({
      code: 'CONFIG_ERROR',
      field: 'memory',
      message: `sandbox.limits.memory "${value}" is not a size (try 2g, 512m, 1536)`,
    });
  }
  const amount = Number(match[1]);
  const unit = (match[2] ?? '').toLowerCase();
  const factor = unit === 'k' ? 1 / 1024 : unit === 'g' ? 1024 : unit === 't' ? 1024 * 1024 : 1;
  const mb = Math.round(amount * factor);
  if (!Number.isFinite(mb) || mb <= 0) {
    return err({
      code: 'CONFIG_ERROR',
      field: 'memory',
      message: `sandbox.limits.memory "${value}" must be a positive size`,
    });
  }
  return ok(mb);
}

/** Parse `sandbox.limits.cpu` into a core count (fractions allowed). */
export function parseCpuCount(value: string): Result<number, StitchError> {
  const trimmed = value.trim();
  if (!/^\d+(?:\.\d+)?$/.test(trimmed)) {
    return err({
      code: 'CONFIG_ERROR',
      field: 'cpu',
      message: `sandbox.limits.cpu "${value}" is not a core count (try 1, 2, 0.5)`,
    });
  }
  const cores = Number(trimmed);
  if (!Number.isFinite(cores) || cores <= 0) {
    return err({
      code: 'CONFIG_ERROR',
      field: 'cpu',
      message: `sandbox.limits.cpu "${value}" must be a positive number of cores`,
    });
  }
  return ok(cores);
}

/**
 * Build the limits from `config.sandbox`, falling back to
 * {@link DEFAULT_LIMITS} for anything the config does not set.
 *
 * `limits.timeout` is SECONDS in the P-009 schema (default `600`), so it is
 * multiplied by 1000; the phase's own `300_000` fallback applies only when no
 * config is supplied at all. Returns `err` rather than silently dropping a
 * limit it cannot read.
 */
export function defaultLimits(config: LimitsConfigSource = {}): Result<LimitsConfig, StitchError> {
  let memMb = DEFAULT_LIMITS.memMb;
  if (config.limits?.memory !== undefined) {
    const parsed = parseMemoryToMb(config.limits.memory);
    if (parsed.isErr()) return err(parsed.error);
    memMb = parsed.value;
  }

  let cpuCount = DEFAULT_LIMITS.cpuCount;
  if (config.limits?.cpu !== undefined) {
    const parsed = parseCpuCount(config.limits.cpu);
    if (parsed.isErr()) return err(parsed.error);
    cpuCount = parsed.value;
  }

  let timeoutMs = DEFAULT_LIMITS.timeoutMs;
  if (config.limits?.timeout !== undefined) {
    const seconds = config.limits.timeout;
    if (!Number.isFinite(seconds) || seconds <= 0) {
      return err({
        code: 'CONFIG_ERROR',
        field: 'timeout',
        message: `sandbox.limits.timeout "${String(seconds)}" must be a positive number of seconds`,
      });
    }
    timeoutMs = Math.round(seconds * 1000);
  }

  return ok({
    timeoutMs,
    memMb,
    cpuCount,
    outputLines: DEFAULT_LIMITS.outputLines,
    maxArtifactBytes: config.maxArtifactBytes ?? DEFAULT_LIMITS.maxArtifactBytes,
    networkAllowed: config.networkAllow ?? DEFAULT_LIMITS.networkAllowed,
  });
}

// ---------------------------------------------------------------------------
// applyLimits
// ---------------------------------------------------------------------------

/**
 * Apply a limits profile to a container spec.
 *
 * Returns a NEW spec rather than mutating the caller's, matching how every
 * other spec-building helper in this epic behaves. The network posture is
 * expressed through `networkDisabled` (P-168 maps it to `NetworkMode: 'none'`),
 * and `cpus` is passed as cores — the client converts to `NanoCpus`.
 *
 * `OomKillDisable` is deliberately NOT set: disabling the OOM killer would let
 * a runaway allocation starve the host, which is the exact failure this phase
 * exists to prevent. The memory cap plus the daemon's default OOM policy is the
 * safe pair.
 */
export function applyLimits(spec: ContainerSpec, cfg: LimitsConfig): ContainerSpec {
  return {
    ...spec,
    memory: cfg.memMb * MB,
    cpus: cfg.cpuCount,
    networkDisabled: !cfg.networkAllowed,
  };
}

/** The capture settings a limits profile implies (shared bounds, step 5). */
export function limitsToCaptureOptions(cfg: LimitsConfig): {
  logCapacity: number;
  maxArtifactBytes: number;
} {
  return { logCapacity: cfg.outputLines, maxArtifactBytes: cfg.maxArtifactBytes };
}

// ---------------------------------------------------------------------------
// enforceTimeout
// ---------------------------------------------------------------------------

/**
 * Bound any sandbox operation by a wall clock and an abort signal.
 *
 * Returns the wrapped operation's own result when it settles first; otherwise
 * `SANDBOX_TIMEOUT` (the clock) or `SANDBOX_ABORTED` (the signal). Both are
 * distinct codes because P-163 routes them differently — one is a runaway
 * build, the other is somebody pressing stop.
 *
 * Container cleanup is not this function's job: P-168's `run` kills and removes
 * on its own timeout/abort (`finally`), so wrapping `client.run` with the same
 * budget means the container is already gone by the time this returns, and a
 * wrapper that also had to hold a container reference could not be generic.
 */
export async function enforceTimeout<T>(
  fn: () => Promise<Result<T, StitchError>>,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<Result<T, StitchError>> {
  if (signal?.aborted === true) {
    return err({ code: 'SANDBOX_ABORTED', message: 'sandbox operation aborted before start' });
  }
  return new Promise<Result<T, StitchError>>(resolve => {
    let settled = false;
    const finish = (outcome: Result<T, StitchError>): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolve(outcome);
    };
    const timer = setTimeout(
      () =>
        finish(
          err({
            code: 'SANDBOX_TIMEOUT',
            timeoutMs,
            message: `sandbox operation exceeded its time budget (${timeoutMs}ms)`,
          })
        ),
      timeoutMs
    );
    const onAbort = (): void =>
      finish(err({ code: 'SANDBOX_ABORTED', message: 'sandbox operation aborted' }));

    if (signal !== undefined) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }

    let started: Promise<Result<T, StitchError>>;
    try {
      started = fn();
    } catch (cause: unknown) {
      // A throwing operation is a bug in the operator, not a verdict: surface
      // it as a typed INTERNAL rather than letting it reject the wrapper.
      finish(
        err({
          code: 'INTERNAL',
          message: `sandbox operation threw: ${cause instanceof Error ? cause.message : String(cause)}`,
        })
      );
      return;
    }
    void Promise.resolve(started).then(
      outcome => finish(outcome),
      (cause: unknown) =>
        finish(
          err({
            code: 'INTERNAL',
            message: `sandbox operation rejected: ${cause instanceof Error ? cause.message : String(cause)}`,
          })
        )
    );
  });
}
