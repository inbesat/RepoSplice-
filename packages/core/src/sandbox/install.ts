// P-170 — Sandbox: install deps.
//
// The step between resolving an image (P-169) and building (P-171): mount the
// staged child repo C into a container and let the ecosystem install its
// dependencies there, never on the host. The result gates whether the build
// runs, so every outcome is explicit:
//
//   - exit 0            → `ok(InstallResult)`
//   - exit ≠ 0          → `err(DEP_INSTALL_FAILED)`
//   - offline + needed  → `err(DEP_INSTALL_OFFLINE_BLOCKED)` (never a hang)
//
// The install command is chosen per ecosystem from the workspace's own files
// (a committed lockfile, a `pyproject.toml`), mirroring the command knowledge
// P-114 already encoded for lockfile regeneration. The `node` commands are
// bun-based because the pinned node image is bun-ready (P-169/ADR-043) and
// P-155's build/test (`bun run build`, `bun test`) are too — one package
// manager, one lockfile story.
//
// Offline mode: a container started with `NetworkMode: 'none'` cannot reach a
// registry, and an install that needs one would either fail slowly or hang.
// Rather than probe the network we are denying, the caller must DECLARE the
// workspace offline-ready (`offlineReady`) — deps vendored or a warm cache —
// and only then do we run the same command with the network off. Otherwise the
// caller gets a typed `DEP_INSTALL_OFFLINE_BLOCKED`; P-175's GH-Actions path
// has network and handles it. See ADR-043.

import { ok, err, type Result } from 'neverthrow';
import { type StitchError } from '../result/index.js';
import { pathExists } from '../util/fs.js';
import { imageFor } from './images.js';
import { restoreCache, saveCache, type CacheKeyOptions, type SandboxCache } from './cache.js';
import type { ContainerRun, ContainerSpec, RunOptions } from './client.js';
import type { Ecosystem } from '../deps/index.js';

/** Where the staged child repo is mounted inside the container. */
export const WORKSPACE_MOUNT = '/workspace';

/** Default timeout for one install run (mirrors P-168's default budget). */
export const DEFAULT_INSTALL_TIMEOUT_MS = 600_000;

/** The lockfile names a `node` workspace may commit. */
export const NODE_LOCKFILES = ['bun.lock', 'bun.lockb', 'package-lock.json'] as const;

/** The install target for one ecosystem (phase step 1). */
export interface InstallSpec extends ContainerSpec {
  ecosystem: Ecosystem;
  /** Absolute host path of the staged child repo (mounted read-write). */
  repoPath: string;
  /** A specific lockfile to look for; defaults to {@link NODE_LOCKFILES}. */
  lockfileName?: string;
  /** P-168's offline switch; `false` starts the container with no network. */
  networkAllowed?: boolean;
}

/** What a completed install reports. */
export interface InstallResult {
  ecosystem: Ecosystem;
  /** The command line that ran, space-joined for logs. `(cached)` on a hit. */
  command: string;
  exitCode: number;
  /** `false` when a P-178 cache hit skipped the install entirely. */
  installed: boolean;
  /**
   * Always `false`: the install must only touch files inside the mounted
   * workspace, never the host — the flag anticipates P-181's provenance check.
   */
  dirty: boolean;
  /** Best-effort count parsed from stdout, when the tool printed one. */
  packageCount?: number;
  logs: { stdout: string[]; stderr: string[] };
  durationMs: number;
  /** P-178: `true` when the install was skipped because the cache hit. */
  cached?: boolean;
  /** P-178: the content key this install was looked up and recorded under. */
  cacheKey?: string;
  /** P-178: the image the install ran in, or the cached tag on a hit. */
  image?: string;
}

/** Options for {@link installDeps}. */
export interface InstallOptions {
  /**
   * The image ref to run. Defaults to {@link imageFor}`(ecosystem)` — pass the
   * resolved ref from P-169's `ensureImage` when an override or local build is
   * in play.
   */
  image?: string;
  /** A specific lockfile to look for in the workspace. */
  lockfileName?: string;
  /** Whether the container may reach the network. Default `true`. */
  networkAllowed?: boolean;
  /**
   * Declares the workspace is known to have its dependencies available offline
   * (vendored, or a warm cache). Required when `networkAllowed === false`,
   * because there is no honest way to prove a cache exists without the network
   * we are denying.
   */
  offlineReady?: boolean;
  /** Wall-clock budget for the install run. */
  timeoutMs?: number;
  /** Abort signal, forwarded to the container run. */
  signal?: AbortSignal;
  /**
   * P-178: reuse a recorded install for the same content key instead of
   * re-installing. Optional — with no cache the behaviour is unchanged.
   */
  cache?: SandboxCache;
  /** P-178: inputs for the cache key (`includeFiles`, the full-tree gate). */
  cacheKeyOptions?: CacheKeyOptions;
}

/** What `installDeps` needs from a container client (P-168 `SandboxClient`). */
export interface InstallClient {
  run(spec: ContainerSpec, opts?: RunOptions): Promise<Result<ContainerRun, StitchError>>;
}

// ---------------------------------------------------------------------------
// Command selection
// ---------------------------------------------------------------------------

/** The install command for an ecosystem, given what the workspace contains. */
async function installCommandFor(
  ecosystem: Ecosystem,
  repoPath: string,
  opts: InstallOptions
): Promise<Result<string[], StitchError>> {
  switch (ecosystem) {
    case 'node': {
      // A committed lockfile makes the install reproducible (`--frozen-lockfile`
      // mirrors P-114's bun-based path); without one, a plain install resolves.
      const names = opts.lockfileName !== undefined ? [opts.lockfileName] : [...NODE_LOCKFILES];
      for (const name of names) {
        const exists = await pathExists(repoPath, name);
        if (exists.isErr()) return err(exists.error);
        if (exists.value) return ok(['bun', 'install', '--frozen-lockfile']);
      }
      return ok(['bun', 'install']);
    }
    case 'python': {
      const pyproject = await pathExists(repoPath, 'pyproject.toml');
      if (pyproject.isErr()) return err(pyproject.error);
      return pyproject.value
        ? ok(['uv', 'sync'])
        : ok(['pip', 'install', '-r', 'requirements.txt']);
    }
    case 'rust':
      return ok(['cargo', 'fetch']);
    case 'go':
      return ok(['go', 'mod', 'download']);
  }
}

/** Best-effort installed-count parsed from the tool's stdout. */
export function countInstalled(
  ecosystem: Ecosystem,
  stdout: readonly string[]
): number | undefined {
  const text = stdout.join('\n');
  const match = (re: RegExp): number | undefined => {
    const found = re.exec(text);
    if (found === null) return undefined;
    const value = Number(found[1]);
    return Number.isFinite(value) ? value : undefined;
  };
  switch (ecosystem) {
    case 'node':
      return match(/(\d+)\s+packages?\s+installed/i);
    case 'python': {
      const line = stdout.find(l => /^Successfully installed\b/i.test(l.trim()));
      if (line === undefined) return undefined;
      const names = line
        .trim()
        .replace(/^Successfully installed\s*/i, '')
        .split(/\s+/)
        .filter(Boolean);
      return names.length > 0 ? names.length : undefined;
    }
    case 'rust':
      return match(/Downloaded\s+(\d+)/i);
    case 'go':
      return match(/Downloaded\s+(\d+)/i);
  }
}

// ---------------------------------------------------------------------------
// installDeps
// ---------------------------------------------------------------------------

/**
 * Install the staged repo's dependencies inside the sandbox.
 *
 * Returns `ok(InstallResult)` on exit 0, `err(DEP_INSTALL_FAILED)` on a
 * non-zero exit, and `err(DEP_INSTALL_OFFLINE_BLOCKED)` when the caller turned
 * the network off without declaring the workspace offline-ready.
 */
export async function installDeps(
  ecosystem: Ecosystem,
  repoPath: string,
  opts: InstallOptions,
  client: InstallClient
): Promise<Result<InstallResult, StitchError>> {
  if (repoPath.trim() === '') {
    return err({
      code: 'CONFIG_ERROR',
      field: 'repoPath',
      message: 'installDeps: repoPath is required',
    });
  }

  const networkAllowed = opts.networkAllowed ?? true;
  if (!networkAllowed && opts.offlineReady !== true) {
    return err({
      code: 'DEP_INSTALL_OFFLINE_BLOCKED',
      ecosystem,
      message:
        `installing ${ecosystem} dependencies needs the network, but network access is disabled and ` +
        `the workspace was not declared offline-ready (vendored deps / warm cache)`,
    });
  }

  const cache = opts.cache;
  let cacheKey: string | undefined;
  if (cache !== undefined) {
    // P-178: a repeat install for the same dependency state is skipped outright —
    // no container is created at all. `get` computes and returns the key, which
    // the store write below reuses, so the workspace is hashed only once.
    const lookup = await restoreCache(cache, ecosystem, repoPath, opts.cacheKeyOptions ?? {});
    // A failed read is reported through the cache's `read-failed` event and
    // degrades to a miss: a cache is an optimization and must never block an
    // install that would otherwise succeed (P-177's degrade rule).
    if (lookup.isOk()) {
      cacheKey = lookup.value.cacheKey;
      if (lookup.value.hit) {
        return ok({
          ecosystem,
          command: '(cached)',
          exitCode: 0,
          installed: false,
          cached: true,
          cacheKey,
          image: lookup.value.imageTag ?? opts.image ?? imageFor(ecosystem),
          dirty: false,
          logs: { stdout: [], stderr: [] },
          durationMs: 0,
        });
      }
    }
  }

  const command = await installCommandFor(ecosystem, repoPath, opts);
  if (command.isErr()) return err(command.error);

  const spec: ContainerSpec = {
    image: opts.image ?? imageFor(ecosystem),
    workingDir: WORKSPACE_MOUNT,
    // Read-write for install: the package manager must populate the workspace.
    bindMounts: [{ host: repoPath, container: WORKSPACE_MOUNT }],
    cmd: command.value,
    networkDisabled: !networkAllowed,
  };

  const runOptions: RunOptions = {
    timeoutMs: opts.timeoutMs ?? DEFAULT_INSTALL_TIMEOUT_MS,
    ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
  };
  const ran = await client.run(spec, runOptions);
  if (ran.isErr()) return err(ran.error);

  const outcome = ran.value;
  if (outcome.exitCode !== 0) {
    return err({
      code: 'DEP_INSTALL_FAILED',
      exitCode: outcome.exitCode,
      stderr: outcome.stderr.join('\n'),
      message: `installing ${ecosystem} dependencies exited ${outcome.exitCode}: ${command.value.join(' ')}`,
    });
  }

  const packageCount = countInstalled(ecosystem, outcome.stdout);

  // P-178: record the successful install so the next run for the same content
  // skips it. Best-effort: a failed write is reported through the cache's
  // `write-failed` event and must not turn a successful install into a failure.
  if (cache !== undefined) {
    await saveCache(
      cache,
      ecosystem,
      repoPath,
      { imageTag: spec.image, command: command.value.join(' ') },
      {
        ...(cacheKey !== undefined ? { cacheKey } : {}),
        ...(opts.cacheKeyOptions !== undefined ? opts.cacheKeyOptions : {}),
      }
    );
  }

  return ok({
    ecosystem,
    command: command.value.join(' '),
    exitCode: outcome.exitCode,
    installed: true,
    cached: false,
    dirty: false,
    ...(cacheKey !== undefined ? { cacheKey } : {}),
    image: spec.image,
    ...(packageCount !== undefined ? { packageCount } : {}),
    logs: { stdout: outcome.stdout, stderr: outcome.stderr },
    durationMs: outcome.durationMs,
  });
}
