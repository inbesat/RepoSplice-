import { ok, type Result } from 'neverthrow';
import type { StitchError } from '../result/index.js';

/**
 * git-filter-repo presence probe (P-066). filter-repo is the engine behind
 * path extraction/history rewrite (P-070); `stitch doctor` (P-068) calls
 * `checkFilterRepoStatus` with its own process runner.
 *
 * Deliberately NO minimum-version constant (unlike `MIN_GIT_VERSION`):
 * upstream `git-filter-repo --version` reports its own revision hash
 * (verified: 2.47.0 prints `a40bce548d2c`), not semver, so there is nothing
 * sound to compare. The raw string is carried through opaquely for display;
 * presence is the gate. If upstream ever ships comparable versions, add the
 * floor then — with a real sample, not a guess.
 */
export interface FilterRepoStatus {
  available: boolean;
  /** Raw `--version` output (opaque revision), or null when unknown. */
  version: string | null;
  /** Install hint, set only when the binary is missing. */
  fix?: string;
}

const INSTALL_HINT = 'pip install git-filter-repo, then add the Python Scripts directory to PATH';

/**
 * Probe for the `git-filter-repo` binary via an injected runner (same seam
 * as `localGitVersion`: pass `(args) => execFile('git-filter-repo', args)`).
 * Never throws and never reports a missing binary as an error — absence is
 * a normal, doctor-hintable state, so it comes back as data.
 */
export async function checkFilterRepoStatus(
  run: (args: readonly string[]) => Promise<string>
): Promise<Result<FilterRepoStatus, StitchError>> {
  let output: string;
  try {
    output = await run(['--version']);
  } catch {
    return ok({ available: false, version: null, fix: INSTALL_HINT });
  }
  const version = output.trim();
  return ok({ available: true, version: version === '' ? null : version });
}
