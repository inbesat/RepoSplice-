// Dedupe/nest strategy for npm version collisions (P-111).
//
// When two source repos require the same package at incompatible ranges
// (e.g. `react@17` vs `react@18`), npm can either hoist a single version
// to the top-level `node_modules` (dedupe) or nest one copy under the
// dependent's own `node_modules` (legacy nesting, or via `overrides`).
// This module decides the strategy so P-114 (lockfile regen) and P-116
// (report) can act on it, and the UI panel (P-219) can preview it.
//
// Safety contract (P-011):
// - No throws: every semver call goes through the P-019/P-109 Result
//   wrappers (`resolveCollision`, `maxSatisfying`, `validRange`/`coerce`).
//   An invalid range is a typed err that is CONTAINED — the function
//   returns a `DedupeResult` with a reason, never an exception.
// - Only package values and reasons reach the result — never file contents.
// - Pure: inputs are never mutated; every result is freshly constructed.

import { resolveCollision, maxSatisfying, semver } from './semver.js';
import type { RangeOptions } from './semver.js';

export type DedupeStrategy = 'hoist' | 'nest' | 'error';

export interface DedupeResult {
  strategy: DedupeStrategy;
  version: string;
  reason: string;
}

export interface DedupeOptions {
  /** npm version string from `engines.npm` (e.g. "8.11.0") — default is npm 8. */
  npmVersion?: string | undefined;
  /** True when the package is also involved in a peer conflict (P-110). */
  peerInvolved?: boolean | undefined;
  /** Semver options forwarded to `resolveCollision`/`maxSatisfying`. */
  semverOptions?: RangeOptions | undefined;
}

/**
 * Check if the given npm version supports `overrides` (npm 8.3+).
 * Default is npm 8 (supports overrides) when no version is provided.
 * Returns false only for explicit legacy versions (<8.3.0) or unparsable
 * strings that coerce to a version below the threshold.
 */
function npmSupportsOverrides(npmVersion: string | undefined): boolean {
  if (npmVersion === undefined || npmVersion.trim().length === 0) return true;
  // Try to coerce a version from the range string (e.g. ">=8.3.0", "^8.0.0",
  // "8.3.0"). If we cannot coerce, assume legacy to be safe and nest.
  let coerced: ReturnType<typeof semver.coerce>;
  try {
    coerced = semver.coerce(npmVersion);
  } catch {
    return false;
  }
  if (coerced === null) return false;
  try {
    // Compare against 8.3.0 threshold.
    const threshold = semver.coerce('8.3.0');
    if (threshold === null) return true;
    return semver.gte(coerced, threshold);
  } catch {
    return false;
  }
}

/**
 * Detect if the requested ranges span different major versions.
 * Returns true when at least two ranges coerce to different major numbers.
 * Invalid ranges (coerce returns null) are ignored — they do not count as
 * a major mismatch but will be handled as a disjoint via the intersect check.
 */
function isMajorMismatch(requested: Record<string, string>): boolean {
  const majors = new Set<number>();
  for (const range of Object.values(requested)) {
    if (range.trim().length === 0) continue;
    // Strip leading range operators to help coerce: "^17.0.0" -> "17.0.0",
    // ">=8.3.0" -> "8.3.0", "*" -> null (ignored).
    let coerced: ReturnType<typeof semver.coerce>;
    try {
      coerced = semver.coerce(range);
    } catch {
      continue;
    }
    if (coerced === null) continue;
    majors.add(coerced.major);
    if (majors.size > 1) return true;
  }
  return false;
}

/**
 * Choose the dedupe strategy for a package collision (P-111).
 *
 * - `versions` — available versions from the registry stub (e.g.
 *   `['4.17.20','4.17.21']`). Mocked in tests; empty in the merge
 *   integration when no registry data is available.
 * - `requested` — map of source label -> range string (e.g.
 *   `{ 'repo-a': '^4.17.20', 'repo-b': '^4.17.21' }`). Values are the
 *   same strings that appear in `Conflict.values`.
 * - `opts.npmVersion` — `engines.npm` value or undefined (default npm 8).
 * - `opts.peerInvolved` — true when the package also has a peer conflict.
 *
 * Decision tree (per spec, with probed refinements):
 * 1. Empty `requested` → `error`.
 * 2. Iteratively intersect all ranges via `resolveCollision`:
 *    - If a single intersected range exists:
 *      - If `versions` contains a version satisfying it → `hoist` with
 *        the highest satisfying version (via `maxSatisfying`).
 *      - Else → `error` (no available version satisfies the intersect).
 * 3. No intersect (disjoint / invalid):
 *    - If `peerInvolved` → `nest` (peers prefer nesting over hoisting).
 *    - Else if major mismatch → `nest` with "major version mismatch" reason.
 *    - Else if npm supports overrides → `hoist` with overrides suggestion.
 *    - Else → `nest` (legacy npm without overrides).
 *
 * Never throws: every semver call is guarded; invalid ranges are handled
 * as a "no intersect" case, not an exception.
 */
export function chooseDedupeStrategy(
  versions: string[],
  requested: Record<string, string>,
  opts: DedupeOptions = {}
): DedupeResult {
  const peerInvolved = opts.peerInvolved ?? false;
  const npmVersion = opts.npmVersion;
  const semverOptions = opts.semverOptions ?? {};

  const requestedEntries = Object.entries(requested);
  if (requestedEntries.length === 0) {
    return {
      strategy: 'error',
      version: '',
      reason: 'no requested ranges: cannot determine dedupe strategy',
    };
  }

  // Spec: if peer conflict involved → nest preferred (takes precedence
  // over hoisting even when ranges intersect — peers prefer nesting).
  if (peerInvolved) {
    return {
      strategy: 'nest',
      version: '',
      reason:
        'peer dependency involved, requires nested node_modules (peer conflicts prefer nesting over hoisting)',
    };
  }

  // Normalize empty/whitespace ranges to "*" (any) — mirrors P-109's
  // handling where validRange('') is '*'. Keep original strings for reason.
  const ranges = requestedEntries.map(([, range]) => {
    const trimmed = range.trim();
    return trimmed.length === 0 ? '*' : range;
  });

  // Iteratively intersect all ranges.
  let intersected: string | null = ranges[0] ?? null;
  if (intersected === null) {
    return {
      strategy: 'error',
      version: '',
      reason: 'no requested ranges: cannot determine dedupe strategy',
    };
  }

  let hasIntersect = true;
  for (let i = 1; i < ranges.length; i++) {
    const next = ranges[i];
    if (next === undefined) continue;
    const result = resolveCollision(intersected, next, semverOptions);
    if (result.isErr()) {
      hasIntersect = false;
      break;
    }
    if (result.value.kind !== 'resolved') {
      hasIntersect = false;
      break;
    }
    intersected = result.value.range;
  }

  if (hasIntersect && intersected !== null) {
    // Check if any available version satisfies the intersected range.
    if (versions.length === 0) {
      // No registry data — hoist is still possible in principle (the
      // intersect exists), but we cannot name a version. Return hoist
      // with empty version and a reason explaining the missing data.
      // Spec's merge integration passes empty versions; we treat it as
      // a hoist-capable case with a placeholder.
      return {
        strategy: 'hoist',
        version: '',
        reason: `compatible ranges ${JSON.stringify(intersected)} can be hoisted (no registry versions provided to select concrete version)`,
      };
    }
    const picked = maxSatisfying(versions, intersected, semverOptions);
    if (picked.isErr()) {
      const msg = 'message' in picked.error ? picked.error.message : JSON.stringify(picked.error);
      return {
        strategy: 'error',
        version: '',
        reason: `invalid intersected range ${JSON.stringify(intersected)}: ${msg}`,
      };
    }
    if (picked.value !== null) {
      return {
        strategy: 'hoist',
        version: picked.value,
        reason: `compatible ranges hoisted to ${picked.value} (satisfies ${intersected})`,
      };
    }
    return {
      strategy: 'error',
      version: '',
      reason: `no available version satisfies intersected range ${JSON.stringify(intersected)} (checked ${versions.length} versions)`,
    };
  }

  // No intersect — disjoint or invalid. Peer case already handled
  // above, so remaining branches are major-mismatch vs overrides vs legacy.
  if (isMajorMismatch(requested)) {
    return {
      strategy: 'nest',
      version: '',
      reason: 'major version mismatch, requires nested node_modules',
    };
  }

  if (npmSupportsOverrides(npmVersion)) {
    const requestedStr = Object.entries(requested)
      .map(([label, range]) => `${label}: ${range}`)
      .join(', ');
    const npmLabel = npmVersion ?? '8 (default)';
    return {
      strategy: 'hoist',
      version: '',
      reason: `no intersect (${requestedStr}), but npm ${npmLabel} supports overrides: add overrides to force single version`,
    };
  }

  return {
    strategy: 'nest',
    version: '',
    reason: `no intersect and npm ${npmVersion} does not support overrides, requires nested node_modules (legacy)`,
  };
}
