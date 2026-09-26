// P-110 tests: peerDependency conflict handling. Every manifest below is
// built through the real P-104 parser (round-trip proof: the peer analysis
// consumes actual parser output, never hand-shaped fixtures). Covers the
// three spec-required cases plus the acceptance criteria (react@18 vs ^18
// no conflict, react@17 vs ^18 warning, overrides suggestion, warning
// severity keeps the merge mergeable, peer optional `*` case) and the
// documented edges (both-peer refinement replacing the P-108 fold's raw
// conflicts, optional absent/present, unmet absent, wildcard, invalid
// fail-closed, devDeps satisfaction, deps priority, non-npm ignore,
// no peers, 3-side pairwise dedupe, identical ranges, end-to-end
// unionManifests integration).
import { describe, expect, it } from 'vitest';
import { parsePackageJson } from './parse/npm.js';
import { parsePythonManifest } from './parse/python.js';
import { parseCargoToml } from './parse/cargo.js';
import { parseGoMod } from './parse/go.js';
import { unionManifests } from './merge.js';
import { detectPeerConflicts, suggestPeerFix } from './peer.js';
import type { PeerConflict } from './peer.js';
import type { NpmManifest, ParsedManifest, UnifiedManifest } from './types.js';

function mustNpm(content: string, path: string): ParsedManifest {
  const r = parsePackageJson(content, path);
  expect(r.isOk()).toBe(true);
  if (r.isErr()) throw new Error(`npm fixture failed to parse: ${path}`);
  return r.value;
}

function mustPython(content: string, path: string): ParsedManifest {
  const r = parsePythonManifest(path, content);
  expect(r.isOk()).toBe(true);
  if (r.isErr()) throw new Error(`python fixture failed to parse: ${path}`);
  return r.value;
}

function mustCargo(content: string, path: string): ParsedManifest {
  const r = parseCargoToml(content, path);
  expect(r.isOk()).toBe(true);
  if (r.isErr()) throw new Error(`cargo fixture failed to parse: ${path}`);
  return r.value;
}

function mustGo(content: string, path: string): ParsedManifest {
  const r = parseGoMod(content, path);
  expect(r.isOk()).toBe(true);
  if (r.isErr()) throw new Error(`go fixture failed to parse: ${path}`);
  return r.value;
}

/** Narrow a merged manifest to its npm shape (npm has no required key). */
function asNpm(merged: UnifiedManifest): NpmManifest {
  if ('source' in merged || 'package' in merged || 'module' in merged) {
    throw new Error('expected an npm manifest');
  }
  return merged;
}

/** unionManifests with a throw-on-err guard (test fixtures never err). */
function unionManifestsOrThrow(manifests: ParsedManifest[]): import('./types.js').MergeResult {
  const r = unionManifests(manifests);
  expect(r.isOk()).toBe(true);
  if (r.isErr()) throw new Error(`union failed: ${r.error.code}`);
  return r.value;
}

describe('P-110 peer: detectPeerConflicts', () => {
  it('no conflict when peer satisfied', () => {
    // The acceptance scenario: react@18 in A dependencies satisfies the
    // react@"^18" peer required by B — the install set admits the range.
    const merged = asNpm(
      unionManifestsOrThrow([
        mustNpm(JSON.stringify({ dependencies: { react: '18' } }), 'repo-a/package.json'),
        mustNpm(JSON.stringify({ peerDependencies: { react: '^18' } }), 'repo-b/package.json'),
      ]).merged
    );
    const manifests = [
      mustNpm(JSON.stringify({ dependencies: { react: '18' } }), 'repo-a/package.json'),
      mustNpm(JSON.stringify({ peerDependencies: { react: '^18' } }), 'repo-b/package.json'),
    ];
    expect(detectPeerConflicts(merged, manifests)).toEqual([]);

    // A caret install-set range works the same way (range-vs-range).
    const merged2 = asNpm(
      unionManifestsOrThrow([
        mustNpm(JSON.stringify({ dependencies: { react: '^18.0.0' } }), 'repo-a/package.json'),
        mustNpm(JSON.stringify({ peerDependencies: { react: '^18' } }), 'repo-b/package.json'),
      ]).merged
    );
    const manifests2 = [
      mustNpm(JSON.stringify({ dependencies: { react: '^18.0.0' } }), 'repo-a/package.json'),
      mustNpm(JSON.stringify({ peerDependencies: { react: '^18' } }), 'repo-b/package.json'),
    ];
    expect(detectPeerConflicts(merged2, manifests2)).toEqual([]);
  });

  it('warns when peer unsatisfied', () => {
    // The acceptance scenario: react@17 in the install set does NOT satisfy
    // the react@"^18" peer — one warning conflict, severity warning.
    const manifests = [
      mustNpm(JSON.stringify({ dependencies: { react: '17' } }), 'repo-a/package.json'),
      mustNpm(JSON.stringify({ peerDependencies: { react: '^18' } }), 'repo-b/package.json'),
    ];
    const merged = asNpm(unionManifestsOrThrow(manifests).merged);
    const conflicts = detectPeerConflicts(merged, manifests);
    expect(conflicts).toHaveLength(1);
    const conflict = conflicts[0];
    expect(conflict).toBeDefined();
    if (conflict === undefined) return;
    expect(conflict.type).toBe('peer');
    expect(conflict.severity).toBe('warning');
    expect(conflict.package).toBe('react');
    expect(conflict.peerSource).toBe('repo-b');
    expect(conflict.values).toEqual({ 'repo-b': '^18', 'install-set': '17' });
    // The merge result carries the fix immediately (the P-110 refinement).
    expect(conflict.suggestedResolution).toBeDefined();
    expect(conflict.suggestedResolution).toContain('manual review required');
  });

  it('suggests overrides when intersect', () => {
    // The acceptance scenario: overlapping peer ranges get the overrides
    // suggestion carrying the intersected range (resolveCollision's
    // narrowest logic: ^17.2.0 is the subset side).
    const conflict: PeerConflict = {
      type: 'peer',
      package: 'react',
      values: { 'repo-a': '^17.0.0', 'repo-b': '^17.2.0' },
      severity: 'warning',
      peerSource: 'repo-a',
    };
    expect(suggestPeerFix(conflict)).toBe(`add overrides: {react: '^17.2.0'}`);

    // A genuine partial overlap (neither contains the other) also resolves
    // through the conjunction basis.
    const partial: PeerConflict = {
      type: 'peer',
      package: 'vite',
      values: { 'repo-a': '^5.0.0', 'repo-b': '>=4.0.0 <5.1.0' },
      severity: 'warning',
      peerSource: 'repo-a',
    };
    const fix = suggestPeerFix(partial);
    expect(fix).toContain('add overrides: {vite:');
    expect(fix).toContain('>=4.0.0 <5.1.0');
  });

  it('both-peer disjoint ranges conflict with peer provenance', () => {
    // P-108's pinned shape: A peers ^18.0.0, B peers ^17.0.0 (disjoint) —
    // exactly one warning conflict naming both sides' ranges.
    const manifests = [
      mustNpm(JSON.stringify({ peerDependencies: { react: '^18.0.0' } }), 'repo-a/package.json'),
      mustNpm(JSON.stringify({ peerDependencies: { react: '^17.0.0' } }), 'repo-b/package.json'),
    ];
    const merged = asNpm(unionManifestsOrThrow(manifests).merged);
    const conflicts = detectPeerConflicts(merged, manifests);
    expect(conflicts).toHaveLength(1);
    const conflict = conflicts[0];
    expect(conflict).toBeDefined();
    if (conflict === undefined) return;
    expect(conflict.type).toBe('peer');
    expect(conflict.severity).toBe('warning');
    expect(conflict.peerSource).toBe('repo-a');
    expect(conflict.values).toEqual({ 'repo-a': '^18.0.0', 'repo-b': '^17.0.0' });
  });

  it('both-peer compatible ranges do not conflict', () => {
    // The P-110 refinement: compatible (intersecting) peer divergences no
    // longer conflict — npm installs one version satisfying both and the
    // merged map keeps first-seen. The P-108 fold's raw conflict is gone.
    // A satisfying direct dep keeps the unmet check quiet so this isolates
    // the both-peer refinement alone.
    const manifests = [
      mustNpm(
        JSON.stringify({
          dependencies: { react: '^17.2.0' },
          peerDependencies: { react: '^17.0.0' },
        }),
        'repo-a/package.json'
      ),
      mustNpm(JSON.stringify({ peerDependencies: { react: '^17.2.0' } }), 'repo-b/package.json'),
    ];
    const merged = asNpm(unionManifestsOrThrow(manifests).merged);
    expect(detectPeerConflicts(merged, manifests)).toEqual([]);
    expect(unionManifestsOrThrow(manifests).conflicts).toHaveLength(0);
  });

  it('compatible peer divergence without a direct dep surfaces unmet warnings', () => {
    // With NO direct dep providing the peered package, the unmet check
    // fires per requirement (npm warns UNMET PEER per declaration) — the
    // both-peer refinement still produces no range conflict.
    const manifests = [
      mustNpm(JSON.stringify({ peerDependencies: { react: '^17.0.0' } }), 'repo-a/package.json'),
      mustNpm(JSON.stringify({ peerDependencies: { react: '^17.2.0' } }), 'repo-b/package.json'),
    ];
    const merged = asNpm(unionManifestsOrThrow(manifests).merged);
    const conflicts = detectPeerConflicts(merged, manifests);
    expect(conflicts).toHaveLength(2);
    for (const conflict of conflicts) {
      expect(conflict.type).toBe('peer');
      expect(conflict.severity).toBe('warning');
      expect(conflict.values['install-set']).toBeUndefined();
    }
    expect(conflicts.map(c => c.peerSource)).toEqual(['repo-a', 'repo-b']);
  });

  it('optional peer absent from install set does not conflict', () => {
    // peerDependenciesMeta optional:true forgives ABSENCE (npm's rule).
    const manifests = [
      mustNpm(
        JSON.stringify({
          peerDependencies: { react: '^18' },
          peerDependenciesMeta: { react: { optional: true } },
        }),
        'repo-a/package.json'
      ),
    ];
    const merged = asNpm(unionManifestsOrThrow(manifests).merged);
    expect(detectPeerConflicts(merged, manifests)).toEqual([]);
  });

  it('optional peer present but unsatisfying still conflicts', () => {
    // An optional peer only forgives absence — a present peer must satisfy.
    const manifests = [
      mustNpm(
        JSON.stringify({
          peerDependencies: { react: '^18' },
          peerDependenciesMeta: { react: { optional: true } },
        }),
        'repo-a/package.json'
      ),
      mustNpm(JSON.stringify({ dependencies: { react: '17' } }), 'repo-b/package.json'),
    ];
    const merged = asNpm(unionManifestsOrThrow(manifests).merged);
    const conflicts = detectPeerConflicts(merged, manifests);
    expect(conflicts).toHaveLength(1);
    const conflict = conflicts[0];
    expect(conflict).toBeDefined();
    if (conflict === undefined) return;
    expect(conflict.type).toBe('peer');
    expect(conflict.severity).toBe('warning');
    expect(conflict.values).toEqual({ 'repo-a': '^18', 'install-set': '17' });
  });

  it('unmet peer with absent install set conflicts', () => {
    // No side directly depends on the peered package: npm warns UNMET PEER.
    const manifests = [
      mustNpm(
        JSON.stringify({ peerDependencies: { react: '^18' }, dependencies: { lodash: '^4.0.0' } }),
        'repo-a/package.json'
      ),
    ];
    const merged = asNpm(unionManifestsOrThrow(manifests).merged);
    const conflicts = detectPeerConflicts(merged, manifests);
    expect(conflicts).toHaveLength(1);
    const conflict = conflicts[0];
    expect(conflict).toBeDefined();
    if (conflict === undefined) return;
    expect(conflict.peerSource).toBe('repo-a');
    expect(conflict.values).toEqual({ 'repo-a': '^18' });
  });

  it('wildcard peer ranges are compatible, unmet wildcards still warn', () => {
    // '*' vs '^18' intersect (the wildcard contains everything) — the
    // both-peer check produces NO conflict.
    const compatible = [
      mustNpm(JSON.stringify({ peerDependencies: { react: '*' } }), 'repo-a/package.json'),
      mustNpm(JSON.stringify({ peerDependencies: { react: '^18' } }), 'repo-b/package.json'),
      mustNpm(JSON.stringify({ dependencies: { react: '^18.0.0' } }), 'repo-c/package.json'),
    ];
    const merged = asNpm(unionManifestsOrThrow(compatible).merged);
    expect(detectPeerConflicts(merged, compatible)).toEqual([]);

    // A '*' peer with an absent install set still warns (npm warns UNMET
    // PEER for uninstalled peers regardless of range) — with the '*'
    // branch of suggestPeerFix for the fix string.
    const unmet = [
      mustNpm(JSON.stringify({ peerDependencies: { react: '*' } }), 'repo-a/package.json'),
    ];
    const merged2 = asNpm(unionManifestsOrThrow(unmet).merged);
    const conflicts = detectPeerConflicts(merged2, unmet);
    expect(conflicts).toHaveLength(1);
    const conflict = conflicts[0];
    expect(conflict).toBeDefined();
    if (conflict === undefined) return;
    expect(conflict.values).toEqual({ 'repo-a': '*' });
    expect(conflict.suggestedResolution).toBe(
      'add peerDependenciesMeta: {react: {optional: true}}'
    );
  });

  it('invalid peer range fails closed without throwing', () => {
    // An unparseable peer range cannot be verified — fail-closed toward
    // surfacing (the user decides), never an escaping exception.
    const manifests = [
      mustNpm(
        JSON.stringify({ peerDependencies: { react: 'not-a-range' } }),
        'repo-a/package.json'
      ),
      mustNpm(JSON.stringify({ dependencies: { react: '18' } }), 'repo-b/package.json'),
    ];
    const merged = asNpm(unionManifestsOrThrow(manifests).merged);
    const conflicts = detectPeerConflicts(merged, manifests);
    expect(conflicts).toHaveLength(1);
    const conflict = conflicts[0];
    expect(conflict).toBeDefined();
    if (conflict === undefined) return;
    expect(conflict.type).toBe('peer');
    expect(conflict.severity).toBe('warning');
  });

  it('devDependencies satisfy peers', () => {
    // npm resolves peers against the whole installed tree — the install
    // set includes devDependencies.
    const manifests = [
      mustNpm(JSON.stringify({ peerDependencies: { react: '^18' } }), 'repo-a/package.json'),
      mustNpm(JSON.stringify({ devDependencies: { react: '^18.0.0' } }), 'repo-b/package.json'),
    ];
    const merged = asNpm(unionManifestsOrThrow(manifests).merged);
    expect(detectPeerConflicts(merged, manifests)).toEqual([]);
  });

  it('dependencies take priority over devDependencies in the install set', () => {
    // npm's own precedence: dependencies win over devDependencies when a
    // package lands in both maps after the merge.
    const manifests = [
      mustNpm(JSON.stringify({ peerDependencies: { typescript: '^5' } }), 'repo-a/package.json'),
      mustNpm(
        JSON.stringify({
          dependencies: { typescript: '^5.0.0' },
          devDependencies: { typescript: '^4.0.0' },
        }),
        'repo-b/package.json'
      ),
    ];
    const merged = asNpm(unionManifestsOrThrow(manifests).merged);
    expect(detectPeerConflicts(merged, manifests)).toEqual([]);
  });

  it('optionalDependencies slot into the install set between deps and devDeps', () => {
    // npm's precedence: dependencies > optionalDependencies >
    // devDependencies. A package present only in optionalDependencies is
    // still in the install set and satisfies peers.
    const manifests = [
      mustNpm(JSON.stringify({ peerDependencies: { typescript: '^5' } }), 'repo-a/package.json'),
      mustNpm(
        JSON.stringify({
          optionalDependencies: { typescript: '^5.0.0' },
          devDependencies: { typescript: '^4.0.0' },
        }),
        'repo-b/package.json'
      ),
    ];
    const merged = asNpm(unionManifestsOrThrow(manifests).merged);
    expect(detectPeerConflicts(merged, manifests)).toEqual([]);
  });

  it('non-npm manifests are ignored', () => {
    // Peers are an npm concept: python/cargo/go members never produce
    // peer conflicts.
    const merged = asNpm(
      unionManifestsOrThrow([mustNpm(JSON.stringify({ dependencies: {} }), 'repo-a/package.json')])
        .merged
    );
    const manifests: ParsedManifest[] = [
      mustPython('requests>=2.0.0\n', 'repo-b/requirements.txt'),
      mustCargo(
        '[package]\nname = "c"\nversion = "0.1.0"\n\n[dependencies]\nserde = "1.0"\n',
        'repo-c/Cargo.toml'
      ),
      mustGo('module example.com/m\n\ngo 1.21\n', 'repo-d/go.mod'),
    ];
    expect(detectPeerConflicts(merged, manifests)).toEqual([]);
  });

  it('no peers yields empty array', () => {
    const merged = asNpm(
      unionManifestsOrThrow([
        mustNpm(JSON.stringify({ dependencies: { lodash: '^4.0.0' } }), 'repo-a/package.json'),
      ]).merged
    );
    const manifests = [
      mustNpm(JSON.stringify({ dependencies: { react: '^18.0.0' } }), 'repo-b/package.json'),
    ];
    expect(detectPeerConflicts(merged, manifests)).toEqual([]);
  });

  it('three sides pairwise disjoint produce one conflict per pair', () => {
    // Unordered-pair dedupe: (A,B), (A,C), (B,C) — each disjoint pair
    // surfaces exactly once, regardless of side order.
    const manifests = [
      mustNpm(JSON.stringify({ peerDependencies: { react: '^17.0.0' } }), 'repo-a/package.json'),
      mustNpm(JSON.stringify({ peerDependencies: { react: '^18.0.0' } }), 'repo-b/package.json'),
      mustNpm(JSON.stringify({ peerDependencies: { react: '^19.0.0' } }), 'repo-c/package.json'),
    ];
    const merged = asNpm(unionManifestsOrThrow(manifests).merged);
    const conflicts = detectPeerConflicts(merged, manifests);
    expect(conflicts).toHaveLength(3);
    const pairKeys = conflicts.map(c => {
      const labels = Object.keys(c.values).sort();
      return labels.join('|');
    });
    expect(pairKeys).toEqual(['repo-a|repo-b', 'repo-a|repo-c', 'repo-b|repo-c']);
    // Every conflict is a warning with the first pair side as peerSource.
    for (const conflict of conflicts) {
      expect(conflict.severity).toBe('warning');
      expect(conflict.peerSource).toBe(Object.keys(conflict.values)[0]);
    }
  });

  it('identical peer ranges from multiple sides do not conflict', () => {
    const manifests = [
      mustNpm(JSON.stringify({ peerDependencies: { react: '^17.0.0' } }), 'repo-a/package.json'),
      mustNpm(JSON.stringify({ peerDependencies: { react: '^17.0.0' } }), 'repo-b/package.json'),
      mustNpm(JSON.stringify({ dependencies: { react: '^17.0.0' } }), 'repo-c/package.json'),
    ];
    const merged = asNpm(unionManifestsOrThrow(manifests).merged);
    expect(detectPeerConflicts(merged, manifests)).toEqual([]);
  });
});

describe('P-110 peer: suggestPeerFix', () => {
  it('suggests peerDependenciesMeta optional when one side is a wildcard', () => {
    const conflict: PeerConflict = {
      type: 'peer',
      package: 'react',
      values: { 'repo-a': '*', 'repo-b': '^18' },
      severity: 'warning',
      peerSource: 'repo-a',
    };
    expect(suggestPeerFix(conflict)).toBe('add peerDependenciesMeta: {react: {optional: true}}');
  });

  it('suggests manual review for disjoint ranges', () => {
    const conflict: PeerConflict = {
      type: 'peer',
      package: 'react',
      values: { 'repo-a': '^18.0.0', 'repo-b': '^17.0.0' },
      severity: 'warning',
      peerSource: 'repo-a',
    };
    expect(suggestPeerFix(conflict)).toBe(
      'add peerDependenciesMeta: {react: {optional: true}} (manual review required)'
    );
  });

  it('suggests manual review for single-sided conflicts', () => {
    const conflict: PeerConflict = {
      type: 'peer',
      package: 'react',
      values: { 'repo-a': '^18' },
      severity: 'warning',
      peerSource: 'repo-a',
    };
    expect(suggestPeerFix(conflict)).toBe(
      'add peerDependenciesMeta: {react: {optional: true}} (manual review required)'
    );
  });

  it('names the conflicting package in every suggestion', () => {
    const cases: PeerConflict[] = [
      {
        type: 'peer',
        package: 'left-pad',
        values: { 'repo-a': '*', 'repo-b': '^1.0.0' },
        severity: 'warning',
        peerSource: 'repo-a',
      },
      {
        type: 'peer',
        package: 'left-pad',
        values: { 'repo-a': '^1.0.0', 'repo-b': '^1.2.0' },
        severity: 'warning',
        peerSource: 'repo-a',
      },
      {
        type: 'peer',
        package: 'left-pad',
        values: { 'repo-a': '^1.0.0', 'repo-b': '^2.0.0' },
        severity: 'warning',
        peerSource: 'repo-a',
      },
    ];
    for (const conflict of cases) {
      expect(suggestPeerFix(conflict)).toContain('left-pad');
    }
  });
});

describe('P-110 peer: end-to-end unionManifests integration', () => {
  it('appends peer conflicts with suggestedResolution to the merge result', () => {
    // The acceptance scenario: react@17 (install set) vs react@"^18" peer —
    // one warning conflict, type peer, fix carried on the conflict.
    const r = unionManifestsOrThrow([
      mustNpm(JSON.stringify({ dependencies: { react: '17' } }), 'repo-a/package.json'),
      mustNpm(JSON.stringify({ peerDependencies: { react: '^18' } }), 'repo-b/package.json'),
    ]);
    expect(r.conflicts).toHaveLength(1);
    const conflict = r.conflicts[0];
    expect(conflict).toBeDefined();
    if (conflict === undefined) return;
    expect(conflict.type).toBe('peer');
    expect(conflict.severity).toBe('warning');
    expect(conflict.suggestedResolution).toBeDefined();
    // Warning severity never blocks the merge: the merge result stays
    // mergeable regardless of the peer conflict.
    expect(r.warnings).toEqual([]);
  });

  it('P-108 parity: disjoint both-peer still yields exactly one conflict', () => {
    const r = unionManifestsOrThrow([
      mustNpm(JSON.stringify({ peerDependencies: { react: '^18.0.0' } }), 'repo-a/package.json'),
      mustNpm(JSON.stringify({ peerDependencies: { react: '^17.0.0' } }), 'repo-b/package.json'),
    ]);
    expect(r.conflicts).toHaveLength(1);
    const conflict = r.conflicts[0];
    expect(conflict).toBeDefined();
    if (conflict === undefined) return;
    expect(conflict.type).toBe('peer');
    expect(conflict.values).toEqual({ 'repo-a': '^18.0.0', 'repo-b': '^17.0.0' });
  });

  it('compatible peer divergence no longer conflicts end-to-end', () => {
    // A satisfying direct dep keeps the unmet check quiet; the both-peer
    // refinement suppresses the fold's raw range conflict entirely.
    const r = unionManifestsOrThrow([
      mustNpm(
        JSON.stringify({
          dependencies: { react: '^17.2.0' },
          peerDependencies: { react: '^17.0.0' },
        }),
        'repo-a/package.json'
      ),
      mustNpm(JSON.stringify({ peerDependencies: { react: '^17.2.0' } }), 'repo-b/package.json'),
    ]);
    expect(r.conflicts).toHaveLength(0);
    // The merged map keeps first-seen.
    expect(asNpm(r.merged).peerDependencies).toEqual({ react: '^17.0.0' });
  });

  it('peerDependenciesMeta flag drift still conflicts (fold untouched)', () => {
    const r = unionManifestsOrThrow([
      mustNpm(
        JSON.stringify({ peerDependenciesMeta: { typescript: { optional: true } } }),
        'repo-a/package.json'
      ),
      mustNpm(JSON.stringify({ peerDependenciesMeta: { typescript: {} } }), 'repo-b/package.json'),
    ]);
    expect(r.conflicts).toHaveLength(1);
    const conflict = r.conflicts[0];
    expect(conflict).toBeDefined();
    if (conflict === undefined) return;
    expect(conflict.type).toBe('peer');
    expect(conflict.severity).toBe('warning');
  });

  it('version conflicts keep suggestedResolution absent (P-110 is peer-only)', () => {
    const r = unionManifestsOrThrow([
      mustNpm(JSON.stringify({ dependencies: { react: '^18.0.0' } }), 'repo-a/package.json'),
      mustNpm(JSON.stringify({ dependencies: { react: '^17.0.0' } }), 'repo-b/package.json'),
    ]);
    expect(r.conflicts).toHaveLength(1);
    const conflict = r.conflicts[0];
    expect(conflict).toBeDefined();
    if (conflict === undefined) return;
    expect(conflict.type).toBe('version');
    expect(conflict.severity).toBe('error');
    expect(conflict.suggestedResolution).toBeUndefined();
  });

  it('round-trips the full flow: deps fold + peer analysis + merged map', () => {
    // A realistic two-repo merge: shared deps, one peer satisfied by the
    // install set, one peer unmet.
    const r = unionManifestsOrThrow([
      mustNpm(
        JSON.stringify({
          dependencies: { react: '^18.0.0', lodash: '~4.17.21' },
          peerDependencies: { react: '^18', 'styled-components': '^5.0.0' },
        }),
        'repo-a/package.json'
      ),
      mustNpm(
        JSON.stringify({
          dependencies: { react: '^18.0.0' },
          peerDependencies: { react: '^18' },
        }),
        'repo-b/package.json'
      ),
    ]);
    // react: both-peer ranges identical (no both-peer conflict) and the
    // install set satisfies ^18 — no conflict.
    // styled-components: peered by repo-a only, absent from the install
    // set — one unmet warning conflict.
    expect(r.conflicts).toHaveLength(1);
    const conflict = r.conflicts[0];
    expect(conflict).toBeDefined();
    if (conflict === undefined) return;
    if (!('peerSource' in conflict)) throw new Error('expected a peer conflict');
    expect(conflict.package).toBe('styled-components');
    expect(conflict.peerSource).toBe('repo-a');
    expect(conflict.suggestedResolution).toContain('manual review required');
    const merged = asNpm(r.merged);
    expect(merged.dependencies).toEqual({ react: '^18.0.0', lodash: '~4.17.21' });
    expect(merged.peerDependencies).toEqual({
      react: '^18',
      'styled-components': '^5.0.0',
    });
  });
});
