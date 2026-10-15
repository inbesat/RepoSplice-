// P-180 — the only sandbox test helper that talks to a REAL daemon.
//
// Kept out of `sandbox.docker.test.ts` so the suite file stays pure assertions,
// and kept out of the production modules because it pulls and runs a real image.
// The suite is gated, so nothing here executes unless a developer opts in.

import { ok, err, type Result } from 'neverthrow';
import { type StitchError } from '../../result/index.js';
import { SandboxClient } from '../client.js';

/** The tiny image the integration run uses (the phase's own example). */
export const INTEGRATION_IMAGE = 'node:22-alpine';

/** What `echo` must print for the run to count as a success. */
export const INTEGRATION_MARKER = 'stitch-sandbox-ok';

/** Daemon reachability, reported without ever throwing. */
export interface DockerAvailability {
  reachable: boolean;
  reason?: string;
}

/**
 * Is a real daemon reachable?
 *
 * `SandboxClient.create()` maps a missing socket to a typed error and
 * `isAvailable()` is a false-never-throw probe, so the gated suite can report
 * "no daemon" as a value rather than an exception.
 */
export async function dockerAvailability(): Promise<DockerAvailability> {
  const created = SandboxClient.create({});
  if (created.isErr()) return { reachable: false, reason: created.error.code };
  const available = await created.value.isAvailable();
  return available
    ? { reachable: true }
    : { reachable: false, reason: 'the daemon did not answer' };
}

/** What one real container run produced. */
export interface IntegrationRun {
  exitCode: number;
  stdout: string[];
  stderr: string[];
}

/**
 * Pull the tiny image and run `echo` inside a REAL container.
 *
 * Deliberately does NOT report whether the container was removed: the client
 * force-removes in its own `finally`, and `ContainerLike` exposes no "does this
 * container still exist?" call — asserting removal here would mean inventing
 * seam capability that production does not have. The fake-based suite already
 * asserts removal against `FakeDockerode.removed`.
 */
export async function sandboxContainerSpec(): Promise<Result<IntegrationRun, StitchError>> {
  const created = SandboxClient.create({});
  if (created.isErr()) return err(created.error);
  const client = created.value;

  const pulled = await client.pull(INTEGRATION_IMAGE);
  if (pulled.isErr()) return err(pulled.error);

  const ran = await client.run({
    image: INTEGRATION_IMAGE,
    workingDir: '/tmp',
    cmd: ['echo', INTEGRATION_MARKER],
    // No network for the workload itself: the pull above is the only networked
    // step, which is exactly the posture the sandbox enforces everywhere else.
    networkDisabled: true,
  });
  if (ran.isErr()) return err(ran.error);

  return ok({
    exitCode: ran.value.exitCode,
    stdout: ran.value.stdout,
    stderr: ran.value.stderr,
  });
}
