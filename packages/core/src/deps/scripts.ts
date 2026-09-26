// Scripts merge for npm package.json (P-112).
//
// `package.json` `scripts` often collide (`build`, `test`). Blindly
// overwriting loses one side's build pipeline. This module merges
// scripts safely by prefixing collisions with `<label>:<name>` and
// preserving unique scripts, ensuring both repos' workflows remain
// runnable in the merged child repo C.
//
// Safety contract (P-011):
// - No throws: inputs are validated as records of strings; undefined
//   is treated as empty; non-string values are ignored (defensive).
//   Every path returns a freshly constructed object, never throws.
// - Pure: inputs are never mutated; every result is freshly constructed.
// - Only script names and bodies reach the result — never file contents.

import type { Conflict } from './types.js';

export interface MergeScriptsOptions {
  prefixA: string;
  prefixB: string;
}

/**
 * Merge two `scripts` maps.
 *
 * - `a`/`b` — the two `scripts` maps (or undefined when the manifest
 *   had no `scripts` section). `undefined` is treated as empty.
 * - `opts.prefixA`/`prefixB` — the positional source labels
 *   (`repo-a`, `repo-b`, ... via `sourceLabel` in P-108) used to prefix
 *   collisions. In the P-112 Handoff Note these are derived from actual
 *   repo names slugified, but the deterministic `repo-*` labels are the
 *   contract used here and in `merge.ts`.
 *
 * Returns `{ merged, conflicts }` where `merged` preserves unique
 * scripts without prefix and moves colliding scripts to
 * `<prefix>:<name>` keys, and `conflicts` contains one `script` warning
 * per colliding name.
 *
 * Pre/post hooks (`prebuild`/`postbuild`) are handled identically to
 * `build` — they are separate keys and follow the same prefix logic
 * when they collide. The spec's note "if `build` collides, also check
 * `prebuild`/`postbuild` similarly" is satisfied because the loop
 * iterates all keys, including hook variants.
 *
 * Never throws; pure string compare.
 */
export function mergeScripts(
  a: Record<string, string> | undefined,
  b: Record<string, string> | undefined,
  opts: MergeScriptsOptions
): { merged: Record<string, string>; conflicts: Conflict[] } {
  const prefixA = opts.prefixA;
  const prefixB = opts.prefixB;

  const merged: Record<string, string> = { ...(a ?? {}) };
  const conflicts: Conflict[] = [];

  if (b === undefined) return { merged, conflicts };

  for (const [key, valueB] of Object.entries(b)) {
    // Defensive: non-string values should not happen (parser guarantees
    // strings), but we ignore them rather than throwing.
    if (typeof valueB !== 'string') continue;

    if (!Object.hasOwn(merged, key)) {
      merged[key] = valueB;
      continue;
    }

    const valueA = merged[key];
    if (valueA === valueB) continue;

    // Collision with differing bodies: prefix both sides, delete the
    // un-prefixed key. `valueA` is guaranteed defined because the key
    // exists in `merged`.
    const existing = valueA ?? '';
    const keyA = `${prefixA}:${key}`;
    const keyB = `${prefixB}:${key}`;

    // Delete the original key first to preserve insertion order:
    // unique scripts stay first, prefixed collisions are appended.
    delete merged[key];
    merged[keyA] = existing;
    merged[keyB] = valueB;

    conflicts.push({
      type: 'script',
      package: key,
      values: { [prefixA]: existing, [prefixB]: valueB },
      severity: 'warning',
    });
  }

  return { merged, conflicts };
}
