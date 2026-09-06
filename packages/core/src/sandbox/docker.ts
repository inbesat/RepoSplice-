// Typed Docker sandbox client via `dockerode` (P-029).
//
// `dockerode@5` is the programmatic Docker client for the local sandbox
// backend (P-168–P-180): build/run ephemeral per-ecosystem images,
// install deps, run build/tests, capture logs, apply limits/timeout,
// and clean up. GH Actions (P-178) and K8s (P-304) are alternates.
//
// This phase wires only the client surface + reachability detection:
//   - `createDockerClient(opts)` → typed `Docker` instance (no I/O;
//     construction never touches the daemon).
//   - `pingDocker(client)` → `ok({ reachable: true })`, or
//     `ok({ reachable: false, reason })` when the daemon is missing /
//     refused / timed out. Unreachable is an *expected* state (the
//     caller falls back to GH Actions per P-178), NOT an err — same
//     shape as P-025's UNKNOWN path. err(INTERNAL) is reserved for
//     truly unexpected failures.
//
// Container lifecycle (pull/create/start/logs/remove) is P-168+; the
// raw `Docker` instance is exposed on the client so those phases can
// build on it without re-wrapping.

import Docker from 'dockerode';
import { ok, err, type Result } from 'neverthrow';
import { type StitchError } from '../result/index.js';

/**
 * Minimal structural surface `pingDocker` needs. `Docker` satisfies it;
 * tests pass a stub — no daemon, no network.
 */
export interface DockerPingable {
  ping(): Promise<unknown>;
}

/**
 * Options for the Docker client factory. `socketPath` (Unix socket or
 * Windows npipe) is the default transport; `host`/`port` selects TCP
 * (remote daemon, TLS-terminating proxy). `timeoutMs` bounds daemon
 * round-trips (forwarded to dockerode's `timeout`).
 */
export interface DockerClientOptions {
  socketPath?: string;
  host?: string;
  port?: number;
  timeoutMs?: number;
}

/** Default Unix socket; Windows uses the docker npipe. */
export function defaultDockerSocket(): string {
  return process.platform === 'win32' ? '//./pipe/docker_engine' : '/var/run/docker.sock';
}

/**
 * What we hand back. `docker` is the raw typed `Docker` instance that
 * P-168+ builds container lifecycle on; `transport` records how we
 * connect (useful for logs and for P-178 fallback diagnostics).
 */
export interface DockerSandboxClient {
  docker: Docker;
  transport: { socketPath: string } | { host: string; port: number };
}

/**
 * Reachability verdict. `reachable: false` carries the daemon error
 * text (ENOENT/ECONNREFUSED/EACCES/ETIMEDOUT…) so the caller can log
 * *why* it is falling back to GH Actions.
 */
export type DockerReachability = { reachable: true } | { reachable: false; reason: string };

/**
 * Create a typed `Docker` client. No I/O happens here — dockerode only
 * stores the options — so this cannot fail for daemon reasons. Returns
 * err(INTERNAL) only if construction itself throws (true bug).
 */
export function createDockerClient(
  options: DockerClientOptions = {}
): Result<DockerSandboxClient, StitchError> {
  try {
    if (options.host !== undefined) {
      const port = options.port ?? 2375;
      const docker = new Docker({
        host: options.host,
        port,
        ...(options.timeoutMs !== undefined ? { timeout: options.timeoutMs } : {}),
      });
      return ok({ docker, transport: { host: options.host, port } });
    }
    const socketPath = options.socketPath ?? defaultDockerSocket();
    const docker = new Docker({
      socketPath,
      ...(options.timeoutMs !== undefined ? { timeout: options.timeoutMs } : {}),
    });
    return ok({ docker, transport: { socketPath } });
  } catch (cause: unknown) {
    const detail = cause instanceof Error ? cause.message : 'unknown docker init error';
    return err({
      code: 'INTERNAL',
      message: `dockerode init failed: ${detail}`,
    });
  }
}

/**
 * Probe daemon reachability via `ping()`.
 *
 * Returns ok({ reachable: true }) when the daemon answers, or
 * ok({ reachable: false, reason }) for every failure mode (missing
 * socket, refused connection, timeout, permission). Callers branch
 * on `reachable` to select the GH Actions fallback (P-178).
 */
export async function pingDocker(
  client: DockerPingable
): Promise<Result<DockerReachability, StitchError>> {
  try {
    await client.ping();
    return ok({ reachable: true });
  } catch (cause: unknown) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    return ok({ reachable: false, reason });
  }
}
