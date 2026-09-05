// Circular-dependency detection wrapper around `madge` (P-022).
//
// `findCycles(root)` walks the dependency graph starting at `root` and
// returns a `Result<string[][]>` (per the P-011 contract):
//   - ok(cycles) where cycles is an array of cycle lists
//     (each cycle is the ordered list of file paths that form a loop)
//   - err on madge load/init failure
//
// Used by:
//   - CI `--no-circles` gate (this file's `findCycles` is the canonical
//     surface; a CI script calls it via `bun run validate`)
//   - P-149 module-graph analysis
//   - P-238 orchestration (to surface cycles before the merge step)
//
// `madge` is a devDep: this module is itself in `src/analysis/` but is
// only loaded by tooling (CI, scripts), not at runtime by core features.

import madge, { type MadgeConfig } from 'madge';
import { ok, err, type Result } from 'neverthrow';
import { fromInternalPromise, type StitchError } from '../result/index.js';

export interface FindCyclesOptions {
  /** File extensions to consider when walking the graph. Default: ['ts','tsx','js','jsx']. */
  fileExtensions?: string[];
  /** Treat paths outside `root` as in-scope (default: false, like madge). */
  includeNpm?: boolean;
  /** A `tsconfig.json` path used for path-alias resolution. */
  tsConfig?: string;
  /** Skip files whose absolute path matches this regex. */
  excludeRegExp?: string;
}

/**
 * Walk the dependency graph rooted at `root` and return every circular
 * dependency as an array of cycles. Each cycle is a list of file paths
 * (relative to `root`) that form a loop.
 *
 *   - Empty array `[]` = no cycles (clean tree).
 *   - Non-empty array = cycles; each entry is a list of N paths
 *     `[a, b, c, a]` such that a→b, b→c, c→a (closing the loop).
 */
export async function findCycles(
  root: string,
  options: FindCyclesOptions = {}
): Promise<Result<string[][], StitchError>> {
  const madgeResult = await fromInternalPromise(
    Promise.resolve(
      madge(root, {
        fileExtensions: options.fileExtensions ?? ['ts', 'tsx', 'js', 'jsx'],
        includeNpm: options.includeNpm ?? false,
        ...(options.tsConfig !== undefined ? { tsConfig: options.tsConfig } : {}),
        ...(options.excludeRegExp !== undefined ? { excludeRegExp: options.excludeRegExp } : {}),
      } satisfies MadgeConfig)
    ),
    'madge init'
  );
  if (madgeResult.isErr()) {
    const detail =
      madgeResult.error.code === 'INTERNAL' ? madgeResult.error.message : madgeResult.error.code;
    return err<string[][], StitchError>({
      code: 'INTERNAL',
      message: `madge init failed for ${root}: ${detail}`,
    });
  }
  const cycles: string[][] = madgeResult.value.circular();
  return ok(cycles);
}

/** True iff the cycles list is non-empty. */
export function hasCycles(cycles: readonly string[][]): boolean {
  return cycles.length > 0;
}

/** Flatten a cycles list to a set of every file path that participates in a cycle. */
export function filesInCycles(cycles: readonly string[][]): Set<string> {
  const out = new Set<string>();
  for (const cycle of cycles) {
    for (const file of cycle) out.add(file);
  }
  return out;
}
