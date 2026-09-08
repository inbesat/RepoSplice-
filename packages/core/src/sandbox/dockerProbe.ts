import { ok, type Result } from 'neverthrow';
import type { StitchError } from '../result/index.js';
import type { DockerReachability } from './docker.js';

/**
 * Doctor-oriented Docker probe (P-067). The daemon client itself lives in
 * `docker.ts` (P-029); this module shapes what `stitch doctor` (P-068)
 * needs: reachability + engine version + a fix hint when down.
 *
 * Deliberately NO minimum-engine-version constant: the spec names none, and
 * inventing a floor would turn into a doctor gate rejecting valid setups.
 * Presence + reported version is the contract; policy belongs to P-068.
 */

/** What doctor renders for one daemon probe. */
export interface DockerDaemonStatus {
  reachable: boolean;
  /** Engine version (`docker version` server side), or null when unknown. */
  engineVersion: string | null;
  /** Fix hint, set only when the daemon is unreachable. */
  fix?: string;
}

const START_DAEMON_HINT =
  'Start Docker Desktop (or the Docker daemon) and retry. ' +
  'Without a daemon, stitch falls back to GH Actions (P-178).';

const INSTALL_HINT =
  'Docker is not installed. Install Docker Desktop (Windows/macOS) or ' +
  'the Engine (Linux), then start the daemon. See docs/system/docker.md.';

const PERMISSION_HINT =
  'Docker denied access (permission). Add your user to the docker group ' +
  '(Linux) or run with elevated rights, then retry.';

/** Pick the hint from the daemon's failure text. */
function hintFor(reason: string): string {
  const lowered = reason.toLowerCase();
  if (
    lowered.includes('enoent') ||
    lowered.includes('not found') ||
    lowered.includes('not recognized')
  ) {
    return INSTALL_HINT;
  }
  if (lowered.includes('eacces') || lowered.includes('permission') || lowered.includes('denied')) {
    return PERMISSION_HINT;
  }
  return START_DAEMON_HINT;
}

/**
 * Extract the first `major.minor.patch` from engine version output
 * (`docker version --format '{{.Server.Version}}'` prints e.g. `26.1.4`).
 * Returns null when nothing version-like is present — unknown, not an error.
 */
export function parseDockerEngineVersion(output: string): string | null {
  const match = /(\d+\.\d+\.\d+)/.exec(output);
  if (match === null) return null;
  const version = match[1];
  if (version === undefined) return null;
  return version;
}

/**
 * Probe the daemon through injected seams (same pattern as
 * `localGitVersion`): `ping` reports reachability (wire it to
 * `pingDocker`), `readVersion` returns raw `docker version` output.
 * Never throws and never errs: an unreachable daemon is expected,
 * doctor-hintable data (P-178 fallback), not a failure.
 */
export async function checkDockerDaemon(
  ping: () => Promise<DockerReachability>,
  readVersion: () => Promise<string>
): Promise<Result<DockerDaemonStatus, StitchError>> {
  let reachability: DockerReachability;
  try {
    reachability = await ping();
  } catch {
    return ok({ reachable: false, engineVersion: null, fix: INSTALL_HINT });
  }
  if (!reachability.reachable) {
    return ok({ reachable: false, engineVersion: null, fix: hintFor(reachability.reason) });
  }
  let engineVersion: string | null;
  try {
    engineVersion = parseDockerEngineVersion(await readVersion());
  } catch {
    engineVersion = null;
  }
  return ok({ reachable: true, engineVersion });
}
