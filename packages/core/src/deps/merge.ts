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
// - Only package names, source labels, and version strings reach errors,
//   warnings, and logs — never file contents.
// - Inputs are never mutated: every map is shallow-copied, so callers can
//   reuse their manifests freely.
//
// Source labels: inputs have no repo names (only file paths), so conflicts
// are keyed by positional labels `repo-a`, `repo-b`, ... in input order
// (spreadsheet-style past `repo-z`: `repo-aa`, ...). Deterministic for any
// input order; P-116/P-219 render these labels directly.
// On any version conflict the merged map keeps the first-seen value —
// P-109 resolves it later; the conflict carries both sides.

// P-115: ensure parsers are registered before unionManifests is called.
// Side-effect import populates the plugin registry.
import './parsers/index.js';
import { err, ok, type Result } from 'neverthrow';
import { logger } from '../logger/index.js';
import type { StitchError } from '../result/index.js';
import { sourceLabel } from './labels.js';
import { getParser } from './plugin.js';

// Re-export for barrel consistency and to satisfy P-112/P-113 integration
// (mergeScripts is the 2-way primitive; foldScripts below is its N-way
// extension preserving per-key origin tracking. Config helpers are the
// P-113 JSON merge primitives for tsconfig/vite/eslint.)
export { mergeScripts } from './scripts.js';
export { mergeTsConfig, mergeViteConfig, mergeEslintConfig, mergeGenericJson } from './config.js';
export type { ConfigMergeResult } from './config.js';
import type { Conflict, MergeResult, ParsedManifest } from './types.js';

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
function compareConflicts(a: Conflict, b: Conflict): number {
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

// Per-ecosystem merge logic moved to merge-impl.ts and parsers/ (P-115).
// This file now delegates to the plugin registry; see plugin.ts and parsers/.

// ---------------------------------------------------------------------------
// top-level
// ---------------------------------------------------------------------------

/**
 * Union same-ecosystem manifests into one `UnifiedManifest` plus conflicts
 * and warnings. Inputs are positional (`repo-a`, `repo-b`, ...); on any
 * version collision the merged map keeps the first-seen value and the
 * conflict carries both sides for P-109 to resolve.
 *
 * - Empty input (caller bug) -> `err(CONFIG_ERROR)`.
 * - Mixed ecosystems (caller bug) -> `err(ECOSYSTEM_MISMATCH)` with the
 *   sorted ecosystem list.
 */
export function unionManifests(manifests: ParsedManifest[]): Result<MergeResult, StitchError> {
  if (manifests.length === 0) {
    return err({
      code: 'CONFIG_ERROR',
      field: 'manifests',
      message: 'unionManifests requires at least one manifest',
    });
  }
  const first = manifests[0];
  if (first === undefined) {
    return err({
      code: 'CONFIG_ERROR',
      field: 'manifests',
      message: 'unionManifests requires at least one manifest',
    });
  }
  const ecosystems = [...new Set(manifests.map(m => m.ecosystem))].sort(compareCodeUnit);
  if (ecosystems.length > 1) {
    logger.warn(
      { ecosystems: ecosystems.join(',') },
      'unionManifests refused mixed-ecosystem input'
    );
    return err({
      code: 'ECOSYSTEM_MISMATCH',
      message: `cannot union manifests across ecosystems: ${ecosystems.join(', ')}`,
      ecosystems,
    });
  }

  // P-115: delegate to the registered parser for the ecosystem.
  // The per-ecosystem switch has been removed — new ecosystems are
  // handled by registering a parser, without editing this file.
  let parser: import('./plugin.js').ManifestParser;
  try {
    parser = getParser(first.ecosystem);
  } catch (e) {
    return err({
      code: 'UNSUPPORTED_ECOSYSTEM',
      ecosystem: first.ecosystem,
      message: e instanceof Error ? e.message : String(e),
    });
  }
  const mergedResult = parser.merge(manifests);
  if (mergedResult.isErr()) return err(mergedResult.error);
  const result = mergedResult.value;
  result.conflicts.sort(compareConflicts);
  return ok({ merged: result.merged, conflicts: result.conflicts, warnings: result.warnings });
}
