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

import semver, { type SemVer, type RangeOptions } from 'semver';
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
export function validRange(range: string, options?: RangeOptions): Result<string, StitchError> {
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
  options: RangeOptions & { includePrerelease?: boolean } = {}
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
  options?: RangeOptions
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
  options?: RangeOptions
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

// ---------------------------------------------------------------------------
// P-109: semver collision resolution
// ---------------------------------------------------------------------------

import { logger } from '../logger/index.js';

/**
 * True when a range string contains a prerelease identifier, e.g.
 * `1.0.0-beta.1`, `>=1.0.0-0`, `^1.2.3-rc.1`. This gates the spec-mandated
 * `includePrerelease: true` threading (P-109: pass it only if either range
 * contains a prerelease).
 *
 * Detection is token-based on the ORIGINAL string (never the canonicalized
 * form — `validRange('^1.0.0')` is `'>=1.0.0 <2.0.0-0'`, whose `-0` upper
 * bound would false-positive every caret range). Hyphen RANGE operators
 * (`1.0.0 - 2.0.0`) use space-separated hyphens; prerelease identifiers
 * never do, so the space-form never matches.
 */
function rangeHasPrerelease(range: string): boolean {
  return range.split(/\s+/).some(token => {
    const bare = token.replace(/^[=<>!~^v]+/, '');
    return /^\d+(\.\d+)*-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*(\+[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)*$/.test(
      bare
    );
  });
}

/**
 * How `resolveCollision` derived a resolved range (P-109):
 * - `identical`: both inputs were the same string (fast path).
 * - `subset-a`: `rangeA` is the narrower range (A ⊆ B) — returned as-is.
 * - `subset-b`: `rangeB` is the narrower range (B ⊆ A) — returned as-is.
 * - `conjunction`: overlapping but neither contains the other — the
 *   space-joined `'${rangeA} ${rangeB}'` (semver interprets space as AND).
 */
export type CollisionBasis = 'identical' | 'subset-a' | 'subset-b' | 'conjunction';

/**
 * How `resolveCollision` classified a version-range collision (P-109).
 *
 * Every outcome is an explicit VALUE — `resolveCollision` classifies, it
 * does not fail (P-098 precedent: legitimate non-error outcomes are ok
 * values). The err channel exists only for defensive canaries that can
 * never fire after validation (typed `INTERNAL`).
 *
 * - `resolved`: the ranges intersect; `range` is the narrowest intersection
 *   string (original input form — `'^1.2.3'`, not its canonicalized
 *   `'>=1.2.0 <2.0.0-0'`) and `basis` names how it was derived.
 * - `disjoint`: no overlap (major bump or unrelated ranges) — the spec's
 *   `null` case; `reason` explains why, for the P-116 report and P-219 UI.
 * - `invalid`: an input is not a valid range (the spec's other `null`
 *   case); `reason` names the offending input and a warning is logged.
 */
export type CollisionResolution =
  | { kind: 'resolved'; range: string; basis: CollisionBasis }
  | { kind: 'disjoint'; reason: string }
  | { kind: 'invalid'; reason: string };

/**
 * Map a `CollisionResolution` to the `Conflict.suggestedResolution` value
 * (`string | null`): resolved → the intersected range, disjoint/invalid →
 * null ("no automatic fix known"). This is the exact observable the P-109
 * spec describes as returning `string | null`; P-111's dedupe strategy,
 * P-151's auto-fix, and the P-219 panel consume it.
 */
export function toSuggestedResolution(resolution: CollisionResolution): string | null {
  return resolution.kind === 'resolved' ? resolution.range : null;
}

/**
 * Resolve a version-range collision between two source repos (P-109).
 *
 * Returns a typed classification instead of a bare `string | null` (P-011:
 * every public API is a `Result`; every outcome is explicit):
 * - `ok({kind:'resolved', range, basis})` — intersected ranges; `range` is
 *   the narrowest intersection in original input form, `basis` names how.
 * - `ok({kind:'disjoint', reason})` — no overlap (the spec's `null` case
 *   for major bumps).
 * - `ok({kind:'invalid', reason})` — an input is not a valid range (the
 *   spec's other `null` case); a warning is logged, nothing throws.
 * - `err(INTERNAL)` — defensive only: the raw lib threw after validation
 *   passed (unreachable in practice; can never escape as an exception).
 *
 * Narrowest-intersection logic per spec:
 * 1. Validate both inputs via `validRange` — invalid first, so a garbage
 *    pair (`'not-a-range'` twice) classifies as `invalid`, never resolves.
 * 2. `rangeA === rangeB` → return `rangeA` (identical fast path).
 * 3. `intersects(rangeA, rangeB)` false → `disjoint`.
 * 4. `subset(rangeA, rangeB)` → return `rangeA` (A is narrower); else
 *    `subset(rangeB, rangeA)` → return `rangeB`; else `'${rangeA} ${rangeB}'`
 *    (semver interprets space as AND).
 *
 * Prerelease handling per spec: `includePrerelease: true` is passed to
 * every lib call only when either range contains a prerelease (auto-detected
 * on the original strings); an explicit caller `options.includePrerelease`
 * wins over the detection. Note that a prerelease point below a range's
 * lower bound (e.g. `1.0.0-beta.1` vs `^1.0.0`) is honestly `disjoint`
 * regardless — semver precedence puts prereleases before their release.
 *
 * The returned range is the ORIGINAL input string (subset/identical) or the
 * space-joined conjunction — human-readable for the P-219 panel; callers
 * that need the canonical form pipe it through `validRange`.
 */
export function resolveCollision(
  rangeA: string,
  rangeB: string,
  options: RangeOptions = {}
): Result<CollisionResolution, StitchError> {
  const includePrerelease =
    options.includePrerelease ?? (rangeHasPrerelease(rangeA) || rangeHasPrerelease(rangeB));
  const opts: RangeOptions = { ...options, includePrerelease };

  const a = semver.validRange(rangeA, opts);
  const b = semver.validRange(rangeB, opts);
  if (a === null || b === null) {
    const bad = a === null ? rangeA : rangeB;
    logger.warn(
      { range: JSON.stringify(bad) },
      'resolveCollision: invalid semver range, cannot auto-resolve'
    );
    return ok({ kind: 'invalid', reason: `invalid semver range: ${JSON.stringify(bad)}` });
  }

  if (rangeA === rangeB) {
    // A `''`/whitespace-only pair is the identical fast path too, but the
    // raw input is an empty resolution the no-throw contract forbids —
    // canonicalize to `*` (validRange('') is `*`).
    const identical = rangeA.trim().length === 0 ? '*' : rangeA;
    return ok({ kind: 'resolved', range: identical, basis: 'identical' });
  }

  let intersectsA: boolean;
  try {
    intersectsA = semver.intersects(rangeA, rangeB, opts);
  } catch (e) {
    return err({
      code: 'INTERNAL',
      message: `resolveCollision intersects(${JSON.stringify(rangeA)}, ${JSON.stringify(
        rangeB
      )}) threw after validation: ${e instanceof Error ? e.message : String(e)}`,
    });
  }
  if (!intersectsA) {
    return ok({
      kind: 'disjoint',
      reason: `no overlap between ${JSON.stringify(rangeA)} and ${JSON.stringify(
        rangeB
      )} (major bump or unrelated ranges)`,
    });
  }

  let subsetA: boolean;
  let subsetB: boolean;
  try {
    subsetA = semver.subset(rangeA, rangeB, opts);
    subsetB = semver.subset(rangeB, rangeA, opts);
  } catch (e) {
    return err({
      code: 'INTERNAL',
      message: `resolveCollision subset(${JSON.stringify(rangeA)}, ${JSON.stringify(
        rangeB
      )}) threw after validation: ${e instanceof Error ? e.message : String(e)}`,
    });
  }
  if (subsetA) {
    // A `''`/whitespace-only rangeA is trivially a subset of everything
    // (it canonicalizes to `*`), but the raw input is an empty resolution
    // the no-throw contract forbids — canonicalize to `*`.
    const narrow = rangeA.trim().length === 0 ? '*' : rangeA;
    return ok({ kind: 'resolved', range: narrow, basis: 'subset-a' });
  }
  if (subsetB) {
    const narrow = rangeB.trim().length === 0 ? '*' : rangeB;
    return ok({ kind: 'resolved', range: narrow, basis: 'subset-b' });
  }
  // A `''` or whitespace input canonicalizes to `*` (valid, full set) but
  // the space-joined conjunction would be `" <b>"` or `"  "` — an
  // empty/whitespace resolution the no-throw contract forbids. When the
  // conjunction trims to empty, the full-set side IS the resolution.
  const conjunction = `${rangeA} ${rangeB}`.trim();
  if (conjunction.length === 0) {
    return ok({ kind: 'resolved', range: '*', basis: 'conjunction' });
  }
  return ok({ kind: 'resolved', range: conjunction, basis: 'conjunction' });
}

/**
 * Pick the highest version from `versions` that satisfies `range`, for the
 * UI resolution preview (P-109 step 3). `range` may be a space-joined
 * conjunction from `resolveCollision` (semver interprets space as AND),
 * which is how "satisfying both ranges" is expressed with one string.
 *
 * - `ok(version)` — the highest satisfying version, EXACTLY as it appears
 *   in the input list (e.g. a `v1.2.3` entry wins as `'v1.2.3'`).
 * - `ok(null)` — nothing in the list satisfies the range (an empty list
 *   or a disjoint registry stub; a legitimate preview outcome).
 * - `err(CONFIG_ERROR)` — `range` is not a valid range. The raw lib
 *   swallows this as an ambiguous null; the typed err keeps "no match"
 *   and "bad input" distinguishable and can never throw.
 * - `err(INTERNAL)` — defensive only: the raw lib threw after validation.
 *
 * Unparsable entries in `versions` are skipped by the raw lib (probed:
 * `maxSatisfying(['garbage','1.2.3'], '^1.0.0')` → `'1.2.3'`), never an
 * error. Pass `{ includePrerelease: true }` to pick prereleases against
 * release ranges; exact prerelease pins (e.g. range `1.0.0-beta.1` vs the
 * same entry) match without it.
 */
export function maxSatisfying(
  versions: readonly string[],
  range: string,
  options: RangeOptions = {}
): Result<string | null, StitchError> {
  const valid = semver.validRange(range, options);
  if (valid === null) {
    return err({
      code: 'CONFIG_ERROR',
      field: 'range',
      message: `invalid semver range: ${JSON.stringify(range)}`,
    });
  }
  try {
    return ok(semver.maxSatisfying(versions, valid, options));
  } catch (e) {
    return err({
      code: 'INTERNAL',
      message: `maxSatisfying threw after validation: ${e instanceof Error ? e.message : String(e)}`,
    });
  }
}

// Re-export the raw lib for advanced callers (P-109's higher-level
// resolvers will use this directly).
export { semver };
export type { SemVer, RangeOptions };
