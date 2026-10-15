// P-175/P-176 — the verification dispatcher.
//
// One entry point for "run C's build (or tests) somewhere": resolve the backend
// (P-175), then either drive the Docker path (P-171/P-172) or the GitHub
// Actions fallback, and hand back the SAME result shape either way. The agent
// tool (`run_build`, P-155) and the pipeline call this so no consumer has to
// know which backend ran.
//
// P-176 adds the repeat check on top of it: when `flakyCheck` is set (from
// `config.sandbox.flakyCheck`, default OFF), the first attempt is confirmed by
// a bounded re-run and the resulting `Verdict` rides on the returned result. The
// nested re-runs go through the same dispatcher with `flakyCheck` cleared, so a
// repeat can never recurse.
//
// `unavailable` is the only new failure mode here: no Docker AND no usable
// GitHub path is a wiring/configuration state, reported as the existing
// `SANDBOX_UNAVAILABLE` (P-155 added it for exactly this: "nothing ran at all",
// distinct from a build that ran and failed).

import { ok, err, type Result } from 'neverthrow';
import { type StitchError } from '../result/index.js';
import {
  fallbackSelection,
  runViaGitHubActions,
  type GitHubFallbackOptions,
  type SelectionSource,
} from './fallback.js';
import { runBuild, type BuildClient, type BuildResult } from './build.js';
import { runTests, type TestClient, type TestResult } from './test.js';
import { checkFlaky, type Verdict } from './verdict.js';
import type { SandboxCache, CacheKeyOptions } from './cache.js';
import {
  withCleanup,
  type CleanupClient,
  type CleanupSummary,
  type CleanupTracker,
} from './cleanup.js';
import type { Ecosystem } from '../deps/index.js';

/** Which verification to run. */
export type VerificationKind = 'build' | 'test';

/** Options for {@link runVerification}. */
export interface RunVerificationOptions {
  /** The Docker client (P-168). Required for the Docker path. */
  dockerClient?: BuildClient & TestClient;
  /** Image ref from P-169's `ensureImage`. */
  image?: string;
  /** Build-only: artifact directory to lift out (P-171). */
  outputDir?: string;
  /** Build-only: host dir the artifacts are copied into (P-171). */
  artifactTarget?: string;
  /** Host dir mounted writable at `/buildout` (P-171/P-172). */
  buildoutDir?: string;
  /** Extra environment for the container. */
  env?: Record<string, string>;
  /** Wall-clock budget, seconds-level for Docker, minutes-level for GH. */
  timeoutMs?: number;
  /** Abort signal (Docker path). */
  signal?: AbortSignal;
  /** Test-only: cap on reported failures (P-172). */
  maxFailures?: number;
  /** What the backend selection should consider (P-175). */
  selection?: SelectionSource;
  /** GitHub fallback wiring; required only when the selection picks GitHub. */
  github?: GitHubFallbackOptions;
  /**
   * P-176: confirm the first attempt with a bounded re-run and attach the
   * `Verdict`. Comes from `config.sandbox.flakyCheck`; default OFF.
   */
  flakyCheck?: boolean;
  /** P-176: extra attempts for a failing base. Clamped by P-176. */
  flakyRepeat?: number;
  /**
   * P-178: resolve the run image from the install-layer cache. When the caller
   * does not pass `image`, a cache hit supplies the tag a previous install
   * recorded; a miss (or a cache error) leaves `image` alone.
   */
  cache?: {
    cache: SandboxCache;
    keyOptions?: CacheKeyOptions;
  };
  /**
   * P-177: cleanup wiring. When a tracker is supplied, the whole dispatch —
   * including P-176's repeats — runs inside `withCleanup`, so resources are
   * swept on success, failure AND abort. Without one, nothing is swept (the
   * per-run container removal P-168 already does inside `run` still applies).
   */
  cleanup?: {
    client?: CleanupClient;
    tracker?: CleanupTracker;
    /** `config.sandbox.pruneImages` (default false). */
    pruneImages?: boolean;
    /** Receives the cleanup summary for logging/tracing. */
    onSummary?: (summary: CleanupSummary) => void;
  };
}

/** A run outcome plus the P-176 verdict, when the repeat check ran. */
export type VerifiedRun = (BuildResult | TestResult) & { verdict?: Verdict };

/**
 * Run one verification step on whichever backend is available.
 *
 * Both paths return the Docker path's own `BuildResult`/`TestResult`, so the
 * caller narrows on the `kind` it asked for and never on the backend.
 */
export async function runVerification(
  kind: VerificationKind,
  ecosystem: Ecosystem,
  repoPath: string,
  opts: RunVerificationOptions = {}
): Promise<Result<VerifiedRun, StitchError>> {
  // P-178: take the run image from the install-layer cache when the caller named
  // none. Resolved ONCE, before the body, so P-176's repeats reuse the same tag.
  const cachedImage = await resolveCachedImage(ecosystem, repoPath, opts);
  const effective: RunVerificationOptions =
    cachedImage === undefined ? opts : { ...opts, image: cachedImage };

  const body = async (): Promise<Result<VerifiedRun, StitchError>> => {
    const first = await dispatchOnce(kind, ecosystem, repoPath, effective);
    if (first.isErr()) return err(first.error);

    if (effective.flakyCheck !== true) return ok(first.value);

    // The base run is reused as attempt 1; later attempts re-dispatch with the
    // repeat check cleared so a re-run can never recurse.
    const checked = await checkFlaky(
      ecosystem,
      repoPath,
      kind,
      {
        enabled: true,
        ...(effective.flakyRepeat !== undefined ? { repeat: effective.flakyRepeat } : {}),
      },
      attempt =>
        attempt === 1
          ? Promise.resolve(ok(first.value))
          : dispatchOnce(kind, ecosystem, repoPath, { ...effective, flakyCheck: false })
    );
    if (checked.isErr()) return err(checked.error);
    return ok({ ...first.value, verdict: checked.value });
  };

  // P-177: the `finally` guarantee. A tracker means "sweep whatever I recorded
  // as well", including when the body throws.
  const tracker = effective.cleanup?.tracker;
  if (tracker === undefined) return body();
  return withCleanup(
    effective.cleanup?.client,
    tracker,
    {
      ...(effective.cleanup?.pruneImages !== undefined
        ? { pruneImages: effective.cleanup.pruneImages }
        : {}),
      ...(effective.cleanup?.onSummary !== undefined
        ? { onSummary: effective.cleanup.onSummary }
        : {}),
    },
    body
  );
}

/**
 * P-178: the image to run, taken from the install-layer cache when the caller
 * named none.
 *
 * A cache error is deliberately NOT a run error: the run proceeds with whatever
 * image the caller supplied (or the ecosystem default) and the cache reports the
 * failure through its own event sink. Making a cache outage fail a verification
 * would be a worse trade than a cold run.
 */
async function resolveCachedImage(
  ecosystem: Ecosystem,
  repoPath: string,
  opts: RunVerificationOptions
): Promise<string | undefined> {
  const wiring = opts.cache;
  if (wiring === undefined || opts.image !== undefined) return undefined;
  const lookup = await wiring.cache.get(ecosystem, repoPath, wiring.keyOptions ?? {});
  return lookup.isOk() && lookup.value.hit ? lookup.value.imageTag : undefined;
}

/** One dispatch, with no repeat logic (the recursion guard for P-176). */
async function dispatchOnce(
  kind: VerificationKind,
  ecosystem: Ecosystem,
  repoPath: string,
  opts: RunVerificationOptions
): Promise<Result<BuildResult | TestResult, StitchError>> {
  const choice = fallbackSelection(opts.selection);
  if (choice === 'unavailable') {
    return err({
      code: 'SANDBOX_UNAVAILABLE',
      message:
        'no sandbox backend is available: Docker is not reachable and no usable GitHub Actions path is configured',
    });
  }

  if (choice === 'github') {
    if (opts.github === undefined) {
      return err({
        code: 'CONFIG_ERROR',
        field: 'github',
        message:
          'runVerification: the GitHub fallback was selected but no github options were supplied',
      });
    }
    return runViaGitHubActions(ecosystem, repoPath, kind, opts.github);
  }

  // Docker.
  if (opts.dockerClient === undefined) {
    return err({
      code: 'CONFIG_ERROR',
      field: 'dockerClient',
      message: 'runVerification: the Docker backend was selected but no dockerClient was supplied',
    });
  }
  if (kind === 'build') {
    return runBuild(
      ecosystem,
      repoPath,
      {
        ...(opts.image !== undefined ? { image: opts.image } : {}),
        ...(opts.outputDir !== undefined ? { outputDir: opts.outputDir } : {}),
        ...(opts.artifactTarget !== undefined ? { artifactTarget: opts.artifactTarget } : {}),
        ...(opts.buildoutDir !== undefined ? { buildoutDir: opts.buildoutDir } : {}),
        ...(opts.env !== undefined ? { env: opts.env } : {}),
        ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
        ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
      },
      opts.dockerClient
    );
  }
  return runTests(
    ecosystem,
    repoPath,
    {
      ...(opts.image !== undefined ? { image: opts.image } : {}),
      ...(opts.buildoutDir !== undefined ? { buildoutDir: opts.buildoutDir } : {}),
      ...(opts.env !== undefined ? { env: opts.env } : {}),
      ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
      ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
      ...(opts.maxFailures !== undefined ? { maxFailures: opts.maxFailures } : {}),
    },
    opts.dockerClient
  );
}
