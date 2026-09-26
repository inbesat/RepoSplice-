// PeerDependency conflict handling (P-110): `peerDependencies` are not
// installed automatically but indicate compatibility. A conflict like
// `react@^18` (peered by repo-a) vs the install set's `react@17` should
// warn, not block the merge, but must surface to the user (P-219 renders
// these as yellow, not red) and suggest `overrides`/`peerDependenciesMeta`
// fixes that P-151's auto-fix can consume via `Conflict.suggestedResolution`.
//
// Safety contract (P-011):
// - No throws: every semver call goes through the P-019 Result wrappers
//   (`intersects`, `resolveCollision`). An invalid range string is a typed
//   err that is CONTAINED — the check treats it as unsatisfied (fail-closed
//   toward surfacing: the user decides), never an escaping exception.
//   `resolveCollision` classifies, it does not fail: invalid ranges are the
//   'invalid' OK-value (a conflict, fail-closed) and its err channel exists
//   only for defensive canaries that cannot fire after validation.
// - Only package names, source labels, and range strings reach conflicts —
//   never file contents.
// - Inputs are never mutated: `merged` and `manifests` are read-only here;
//   every conflict is freshly constructed.
//
// Detection rules (per spec, generalized from the 2-repo framing to N):
// - Both-peer check (the REFINEMENT of P-108's raw peer-range fold, which
//   this module REPLACES in merge.ts): for each package peered by 2+ sides,
//   pairwise over distinct ranges (unordered-pair dedupe) — compatible
//   ranges (resolveCollision 'resolved') produce NO conflict (npm installs
//   one version satisfying both; the merged map keeps first-seen); disjoint
//   or invalid ranges produce ONE warning conflict per incompatible pair,
//   whose `values` name the two sides' ranges and whose `peerSource` names
//   the first side of the pair (P-108's pinned shape for the 2-side case).
// - Unmet check (npm's real rule — peers are satisfied by the INSTALLED
//   tree, and install-set values are RANGE strings, so the check is
//   `intersects(installRange, peerRange)`, which subsumes `satisfies` for
//   exact pins): for each peer requirement (pkg@range required by a side),
//   skipping packages already conflicted by the both-peer check (one yellow
//   entry per package, root cause first) — the install set is looked up
//   with npm's own precedence (dependencies win over optionalDependencies
//   win over devDependencies). Absent: an optional peer
//   (`peerDependenciesMeta[pkg].optional === true` in the MERGED meta) may
//   be absent (skipped), any other peer is unmet (conflict). Present: a
//   disjoint or invalid pair conflicts (an optional peer only forgives
//   ABSENCE — a present peer must still satisfy); `'*'` install values
//   admit any peer (satisfied).
// - Conflict values for the unmet case use the requiring side's positional
//   label plus the stable `install-set` key for the other side (not a
//   positional source — documented deviation so P-219 can render both).

import { intersects, resolveCollision } from './semver.js';
import { sourceLabel } from './labels.js';
import type { Conflict, NpmManifest, ParsedManifest } from './types.js';

/**
 * One peerDependency conflict (P-110): extends the P-108 `Conflict` with
 * the positional source label of the side whose peer requirement triggered
 * it (`repo-a`, `repo-b`, ... in input order — see `sourceLabel`).
 *
 * For both-peer conflicts `peerSource` is the first side of the disjoint
 * pair; for unmet conflicts it is the requiring side. `type` is always
 * `'peer'` and `severity` always `'warning'` — peer conflicts never block
 * the merge, so `MergeResult` stays mergeable (the P-219 panel renders
 * them as yellow, not red).
 */
export interface PeerConflict extends Conflict {
  peerSource: string;
}

/**
 * One peer requirement: `pkg@range` required by the side labeled `label`.
 */
interface PeerRequirement {
  label: string;
  range: string;
}

/**
 * Look up a package's install-set range with npm's own precedence:
 * `dependencies` win over `optionalDependencies` win over
 * `devDependencies` (npm dedupes a package listed in several maps the
 * same way — the production install set wins).
 */
function installRangeFor(merged: NpmManifest, pkg: string): string | undefined {
  const dep = merged.dependencies?.[pkg];
  if (dep !== undefined) return dep;
  const opt = merged.optionalDependencies?.[pkg];
  if (opt !== undefined) return opt;
  return merged.devDependencies?.[pkg];
}

/**
 * Filter the parsed manifests down to their npm members, labeled
 * positionally in input order (P-108 consistency: `sourceLabel(i)`).
 * Non-npm members carry no peer data (peers are an npm concept) and are
 * ignored — python/cargo/go manifests never produce peer conflicts.
 */
function npmLabeled(manifests: readonly ParsedManifest[]): {
  manifest: NpmManifest;
  label: string;
}[] {
  const out: { manifest: NpmManifest; label: string }[] = [];
  for (let i = 0; i < manifests.length; i++) {
    const entry = manifests[i];
    if (entry === undefined) continue;
    if (entry.ecosystem !== 'npm') continue;
    out.push({ manifest: entry.manifest, label: sourceLabel(i) });
  }
  return out;
}

/**
 * Collect every peer requirement per package: `pkg` -> the sides that peer
 * it, in input order. Both the both-peer check and the unmet check consume
 * this inventory (peers must be satisfied by direct deps — the install set
 * is the merged one, not per-side).
 */
function collectPeerRequirements(
  npmInputs: readonly { manifest: NpmManifest; label: string }[]
): Map<string, PeerRequirement[]> {
  const reqs = new Map<string, PeerRequirement[]>();
  for (const { manifest, label } of npmInputs) {
    const peers = manifest.peerDependencies;
    if (peers === undefined) continue;
    for (const [pkg, range] of Object.entries(peers)) {
      const list = reqs.get(pkg);
      if (list === undefined) {
        reqs.set(pkg, [{ label, range }]);
      } else {
        list.push({ label, range });
      }
    }
  }
  return reqs;
}

/**
 * The both-peer check: for each package peered by 2+ sides, pairwise over
 * distinct ranges via `resolveCollision`. The strict `i < j` iteration
 * visits each unordered pair exactly once (labels are injective per
 * position, so no pair dedupe is needed). Returns one warning conflict per
 * incompatible (disjoint or invalid) pair; a canary err from
 * `resolveCollision` (unreachable after validation) is treated as
 * conflicting (fail-closed toward surfacing).
 */
function bothPeerConflicts(peerReqs: ReadonlyMap<string, PeerRequirement[]>): {
  conflicts: PeerConflict[];
  conflictedPkgs: Set<string>;
} {
  const conflicts: PeerConflict[] = [];
  const conflictedPkgs = new Set<string>();
  for (const [pkg, reqs] of peerReqs) {
    if (reqs.length < 2) continue;
    for (let i = 0; i < reqs.length; i++) {
      const first = reqs[i];
      if (first === undefined) continue;
      for (let j = i + 1; j < reqs.length; j++) {
        const second = reqs[j];
        if (second === undefined) continue;
        // Identical ranges never conflict (resolveCollision would say so).
        if (first.range === second.range) continue;
        const r = resolveCollision(first.range, second.range);
        if (r.isErr() || r.value.kind !== 'resolved') {
          conflictedPkgs.add(pkg);
          conflicts.push({
            type: 'peer',
            package: pkg,
            values: { [first.label]: first.range, [second.label]: second.range },
            severity: 'warning',
            peerSource: first.label,
          });
        }
      }
    }
  }
  return { conflicts, conflictedPkgs };
}

/**
 * The unmet check: for each peer requirement, skipping packages already
 * conflicted by the both-peer check, verify the install set admits the
 * peer range via `intersects` (install-set values are RANGE strings; an
 * err is treated as unsatisfied — fail-closed toward surfacing).
 */
function unmetPeerConflicts(
  peerReqs: ReadonlyMap<string, PeerRequirement[]>,
  merged: NpmManifest,
  conflictedPkgs: ReadonlySet<string>
): PeerConflict[] {
  const conflicts: PeerConflict[] = [];
  for (const [pkg, reqs] of peerReqs) {
    if (conflictedPkgs.has(pkg)) continue;
    // An optional peer (in the MERGED meta) may be absent; a present peer
    // must still satisfy regardless of the optional flag.
    const optional = merged.peerDependenciesMeta?.[pkg]?.optional === true;
    for (const req of reqs) {
      const installRange = installRangeFor(merged, pkg);
      if (installRange === undefined) {
        if (optional) continue;
        conflicts.push({
          type: 'peer',
          package: pkg,
          values: { [req.label]: req.range },
          severity: 'warning',
          peerSource: req.label,
        });
        continue;
      }
      const r = intersects(installRange, req.range);
      const unsatisfied = r.isErr() ? true : !r.value;
      if (!unsatisfied) continue;
      conflicts.push({
        type: 'peer',
        package: pkg,
        values: { [req.label]: req.range, 'install-set': installRange },
        severity: 'warning',
        peerSource: req.label,
      });
    }
  }
  return conflicts;
}

/**
 * Detect peerDependency conflicts across the merged manifest and the input
 * manifests (P-110). Pure: returns freshly constructed conflicts, never
 * throws, never mutates its inputs.
 *
 * - `merged` — the P-108 fold result for the npm ecosystem: the install set
 *   (`dependencies` + `optionalDependencies` + `devDependencies`) peers are
 *   checked against, plus the merged `peerDependenciesMeta` for the
 *   optional-peer rule. The check is against the first-seen install-set
 *   value (P-108 keeps first-seen on conflict; P-109 resolves later).
 * - `manifests` — the input manifests; non-npm members are ignored, npm
 *   members are labeled positionally in input order (`repo-a`, ...).
 *
 * The produced conflicts:
 * - both-peer ranges incompatible (disjoint/invalid, pairwise over 2+
 *   sides peering the same package) — compatible ranges produce NO
 *   conflict (the refinement of P-108's raw peer-range fold);
 * - peer requirements unsatisfied by the install set (per requirement,
 *   skipping packages already conflicted above; optional peers may be
 *   absent, present peers must satisfy).
 *
 * Every conflict carries `type: 'peer'`, `severity: 'warning'`, the
 * triggering side's `peerSource`, and a `suggestedResolution` from
 * `suggestPeerFix` — the merge result carries the fix immediately, so
 * P-151's auto-fix and the P-219 panel consume it directly.
 */
export function detectPeerConflicts(
  merged: NpmManifest,
  manifests: ParsedManifest[]
): PeerConflict[] {
  const npmInputs = npmLabeled(manifests);
  const peerReqs = collectPeerRequirements(npmInputs);

  const both = bothPeerConflicts(peerReqs);
  const unmet = unmetPeerConflicts(peerReqs, merged, both.conflictedPkgs);

  const conflicts: PeerConflict[] = [...both.conflicts, ...unmet];
  for (const conflict of conflicts) {
    conflict.suggestedResolution = suggestPeerFix(conflict);
  }
  return conflicts;
}

/**
 * Suggest a fix for a peer conflict (P-110), reading the two sides' range
 * strings off the conflict's `values`:
 *
 * - either side is `'*'` → the tolerant side makes the peer optional:
 *   `add peerDependenciesMeta: {<pkg>: {optional: true}}`.
 * - the ranges intersect → the intersected range (from `resolveCollision`'s
 *   narrowest logic) forces the install set to satisfy both:
 *   `add overrides: {<pkg>: '<intersected range>'}` (overrides ship in
 *   npm 8.3+, the modern default).
 * - else (disjoint or single-sided) → the versions are mutually exclusive,
 *   so the fix needs human judgment:
 *   `add peerDependenciesMeta: {<pkg>: {optional: true}} (manual review
 *   required)`.
 *
 * Pure: returns a string, never throws. Consumed by the P-219 panel and
 * P-151's `fix_dependency` auto-tool via `Conflict.suggestedResolution`.
 */
export function suggestPeerFix(conflict: PeerConflict): string {
  const pkg = conflict.package;
  const entries = Object.entries(conflict.values);
  if (entries.some(([, value]) => value === '*')) {
    return `add peerDependenciesMeta: {${pkg}: {optional: true}}`;
  }
  const first = entries[0];
  const second = entries[1];
  if (first !== undefined && second !== undefined) {
    const r = resolveCollision(first[1], second[1]);
    if (r.isOk() && r.value.kind === 'resolved') {
      return `add overrides: {${pkg}: '${r.value.range}'}`;
    }
  }
  return `add peerDependenciesMeta: {${pkg}: {optional: true}} (manual review required)`;
}
