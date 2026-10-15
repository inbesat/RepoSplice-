// P-168 — Sandbox: Docker client.
//
// The container-lifecycle wrapper the rest of the Sandbox epic builds on
// (P-169 images, P-170 install, P-171 build, P-172 test, P-173 capture,
// P-174 limits, P-177 cleanup). `dockerode` (P-029) is the transport; this
// module is the thin, testable surface over it, so no other phase talks to
// `dockerode` directly and every container operation is exercised in unit
// tests with an injected fake.
//
// Design points that matter:
//
// - **Injected instance, not a module-global.** The constructor takes a
//   `DockerLike`; `SandboxClient.create()` builds a real one via the P-067
//   `createDockerClient` factory. Tests pass a fake — no daemon, no Docker.
//   The seam is a NARROW structural interface (the `DockerPingable` precedent
//   in `docker.ts`), so a fake is a few lines rather than a `dockerode` mock,
//   and the real `Docker` satisfies it structurally.
// - **Availability NEVER throws.** `isAvailable()` delegates to the P-067
//   `pingDocker` probe and returns a boolean; `false` is the expected state
//   that drives the P-175 GH Actions fallback, not an error.
// - **Cleanup is structural.** `run()` removes its container in a `finally`,
//   so a timeout, an abort, a start failure, or a log failure all still leave
//   no container behind. `rm()` never throws (cleanup is best-effort by
//   contract) — it is the last thing that should be able to fail a job.
// - **Logs are demultiplexed and bounded.** Docker multiplexes stdout/stderr
//   into one stream with 8-byte frame headers when TTY is off; `demuxDockerLogs`
//   splits them, falls back to "everything is stdout" for a raw/TTY stream, and
//   keeps at most `maxLogLines` per stream so a chatty build cannot exhaust
//   memory (the phase handoff's explicit requirement).
// - **Network posture is explicit.** `networkAllow: false` (config
//   `sandbox.networkAllow`, see ADR-041) OR `spec.networkDisabled` starts the
//   container with `NetworkMode: 'none'`.

import { ok, err, type Result } from 'neverthrow';
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type Docker from 'dockerode';
import { type StitchError } from '../result/index.js';
import { createDockerClient, pingDocker, type DockerClientOptions } from './docker.js';

/** How many log lines per stream are kept (the phase handoff's bound). */
export const MAX_CONTAINER_LOG_LINES = 500;

/** Default wall-clock budget for one container run. */
export const DEFAULT_RUN_TIMEOUT_MS = 600_000;

// ---------------------------------------------------------------------------
// Narrow structural dockerode seam (real client satisfies it; tests fake it)
// ---------------------------------------------------------------------------

/** `HostConfig` fields this client sets. */
export interface HostConfigLike {
  Binds?: string[];
  Memory?: number;
  NanoCpus?: number;
  NetworkMode?: string;
}

/**
 * The `createContainer` options this client builds.
 *
 * Aliased to dockerode's own `ContainerCreateOptions` rather than a narrowed
 * shape: a narrow required-`Image` interface makes an overloaded
 * `Docker.createContainer` assignment fail on arity, and the real type is
 * already all-optional, so a structural supertype is both looser where it
 * must be and honest about the wire contract.
 */
export type ContainerCreateOptionsLike = Docker.ContainerCreateOptions;

/** The `buildImage` options this client sets (dockerode's `ImageBuildOptions`). */
export interface ImageBuildOptionsLike {
  /** The tag to produce (`-t`). */
  t?: string;
  /** Dockerfile path (`-f`), absolute or relative to the context. */
  dockerfile?: string;
  /** `--build-arg` values. */
  buildargs?: Record<string, string>;
}

/** The container operations the client uses. */
export interface ContainerLike {
  /** The daemon-side id, when the handle exposes one (used in errors). */
  readonly id?: string;
  start(): Promise<unknown>;
  wait(options?: {
    condition?: 'not-running' | 'next-exit' | 'removed';
    abortSignal?: AbortSignal;
  }): Promise<unknown>;
  logs(options?: { stdout?: boolean; stderr?: boolean }): Promise<Buffer | string>;
  remove(options?: { force?: boolean; v?: boolean }): Promise<unknown>;
  stats(options?: { stream?: false }): Promise<unknown>;
  inspect(): Promise<unknown>;
  getArchive(options?: { path: string }): Promise<NodeJS.ReadableStream>;
  /** The raw multiplexed log stream (P-173), for a live capture. */
  followLogs(): Promise<NodeJS.ReadableStream>;
}

/** The dockerode surface the client uses. */
export interface DockerLike {
  ping(): Promise<unknown>;
  pull(repoTag: string, options?: { platform?: string }): Promise<unknown>;
  buildImage(
    file: string | NodeJS.ReadableStream,
    options: ImageBuildOptionsLike
  ): Promise<unknown>;
  createContainer(options: ContainerCreateOptionsLike): Promise<ContainerLike>;
  getContainer(id: string): ContainerLike;
}

/**
 * Adapt a real `Docker` / `Container` to the narrow seams.
 *
 * Needed because dockerode declares `createContainer`, `wait`, `logs`,
 * `remove` and `stats` as OVERLOAD SETS (`(options, callback)` + `(options)`),
 * and TypeScript checks a single-signature target against the first overload
 * only — so assigning the instance directly fails with `Expected 2 or more
 * arguments, but got 1`. Naming each member explicitly sidesteps the
 * structural-overload comparison entirely, with no cast, and records exactly
 * which dockerode calls this client is allowed to make.
 */
function adaptContainer(container: Docker.Container): ContainerLike {
  return {
    id: container.id,
    start: () => container.start(),
    wait: options => container.wait(options ?? {}),
    logs: options => container.logs(options ?? {}),
    remove: options => container.remove(options ?? {}),
    stats: options => container.stats(options ?? {}),
    inspect: () => container.inspect(),
    getArchive: options => container.getArchive(options ?? {}),
    followLogs: () => container.logs({ stdout: true, stderr: true, follow: true }),
  };
}

function adaptDocker(docker: Docker): DockerLike {
  return {
    ping: () => docker.ping(),
    pull: (repoTag, options) => docker.pull(repoTag, options ?? {}),
    buildImage: (file, options) => docker.buildImage(file, options),
    createContainer: async options => adaptContainer(await docker.createContainer(options)),
    getContainer: id => adaptContainer(docker.getContainer(id)),
  };
}

// ---------------------------------------------------------------------------
// Public shapes
// ---------------------------------------------------------------------------

/** What to run. Verbatim from the phase spec (PHASES_DETAILED.md:8502). */
export interface ContainerSpec {
  image: string;
  workingDir: string;
  bindMounts?: { host: string; container: string }[];
  env?: Record<string, string>;
  cmd?: string[];
  memory?: number;
  cpus?: number;
  networkDisabled?: boolean;
}

/** What a finished container reports. */
export interface ContainerRun {
  exitCode: number;
  /** Captured stdout, newest lines kept, bounded by `maxLogLines`. */
  stdout: string[];
  /** Captured stderr, newest lines kept, bounded by `maxLogLines`. */
  stderr: string[];
  durationMs: number;
  /** Host archive path, when `RunOptions.capture` succeeded. */
  capturedArchive?: string;
}

/** A point-in-time resource sample (P-173 capture / P-174 limits). */
export interface SandboxStats {
  /** CPU utilisation as a percentage (0 when the daemon reports nothing). */
  cpuPercent: number;
  /** Bytes of memory in use (0 when unknown). */
  memoryUsage: number;
  /** Bytes of the memory limit (0 when unknown). */
  memoryLimit: number;
}

/** Options for {@link SandboxClient.pull}. */
export interface PullOptions {
  /** Pull the image for a specific platform (e.g. `linux/amd64`). */
  platform?: string;
  /** Streaming-progress hook; receives raw pull chunks. */
  onProgress?: (chunk: string) => void;
}

/** Options for {@link SandboxClient.buildImage}. */
export interface BuildImageOptions {
  /** Build context: a path to a tar archive, or a readable stream. */
  context: string | NodeJS.ReadableStream;
  /** The tag to produce (e.g. `stitch-node:eph-1a2b3c`). */
  tag: string;
  /** Dockerfile path (`-f`), absolute or relative to the context. */
  dockerfile?: string;
  /** `--build-arg` values. */
  buildArgs?: Record<string, string>;
  /** Streaming-progress hook; receives raw build chunks. */
  onProgress?: (chunk: string) => void;
}

/** Options for {@link SandboxClient.run}. */
export interface RunOptions {
  /** Wall-clock budget. Default {@link DEFAULT_RUN_TIMEOUT_MS}. */
  timeoutMs?: number;
  /** Abort signal; aborting kills and removes the container. */
  signal?: AbortSignal;
  /**
   * Copy a container path out to the host before the container is removed.
   *
   * P-171 needs build artifacts, and P-168's `run` removes its container in a
   * `finally` — so the copy must happen INSIDE the container's lifetime, which
   * is what this requests. A failed capture never fails the run (the command
   * ran); the absence is reported by an undefined `capturedArchive`.
   */
  capture?: { containerPath: string; hostDir: string };
  /**
   * P-173: receive the container's output lines.
   *
   * Delivered from the collected log buffer when the run settles (the entries
   * the client already reads), so a capture sink sees the same bytes without a
   * second reader racing the daemon. Callers that want lines as they are
   * emitted use {@link SandboxClient.followLogs} instead.
   */
  onLog?: (line: string) => void;
}

/** Construction options for {@link SandboxClient}. */
export interface SandboxClientOptions {
  /** The dockerode instance (or a fake). Required — never a hidden global. */
  docker: DockerLike;
  /**
   * Whether containers may reach the network. `false` forces
   * `NetworkMode: 'none'`. Default `true` (the pre-P-168 behaviour).
   */
  networkAllowed?: boolean;
  /** Per-stream log-line cap. Default {@link MAX_CONTAINER_LOG_LINES}. */
  maxLogLines?: number;
}

/** Options for {@link SandboxClient.create}: a real dockerode client + policy. */
export interface SandboxClientFactoryOptions extends DockerClientOptions {
  networkAllowed?: boolean;
  maxLogLines?: number;
  /** Platform for the daemon's own image pulls (rarely needed). */
  platform?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function detailOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** Is a value a Node readable stream (a real pull returns one)? */
function isReadableStream(value: unknown): value is NodeJS.ReadableStream {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { on?: unknown }).on === 'function'
  );
}

/**
 * Split a Docker multiplexed log buffer into stdout/stderr lines.
 *
 * Frame format (TTY off): `[stream(1), 0, 0, 0, size(4 BE)]` + `size` payload
 * bytes, where stream `1` is stdout and `2` is stderr. A buffer that does not
 * begin with a valid frame (a TTY/raw stream) is treated as all-stdout rather
 * than being dropped — an unparseable stream must still yield the logs.
 * Blank lines are dropped and each stream keeps its newest `maxLines`.
 */
export function demuxDockerLogs(
  buffer: Buffer,
  maxLines: number = MAX_CONTAINER_LOG_LINES
): { stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  let offset = 0;
  let demuxed = false;
  while (offset + 8 <= buffer.length) {
    const streamType = buffer[offset];
    if (streamType !== 1 && streamType !== 2) break;
    const size = buffer.readUInt32BE(offset + 4);
    if (offset + 8 + size > buffer.length) break;
    const payload = buffer.subarray(offset + 8, offset + 8 + size).toString('utf8');
    for (const line of payload.split('\n')) {
      if (line !== '') (streamType === 1 ? stdout : stderr).push(line);
    }
    offset += 8 + size;
    demuxed = true;
  }
  if (!demuxed) {
    for (const line of buffer.toString('utf8').split('\n')) {
      if (line !== '') stdout.push(line);
    }
  }
  return { stdout: stdout.slice(-maxLines), stderr: stderr.slice(-maxLines) };
}

/** Read a nested number out of an unknown stats blob. */
function numberAt(root: unknown, path: readonly string[]): number {
  let node: unknown = root;
  for (const key of path) {
    if (typeof node !== 'object' || node === null) return 0;
    node = (node as Record<string, unknown>)[key];
  }
  return typeof node === 'number' && Number.isFinite(node) ? node : 0;
}

/** Shape a dockerode stats blob into the small public verdict. */
function shapeStats(raw: unknown): SandboxStats {
  const cpuTotal = numberAt(raw, ['cpu_stats', 'cpu_usage', 'total_usage']);
  const systemTotal = numberAt(raw, ['cpu_stats', 'system_cpu_usage']);
  const preCpu = numberAt(raw, ['precpu_stats', 'cpu_usage', 'total_usage']);
  const preSystem = numberAt(raw, ['precpu_stats', 'system_cpu_usage']);
  const onlineCpus = numberAt(raw, ['cpu_stats', 'online_cpus']) || 1;
  const cpuDelta = cpuTotal - preCpu;
  const systemDelta = systemTotal - preSystem;
  const cpuPercent =
    cpuDelta > 0 && systemDelta > 0 ? (cpuDelta / systemDelta) * onlineCpus * 100 : 0;
  return {
    cpuPercent: Math.round(cpuPercent * 100) / 100,
    memoryUsage: numberAt(raw, ['memory_stats', 'usage']),
    memoryLimit: numberAt(raw, ['memory_stats', 'limit']),
  };
}

function containerIdOf(container: ContainerLike): string | undefined {
  const raw = container.id;
  return typeof raw === 'string' && raw !== '' ? raw : undefined;
}

// ---------------------------------------------------------------------------
// The client
// ---------------------------------------------------------------------------

/**
 * A thin, testable wrapper over the container lifecycle.
 *
 * Construct with an injected dockerode instance, or use
 * {@link SandboxClient.create} to build a real one.
 */
export class SandboxClient {
  readonly #docker: DockerLike;
  readonly #networkAllowed: boolean;
  readonly #maxLogLines: number;

  constructor(options: SandboxClientOptions) {
    this.#docker = options.docker;
    this.#networkAllowed = options.networkAllowed ?? true;
    this.#maxLogLines = Math.max(1, options.maxLogLines ?? MAX_CONTAINER_LOG_LINES);
  }

  /**
   * Build a client over a real dockerode instance.
   *
   * Returns `err` only when construction itself fails (the P-067 factory's
   * `INTERNAL`); it never pings, so it cannot fail for daemon reasons.
   */
  static create(options: SandboxClientFactoryOptions = {}): Result<SandboxClient, StitchError> {
    const created = createDockerClient(options);
    if (created.isErr()) return err(created.error);
    return ok(
      new SandboxClient({
        docker: adaptDocker(created.value.docker),
        ...(options.networkAllowed !== undefined ? { networkAllowed: options.networkAllowed } : {}),
        ...(options.maxLogLines !== undefined ? { maxLogLines: options.maxLogLines } : {}),
      })
    );
  }

  /**
   * Can a container run right now?
   *
   * `false` covers every "no usable daemon" mode (missing socket, refused,
   * timed out, permission) and is an expected state that drives the P-175
   * fallback — this NEVER throws and never returns `err`.
   */
  async isAvailable(): Promise<boolean> {
    const reachability = await pingDocker(this.#docker);
    return reachability.isOk() && reachability.value.reachable;
  }

  /**
   * Pull an image, consuming the progress stream to completion.
   *
   * A `{"error": ...}` line inside the stream IS a failed pull even though the
   * HTTP call resolved, so the stream is drained and inspected; a rejection is
   * mapped directly. Both become `DOCKER_PULL_FAILED` with the image named.
   */
  async pull(image: string, opts: PullOptions = {}): Promise<Result<void, StitchError>> {
    if (image.trim() === '') {
      return err({ code: 'CONFIG_ERROR', field: 'image', message: 'pull: image is required' });
    }
    let stream: unknown;
    try {
      stream = await this.#docker.pull(
        image,
        opts.platform !== undefined ? { platform: opts.platform } : {}
      );
    } catch (cause: unknown) {
      return err({
        code: 'DOCKER_PULL_FAILED',
        image,
        message: `docker pull "${image}" failed: ${detailOf(cause)}`,
      });
    }
    // A fake may resolve nothing meaningful; a real daemon always returns a
    // stream. Only drain what is actually a stream.
    if (!isReadableStream(stream)) return ok(undefined);
    return this.#drainStream(
      stream,
      detail => ({
        code: 'DOCKER_PULL_FAILED',
        image,
        message: `docker pull "${image}" failed: ${detail}`,
      }),
      opts.onProgress
    );
  }

  /**
   * Build an image from a context, consuming the build stream to completion.
   *
   * `context` is dockerode's `file` argument — a path to a tar archive or a
   * readable stream; this client passes it through unchanged (shaping a real
   * build context is the pipeline's job, and no `tar` dependency is added for
   * it). A `{"error": ...}` line is a failed build even when the call resolved,
   * so the stream is drained and inspected. Both failures become
   * `DOCKER_BUILD_FAILED` naming the produced tag.
   */
  async buildImage(options: BuildImageOptions): Promise<Result<string, StitchError>> {
    if (options.tag.trim() === '') {
      return err({ code: 'CONFIG_ERROR', field: 'tag', message: 'buildImage: tag is required' });
    }
    let stream: unknown;
    try {
      stream = await this.#docker.buildImage(options.context, {
        t: options.tag,
        ...(options.dockerfile !== undefined ? { dockerfile: options.dockerfile } : {}),
        ...(options.buildArgs !== undefined ? { buildargs: options.buildArgs } : {}),
      });
    } catch (cause: unknown) {
      return err({
        code: 'DOCKER_BUILD_FAILED',
        image: options.tag,
        message: `docker build "${options.tag}" failed: ${detailOf(cause)}`,
      });
    }
    // A fake may resolve nothing meaningful; only drain a real stream.
    if (!isReadableStream(stream)) return ok(options.tag);
    const drained = await this.#drainStream(
      stream,
      detail => ({
        code: 'DOCKER_BUILD_FAILED',
        image: options.tag,
        message: `docker build "${options.tag}" failed: ${detail}`,
      }),
      options.onProgress
    );
    return drained.isErr() ? err(drained.error) : ok(options.tag);
  }

  /** Drain a pull/build stream; a stream-level `error` line is a failure. */
  #drainStream(
    stream: NodeJS.ReadableStream,
    makeError: (detail: string) => StitchError,
    onProgress?: (chunk: string) => void
  ): Promise<Result<void, StitchError>> {
    return new Promise<Result<void, StitchError>>(resolve => {
      let settled = false;
      let streamError: string | undefined;
      const finish = (outcome: Result<void, StitchError>): void => {
        if (settled) return;
        settled = true;
        resolve(outcome);
      };
      const onData = (chunk: unknown): void => {
        const text =
          typeof chunk === 'string'
            ? chunk
            : Buffer.isBuffer(chunk)
              ? chunk.toString('utf8')
              : String(chunk);
        onProgress?.(text);
        for (const line of text.split('\n')) {
          const trimmed = line.trim();
          if (trimmed === '') continue;
          try {
            const parsed = JSON.parse(trimmed) as {
              error?: unknown;
              errorDetail?: { message?: unknown };
            };
            const message = parsed.error ?? parsed.errorDetail?.message;
            if (typeof message === 'string' && message !== '') streamError = message;
          } catch {
            // Progress noise (plain-text layers) is not an error.
          }
        }
      };
      stream.on('data', onData);
      stream.on('error', (cause: unknown) => finish(err(makeError(detailOf(cause)))));
      stream.on('end', () =>
        finish(streamError === undefined ? ok(undefined) : err(makeError(streamError)))
      );
    });
  }

  /**
   * Create, start, wait for, log, and remove one container.
   *
   * The container is removed in a `finally`, so a start failure, a wait
   * rejection, a timeout, or an abort all still clean up. On timeout or abort
   * the returned error is `DOCKER_ERROR` / `ABORTED` respectively.
   */
  async run(
    spec: ContainerSpec,
    opts: RunOptions = {}
  ): Promise<Result<ContainerRun, StitchError>> {
    const invalid = validateSpec(spec);
    if (invalid.isErr()) return err(invalid.error);
    if (opts.signal?.aborted === true) {
      return err({ code: 'SANDBOX_ABORTED', message: 'sandbox run aborted before start' });
    }
    const timeoutMs = opts.timeoutMs ?? DEFAULT_RUN_TIMEOUT_MS;

    let container: ContainerLike;
    try {
      container = await this.#docker.createContainer(this.#createOptions(spec));
    } catch (cause: unknown) {
      return err({ code: 'DOCKER_ERROR', message: `createContainer failed: ${detailOf(cause)}` });
    }
    const containerId = containerIdOf(container);

    const startedAt = Date.now();
    try {
      try {
        await container.start();
      } catch (cause: unknown) {
        return err({
          code: 'DOCKER_ERROR',
          ...(containerId !== undefined ? { containerId } : {}),
          message: `container start failed: ${detailOf(cause)}`,
        });
      }

      const waited = await this.#waitForExit(container, containerId, timeoutMs, opts.signal);
      if (waited.isErr()) return err(waited.error);

      const logs = await this.#collectLogs(container);
      // P-173: hand the collected lines to the capture sink.
      if (opts.onLog !== undefined) {
        for (const line of logs.stdout) opts.onLog(line);
        for (const line of logs.stderr) opts.onLog(line);
      }
      // Capture BEFORE the `finally` removes the container: the handle is only
      // valid inside its lifetime. A failed capture is non-fatal.
      let capturedArchive: string | undefined;
      if (opts.capture !== undefined) {
        const captured = await this.#copyArchive(
          container,
          opts.capture.containerPath,
          opts.capture.hostDir
        );
        if (captured.isOk()) capturedArchive = captured.value;
      }
      return ok({
        exitCode: waited.value,
        stdout: logs.stdout,
        stderr: logs.stderr,
        durationMs: Date.now() - startedAt,
        ...(capturedArchive !== undefined ? { capturedArchive } : {}),
      });
    } finally {
      await this.rm(container);
    }
  }

  /**
   * Copy a path out of a container onto the host, returned as an archive.
   *
   * dockerode's `getArchive` streams a TAR of the container path; with no
   * tar-extraction dependency declared (the same decision ADR-042 recorded for
   * build contexts) the archive is written VERBATIM to
   * `<hostDir>/<basename>.tar`, and unpacking is the artifact consumer's step
   * (P-173). Returns the host archive path.
   */
  async copyFrom(
    containerOrId: string | ContainerLike,
    containerPath: string,
    hostDir: string
  ): Promise<Result<string, StitchError>> {
    const container =
      typeof containerOrId === 'string' ? this.#docker.getContainer(containerOrId) : containerOrId;
    return this.#copyArchive(container, containerPath, hostDir);
  }

  /** The archive write, shared by `copyFrom` and `run`'s in-lifetime capture. */
  async #copyArchive(
    container: ContainerLike,
    containerPath: string,
    hostDir: string
  ): Promise<Result<string, StitchError>> {
    if (containerPath.trim() === '') {
      return err({
        code: 'CONFIG_ERROR',
        field: 'containerPath',
        message: 'copyFrom: containerPath is required',
      });
    }
    if (hostDir.trim() === '') {
      return err({
        code: 'CONFIG_ERROR',
        field: 'hostDir',
        message: 'copyFrom: hostDir is required',
      });
    }
    try {
      const archive = await container.getArchive({ path: containerPath });
      await mkdir(hostDir, { recursive: true });
      const trimmed = containerPath.replace(/[/\\]+$/, '');
      const name = basename(trimmed);
      const target = join(hostDir, `${name === '' ? 'archive' : name}.tar`);
      await pipeline(archive, createWriteStream(target));
      return ok(target);
    } catch (cause: unknown) {
      return err({
        code: 'DOCKER_ERROR',
        message: `copyFrom("${containerPath}") failed: ${detailOf(cause)}`,
      });
    }
  }

  /** Force-remove a container. Best-effort: cleanup must never fail a job. */
  async rm(containerOrId: string | ContainerLike): Promise<void> {
    try {
      const container =
        typeof containerOrId === 'string'
          ? this.#docker.getContainer(containerOrId)
          : containerOrId;
      await container.remove({ force: true, v: true });
    } catch {
      // Deliberately swallowed — see the method contract above.
    }
  }

  /** Sample CPU/memory for a running container (P-173/P-174). */
  async stats(containerId: string): Promise<Result<SandboxStats, StitchError>> {
    if (containerId.trim() === '') {
      return err({
        code: 'CONFIG_ERROR',
        field: 'containerId',
        message: 'stats: containerId is required',
      });
    }
    try {
      const raw = await this.#docker.getContainer(containerId).stats({ stream: false });
      return ok(shapeStats(raw));
    } catch (cause: unknown) {
      return err({
        code: 'DOCKER_ERROR',
        containerId,
        message: `stats failed: ${detailOf(cause)}`,
      });
    }
  }

  /** The `createContainer` options for a spec. Exposed for assertions. */
  #createOptions(spec: ContainerSpec): ContainerCreateOptionsLike {
    const env =
      spec.env === undefined ? undefined : Object.entries(spec.env).map(([k, v]) => `${k}=${v}`);
    const binds = spec.bindMounts?.map(mount => `${mount.host}:${mount.container}`);
    const disableNetwork = spec.networkDisabled === true || !this.#networkAllowed;
    const hostConfig: HostConfigLike = {
      ...(binds !== undefined ? { Binds: binds } : {}),
      ...(spec.memory !== undefined ? { Memory: spec.memory } : {}),
      ...(spec.cpus !== undefined ? { NanoCpus: Math.round(spec.cpus * 1e9) } : {}),
      ...(disableNetwork ? { NetworkMode: 'none' } : {}),
    };
    return {
      Image: spec.image,
      ...(spec.cmd !== undefined ? { Cmd: spec.cmd } : {}),
      ...(spec.workingDir !== '' ? { WorkingDir: spec.workingDir } : {}),
      ...(env !== undefined ? { Env: env } : {}),
      ...(Object.keys(hostConfig).length > 0 ? { HostConfig: hostConfig } : {}),
    };
  }

  /** Race the container's exit against the timeout and the abort signal. */
  #waitForExit(
    container: ContainerLike,
    containerId: string | undefined,
    timeoutMs: number,
    signal: AbortSignal | undefined
  ): Promise<Result<number, StitchError>> {
    return new Promise<Result<number, StitchError>>(resolve => {
      let settled = false;
      const finish = (outcome: Result<number, StitchError>): void => {
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
              message: `container exceeded its time budget (${timeoutMs}ms${containerId !== undefined ? `, ${containerId}` : ''})`,
            })
          ),
        timeoutMs
      );
      const onAbort = (): void =>
        finish(err({ code: 'SANDBOX_ABORTED', message: 'sandbox run aborted' }));

      if (signal !== undefined) {
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener('abort', onAbort, { once: true });
      }

      Promise.resolve(
        container.wait({
          condition: 'not-running',
          ...(signal !== undefined ? { abortSignal: signal } : {}),
        })
      )
        .then((outcome: unknown) => {
          const status = (outcome as { StatusCode?: unknown } | null)?.StatusCode;
          finish(ok(typeof status === 'number' ? status : 0));
        })
        .catch((cause: unknown) =>
          finish(
            err({
              code: 'DOCKER_ERROR',
              ...(containerId !== undefined ? { containerId } : {}),
              message: `container wait failed: ${detailOf(cause)}`,
            })
          )
        );
    });
  }

  /** Read the container's logs; a failure yields empty streams, never err. */
  async #collectLogs(container: ContainerLike): Promise<{ stdout: string[]; stderr: string[] }> {
    try {
      const raw = await container.logs({ stdout: true, stderr: true });
      const buffer = typeof raw === 'string' ? Buffer.from(raw, 'utf8') : raw;
      return demuxDockerLogs(buffer, this.#maxLogLines);
    } catch {
      return { stdout: [], stderr: [] };
    }
  }

  /**
   * Read a container's logs as demultiplexed stdout/stderr lines (P-173).
   *
   * Separate from `run` so a capture manager can drain logs for a container it
   * did not start. `FILE_NOT_FOUND`-style failures are a typed `DOCKER_ERROR`.
   */
  async logs(
    containerOrId: string | ContainerLike
  ): Promise<Result<{ stdout: string[]; stderr: string[] }, StitchError>> {
    const container =
      typeof containerOrId === 'string' ? this.#docker.getContainer(containerOrId) : containerOrId;
    try {
      const raw = await container.logs({ stdout: true, stderr: true });
      const buffer = typeof raw === 'string' ? Buffer.from(raw, 'utf8') : raw;
      return ok(demuxDockerLogs(buffer, this.#maxLogLines));
    } catch (cause: unknown) {
      return err({ code: 'DOCKER_ERROR', message: `logs failed: ${detailOf(cause)}` });
    }
  }

  /**
   * Follow a container's logs as a raw multiplexed stream (P-173).
   *
   * The caller owns the stream: it is the raw docker payload, so a `json`
   * capture splits it on newlines while the default `docker` capture uses
   * {@link logs}'s demultiplexing.
   */
  async followLogs(
    containerOrId: string | ContainerLike
  ): Promise<Result<NodeJS.ReadableStream, StitchError>> {
    const container =
      typeof containerOrId === 'string' ? this.#docker.getContainer(containerOrId) : containerOrId;
    try {
      const stream = await container.followLogs();
      return ok(stream);
    } catch (cause: unknown) {
      return err({ code: 'DOCKER_ERROR', message: `followLogs failed: ${detailOf(cause)}` });
    }
  }
}

/** Validate the required spec fields before touching the daemon. */
function validateSpec(spec: ContainerSpec): Result<void, StitchError> {
  if (spec.image.trim() === '') {
    return err({ code: 'CONFIG_ERROR', field: 'image', message: 'run: image is required' });
  }
  if (spec.workingDir.trim() === '') {
    return err({
      code: 'CONFIG_ERROR',
      field: 'workingDir',
      message: 'run: workingDir is required',
    });
  }
  return ok(undefined);
}
