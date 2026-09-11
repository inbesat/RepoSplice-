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

  // In .gitignore mode, expand patterns to match git's own semantics
  // (verified against picomatch v4 behavior in P-036, extended with
  // anchored forms in P-083 — probed: a leading `/` matched NOTHING, and
  // `a/b` missed `a/b/c`, while git ignores anchored dir trees):
  // - leading `/` anchors to the repo root; matcher inputs are already
  //   root-relative, so strip it.
  // - leading `**/` means "at any depth": reduce to the bare remainder.
  // - a remaining `/` means anchored: match the entry itself PLUS the
  //   tree under it (`[base, base/**]`) — exactly git's dir exclusion
  //   (a `/**` arm only fires when the entry IS a dir, in which case git
  //   ignores its contents too).
  // - otherwise the P-036 bare rules: trailing slash stripped first, so
  //   `dist/` behaves like bare `dist` (dir at any depth + contents);
  //   file-extension `*.log` matches at any depth.
  const expandPattern = (p: string): string[] => {
    if (!gitignore) return [p];
    // A leading `/` anchors to the repo root (it does NOT mean
    // match-at-any-depth); matcher inputs are already root-relative.
    const explicitAnchor = p.startsWith('/');
    const noLead = explicitAnchor ? p.slice(1) : p;
    // A leading `**/` means "at any depth" and keeps that meaning even
    // when explicitly anchored (`/**/x` matches x anywhere below root).
    const starStripped = noLead.startsWith('**/');
    const core = starStripped ? noLead.slice(3) : noLead;
    const base = core.endsWith('/') && core.length > 1 ? core.slice(0, -1) : core;
    if (starStripped || (!explicitAnchor && !base.includes('/'))) {
      // Any-depth forms: bare names + ext globs (P-036, untouched).
      const looksLikeFileExt = base.includes('.');
      return looksLikeFileExt ? [`**/${base}`] : [`**/${base}`, `**/${base}/**`];
    }
    // Anchored path: the entry itself plus the tree under it — exactly
    // git's dir exclusion (a `/**` arm only fires when the entry IS a
    // dir, in which case git ignores its contents too).
    return [base, `${base}/**`];
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
