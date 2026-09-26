// Deps manifest union + conflict detection (P-108): the heart of Epic 4.
// Takes one `ParsedManifest` per source repo (all four P-104–P-107 parser
// outputs) and folds them into a single `UnifiedManifest`, recording every
// key collision as a `Conflict` for P-109 (semver auto-resolve), P-110
// (peer warnings), P-111 (dedupe strategy), and P-116 (report) plus the UI
// panel (P-219) to consume.
//
// Safety contract (P-011):
// - No throws: every failure is a typed `Result` err. Mixed-ecosystem
//   inputs are caller bugs -> ECOSYSTEM_MISMATCH (with the sorted
//   ecosystem list); an empty input array is a caller bug -> CONFIG_ERROR.
//   The `semver` library calls used for `engines`/`pythonVersion`/
//   `goVersion` picks are guarded by coerce-then-compare inside try/catch:
//   an unparsable version can never escape as an exception — it falls back
//   to first-wins plus a `warnings[]` note.
// - Only package names, source labels, and version strings reach errors,
//   warnings, and logs — never file contents.
// - Inputs are never mutated: every map is shallow-copied (cargo table
//   values and feature arrays are copied element-wise; go `indirect`
//   becomes a fresh `Set`), so callers can reuse their manifests freely.
//
// Merge rules per ecosystem (never leaked wire shapes — parsers own those):
// - npm: `dependencies`/`devDependencies`/`optionalDependencies`/
//   `overrides` fold with version conflicts (type `version`, error);
//   `peerDependencies` fold unions the merged map — P-110's refined peer
//   analysis REPLACES the fold's raw range conflicts (compatible
//   divergences no longer conflict; disjoint peer pairs and install-set
//   mismatches surface as peer/warning conflicts with suggestedResolution);
//   `peerDependenciesMeta` unions with a peer/warning conflict when the
//   same key carries different flags; `scripts` keep
//   identical values, prefix collisions as `<label>:<name>` (type `script`,
//   warning — P-112 extracts this into `scripts.ts`); `engines` picks the
//   higher semver value; `workspaces` unions deduped and sorted.
// - python: `dependencies`/`devDependencies` fold with version conflicts;
//   `extras` union per key (order-preserving dedupe); `urls` fold with
//   version conflicts on divergent targets; `pythonVersion` picks the
//   higher numeric minimum; `source` keeps the first manifest's dialect
//   with a warning when inputs mix dialects (P-114 picks the lockfile
//   regenerator from it).
// - cargo: `dependencies`/`devDependencies` fold version-aware (a bare
//   `"1.0"` and `{ version = "1.0" }` with no extras are the same dep —
//   same version unions features and requires (required wins over
//   `optional`), no conflict; differing versions conflict); `buildDependencies` folds as plain strings; `features`
//   union per feature; `workspace.members` union; `[package]` identity
//   keeps the first manifest with a warning when others differ (two
//   crates cannot share one identity — the pipeline renames in P-112+).
// - go: `require`/`exclude` fold with version conflicts; `replace` keeps
//   identical targets and conflicts (error) on same-old/different-new;
//   `indirect` unions; `goVersion` picks the higher numeric version;
//   `module` keeps the first path with a warning when others differ.
//
// Source labels: inputs have no repo names (only file paths), so conflicts
// are keyed by positional labels `repo-a`, `repo-b`, ... in input order
// (spreadsheet-style past `repo-z`: `repo-aa`, ...). Deterministic for any
// input order; P-116/P-219 render these labels directly.
// On any version conflict the merged map keeps the first-seen value —
// P-109 resolves it later; the conflict carries both sides.

import { sourceLabel } from './labels.js';
import { chooseDedupeStrategy } from './dedupe.js';
import { detectPeerConflicts } from './peer.js';
import { semver, type SemVer } from './semver.js';
import type { CargoManifest, Conflict, GoManifest, NpmManifest, PythonManifest } from './types.js';

// Positional source labels moved to labels.ts (P-110's peer analysis needs
// them too; re-exported so the public barrel surface is unchanged).
export { sourceLabel };

/** The folded output of `recordMerge`: merged map plus its conflicts. */
export interface RecordMergeResult {
  merged: Record<string, string>;
  conflicts: Conflict[];
}

/** Options for `recordMerge`: conflict taxonomy (default version/error). */
export interface RecordMergeOptions {
  type?: Conflict['type'];
  severity?: Conflict['severity'];
}

/**
 * Fold two `Record<name, spec>` maps: keys only in one side are kept, keys
 * in both with equal values are kept once, keys in both with differing
 * values keep the `a` value and produce one `Conflict` whose `values`
 * maps each source label to its spec. Never throws; pure string compare.
 */
export function recordMerge(
  a: Record<string, string>,
  b: Record<string, string>,
  sourceA: string,
  sourceB: string,
  options: RecordMergeOptions = {}
): RecordMergeResult {
  const type = options.type ?? 'version';
  const severity = options.severity ?? 'error';
  const merged: Record<string, string> = { ...a };
  const conflicts: Conflict[] = [];
  for (const [name, specB] of Object.entries(b)) {
    if (!Object.hasOwn(merged, name)) {
      merged[name] = specB;
      continue;
    }
    const specA = merged[name];
    if (specA === specB) continue;
    if (specA === undefined) {
      merged[name] = specB;
      continue;
    }
    conflicts.push({
      type,
      package: name,
      values: { [sourceA]: specA, [sourceB]: specB },
      severity,
    });
  }
  return { merged, conflicts };
}

/** Deterministic conflict order: by package (code units), then type. */
export function compareConflicts(a: Conflict, b: Conflict): number {
  if (a.package < b.package) return -1;
  if (a.package > b.package) return 1;
  if (a.type < b.type) return -1;
  if (a.type > b.type) return 1;
  return 0;
}

/** Code-unit sort (NOT locale-aware) for deterministic emits. */
function compareCodeUnit(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** One input manifest paired with its positional source label. */
interface Labeled<T> {
  manifest: T;
  label: string;
}

/**
 * N-way fold of `Record<name, spec>` maps with per-key provenance: the
 * merged map keeps the first-seen value on collision and each conflict
 * names the two labels that actually set the colliding values (correct
 * for 3+ inputs, where pairwise folding would mislabel the accumulator).
 */
function foldStringMaps(
  inputs: readonly { map: Record<string, string> | undefined; label: string }[],
  options: RecordMergeOptions = {}
): RecordMergeResult {
  const type = options.type ?? 'version';
  const severity = options.severity ?? 'error';
  const merged: Record<string, string> = {};
  const origin: Record<string, string> = {};
  const conflicts: Conflict[] = [];
  for (const { map, label } of inputs) {
    if (map === undefined) continue;
    for (const [name, spec] of Object.entries(map)) {
      const existing = merged[name];
      if (existing === undefined) {
        merged[name] = spec;
        origin[name] = label;
        continue;
      }
      if (existing === spec) continue;
      const firstLabel = origin[name] ?? label;
      conflicts.push({
        type,
        package: name,
        values: { [firstLabel]: existing, [label]: spec },
        severity,
      });
    }
  }
  return { merged, conflicts };
}

/**
 * Pick which of two version strings names the higher version, using
 * `semver.coerce` (handles `^1.2.3`, `>=20.0.0`, `1.21`, `3.11.0`)
 * inside try/catch. Returns `'a'`/`'b'` for the winner, or `undefined`
 * when either side is unparsable (caller keeps first + warns). Never
 * throws: the raw lib calls are fully guarded.
 */
function higherVersion(a: string, b: string): 'a' | 'b' | undefined {
  let va: SemVer | undefined;
  let vb: SemVer | undefined;
  try {
    va = semver.coerce(a) ?? undefined;
    vb = semver.coerce(b) ?? undefined;
  } catch {
    return undefined;
  }
  if (va === undefined || vb === undefined) return undefined;
  try {
    if (semver.gt(va, vb)) return 'a';
    if (semver.gt(vb, va)) return 'b';
    return 'a';
  } catch {
    return undefined;
  }
}

/** Union string arrays order-preserving with dedupe. */
function unionStrArrays(a: readonly string[], b: readonly string[]): string[] {
  const out = [...a];
  for (const item of b) {
    if (!out.includes(item)) out.push(item);
  }
  return out;
}

/** Union of `string[]` maps (`extras`, `features`): per-key array union. */
function unionListMaps(
  inputs: readonly { map: Record<string, string[]> | undefined; label: string }[]
): Record<string, string[]> {
  const merged: Record<string, string[]> = {};
  for (const { map } of inputs) {
    if (map === undefined) continue;
    for (const [key, list] of Object.entries(map)) {
      const existing = merged[key];
      merged[key] = existing === undefined ? [...list] : unionStrArrays(existing, list);
    }
  }
  return merged;
}

// ---------------------------------------------------------------------------
// npm
// ---------------------------------------------------------------------------

/** Display a `peerDependenciesMeta` entry deterministically for conflicts. */
function displayPeerMeta(entry: { optional?: boolean }): string {
  return JSON.stringify(entry.optional === true ? { optional: true } : {});
}

/** Fold `peerDependenciesMeta` maps: union keys, conflict on flag drift. */
function foldPeerMeta(inputs: readonly Labeled<NpmManifest>[]): {
  merged?: Record<string, { optional?: boolean }>;
  conflicts: Conflict[];
} {
  let defined = false;
  const merged: Record<string, { optional?: boolean }> = {};
  const origin: Record<string, string> = {};
  const conflicts: Conflict[] = [];
  for (const { manifest, label } of inputs) {
    const meta = manifest.peerDependenciesMeta;
    if (meta === undefined) continue;
    defined = true;
    for (const [name, entry] of Object.entries(meta)) {
      const existing = merged[name];
      if (existing === undefined) {
        merged[name] = entry.optional === true ? { optional: true } : {};
        origin[name] = label;
        continue;
      }
      const same = (existing.optional === true) === (entry.optional === true);
      if (same) continue;
      const firstLabel = origin[name] ?? label;
      conflicts.push({
        type: 'peer',
        package: name,
        values: { [firstLabel]: displayPeerMeta(existing), [label]: displayPeerMeta(entry) },
        severity: 'warning',
      });
    }
  }
  return { ...(defined ? { merged } : {}), conflicts };
}

/** Fold npm `scripts`: identical values kept, collisions prefixed per side. */
function foldScripts(inputs: readonly Labeled<NpmManifest>[]): {
  merged?: Record<string, string>;
  conflicts: Conflict[];
  warnings: string[];
} {
  let defined = false;
  const merged: Record<string, string> = {};
  const origin: Record<string, string> = {};
  const conflicts: Conflict[] = [];
  const warnings: string[] = [];
  for (const { manifest, label } of inputs) {
    const scripts = manifest.scripts;
    if (scripts === undefined) continue;
    defined = true;
    for (const [name, body] of Object.entries(scripts)) {
      const existing = merged[name];
      if (existing === undefined) {
        // A prefixed key from an earlier collision is a real script name
        // now: a later plain entry with the same name is genuinely
        // ambiguous, so it stays last-wins with a warning.
        merged[name] = body;
        if (origin[name] === undefined) origin[name] = label;
        continue;
      }
      if (existing === body) continue;
      const firstLabel = origin[name] ?? label;
      const keyA = `${firstLabel}:${name}`;
      const keyB = `${label}:${name}`;
      if (Object.hasOwn(merged, keyA) && merged[keyA] !== existing) {
        warnings.push(
          `script '${name}': prefixed key '${keyA}' already taken, overwriting with ${firstLabel} value`
        );
      }
      if (Object.hasOwn(merged, keyB) && merged[keyB] !== body) {
        warnings.push(
          `script '${name}': prefixed key '${keyB}' already taken, overwriting with ${label} value`
        );
      }
      delete merged[name];
      delete origin[name];
      merged[keyA] = existing;
      merged[keyB] = body;
      conflicts.push({
        type: 'script',
        package: name,
        values: { [firstLabel]: existing, [label]: body },
        severity: 'warning',
      });
    }
  }
  return { ...(defined ? { merged } : {}), conflicts, warnings };
}

/**
 * Fold npm `engines`: equal values kept, otherwise the higher semver
 * value wins; uncomparable pairs keep first + warning (never a conflict —
 * engines advise the runtime, they do not break the resolve).
 */
function foldEngines(inputs: readonly Labeled<NpmManifest>[]): {
  merged?: Record<string, string>;
  warnings: string[];
} {
  let defined = false;
  const merged: Record<string, string> = {};
  const warnings: string[] = [];
  for (const { manifest } of inputs) {
    const engines = manifest.engines;
    if (engines === undefined) continue;
    defined = true;
    for (const [name, spec] of Object.entries(engines)) {
      const existing = merged[name];
      if (existing === undefined) {
        merged[name] = spec;
        continue;
      }
      if (existing === spec) continue;
      const higher = higherVersion(existing, spec);
      if (higher === 'b') {
        merged[name] = spec;
      } else if (higher === undefined) {
        warnings.push(
          `engines '${name}': '${existing}' vs '${spec}' not comparable, keeping '${existing}'`
        );
      }
    }
  }
  return { ...(defined ? { merged } : {}), warnings };
}

/** Merge same-ecosystem npm manifests (inputs share `ecosystem: 'npm'`). */
export function mergeNpm(manifests: readonly { manifest: NpmManifest; path: string }[]): {
  merged: NpmManifest;
  conflicts: Conflict[];
  warnings: string[];
} {
  const labeled: Labeled<NpmManifest>[] = manifests.map((m, i) => ({
    manifest: m.manifest,
    label: sourceLabel(i),
  }));
  const conflicts: Conflict[] = [];
  const warnings: string[] = [];

  const deps = foldStringMaps(
    labeled.map(({ manifest, label }) => ({ map: manifest.dependencies, label }))
  );
  const dev = foldStringMaps(
    labeled.map(({ manifest, label }) => ({ map: manifest.devDependencies, label }))
  );
  const peer = foldStringMaps(
    labeled.map(({ manifest, label }) => ({ map: manifest.peerDependencies, label })),
    { type: 'peer', severity: 'warning' }
  );
  const optional = foldStringMaps(
    labeled.map(({ manifest, label }) => ({ map: manifest.optionalDependencies, label }))
  );
  const overrides = foldStringMaps(
    labeled.map(({ manifest, label }) => ({ map: manifest.overrides, label }))
  );
  conflicts.push(...deps.conflicts, ...dev.conflicts, ...optional.conflicts);
  // The peer fold's raw range conflicts are NOT pushed: P-110's refined
  // peer analysis (below) REPLACES them — compatible divergences no longer
  // conflict, disjoint pairs and install-set mismatches surface instead.
  conflicts.push(...overrides.conflicts);

  const meta = foldPeerMeta(labeled);
  conflicts.push(...meta.conflicts);

  const scripts = foldScripts(labeled);
  conflicts.push(...scripts.conflicts);
  warnings.push(...scripts.warnings);

  const engines = foldEngines(labeled);
  warnings.push(...engines.warnings);

  let workspaces: string[] | undefined;
  {
    let defined = false;
    const seen = new Set<string>();
    const list: string[] = [];
    for (const { manifest } of labeled) {
      if (manifest.workspaces === undefined) continue;
      defined = true;
      for (const entry of manifest.workspaces) {
        if (!seen.has(entry)) {
          seen.add(entry);
          list.push(entry);
        }
      }
    }
    if (defined) {
      list.sort(compareCodeUnit);
      workspaces = list;
    }
  }

  const merged: NpmManifest = { dependencies: deps.merged };
  if (
    Object.keys(dev.merged).length > 0 ||
    labeled.some(l => l.manifest.devDependencies !== undefined)
  ) {
    merged.devDependencies = dev.merged;
  }
  const peerMerged = peer.merged;
  if (
    Object.keys(peerMerged).length > 0 ||
    labeled.some(l => l.manifest.peerDependencies !== undefined)
  ) {
    merged.peerDependencies = peerMerged;
  }
  if (
    Object.keys(optional.merged).length > 0 ||
    labeled.some(l => l.manifest.optionalDependencies !== undefined)
  ) {
    merged.optionalDependencies = optional.merged;
  }
  if (
    Object.keys(overrides.merged).length > 0 ||
    labeled.some(l => l.manifest.overrides !== undefined)
  ) {
    merged.overrides = overrides.merged;
  }
  if (meta.merged !== undefined) merged.peerDependenciesMeta = meta.merged;
  if (scripts.merged !== undefined) merged.scripts = scripts.merged;
  if (engines.merged !== undefined) merged.engines = engines.merged;
  if (workspaces !== undefined) merged.workspaces = workspaces;

  // P-110: the refined peer analysis REPLACES the fold's raw peer-range
  // conflicts (compatible divergences no longer conflict; disjoint pairs
  // and unmet peers surface as warning conflicts with suggestedResolution).
  // The inputs are re-wrapped into the ParsedManifest shape detectPeerConflicts
  // takes; positional labels are re-derived identically (same order, same
  // deterministic sourceLabel).
  const peerConflicts = detectPeerConflicts(
    merged,
    manifests.map(m => ({ ecosystem: 'npm' as const, manifest: m.manifest, path: m.path }))
  );
  conflicts.push(...peerConflicts);

  // P-111: for version conflicts where no single range satisfies all
  // requestors, decide hoist vs nest. The dedupe strategy is stored on
  // the conflict for P-116 (report) and P-114 (lockfile regen) to consume.
  // Peer-involved packages always prefer nesting; major mismatches nest
  // even when npm supports overrides.
  const peerPackages = new Set(peerConflicts.map(c => c.package));
  for (const conflict of conflicts) {
    if (conflict.type !== 'version') continue;
    const dedupe = chooseDedupeStrategy([], conflict.values, {
      npmVersion: merged.engines?.['npm'],
      peerInvolved: peerPackages.has(conflict.package),
    });
    conflict.dedupeStrategy = dedupe.strategy;
    // Only set an automatic fix when hoisting can resolve the conflict;
    // nesting and error cases require manual review, so we keep
    // suggestedResolution absent (preserves P-108 parity for version
    // conflicts that need human attention).
    if (dedupe.strategy === 'hoist' && dedupe.version.length > 0) {
      conflict.suggestedResolution = dedupe.version;
    } else if (dedupe.strategy === 'hoist' && dedupe.version.length === 0) {
      // Hoist via overrides with no concrete version — surface the
      // overrides hint as the suggested fix.
      conflict.suggestedResolution = dedupe.reason;
    }
  }

  return { merged, conflicts, warnings };
}

// ---------------------------------------------------------------------------
// python
// ---------------------------------------------------------------------------

/** Merge same-ecosystem python manifests. */
export function mergePython(manifests: readonly { manifest: PythonManifest; path: string }[]): {
  merged: PythonManifest;
  conflicts: Conflict[];
  warnings: string[];
} {
  const labeled: Labeled<PythonManifest>[] = manifests.map((m, i) => ({
    manifest: m.manifest,
    label: sourceLabel(i),
  }));
  const conflicts: Conflict[] = [];
  const warnings: string[] = [];

  const deps = foldStringMaps(
    labeled.map(({ manifest, label }) => ({ map: manifest.dependencies, label }))
  );
  const dev = foldStringMaps(
    labeled.map(({ manifest, label }) => ({ map: manifest.devDependencies, label }))
  );
  const urls = foldStringMaps(
    labeled.map(({ manifest, label }) => ({ map: manifest.urls, label }))
  );
  conflicts.push(...deps.conflicts, ...dev.conflicts, ...urls.conflicts);

  const extras = unionListMaps(
    labeled.map(({ manifest, label }) => ({ map: manifest.extras, label }))
  );

  let pythonVersion: string | undefined;
  for (const { manifest } of labeled) {
    if (manifest.pythonVersion === undefined) continue;
    if (pythonVersion === undefined) {
      pythonVersion = manifest.pythonVersion;
      continue;
    }
    if (pythonVersion === manifest.pythonVersion) continue;
    const higher = higherVersion(pythonVersion, manifest.pythonVersion);
    if (higher === 'b') {
      pythonVersion = manifest.pythonVersion;
    } else if (higher === undefined) {
      warnings.push(
        `pythonVersion '${pythonVersion}' vs '${manifest.pythonVersion}' not comparable, keeping '${pythonVersion}'`
      );
    }
  }

  const sources = new Set(labeled.map(l => l.manifest.source));
  const first = labeled[0];
  if (first === undefined) {
    return {
      merged: { dependencies: {}, source: 'pyproject.toml' },
      conflicts,
      warnings,
    };
  }
  if (sources.size > 1) {
    warnings.push(
      `mixed python sources (${[...sources].sort(compareCodeUnit).join(' + ')}); merged source recorded as '${first.manifest.source}'`
    );
  }

  const merged: PythonManifest = { dependencies: deps.merged, source: first.manifest.source };
  if (
    Object.keys(dev.merged).length > 0 ||
    labeled.some(l => l.manifest.devDependencies !== undefined)
  ) {
    merged.devDependencies = dev.merged;
  }
  if (Object.keys(extras).length > 0) merged.extras = extras;
  if (pythonVersion !== undefined) merged.pythonVersion = pythonVersion;
  if (Object.keys(urls.merged).length > 0 || labeled.some(l => l.manifest.urls !== undefined)) {
    merged.urls = urls.merged;
  }
  return { merged, conflicts, warnings };
}

// ---------------------------------------------------------------------------
// cargo
// ---------------------------------------------------------------------------

/** Canonical comparison form for a cargo dep value. */
interface CargoDepCanonical {
  version: string;
  features: string[];
  optional: boolean;
}

type CargoDepValue = string | { version: string; features?: string[]; optional?: boolean };

/** Normalize any cargo dep form to its canonical comparison shape. */
function canonicalCargoDep(value: CargoDepValue): CargoDepCanonical {
  if (typeof value === 'string') return { version: value, features: [], optional: false };
  return {
    version: value.version,
    features: value.features === undefined ? [] : [...value.features].sort(compareCodeUnit),
    optional: value.optional === true,
  };
}

/** Deterministic display of a cargo dep value for `Conflict.values`. */
function displayCargoDep(value: CargoDepValue): string {
  if (typeof value === 'string') return value;
  const parts = [value.version];
  if (value.features !== undefined && value.features.length > 0) {
    parts.push(`[${[...value.features].sort(compareCodeUnit).join(',')}]`);
  }
  if (value.optional === true) parts.push('(optional)');
  return parts.join(' ');
}

/** True when two cargo dep values name the same version (features and
 * `optional` union without conflict — see `combineCargoDep`). */
function sameCargoDep(a: CargoDepValue, b: CargoDepValue): boolean {
  return canonicalCargoDep(a).version === canonicalCargoDep(b).version;
}

/**
 * Combine two same-version cargo dep values: features union (sorted),
 * `optional` OR. `narrow` drops features/optional for `[dev-dependencies]`
 * entries, whose spec type is `string | { version }`.
 */
function combineCargoDep(
  a: CargoDepValue,
  b: CargoDepValue,
  narrow: boolean
): string | { version: string; features?: string[]; optional?: boolean } {
  const ca = canonicalCargoDep(a);
  const cb = canonicalCargoDep(b);
  if (narrow) {
    if (ca.features.length === 0 && cb.features.length === 0 && !ca.optional && !cb.optional) {
      return typeof a === 'string' && typeof b === 'string' ? a : { version: ca.version };
    }
    return { version: ca.version };
  }
  const features = unionStrArrays(ca.features, cb.features);
  // Required wins: the merged entry stays optional only when BOTH sides
  // say so (otherwise A's hard requirement would silently demote).
  const optional = ca.optional && cb.optional;
  if (typeof a === 'string' && typeof b === 'string') return a;
  const out: { version: string; features?: string[]; optional?: boolean } = { version: ca.version };
  if (features.length > 0) out.features = features;
  if (optional) out.optional = true;
  return out;
}

/** Copy a cargo dep value so merged output never aliases parser output. */
function copyCargoDep(
  value: CargoDepValue,
  narrow: boolean
): string | { version: string; features?: string[]; optional?: boolean } {
  if (typeof value === 'string') return value;
  if (narrow) return { version: value.version };
  const out: { version: string; features?: string[]; optional?: boolean } = {
    version: value.version,
  };
  if (value.features !== undefined) out.features = [...value.features];
  if (value.optional !== undefined) out.optional = value.optional;
  return out;
}

/** Fold cargo `[dependencies]`-shaped maps (string-or-table values). */
function foldCargoDeps(
  inputs: readonly { map: Record<string, CargoDepValue> | undefined; label: string }[],
  narrow: boolean
): {
  merged: Record<string, string | { version: string; features?: string[]; optional?: boolean }>;
  conflicts: Conflict[];
} {
  const merged: Record<
    string,
    string | { version: string; features?: string[]; optional?: boolean }
  > = {};
  const origin: Record<string, string> = {};
  const conflicts: Conflict[] = [];
  for (const { map, label } of inputs) {
    if (map === undefined) continue;
    for (const [name, value] of Object.entries(map)) {
      const existing = merged[name];
      if (existing === undefined) {
        merged[name] = copyCargoDep(value, narrow);
        origin[name] = label;
        continue;
      }
      if (sameCargoDep(existing, value)) {
        merged[name] = combineCargoDep(existing, value, narrow);
        continue;
      }
      const firstLabel = origin[name] ?? label;
      conflicts.push({
        type: 'version',
        package: name,
        values: { [firstLabel]: displayCargoDep(existing), [label]: displayCargoDep(value) },
        severity: 'error',
      });
    }
  }
  return { merged, conflicts };
}

/** Merge same-ecosystem cargo manifests. */
export function mergeCargo(manifests: readonly { manifest: CargoManifest; path: string }[]): {
  merged: CargoManifest;
  conflicts: Conflict[];
  warnings: string[];
} {
  const labeled: Labeled<CargoManifest>[] = manifests.map((m, i) => ({
    manifest: m.manifest,
    label: sourceLabel(i),
  }));
  const conflicts: Conflict[] = [];
  const warnings: string[] = [];

  const deps = foldCargoDeps(
    labeled.map(({ manifest, label }) => ({ map: manifest.dependencies, label })),
    false
  );
  const dev = foldCargoDeps(
    labeled.map(({ manifest, label }) => ({
      map: manifest.devDependencies as Record<string, CargoDepValue> | undefined,
      label,
    })),
    true
  );
  const build = foldStringMaps(
    labeled.map(({ manifest, label }) => ({ map: manifest.buildDependencies, label }))
  );
  conflicts.push(...deps.conflicts, ...dev.conflicts, ...build.conflicts);

  const features = unionListMaps(
    labeled.map(({ manifest, label }) => ({ map: manifest.features, label }))
  );

  let members: string[] | undefined;
  {
    let defined = false;
    const seen = new Set<string>();
    const list: string[] = [];
    for (const { manifest } of labeled) {
      if (manifest.workspace === undefined) continue;
      defined = true;
      for (const entry of manifest.workspace.members) {
        if (!seen.has(entry)) {
          seen.add(entry);
          list.push(entry);
        }
      }
    }
    if (defined) members = list;
  }

  const first = labeled[0];
  if (first === undefined) {
    return {
      merged: { package: { name: '', version: '0.0.0' }, dependencies: {} },
      conflicts,
      warnings,
    };
  }
  for (const { manifest, label } of labeled.slice(1)) {
    const a = first.manifest.package;
    const b = manifest.package;
    if (a.name !== b.name || a.version !== b.version || (a.edition ?? '') !== (b.edition ?? '')) {
      warnings.push(
        `cargo package identity differs (${label}: ${b.name} ${b.version}); keeping ${a.name} ${a.version}`
      );
    }
  }

  const merged: CargoManifest = {
    package:
      first.manifest.package.edition === undefined
        ? { name: first.manifest.package.name, version: first.manifest.package.version }
        : {
            name: first.manifest.package.name,
            version: first.manifest.package.version,
            edition: first.manifest.package.edition,
          },
    dependencies: deps.merged,
  };
  const devMerged = dev.merged;
  if (
    Object.keys(devMerged).length > 0 ||
    labeled.some(l => l.manifest.devDependencies !== undefined)
  ) {
    const narrow: Record<string, string | { version: string }> = {};
    for (const [name, value] of Object.entries(devMerged)) {
      narrow[name] = typeof value === 'string' ? value : { version: value.version };
    }
    merged.devDependencies = narrow;
  }
  if (
    Object.keys(build.merged).length > 0 ||
    labeled.some(l => l.manifest.buildDependencies !== undefined)
  ) {
    merged.buildDependencies = build.merged;
  }
  if (Object.keys(features).length > 0) merged.features = features;
  if (members !== undefined) merged.workspace = { members };
  return { merged, conflicts, warnings };
}

// ---------------------------------------------------------------------------
// go
// ---------------------------------------------------------------------------

/** Merge same-ecosystem go manifests. */
export function mergeGo(manifests: readonly { manifest: GoManifest; path: string }[]): {
  merged: GoManifest;
  conflicts: Conflict[];
  warnings: string[];
} {
  const labeled: Labeled<GoManifest>[] = manifests.map((m, i) => ({
    manifest: m.manifest,
    label: sourceLabel(i),
  }));
  const conflicts: Conflict[] = [];
  const warnings: string[] = [];

  const require = foldStringMaps(
    labeled.map(({ manifest, label }) => ({ map: manifest.require, label }))
  );
  const exclude = foldStringMaps(
    labeled.map(({ manifest, label }) => ({ map: manifest.exclude, label }))
  );
  const replace = foldStringMaps(
    labeled.map(({ manifest, label }) => ({ map: manifest.replace, label }))
  );
  conflicts.push(...require.conflicts, ...exclude.conflicts, ...replace.conflicts);

  const indirect = new Set<string>();
  for (const { manifest } of labeled) {
    if (manifest.indirect === undefined) continue;
    for (const mod of manifest.indirect) indirect.add(mod);
  }

  let goVersion: string | undefined;
  for (const { manifest } of labeled) {
    if (manifest.goVersion === undefined) continue;
    if (goVersion === undefined) {
      goVersion = manifest.goVersion;
      continue;
    }
    if (goVersion === manifest.goVersion) continue;
    const higher = higherVersion(goVersion, manifest.goVersion);
    if (higher === 'b') {
      goVersion = manifest.goVersion;
    } else if (higher === undefined) {
      warnings.push(
        `goVersion '${goVersion}' vs '${manifest.goVersion}' not comparable, keeping '${goVersion}'`
      );
    }
  }

  const first = labeled[0];
  if (first === undefined) {
    return { merged: { module: '', require: {} }, conflicts, warnings };
  }
  for (const { manifest, label } of labeled.slice(1)) {
    if (manifest.module !== first.manifest.module) {
      warnings.push(
        `go module differs (${label}: ${manifest.module}); keeping ${first.manifest.module}`
      );
    }
  }

  const merged: GoManifest = { module: first.manifest.module, require: require.merged };
  if (goVersion !== undefined) merged.goVersion = goVersion;
  if (
    Object.keys(replace.merged).length > 0 ||
    labeled.some(l => l.manifest.replace !== undefined)
  ) {
    merged.replace = replace.merged;
  }
  if (
    Object.keys(exclude.merged).length > 0 ||
    labeled.some(l => l.manifest.exclude !== undefined)
  ) {
    merged.exclude = exclude.merged;
  }
  if (indirect.size > 0) merged.indirect = indirect;
  return { merged, conflicts, warnings };
}

// ---------------------------------------------------------------------------
