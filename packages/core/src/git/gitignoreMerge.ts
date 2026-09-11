// .gitignore merge (P-083): merge ignore files from all source roots
// into one canonical child `.gitignore`, so the child keeps build
// artifacts and environment cruft excluded without losing any source's
// intent. Feeds the ignore matcher (P-012/P-036) for scans (P-103) and
// merge filtering (P-192). Flow: validate sources -> read + normalize
// lines (BOM/CRLF stripped) -> rebase anchored patterns under merge
// prefixes -> dedupe exact lines (first wins) -> header + per-source
// section dividers -> validate via the real matcher (required files must
// survive).
//
// Semantics (git rules — the merge preserves them, never reinterprets):
// - Order is load-bearing: later patterns override earlier ones
//   (last-match-wins), so output order is source order, NEVER sorted.
//   A `!negation` stays exactly where its file put it, relative to the
//   patterns around it.
// - Only ANCHORED patterns rebase: a pattern containing `/` beyond one
//   trailing slash is anchored to its file's directory, so under a merge
//   prefix P it becomes `/P/...`. Bare names, `*.ext` globs, and
//   trailing-slash dirs match at any depth already and pass through
//   untouched — likewise `!` bodies, which rebase by the same anchored
//   rule on the text after `!`.
// - Blank/whitespace-only lines drop (cosmetic); everything else —
//   including comments and lone `!` lines — is kept verbatim (CRLF
//   normalized, BOM stripped) so no intent is lost.
// - Each source's `prefix` names the child-relative directory its FILE's
//   patterns anchor at ('' = child root). `collectGitignores` computes
//   this per file as root-prefix + ignore-file subdir — direct callers
//   pass it explicitly.
//
// Safety contract:
// - Validation (blank names/paths/roots, empty source lists) returns
//   CONFIG_ERROR before any I/O; missing files/dirs map ENOENT/ENOTDIR/
//   EISDIR to CONFIG (caller bug), other fs failures to INTERNAL.
// - Merged patterns are validated by CONSTRUCTING the real P-012/P-036
//   matcher (a defensive try/catch: probed picomatch accepts every
//   non-empty string, so the arm documents the no-throw rule rather than
//   a reachable case), and every `requiredFiles` entry is asserted
//   surviving (CONFIG naming the file otherwise).
// - Deterministic bytes given the same inputs + date: source order,
//   first-wins dedupe, LF endings, exactly one trailing newline. The
//   header date defaults to today (spec: dated) and is injectable for
//   reproducible exports (P-282).
// - Only paths + counts reach the logs, never file contents.
// - No new StitchError codes (P-203 owns future taxonomy).
//
// Seams and future phases:
// - No spawns at all (fs reads + pure merge + matcher), so no runner and
//   no timeout: file I/O stays async per codebase convention, fs stays
//   real (P-074 precedent).
// - P-103 discovers scan roots (collectGitignores covers the walk until
//   then); P-192 writes the merged content as the child `.gitignore`;
//   P-084's clean check is the acceptance probe (proven in-test via real
//   `git status`). P-075's two-blob union is the degenerate same-file
//   case of this canonical merge.

import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { ok, err, type Result } from 'neverthrow';
import type { StitchError } from '../result/index.js';
import { logger, createJobLogger } from '../logger/index.js';
import { buildIgnoreMatcher } from '../util/ignore.js';
import { toPosix } from '../util/paths.js';

/** Default header date (today UTC): inject `generatedAt` for reproducibility. */
export const DEFAULT_GITIGNORE_GENERATED_AT: string = new Date().toISOString().slice(0, 10);

/** One ignore file to merge. */
export interface GitignoreSource {
  /** Origin label for headers/dividers (e.g. `repo-a`). */
  name: string;
  /** Absolute path to the source `.gitignore` file. */
  path: string;
  /**
   * Child-relative directory the file's patterns anchor at ('' = child
   * root). `collectGitignores` computes this; direct callers pass it.
   */
  prefix?: string;
}

/** One root to discover ignore files under. */
export interface GitignoreRoot {
  /** Origin label shared by every file found under `dir`. */
  name: string;
  /** Absolute root directory to walk. */
  dir: string;
  /** Merge prefix applied to the whole root (plus each file's subdir). */
  prefix?: string;
}

export interface GitignoreMergeOpts {
  /** Header date (YYYY-MM-DD). Default: today (spec: dated). */
  generatedAt?: string;
  /** Repo-relative paths that must NOT be ignored by the merged set. */
  requiredFiles?: string[];
  /** Job id for structured logs. */
  jobId?: string;
}

/** Effective patterns in merged order (matcher input, no blanks). */
export interface MergedGitignore {
  /** File bytes: header + section dividers + patterns, LF, one trailing NL. */
  content: string;
  /** Effective patterns in merged order (comments/dividers excluded). */
  patterns: string[];
  /** Per-source audit: origin label, file, and contributed pattern count. */
  sources: Array<{ name: string; path: string; patterns: number }>;
}

function invalid(field: string, message: string): Result<never, StitchError> {
  return err({ code: 'CONFIG_ERROR', field, message });
}

function internalError(op: string, cause: unknown): StitchError {
  return {
    code: 'INTERNAL',
    message: `${op}: ${cause instanceof Error ? cause.message : String(cause)}`,
    ...(cause instanceof Error ? { cause } : {}),
  };
}

const GENERATED_BY = 'Generated by repo-stitcher gitignore merge';

/** Split raw text into lines: BOM stripped, CRLF normalized, no empty tail. */
function splitLines(text: string): string[] {
  const noBom = text.startsWith('\uFEFF') ? text.slice(1) : text;
  const normalized = noBom.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** A pattern is anchored when `/` appears beyond one trailing slash. */
function isAnchored(pattern: string): boolean {
  const body = pattern.endsWith('/') && pattern.length > 1 ? pattern.slice(0, -1) : pattern;
  return body.includes('/');
}

/**
 * Rebase one pattern line under `prefix` ('' = no-op). Negations rebase
 * their body; lone `!` and blanks pass through for the caller to filter.
 */
export function rebasePattern(line: string, prefix: string): string {
  if (prefix === '') return line;
  const negated = line.startsWith('!');
  const body = negated ? line.slice(1) : line;
  if (body === '' || !isAnchored(body)) return line;
  const trailing = body.endsWith('/') ? '/' : '';
  const core = trailing === '/' ? body.slice(0, -1) : body;
  const stripped = core.startsWith('/') ? core.slice(1) : core;
  return `${negated ? '!' : ''}/${prefix}/${stripped}${trailing}`;
}

export interface MergeEntry {
  name: string;
  lines: string[];
  prefix: string;
}

export interface MergedIgnoreTexts {
  content: string;
  patterns: string[];
  /** Pattern counts contributed per entry, parallel to the input. */
  counts: number[];
}

/**
 * Pure merge core: dedupe exact lines (first wins), keep order, emit the
 * canonical bytes. Blanks drop; everything else (comments included) is
 * content. Deterministic for the same inputs.
 */
export function mergeIgnoreTexts(
  entries: MergeEntry[],
  generatedAt: string
): Result<MergedIgnoreTexts, StitchError> {
  if (entries.length === 0) {
    return invalid('sources', 'mergeGitignores: at least one source is required');
  }
  const seen = new Set<string>();
  const patterns: string[] = [];
  const counts: number[] = [];
  const sections: Array<{ name: string; lines: string[] }> = [];
  for (const entry of entries) {
    const kept: string[] = [];
    let contributed = 0;
    for (const line of entry.lines) {
      if (line.trim() === '') continue;
      const rebased = rebasePattern(line, entry.prefix);
      if (seen.has(rebased)) continue;
      seen.add(rebased);
      kept.push(rebased);
      if (!rebased.startsWith('#')) {
        patterns.push(rebased);
        contributed += 1;
      }
    }
    counts.push(contributed);
    sections.push({ name: entry.name, lines: kept });
  }
  const parts: string[] = [
    `# ${GENERATED_BY} (${generatedAt})`,
    `# Sources: ${entries.map(entry => entry.name).join(', ')}`,
    '',
  ];
  for (const section of sections) {
    parts.push(`# Source: ${section.name}`, ...section.lines, '');
  }
  return ok({ content: `${parts.join('\n')}`, patterns, counts });
}

interface NormalizedSource {
  name: string;
  path: string;
  prefix: string;
}

function normalizeSource(source: GitignoreSource): Result<NormalizedSource, StitchError> {
  if (source.name.trim() === '') {
    return invalid('sources', 'mergeGitignores: source names must not be blank');
  }
  if (source.path.trim() === '') {
    return invalid('sources', 'mergeGitignores: source paths must not be blank');
  }
  return ok({
    name: source.name,
    path: source.path,
    prefix: (source.prefix ?? '').replace(/^\/+|\/+$/g, ''),
  });
}

/** Read one ignore file: missing/dir callers fail CONFIG, rest INTERNAL. */
async function readSourceFile(path: string): Promise<Result<string[], StitchError>> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (code === 'ENOENT' || code === 'ENOTDIR' || code === 'EISDIR') {
      return err({
        code: 'CONFIG_ERROR',
        field: 'sources',
        message: `mergeGitignores: no such ignore file ("${path}")`,
      });
    }
    return err(internalError('mergeGitignores read', error));
  }
  return ok(splitLines(text));
}

/**
 * Merge ignore files into the canonical child set. Validates the result
 * through the real P-012/P-036 matcher and asserts required files survive.
 */
export async function mergeGitignores(
  sources: GitignoreSource[],
  opts: GitignoreMergeOpts = {}
): Promise<Result<MergedGitignore, StitchError>> {
  if (sources.length === 0) {
    return invalid('sources', 'mergeGitignores: at least one source is required');
  }
  const normalized: NormalizedSource[] = [];
  for (const source of sources) {
    const valid = normalizeSource(source);
    if (valid.isErr()) return err(valid.error);
    normalized.push(valid.value);
  }
  const entries: MergeEntry[] = [];
  for (const source of normalized) {
    const lines = await readSourceFile(source.path);
    if (lines.isErr()) return err(lines.error);
    entries.push({ name: source.name, lines: lines.value, prefix: source.prefix });
  }
  const merged = mergeIgnoreTexts(entries, opts.generatedAt ?? DEFAULT_GITIGNORE_GENERATED_AT);
  if (merged.isErr()) return err(merged.error);
  let matcher: (relPath: string) => boolean;
  try {
    matcher = buildIgnoreMatcher(merged.value.patterns);
  } catch (error) {
    // Defensive only (probed: picomatch accepts every non-empty string);
    // the no-throw rule still requires the guard.
    return err(internalError('mergeGitignores matcher', error));
  }
  const required = opts.requiredFiles ?? [];
  for (const file of required) {
    let ignored: boolean;
    try {
      ignored = matcher(file);
    } catch (error) {
      return err(internalError('mergeGitignores matcher', error));
    }
    if (ignored) {
      return err({
        code: 'CONFIG_ERROR',
        field: 'requiredFiles',
        message: `mergeGitignores: merged set would ignore required file ("${file}")`,
      });
    }
  }
  const log = (opts.jobId === undefined ? logger : createJobLogger(opts.jobId)).child({
    op: 'gitignore-merge',
  });
  log.debug(
    { sources: normalized.length, patterns: merged.value.patterns.length },
    'gitignore merged'
  );
  return ok({
    content: merged.value.content,
    patterns: merged.value.patterns,
    sources: normalized.map((source, index) => ({
      name: source.name,
      path: source.path,
      patterns: merged.value.counts[index] ?? 0,
    })),
  });
}

/**
 * Discover `.gitignore` files under roots (P-103-style walk, skipping
 * `.git`): root ignores plus every nested one, each with its effective
 * merge prefix (root prefix + file subdir, posix).
 */
export async function collectGitignores(
  roots: GitignoreRoot[]
): Promise<Result<GitignoreSource[], StitchError>> {
  if (roots.length === 0) {
    return invalid('roots', 'collectGitignores: at least one root is required');
  }
  const collected: GitignoreSource[] = [];
  for (const root of roots) {
    if (root.name.trim() === '') {
      return invalid('roots', 'collectGitignores: root names must not be blank');
    }
    if (root.dir.trim() === '') {
      return invalid('roots', 'collectGitignores: root dirs must not be blank');
    }
    const found = await walkIgnores(root.dir);
    if (found.isErr()) return err(found.error);
    const rootPrefix = (root.prefix ?? '').replace(/^\/+|\/+$/g, '');
    for (const absPath of found.value) {
      const relDir = toPosix(relative(root.dir, dirname(absPath)));
      const sub = relDir === '' || relDir === '.' ? '' : relDir;
      const prefix = rootPrefix === '' ? sub : sub === '' ? rootPrefix : `${rootPrefix}/${sub}`;
      const name = sub === '' ? root.name : `${root.name}:${sub}`;
      collected.push({ name, path: absPath, prefix });
    }
  }
  return ok(collected);
}

async function walkIgnores(dir: string): Promise<Result<string[], StitchError>> {
  let entries: Array<{ name: string; isDir: boolean; isSymlink: boolean }>;
  try {
    const dirents = await readdir(dir, { withFileTypes: true });
    entries = dirents
      .map(dirent => ({
        name: dirent.name,
        isDir: dirent.isDirectory(),
        isSymlink: dirent.isSymbolicLink(),
      }))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      return err({
        code: 'CONFIG_ERROR',
        field: 'roots',
        message: `collectGitignores: no such directory ("${dir}")`,
      });
    }
    return err(internalError('collectGitignores walk', error));
  }
  const found: string[] = [];
  for (const entry of entries) {
    if (entry.name === '.git') continue;
    const abs = join(dir, entry.name);
    // Symlinks never followed (loop/escape prevention; untestable
    // deterministically across platforms — reviewed, not covered).
    if (entry.isSymlink) continue;
    if (entry.isDir) {
      const nested = await walkIgnores(abs);
      if (nested.isErr()) return err(nested.error);
      found.push(...nested.value);
    } else if (entry.name === '.gitignore') {
      found.push(abs);
    }
  }
  return ok(found);
}
