// npm `package.json` parser (P-104): deterministic parse + serialize for the
// first deps-ecosystem parser. P-103's detector routes `package.json` hits
// here; the `ParsedManifest` this returns feeds the P-108 union logic, which
// switches on `manifest.ecosystem`.
//
// Safety contract (P-011):
// - No throws: malformed JSON, non-object roots, and zod validation
//   failures all become `DEPS_PARSE_ERROR` (with the offending file);
//   empty/missing content becomes `FILE_NOT_FOUND` (with the path).
// - Only the file path + validation messages reach errors/logs, never
//   file contents.
// - Outputs are normalized + shallow-copied: callers can mutate freely and
//   downstream phases never branch on wire shapes.
//
// Wire-shape quirks owned here (never leaked):
// - Full-line `//` comments are stripped defensively before `JSON.parse`.
//   This is provably safe: JSON strings cannot span lines, so a line whose
//   first non-whitespace characters are `//` can never occur inside a
//   string value of VALID json. Trailing inline comments (`"a": 1 // x`)
//   are NOT stripped: removing them would require a real tokenizer, and
//   such files are malformed package.json anyway -> DEPS_PARSE_ERROR.
// - `workspaces` array-vs-`{ packages }` object is unwrapped to `string[]`.
// - Absent/empty `dependencies` normalizes to `{}` for the merge logic.
// - `name`/`version`, when present, must be strings (zod); every other
//   unknown top-level field is ignored (dependency data only).

import { z } from 'zod';
import { err, ok, type Result } from 'neverthrow';
import type { StitchError } from '../../result/index.js';
import type { NpmManifest, ParsedManifest } from '../types.js';

/** `Record<name, spec>` sections: both keys and values must be strings. */
const DepMapSchema = z.record(z.string(), z.string());

const PeerDependenciesMetaSchema = z.record(
  z.string(),
  z.object({ optional: z.boolean().optional() })
);

/** Wire shape: npm accepts an array or `{ packages: [...] }`. */
const WorkspacesSchema = z.union([
  z.array(z.string()),
  z.object({ packages: z.array(z.string()) }),
]);

const PackageJsonSchema = z.object({
  name: z.string().optional(),
  version: z.string().optional(),
  dependencies: DepMapSchema.optional(),
  devDependencies: DepMapSchema.optional(),
  peerDependencies: DepMapSchema.optional(),
  optionalDependencies: DepMapSchema.optional(),
  peerDependenciesMeta: PeerDependenciesMetaSchema.optional(),
  scripts: DepMapSchema.optional(),
  engines: DepMapSchema.optional(),
  overrides: DepMapSchema.optional(),
  workspaces: WorkspacesSchema.optional(),
});

/**
 * Drop full-line `//` comments. See the header proof for why this cannot
 * alter valid JSON (strings are single-line; only comment lines start
 * with `//` after trimming).
 */
function stripFullLineComments(content: string): string {
  return content
    .split('\n')
    .filter(line => !line.trimStart().startsWith('//'))
    .join('\n');
}

/** Copy a validated `Record<string, string>` section (or `{}` when absent). */
function copySection(section: Record<string, string> | undefined): Record<string, string> {
  return section !== undefined ? { ...section } : {};
}

/**
 * Parse `package.json` text into a normalized `ParsedManifest`.
 *
 * - Empty/whitespace-only `content` (caller read a missing file) ->
 *   `err(FILE_NOT_FOUND)` with `path`.
 * - Unparseable JSON, non-object roots, or zod validation failures ->
 *   `err(DEPS_PARSE_ERROR)` with `file` + the reason.
 */
export function parsePackageJson(
  content: string,
  filePath: string
): Result<ParsedManifest, StitchError> {
  if (typeof content !== 'string' || content.trim().length === 0) {
    return err({
      code: 'FILE_NOT_FOUND',
      path: filePath,
      message: `package.json is missing or empty: ${filePath}`,
    });
  }

  let raw: unknown;
  try {
    raw = JSON.parse(stripFullLineComments(content)) as unknown;
  } catch (cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    return err({
      code: 'DEPS_PARSE_ERROR',
      file: filePath,
      message: `invalid package.json in ${filePath}: ${detail}`,
    });
  }

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return err({
      code: 'DEPS_PARSE_ERROR',
      file: filePath,
      message: `package.json in ${filePath} must be a JSON object`,
    });
  }

  const validated = PackageJsonSchema.safeParse(raw);
  if (!validated.success) {
    const detail = validated.error.issues
      .map(issue => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
      .join('; ');
    return err({
      code: 'DEPS_PARSE_ERROR',
      file: filePath,
      message: `package.json in ${filePath} failed validation: ${detail}`,
    });
  }

  const v = validated.data;
  const manifest: NpmManifest = {};
  manifest.dependencies = copySection(v.dependencies);
  if (v.devDependencies !== undefined) manifest.devDependencies = { ...v.devDependencies };
  if (v.peerDependencies !== undefined) manifest.peerDependencies = { ...v.peerDependencies };
  if (v.optionalDependencies !== undefined) {
    manifest.optionalDependencies = { ...v.optionalDependencies };
  }
  if (v.peerDependenciesMeta !== undefined) {
    const meta: Record<string, { optional?: boolean }> = {};
    for (const [name, entry] of Object.entries(v.peerDependenciesMeta)) {
      meta[name] = entry.optional === true ? { optional: true } : {};
    }
    manifest.peerDependenciesMeta = meta;
  }
  if (v.scripts !== undefined) manifest.scripts = { ...v.scripts };
  if (v.engines !== undefined) manifest.engines = { ...v.engines };
  if (v.overrides !== undefined) manifest.overrides = { ...v.overrides };
  if (v.workspaces !== undefined) {
    manifest.workspaces = Array.isArray(v.workspaces)
      ? [...v.workspaces]
      : [...v.workspaces.packages];
  }

  return ok({ ecosystem: 'npm', manifest, path: filePath });
}

/**
 * Serialize a manifest back to `package.json` text: 2-space JSON + trailing
 * newline, with a stable section order (dependencies, devDependencies,
 * peerDependencies, optionalDependencies, peerDependenciesMeta, scripts,
 * engines, overrides, workspaces). Absent sections are omitted, so
 * `parse(serialize(parse(x)))` is a fixed point and round-trips lose no data.
 */
export function serializePackageJson(manifest: NpmManifest): string {
  const ordered: Record<string, unknown> = {};
  if (manifest.dependencies !== undefined) ordered['dependencies'] = manifest.dependencies;
  if (manifest.devDependencies !== undefined) ordered['devDependencies'] = manifest.devDependencies;
  if (manifest.peerDependencies !== undefined) {
    ordered['peerDependencies'] = manifest.peerDependencies;
  }
  if (manifest.optionalDependencies !== undefined) {
    ordered['optionalDependencies'] = manifest.optionalDependencies;
  }
  if (manifest.peerDependenciesMeta !== undefined) {
    ordered['peerDependenciesMeta'] = manifest.peerDependenciesMeta;
  }
  if (manifest.scripts !== undefined) ordered['scripts'] = manifest.scripts;
  if (manifest.engines !== undefined) ordered['engines'] = manifest.engines;
  if (manifest.overrides !== undefined) ordered['overrides'] = manifest.overrides;
  if (manifest.workspaces !== undefined) ordered['workspaces'] = manifest.workspaces;
  return `${JSON.stringify(ordered, null, 2)}\n`;
}
