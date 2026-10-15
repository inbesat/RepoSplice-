// P-171 — Sandbox: run build.
//
// The central verification: does merged C actually build? `runBuild` runs the
// ecosystem's build command inside a sandbox container (after P-170's install)
// and returns a VERDICT, not an error, for a failed build — the agent loop
// (P-155's `run_build`) and the pipeline gate (P-238) need `pass: false` so
// they can iterate, and only an infrastructure problem (no image, a crashed or
// timed-out container) is a typed `err`.
//
// The verdict shape is FROZEN (`BuildResult`): the web sandbox panel (P-220)
// and CLI progress (P-199) render it directly.
//
// The build commands mirror what P-155 already pinned for the agent tool, with
// one deliberate difference the phase spec states: rust builds `--release`
// (P-155's `ECOSYSTEM_COMMANDS.rust` is a plain `cargo build`; the phase's
// dependency note says "the agent run_build stub now points here", so this map
// is the sandbox path's authority). See ADR-044.

import { ok, err, type Result } from 'neverthrow';
import { type StitchError } from '../result/index.js';
import { imageFor } from './images.js';
import { WORKSPACE_MOUNT } from './install.js';
import type { ContainerRun, ContainerSpec, RunOptions } from './client.js';
import type { Ecosystem } from '../deps/index.js';

/** Re-exported so a build caller does not have to reach into `install.ts`. */
export { WORKSPACE_MOUNT };

/** Optional writable mount for build outputs (the phase's `/buildout`). */
export const BUILDOUT_MOUNT = '/buildout';

/** Default wall-clock budget for one build. */
export const DEFAULT_BUILD_TIMEOUT_MS = 900_000;

/** Log lines kept per stream — the phase's explicit memory bound. */
export const MAX_BUILD_LOG_LINES = 500;

/** The build command per ecosystem (phase step 2). */
export const BUILD_COMMANDS: Readonly<Record<Ecosystem, string[]>> = {
  node: ['bun', 'run', 'build'],
  python: ['python', '-m', 'build'],
  rust: ['cargo', 'build', '--release'],
  go: ['go', 'build', './...'],
};

/** Where an ecosystem's build output lands, when it has one. */
export const DEFAULT_OUTPUT_DIRS: Readonly<Record<Ecosystem, string | undefined>> = {
  node: 'dist',
  python: 'dist',
  rust: 'target',
  go: undefined,
};

/** The frozen verdict shape (web P-220 + CLI P-199 render it). */
export interface BuildResult {
  pass: boolean;
  command: string;
  exitCode: number;
  durationMs: number;
  logs: { stdout: string[]; stderr: string[] };
  /** Host path of the copied-out artifacts, when any were requested and found. */
  outputDir?: string;
}

/** Options for {@link runBuild}. */
export interface RunBuildOptions {
  /** The image ref to run. Defaults to {@link imageFor}`(ecosystem)`. */
  image?: string;
  /**
   * Container-relative artifact directory to copy out (`dist`, `target`).
   * Defaults to {@link DEFAULT_OUTPUT_DIRS}`[ecosystem]`.
   */
  outputDir?: string;
  /** Host directory the artifacts are copied into. Required to copy any out. */
  artifactTarget?: string;
  /** Host dir mounted writable at `/buildout` for out-of-tree outputs. */
  buildoutDir?: string;
  /** Extra environment entries for the build container. */
  env?: Record<string, string>;
  /** Wall-clock budget. */
  timeoutMs?: number;
  /** Abort signal, forwarded to the container run. */
  signal?: AbortSignal;
}

/** What `runBuild` needs from a container client (P-168 `SandboxClient`). */
export interface BuildClient {
  run(spec: ContainerSpec, opts?: RunOptions): Promise<Result<ContainerRun, StitchError>>;
}

/** Keep only the newest `max` lines of a stream (the phase's bound). */
export function boundLogLines(lines: readonly string[], max = MAX_BUILD_LOG_LINES): string[] {
  if (max <= 0) return [];
  return lines.length <= max ? [...lines] : lines.slice(-max);
}

/**
 * Build the staged repo inside the sandbox and report the verdict.
 *
 * `ok(BuildResult{pass:false})` IS a result — a failing build is what the loop
 * iterates on. Only infrastructure failures (a container error from the client)
 * return `err`.
 */
export async function runBuild(
  ecosystem: Ecosystem,
  repoPath: string,
  opts: RunBuildOptions,
  client: BuildClient
): Promise<Result<BuildResult, StitchError>> {
  if (repoPath.trim() === '') {
    return err({
      code: 'CONFIG_ERROR',
      field: 'repoPath',
      message: 'runBuild: repoPath is required',
    });
  }

  const command = BUILD_COMMANDS[ecosystem];
  const bindMounts: ContainerSpec['bindMounts'] = [{ host: repoPath, container: WORKSPACE_MOUNT }];
  if (opts.buildoutDir !== undefined && opts.buildoutDir.trim() !== '') {
    bindMounts.push({ host: opts.buildoutDir, container: BUILDOUT_MOUNT });
  }

  const spec: ContainerSpec = {
    image: opts.image ?? imageFor(ecosystem),
    workingDir: WORKSPACE_MOUNT,
    bindMounts,
    cmd: command,
    ...(opts.env !== undefined ? { env: opts.env } : {}),
  };

  const outputDir = opts.outputDir ?? DEFAULT_OUTPUT_DIRS[ecosystem];
  const wantCapture = outputDir !== undefined && opts.artifactTarget !== undefined;

  const ran = await client.run(spec, {
    timeoutMs: opts.timeoutMs ?? DEFAULT_BUILD_TIMEOUT_MS,
    ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
    // The capture rides WITH the run: P-168 removes the container in a
    // `finally`, so the artifacts must be lifted out inside its lifetime, and
    // the verdict is not known until the run returns. A capture that finds
    // nothing is not an error — many projects produce no output directory.
    ...(wantCapture
      ? {
          capture: {
            containerPath: `${WORKSPACE_MOUNT}/${outputDir}`,
            hostDir: opts.artifactTarget as string,
          },
        }
      : {}),
  });
  // An infrastructure failure is the only `err` this phase produces.
  if (ran.isErr()) return err(ran.error);

  const outcome = ran.value;
  const pass = outcome.exitCode === 0;

  const result: BuildResult = {
    pass,
    command: command.join(' '),
    exitCode: outcome.exitCode,
    durationMs: outcome.durationMs,
    logs: {
      stdout: boundLogLines(outcome.stdout),
      stderr: boundLogLines(outcome.stderr),
    },
  };

  // Report the artifacts only when this run REQUESTED a capture and the build
  // passed; a red build's `outputDir` absence is the honest answer even if a
  // capture happened to succeed.
  if (wantCapture && pass && outcome.capturedArchive !== undefined) {
    return ok({ ...result, outputDir: outcome.capturedArchive });
  }
  return ok(result);
}
