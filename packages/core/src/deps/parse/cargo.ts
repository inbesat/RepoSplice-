// Cargo `Cargo.toml` parser (P-106): deterministic parse for the Rust
// ecosystem manifest. P-103's detector routes `Cargo.toml` hits here; the
// `ParsedManifest` this returns feeds the P-108 union logic, which switches
// on `manifest.ecosystem`.
//
// Safety contract (P-011):
// - No throws: malformed TOML, non-table roots, and structurally wrong values
//   in canonical positions all become `DEPS_PARSE_ERROR` (with the offending
//   file plus the smol-toml line/column or a field path); empty/missing
//   content becomes `FILE_NOT_FOUND` (with the path).
// - Only the file path + package/section names + validation messages reach
//   errors/logs, never file contents.
// - Exotic-but-tolerable entries (a dependency as `{ git = "..." }` with no
//   version, a non-string/non-table dep value, `[patch]`/`[replace]` sections)
//   are recorded with a `logger.warn` carrying file + package/section, never
//   file contents: one odd entry must not nuke a whole manifest ("graceful"
//   policy, matching P-105's include-skipping rule and the spec's
//   patch-as-warning rule).
//
// Wire-shape quirks owned here (never leaked):
// - `[dependencies]` values that are bare strings (`"1.0"`) are preserved as
//   strings; inline tables (`{ version = "1.0", features = ["derive"] }`) are
//   normalized to `{ version, features?, optional? }` objects. Tables without
//   a version (`{ git = "..." }`, `{ path = "../x" }`) store `version: "*"`
//   with a warning, per the spec edge.
// - `[dev-dependencies]` uses the same string-vs-table normalization (the spec
//   type keeps the narrow `{ version }` table shape; extra table keys are
//   dropped after warning-free extraction of `version`).
// - `[build-dependencies]` coerces to plain version strings: tables contribute
//   their `version` (or `"*"` with a warning when versionless).
// - `[patch]` and `[replace]` are logged and ignored (not merged in MVP).
// - Absent `[dependencies]` normalizes to `{}` for the merge logic.
// - `workspace.members`, when present, is preserved; a `[workspace]` table
//   without `members` contributes no `workspace` field.

import { err, ok, type Result } from 'neverthrow';
import { TomlError, parse as parseToml } from 'smol-toml';
import { logger } from '../../logger/index.js';
import type { StitchError } from '../../result/index.js';
import type { CargoManifest, ParsedManifest } from '../types.js';

/** `typeof v === 'object'` minus `null` minus arrays: a TOML table. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Read an optional string field off a TOML table. */
function strField(table: Record<string, unknown>, key: string): string | undefined {
  const v = table[key];
  return typeof v === 'string' ? v : undefined;
}

/** Validate that `value` is a `string[]`; `undefined` when it is not. */
function strArrayField(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  if (!value.every(e => typeof e === 'string')) return undefined;
  return [...value];
}

/** Normalized `[dependencies]` entry value. */
type CargoDepValue = string | { version: string; features?: string[]; optional?: boolean };

/**
 * Normalize one `[dependencies]`-shaped entry (also reused for
 * `[dev-dependencies]` tables, whose spec type is the narrow
 * `string | { version }` form).
 *
 * - Bare strings pass through untouched.
 * - Tables with a string `version` yield `{ version, features?, optional? }`
 *   (non-string `features`/`optional` keys are dropped silently; they are
 *   advisory, not load-bearing).
 * - Tables without a version (`{ git = ... }`, `{ path = ... }`) yield
 *   `{ version: '*' }` plus a warning (spec edge).
 * - Anything else (number, boolean, array, null) yields `'*'` as a string
 *   plus a warning, so the crate is still visible to the merge.
 */
function parseDepEntry(value: unknown, name: string, file: string, section: string): CargoDepValue {
  if (typeof value === 'string') return value;
  if (isRecord(value)) {
    const version = strField(value, 'version');
    const featuresRaw = value['features'];
    const features = isRecord(value) ? strArrayField(featuresRaw) : undefined;
    const optionalRaw = value['optional'];
    const optional = typeof optionalRaw === 'boolean' ? optionalRaw : undefined;
    if (version !== undefined) {
      const entry: { version: string; features?: string[]; optional?: boolean } = {
        version,
      };
      if (features !== undefined) entry.features = features;
      if (optional !== undefined) entry.optional = optional;
      return entry;
    }
    logger.warn({ file, section, package: name }, 'cargo dependency without version, using *');
    const fallback: { version: string; features?: string[]; optional?: boolean } = {
      version: '*',
    };
    if (features !== undefined) fallback.features = features;
    if (optional !== undefined) fallback.optional = optional;
    return fallback;
  }
  logger.warn({ file, section, package: name }, 'cargo dependency has unexpected shape, using *');
  return '*';
}

/**
 * Fold a `[dependencies]`-shaped TOML table into a normalized map.
 * `section` names the source section for warnings (e.g. `dependencies`).
 */
function foldDepTable(
  table: Record<string, unknown>,
  file: string,
  section: string
): Record<string, CargoDepValue> {
  const out: Record<string, CargoDepValue> = {};
  for (const [name, value] of Object.entries(table)) {
    out[name] = parseDepEntry(value, name, file, section);
  }
  return out;
}

/**
 * Coerce one `[build-dependencies]`-shaped entry to a plain version string:
 * bare strings pass through; tables contribute their `version` (or `'*'`
 * with a warning when versionless); anything else warns and yields `'*'`.
 */
function parseBuildEntry(value: unknown, name: string, file: string): string {
  if (typeof value === 'string') return value;
  if (isRecord(value)) {
    const version = strField(value, 'version');
    if (version !== undefined) return version;
    logger.warn(
      { file, section: 'build-dependencies', package: name },
      'cargo build dependency without version, using *'
    );
    return '*';
  }
  logger.warn(
    { file, section: 'build-dependencies', package: name },
    'cargo build dependency has unexpected shape, using *'
  );
  return '*';
}

/** Fold a `[build-dependencies]` TOML table into a `Record<name, spec>`. */
function foldBuildTable(table: Record<string, unknown>, file: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(table)) {
    out[name] = parseBuildEntry(value, name, file);
  }
  return out;
}

/**
 * Parse `Cargo.toml` text into a normalized `ParsedManifest`.
 *
 * - Empty/whitespace-only `content` (caller read a missing file) ->
 *   `err(FILE_NOT_FOUND)` with `path`.
 * - Unparseable TOML, non-table roots, or structurally wrong values in
 *   canonical positions -> `err(DEPS_PARSE_ERROR)` with `file` + reason
 *   (parser line/column for syntax errors, field path otherwise).
 */
export function parseCargoToml(
  content: string,
  filePath: string
): Result<ParsedManifest, StitchError> {
  if (typeof content !== 'string' || content.trim().length === 0) {
    return err({
      code: 'FILE_NOT_FOUND',
      path: filePath,
      message: `Cargo.toml is missing or empty: ${filePath}`,
    });
  }

  let root: Record<string, unknown>;
  try {
    root = parseToml(content) as Record<string, unknown>;
  } catch (cause: unknown) {
    if (cause instanceof TomlError) {
      return err({
        code: 'DEPS_PARSE_ERROR',
        file: filePath,
        message: `invalid TOML in ${filePath} at line ${cause.line}, column ${cause.column}: ${cause.message}`,
      });
    }
    const detail = cause instanceof Error ? cause.message : String(cause);
    return err({
      code: 'DEPS_PARSE_ERROR',
      file: filePath,
      message: `invalid TOML in ${filePath}: ${detail}`,
    });
  }
  if (!isRecord(root)) {
    return err({
      code: 'DEPS_PARSE_ERROR',
      file: filePath,
      message: `Cargo.toml in ${filePath} must be a TOML table`,
    });
  }

  const packageTable = root['package'];
  if (packageTable === undefined || !isRecord(packageTable)) {
    return err({
      code: 'DEPS_PARSE_ERROR',
      file: filePath,
      message: `Cargo.toml in ${filePath}: [package] must be a table with name and version`,
    });
  }
  const name = strField(packageTable, 'name');
  const version = strField(packageTable, 'version');
  if (name === undefined || version === undefined) {
    return err({
      code: 'DEPS_PARSE_ERROR',
      file: filePath,
      message: `Cargo.toml in ${filePath}: [package] requires string name and version`,
    });
  }
  const edition = strField(packageTable, 'edition');

  const manifest: CargoManifest = {
    package: edition !== undefined ? { name, version, edition } : { name, version },
    dependencies: {},
  };

  const deps = root['dependencies'];
  if (deps !== undefined) {
    if (!isRecord(deps)) {
      return err({
        code: 'DEPS_PARSE_ERROR',
        file: filePath,
        message: `Cargo.toml in ${filePath}: [dependencies] must be a table`,
      });
    }
    manifest.dependencies = foldDepTable(deps, filePath, 'dependencies');
  }

  const devDeps = root['dev-dependencies'];
  if (devDeps !== undefined) {
    if (!isRecord(devDeps)) {
      return err({
        code: 'DEPS_PARSE_ERROR',
        file: filePath,
        message: `Cargo.toml in ${filePath}: [dev-dependencies] must be a table`,
      });
    }
    const normalized = foldDepTable(devDeps, filePath, 'dev-dependencies');
    const narrow: Record<string, string | { version: string }> = {};
    for (const [depName, entry] of Object.entries(normalized)) {
      if (typeof entry === 'string') {
        narrow[depName] = entry;
      } else {
        narrow[depName] = { version: entry.version };
      }
    }
    manifest.devDependencies = narrow;
  }

  const buildDeps = root['build-dependencies'];
  if (buildDeps !== undefined) {
    if (!isRecord(buildDeps)) {
      return err({
        code: 'DEPS_PARSE_ERROR',
        file: filePath,
        message: `Cargo.toml in ${filePath}: [build-dependencies] must be a table`,
      });
    }
    manifest.buildDependencies = foldBuildTable(buildDeps, filePath);
  }

  const features = root['features'];
  if (features !== undefined) {
    if (!isRecord(features)) {
      return err({
        code: 'DEPS_PARSE_ERROR',
        file: filePath,
        message: `Cargo.toml in ${filePath}: [features] must be a table of string arrays`,
      });
    }
    const normalized: Record<string, string[]> = {};
    for (const [featureName, members] of Object.entries(features)) {
      const list = strArrayField(members);
      if (list === undefined) {
        return err({
          code: 'DEPS_PARSE_ERROR',
          file: filePath,
          message: `Cargo.toml in ${filePath}: feature '${featureName}' must be an array of strings`,
        });
      }
      normalized[featureName] = list;
    }
    manifest.features = normalized;
  }

  const workspace = root['workspace'];
  if (workspace !== undefined) {
    if (!isRecord(workspace)) {
      return err({
        code: 'DEPS_PARSE_ERROR',
        file: filePath,
        message: `Cargo.toml in ${filePath}: [workspace] must be a table`,
      });
    }
    const members = workspace['members'];
    if (members !== undefined) {
      const list = strArrayField(members);
      if (list === undefined) {
        return err({
          code: 'DEPS_PARSE_ERROR',
          file: filePath,
          message: `Cargo.toml in ${filePath}: [workspace].members must be an array of strings`,
        });
      }
      manifest.workspace = { members: list };
    }
  }

  if (root['patch'] !== undefined) {
    logger.warn({ file: filePath, section: 'patch' }, 'cargo [patch] section ignored in MVP');
  }
  if (root['replace'] !== undefined) {
    logger.warn({ file: filePath, section: 'replace' }, 'cargo [replace] section ignored in MVP');
  }

  return ok({ ecosystem: 'cargo', manifest, path: filePath });
}
