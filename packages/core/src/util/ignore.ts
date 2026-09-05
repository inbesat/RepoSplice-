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
 * and adds our own .gitignore semantics (negation + dir-scoping).
 *
 * Pattern syntax matches .gitignore:
 *   node_modules    - matches any path with that segment (auto-prefixed "**"+"/")
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

  // Split patterns into include (no leading !) and exclude (leading !).
  const exclude: string[] = [];
  const include: string[] = [];
  for (const raw of patterns) {
    const p = raw.trim();
    if (p.length === 0) continue;
    if (p.startsWith('!')) {
      include.push(p.slice(1).trim());
    } else {
      exclude.push(p);
    }
  }

  // In .gitignore mode, basename-only patterns (no /) only match at the
  // root by default. We auto-prefix `**/` and append `/**` so bare names
  // (e.g. `node_modules`, `dist`) match anything under any matching
  // directory at any depth. For file-extension patterns (e.g. `*.log`,
  // `.*`) we only add the `**/` prefix so they match the file anywhere.
  // Patterns that already contain a `/` or start with `**/` are passed
  // through verbatim.
  const expandPattern = (p: string): string => {
    if (!gitignore) return p;
    if (p.includes('/')) return p;
    if (p.startsWith('**/')) return p;
    const looksLikeFileExt = p.includes('.');
    return looksLikeFileExt ? `**/${p}` : `**/${p}/**`;
  };

  const excludeMatchers = exclude.map(p => picomatch(expandPattern(p), { dot: true, gitignore }));
  const includeMatchers = include.map(p => picomatch(expandPattern(p), { dot: true, gitignore }));

  return (relPath: string): boolean => {
    const posix = toPosix(relPath);

    // Dir-scope: paths outside baseDir are reported as in-scope-but-not-matched
    // (i.e. the pattern simply doesn't apply). This lets a caller compose
    // multiple scoped matchers without one blanket-ignoring everything.
    if (baseDir !== undefined && !posix.startsWith(baseDir + '/') && posix !== baseDir) {
      return false;
    }

    const excluded = excludeMatchers.some(m => m(posix));
    const reIncluded = includeMatchers.some(m => m(posix));
    const isIgnored = excluded && !reIncluded;

    // `negated: true` flips the result so the matcher returns true for
    // paths that DO match the patterns (i.e. "include these"). Default
    // returns true for paths to skip.
    if (negated) return excluded || reIncluded;
    return isIgnored;
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
