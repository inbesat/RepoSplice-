// Recursive file discovery over `glob` (P-034).
//
// `listFiles(root, patterns, opts)` walks `root` for `patterns` and
// returns absolute posix-normalized paths, sorted + deduped for
// determinism. Used by fixture generation (P-062), repo scanning
// (P-103), and the tree walker (P-104).
//
// CONTRACT NOTES (all verified empirically against `glob@13`):
// - No match (bad pattern, missing dir, empty patterns) resolves to
//   `ok([])` — never err. "Nothing found" is a valid answer.
// - `ignore` takes glob patterns (`**/node_modules/**` skips the whole
//   subtree, entry included).
// - Dotfiles are excluded by default; `dot: true` includes them.
// - `nodir` defaults to true (files only); absolute paths come back
//   with native separators, so the wrapper maps them through `toPosix`
//   (P-012) instead of the lib's `posix` flag (which emits UNC
//   `//?/C:/…` forms on Windows).
// - `signal` passthrough lets P-168 timeouts abort a walk; an aborted
//   walk rejects and maps to err(INTERNAL).

import { glob } from 'glob';
import { ok, err, type Result } from 'neverthrow';
import { type StitchError } from '../result/index.js';
import { toPosix } from './paths.js';

/** Options for `listFiles`. All fields optional. */
export interface ListFilesOptions {
  /** Glob patterns (or a single pattern) to exclude from matches. */
  ignore?: string | readonly string[];
  /** Include dotfiles/dotdirs. Default: false. */
  dot?: boolean;
  /** Match directories as well as files. Default: false (files only). */
  nodir?: boolean;
  /** AbortSignal to cancel the walk (P-168 timeouts). */
  signal?: AbortSignal;
}

/**
 * List files under `root` matching `patterns`.
 *
 * Returns ok(sorted absolute posix paths, deduped). Never errs for
 * "nothing found" (bad pattern / missing dir / empty patterns all
 * yield `ok([])`); err(INTERNAL) only for walk failures such as an
 * aborted `signal`.
 */
export async function listFiles(
  root: string,
  patterns: string | readonly string[],
  options: ListFilesOptions = {}
): Promise<Result<string[], StitchError>> {
  // NOTE: never spread `patterns` directly — spreading a string yields
  // its characters as single-char patterns (which match everything).
  const patternList = typeof patterns === 'string' ? [patterns] : [...patterns];
  try {
    const found = await glob(patternList, {
      cwd: root,
      absolute: true,
      nodir: !(options.nodir === true),
      dot: options.dot === true,
      ...(options.ignore !== undefined ? { ignore: [...options.ignore] } : {}),
      ...(options.signal !== undefined ? { signal: options.signal } : {}),
    });
    return ok([...new Set(found.map(p => toPosix(p)))].sort());
  } catch (cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    return err({ code: 'INTERNAL', message: `listFiles failed for ${root}: ${detail}` });
  }
}
