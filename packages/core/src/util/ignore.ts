import picomatch from 'picomatch';
import { toPosix } from './paths.js';

export type IgnoreMatcher = (relPath: string) => boolean;

export interface BuildIgnoreMatcherOptions {
  /**
   * Directory scope. When set, only paths under `baseDir` are evaluated;
   * paths outside `baseDir` are reported as ignored (treated as out of
   * scope). Default: no scope (all paths considered).
   */
  baseDir?: string;
  /**
   * If true, patterns are treated as .gitignore-style (negate with `!`,
   * `*` does not match `/`). Default: true.
   */
  gitignore?: boolean;
  /**
   * If true, the returned matcher returns `true` only for paths that
   * should be EXCLUDED. If false, returns `true` for paths that should
   * be INCLUDED. Default: true (return true to skip).
   */
  negated?: boolean;
}

/**
 * Build a `.gitignore`-style matcher from a list of patterns. Wraps
 * `picomatch` (the same engine npm/yarn use for their ignore logic)
 * and adds true .gitignore semantics on top:
 *
 * - Last match wins (a later `!negation` re-includes; a later positive
 *   pattern re-excludes). Raw picomatch arrays are union-only, so the
 *   ordering is evaluated here, per pattern, in list order.
 * - Trailing-slash dir patterns (`dist/`) expand to match contents.
 * - Bare names (`node_modules`) match the entry itself at any depth
 *   plus everything under it.
 * - File-extension patterns (`*.log`) match at any depth.
 * - Patterns already containing a `/` pass through verbatim.
 *
 * Pattern syntax matches .gitignore:
 *   node_modules    - matches that entry + subtree at any depth
 *   star.log         - matches any file ending in .log at any depth
 *   dist/double-star - matches anything under dist/
 *   bang.keep.log    - negation: re-include a previously-excluded path
 *
 * The returned function takes a relative (POSIX) path and returns
 * `true` if the path should be skipped.
 */
export function buildIgnoreMatcher(
  patterns: readonly string[],
  options: BuildIgnoreMatcherOptions = {}
): IgnoreMatcher {
  const { gitignore = true, negated = false } = options;
  const baseDir = options.baseDir !== undefined ? toPosix(options.baseDir) : undefined;

  // Split patterns into ordered entries preserving list order, so
  // evaluation below implements gitignore last-match-wins.
  const entries: { negated: boolean; pattern: string }[] = [];
  for (const raw of patterns) {
    const p = raw.trim();
    if (p.length === 0) continue;
    if (p.startsWith('!')) {
      const rest = p.slice(1).trim();
      if (rest.length === 0) continue;
      entries.push({ negated: true, pattern: rest });
    } else {
      entries.push({ negated: false, pattern: p });
    }
  }

  // In .gitignore mode, expand bare patterns (verified against
  // picomatch v4 behavior in P-036). A trailing slash is stripped
  // first, so `dist/` behaves like bare `dist` (dir at any depth):
  // - bare `node_modules` (no slash) -> both the entry itself at any
  //   depth and its contents.
  // - file-extension `*.log` -> match at any depth (raw lib is
  //   root-scoped).
  // Patterns that already contain a `/` or start with `**/` pass
  // through verbatim.
  const expandPattern = (p: string): string[] => {
    if (!gitignore) return [p];
    // Strip one trailing slash first: `dist/` behaves like bare `dist`
    // (dir at any depth + contents), not root-anchored `dist/**`.
    const base = p.endsWith('/') ? p.slice(0, -1) : p;
    if (base.includes('/')) return [p];
    if (base.startsWith('**/')) return [p];
    const looksLikeFileExt = base.includes('.');
    return looksLikeFileExt ? [`**/${base}`] : [`**/${base}`, `**/${base}/**`];
  };

  const matchers = entries.map(e => {
    const expanded = expandPattern(e.pattern);
    const shape: string | string[] = expanded.length === 1 ? (expanded[0] as string) : expanded;
    return { negated: e.negated, match: picomatch(shape, { dot: true, gitignore }) };
  });

  return (relPath: string): boolean => {
    const posix = toPosix(relPath);

    // Dir-scope: paths outside baseDir are reported as in-scope-but-not-matched
    // (i.e. the pattern simply doesn't apply). This lets a caller compose
    // multiple scoped matchers without one blanket-ignoring everything.
    if (baseDir !== undefined && !posix.startsWith(baseDir + '/') && posix !== baseDir) {
      return false;
    }

    // gitignore last-match-wins: walk the entries in list order; the
    // final matching entry decides. A matching negation re-includes;
    // a later positive pattern re-excludes.
    let matched = false;
    let ignored = false;
    for (const m of matchers) {
      if (m.match(posix)) {
        matched = true;
        ignored = !m.negated;
      }
    }

    // `negated: true` flips the result so the matcher returns true for
    // paths that match ANY pattern (i.e. "include these"). Default
    // returns true for paths to skip.
    if (negated) return matched;
    return ignored;
  };
}

/** Convenience: should this path be skipped? Equivalent to the matcher result. */
export function shouldIgnore(
  patterns: readonly string[],
  relPath: string,
  options: BuildIgnoreMatcherOptions = {}
): boolean {
  return buildIgnoreMatcher(patterns, options)(relPath);
}
