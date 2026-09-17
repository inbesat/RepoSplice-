// Deps ecosystem detection (P-103): detect which package ecosystems are
// present in a repo so the deps pipeline (P-104-P-116) can dispatch to the
// right parsers and the sandbox (P-169) can pick base images.
//
// Detection is marker-file driven: each ecosystem owns one or more manifest
// filenames (`package.json` node, `requirements*.txt`/`pyproject.toml`
// python, `Cargo.toml` rust, `go.mod` go). The scan walks `repoPath` via the
// shared glob helper (P-034, async per codebase convention), classifies every
// hit by basename, drops anything ignored (default subtree ignores plus the
// repo's own root `.gitignore` via the P-012/P-036 matcher and P-083 merge
// semantics), and returns the survivors in a deterministic order (P-282:
// code-unit sort on the absolute posix manifest path, never locale-dependent).
//
// Safety contract (P-011):
// - No throws: every failure is a typed `Result` err. Blank/unresolvable
//   `repoPath` and a missing repo root are caller bugs -> CONFIG_ERROR.
//   Walk failures propagate the helper's INTERNAL err untouched.
// - No new StitchError codes (P-203 owns future taxonomy): only
//   CONFIG_ERROR + INTERNAL appear here.
// - Only paths + counts are ever interpolated into messages/logs, never
//   file contents.
// - `go.sum` / `Cargo.lock` alone never count as an ecosystem: lockfiles
//   without their manifest (`go.mod` / `Cargo.toml`) yield no entry.
// - Empty repos are valid: "nothing found" is `ok([])`, never err.
//
// Consumers:
// - P-104-P-107 switch on `DetectedEcosystem.parser` to pick a file parser.
// - P-169 switches on `DetectedEcosystem.ecosystem` to pick sandbox images.
// - P-238 (merge strategy) fans out per detected ecosystem.

import { readFile } from 'node:fs/promises';
import { basename, join, relative } from 'node:path';
import { err, ok, type Result } from 'neverthrow';
import type { StitchError } from '../result/index.js';
import { listFiles } from '../util/glob.js';
import { pathExists } from '../util/fs.js';
import { buildIgnoreMatcher } from '../util/ignore.js';
import { toPosix } from '../util/paths.js';

/** Package ecosystem present in a scanned repo. */
export type Ecosystem = 'node' | 'python' | 'rust' | 'go';

/**
 * Parser id owned by the corresponding P-104-P-107 phase. The detector does
 * not parse; it only routes, so downstream phases can `switch` on this.
 */
export type EcosystemParser = 'npm' | 'python' | 'cargo' | 'gomod';

/** One detected ecosystem instance: which ecosystem, where, and who parses it. */
export interface DetectedEcosystem {
  /** Ecosystem kind (drives P-169 sandbox image selection). */
  readonly ecosystem: Ecosystem;
  /** Absolute posix path of the manifest file that proved the ecosystem. */
  readonly manifestPath: string;
  /** Parser id (drives P-104-P-107 dispatch). */
  readonly parser: EcosystemParser;
}

/** Options for `detectEcosystems`. All fields optional. */
export interface DetectEcosystemsOptions {
  /**
   * Extra ignore patterns (gitignore syntax) applied on top of the defaults
   * and the repo's own root `.gitignore`. Use for caller-scoped excludes.
   */
  readonly ignore?: readonly string[];
}

/**
 * Subtrees that never contribute ecosystem markers, even if a marker file
 * somehow lands inside them (vendored deps, VCS metadata). Applied as glob
 * `ignore` patterns on top of any caller-provided ignores.
 */
export const DEFAULT_ECOSYSTEM_IGNORE: readonly string[] = ['**/.git/**', '**/node_modules/**'];

/** Glob patterns (repo-relative) for every marker file we recognise. */
const MARKER_PATTERNS: readonly string[] = [
  '**/package.json',
  '**/pyproject.toml',
  '**/requirements*.txt',
  '**/Cargo.toml',
  '**/go.mod',
];

/**
 * Classify a manifest basename into its ecosystem + parser. Returns
 * `undefined` for filenames this detector does not recognise (defensive:
 * the glob patterns above should already constrain hits to known names,
 * e.g. `requirements-dev.txt` matches via prefix rule, `go.sum` never
 * matches because it is not globbed at all).
 */
export function classifyManifest(
  fileName: string
): { ecosystem: Ecosystem; parser: EcosystemParser } | undefined {
  if (fileName === 'package.json') return { ecosystem: 'node', parser: 'npm' };
  if (fileName === 'pyproject.toml') return { ecosystem: 'python', parser: 'python' };
  if (fileName === 'Cargo.toml') return { ecosystem: 'rust', parser: 'cargo' };
  if (fileName === 'go.mod') return { ecosystem: 'go', parser: 'gomod' };
  if (fileName.startsWith('requirements') && fileName.endsWith('.txt')) {
    return { ecosystem: 'python', parser: 'python' };
  }
  return undefined;
}

/**
 * Compare two absolute posix paths by UTF-16 code unit (NOT locale-aware:
 * `localeCompare` varies by ICU/ OS locale and would break P-282
 * reproducibility). Total order, deterministic on every platform.
 */
function comparePosix(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * Best-effort read of the repo's root `.gitignore`. Missing/unreadable files
 * yield no patterns (the ignore file is advisory for detection, never
 * load-bearing): detection must keep working on repos without one. Never
 * throws; never leaks file contents into errors.
 */
async function readRootGitignore(repoPath: string): Promise<readonly string[]> {
  let raw: string;
  try {
    raw = await readFile(join(repoPath, '.gitignore'), 'utf8');
  } catch {
    return [];
  }
  return raw
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.startsWith('#'));
}

/**
 * Detect which package ecosystems are present under `repoPath`.
 *
 * Returns `ok` with one `DetectedEcosystem` per manifest file found,
 * sorted deterministically by absolute posix manifest path. Returns
 * `ok([])` when no markers exist (empty or non-package repos are valid
 * input). Returns `err` only for caller bugs (blank path, missing root)
 * or walk failures (propagated INTERNAL from the glob helper).
 */
export async function detectEcosystems(
  repoPath: string,
  options: DetectEcosystemsOptions = {}
): Promise<Result<DetectedEcosystem[], StitchError>> {
  if (repoPath.trim().length === 0) {
    return err({
      code: 'CONFIG_ERROR',
      field: 'repoPath',
      message: 'detectEcosystems requires a non-empty repoPath',
    });
  }

  const exists = await pathExists(repoPath);
  if (exists.isErr()) return err(exists.error);
  if (!exists.value) {
    return err({
      code: 'CONFIG_ERROR',
      field: 'repoPath',
      message: `repo path does not exist: ${repoPath}`,
    });
  }

  const extraIgnore: readonly string[] = options.ignore !== undefined ? options.ignore : [];
  const found = await listFiles(repoPath, MARKER_PATTERNS, {
    ignore: [...DEFAULT_ECOSYSTEM_IGNORE, ...extraIgnore],
  });
  if (found.isErr()) return err(found.error);

  const gitignorePatterns = await readRootGitignore(repoPath);
  const gitignoreActive = gitignorePatterns.length > 0;
  const isGitignored = buildIgnoreMatcher(gitignorePatterns);

  const detected: DetectedEcosystem[] = [];
  for (const abs of found.value) {
    const classified = classifyManifest(toPosix(basename(abs)));
    if (classified === undefined) continue;
    if (gitignoreActive) {
      const rel = toPosix(relative(repoPath, abs));
      if (isGitignored(rel)) continue;
    }
    detected.push({
      ecosystem: classified.ecosystem,
      manifestPath: toPosix(abs),
      parser: classified.parser,
    });
  }

  detected.sort((a, b) => comparePosix(a.manifestPath, b.manifestPath));
  return ok(detected);
}
