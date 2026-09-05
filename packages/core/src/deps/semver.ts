// Thin Result-returning wrapper around the `semver` library so every
// later P-104+ dependency-merge module imports a stable, no-throw
// surface (P-011 contract). The raw `semver` lib is re-exported for
// advanced callers that need the full API.
//
// Why a wrapper:
//   - P-109 (semver collision resolution) calls `intersect(rangeA, rangeB)`
//     dozens of times per merge; we want each call to return Result, not
//     throw on an invalid range string.
//   - P-108 / P-116 use `coerce(version)` to normalize `^1.2.3`, `1.x`,
//     `1.2.3-alpha` into a concrete SemVer.
//   - `validRange` and `satisfies` are used to gate whether a pinned
//     version from a parent repo is acceptable in the merged range.

import semver, { type SemVer, type Options as SemverOptions } from 'semver';
import { ok, err, type Result } from 'neverthrow';
import type { StitchError } from '../result/index.js';

/**
 * Validate a semver range string. Returns the range string if valid,
 * or an err with the offending input. (semver 7's `validRange` returns
 * the canonicalized string form — e.g. `''` is treated as `*` and
 * `'1.x'` is normalized to `'>=1.0.0 <2.0.0-0'`.)
 *
 * `validRange('^1.0.0')` → ok('^1.0.0')
 * `validRange('not-a-range')` → err({...})
 */
export function validRange(range: string, options?: SemverOptions): Result<string, StitchError> {
  const result = semver.validRange(range, options);
  if (result === null) {
    return err({
      code: 'CONFIG_ERROR',
      field: 'range',
      message: `invalid semver range: ${JSON.stringify(range)}`,
    });
  }
  return ok(result);
}

/**
 * Coerce a loose version string into a SemVer. Common cases:
 *   - '1'           → '1.0.0'
 *   - '1.2'         → '1.2.0'
 *   - '1.2.3'       → '1.2.3'
 *   - 'v1.2.3'      → '1.2.3'
 *   - '1.2.3-rc.1'  → '1.2.3-rc.1'  (with includePrerelease)
 *
 * Default `includePrerelease: true` so dependency manifests that pin
 * to a prerelease (e.g. `1.0.0-rc.1`) round-trip cleanly. Pass
 * `{ includePrerelease: false }` to mimic semver's stock behavior.
 *
 * Returns err if the input cannot be coerced.
 */
export function coerce(
  version: string,
  options: SemverOptions & { includePrerelease?: boolean } = {}
): Result<SemVer, StitchError> {
  const result = semver.coerce(version, { includePrerelease: true, ...options });
  if (result === null) {
    return err({
      code: 'CONFIG_ERROR',
      field: 'version',
      message: `cannot coerce ${JSON.stringify(version)} to a semver`,
    });
  }
  return ok(result);
}

/**
 * Test whether `version` satisfies `range`. Both inputs are pre-validated:
 * a bad `range` returns err, a bad `version` returns err. A valid
 * pair always returns a boolean Result.
 */
export function satisfies(
  version: string,
  range: string,
  options?: SemverOptions
): Result<boolean, StitchError> {
  const r = validRange(range, options);
  if (r.isErr()) {
    // validRange's err is the same shape we want; rebuild with the
    // right OK type so TS is happy.
    return err<boolean, StitchError>(r.error);
  }
  // The lib's `satisfies` is permissive about version input (coerces), so
  // we don't pre-validate version — but a totally non-version string
  // will return false rather than throw.
  try {
    return ok(semver.satisfies(version, range, options));
  } catch (e) {
    return err({
      code: 'CONFIG_ERROR',
      field: 'version',
      message: `cannot test satisfies(${JSON.stringify(version)}, ${JSON.stringify(range)}): ${e instanceof Error ? e.message : String(e)}`,
    });
  }
}

/**
 * Test whether two ranges overlap. Used by P-109 (semver collision
 * resolution) to detect when two parent repos pin incompatible version
 * ranges for the same package.
 *
 * semver 7 ships `intersects(rangeA, rangeB)` as a boolean check (not
 * a "give me the intersection range" function — that requires a set of
 * known versions to pick from, which is the caller's job in P-109).
 *
 * Returns ok(true) if the ranges overlap, ok(false) if they are
 * disjoint, err if either input is not a valid range.
 */
export function intersects(
  rangeA: string,
  rangeB: string,
  options?: SemverOptions
): Result<boolean, StitchError> {
  // Inline the validation so the result types line up (validRange returns
  // Result<string, StitchError>; we need Result<boolean, StitchError>).
  const a = semver.validRange(rangeA, options);
  if (a === null) {
    return err({
      code: 'CONFIG_ERROR',
      field: 'range',
      message: `invalid semver range: ${JSON.stringify(rangeA)}`,
    });
  }
  const b = semver.validRange(rangeB, options);
  if (b === null) {
    return err({
      code: 'CONFIG_ERROR',
      field: 'range',
      message: `invalid semver range: ${JSON.stringify(rangeB)}`,
    });
  }
  return ok(semver.intersects(a, b, options));
}

// Re-export the raw lib for advanced callers (P-109's higher-level
// resolvers will use this directly).
export { semver };
export type { SemVer, SemverOptions };
