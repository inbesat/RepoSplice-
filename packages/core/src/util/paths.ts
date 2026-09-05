import { sep, normalize, isAbsolute, relative } from 'node:path';
import { ok, err, type Result } from 'neverthrow';
import type { StitchError } from '../result/index.js';

/**
 * Normalize a path to POSIX separators (`/`). Idempotent: `toPosix(toPosix(x)) === toPosix(x)`.
 * Used for cross-platform path comparisons (git filters, ignore patterns,
 * gitignore-style matchers always use `/`).
 */
export function toPosix(p: string): string {
  if (sep === '/') return p;
  return p.split(sep).join('/');
}

/**
 * Normalize a path to a canonical form, handling Windows backslashes.
 * Collapses `.` and `..` segments and resolves redundancies.
 *
 * The output uses POSIX separators (`/`) when the input has any forward
 * slashes; otherwise it uses the platform separator. This lets a mixed
 * path like `a/b/../c` collapse to `a/c` on Windows even though
 * `path.normalize` would otherwise emit `a\c`.
 */
export function normalizePath(p: string): string {
  const hadForwardSlash = p.includes('/');
  const platform = normalize(p);
  if (hadForwardSlash) {
    // Normalize may emit backslashes on Windows; convert to forward slashes
    // because the caller mixed separators (likely an intent to use POSIX).
    return platform.split(sep).join('/');
  }
  return platform;
}

/**
 * Strip a trailing `/` (or `\` on Windows). Idempotent.
 */
export function trimTrailingSep(p: string): string {
  if (p.length === 0) return p;
  if (p.endsWith('/') || (sep === '\\' && p.endsWith('\\'))) {
    return p.slice(0, -1);
  }
  return p;
}

/**
 * Resolve a relative path `p` against `root`, rejecting any attempt to
 * escape `root` via `..` segments or absolute path injection. Returns a
 * `Result` so callers can compose with other Result-returning functions
 * (per the no-throw rule from AGENTS / P-011).
 *
 * Behavior:
 * - If `p` is absolute, only the final segment chain is examined; if it
 *   still escapes `root`, returns an err.
 * - If `p` contains `..` that, after normalization, would land outside
 *   `root`, returns an err.
 * - The returned value is the normalized, absolute-or-rooted path with
 *   POSIX separators.
 */
export function resolveWithin(root: string, p: string): Result<string, StitchError> {
  if (p.length === 0) {
    return err({ code: 'CONFIG_ERROR', field: 'path', message: 'empty path' });
  }

  const normalizedRoot = trimTrailingSep(toPosix(normalizePath(root)));
  const candidate = isAbsolute(p) ? p : `${normalizedRoot}/${p}`;
  const normalizedCandidate = toPosix(normalizePath(candidate));

  // Reject Windows drive-letter escape (e.g. C:\evil on a unix root)
  if (normalizedCandidate.match(/^[A-Z]:/i)) {
    if (!normalizedRoot.match(/^[A-Z]:/i)) {
      return err({
        code: 'CONFIG_ERROR',
        field: 'path',
        message: `path "${p}" has a drive letter but root "${root}" does not`,
      });
    }
  }

  const rel = relative(normalizedRoot, normalizedCandidate);
  if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) {
    return ok(normalizedCandidate);
  }

  return err({
    code: 'CONFIG_ERROR',
    field: 'path',
    message: `path "${p}" escapes root "${root}" (resolved to "${normalizedCandidate}")`,
  });
}

/**
 * Strict version of `resolveWithin` that throws on escape. Provided as a
 * convenience for callers that genuinely cannot recover from a path
 * escape; prefer `resolveWithin` to satisfy the no-throw rule.
 */
export function safeJoin(root: string, ...parts: string[]): string {
  const joined = parts.length === 0 ? root : [root, ...parts].join('/');
  const result = resolveWithin(root, joined);
  if (result.isErr()) {
    const e = result.error;
    const detail = 'message' in e ? e.message : `${e.code}`;
    throw new Error(detail);
  }
  return result.value;
}
