import { err, type Result } from 'neverthrow';
import type { StitchError } from '../result/index.js';
import { coerce, satisfies } from '../deps/semver.js';

/**
 * Minimum supported git (P-065): the Git Core epic (P-069–P-087) is built
 * and tested against git >= 2.40, whose `ort` merge backend and
 * `--allow-unrelated-histories` behavior the stitch merge strategy
 * (P-072) relies on. `stitch doctor` (P-068) reads this constant — never
 * hardcode the floor anywhere else.
 */
export const MIN_GIT_VERSION = '2.40.0';

/**
 * Parse `git --version` output into a bare version. Handles distro
 * suffixes (`git version 2.45.1.windows.1` → `2.45.1`). Returns null when
 * the output is not recognizable — callers treat that as "cannot verify",
 * never as a pass.
 */
export function parseGitVersion(output: string): string | null {
  const match = /^git version (\d+\.\d+\.\d+)/.exec(output.trim());
  if (match === null) return null;
  const version = match[1];
  if (version === undefined) return null;
  return version;
}

/**
 * True when `version` meets the minimum. Garbage input is an err
 * (`CONFIG_ERROR`), never a throw and never a silent pass — doctor
 * surfaces it as "could not verify" with upgrade instructions.
 */
export function isGitVersionSupported(version: string): Result<boolean, StitchError> {
  const coerced = coerce(version);
  if (coerced.isErr()) {
    return err<boolean, StitchError>(coerced.error);
  }
  return satisfies(coerced.value.version, `>=${MIN_GIT_VERSION}`);
}

/** Convenience: parse `git --version` output, then gate it. */
export function checkGitVersionOutput(output: string): Result<boolean, StitchError> {
  const parsed = parseGitVersion(output);
  if (parsed === null) {
    return err({
      code: 'CONFIG_ERROR',
      field: 'gitVersion',
      message: `unrecognized git version output: ${JSON.stringify(output)}`,
    });
  }
  return isGitVersionSupported(parsed);
}

/** This machine's git version, or null when git is missing/unparseable. */
export async function localGitVersion(
  run: (args: readonly string[]) => Promise<string>
): Promise<string | null> {
  let output: string;
  try {
    output = await run(['--version']);
  } catch {
    return null;
  }
  return parseGitVersion(output);
}
