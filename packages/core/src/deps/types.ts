// Deps manifest types (P-104; the ParsedManifest union grows in P-105-P-107
// as the Python/Cargo/Go parsers land, and P-108 switches on `ecosystem`).
//
// All manifest interfaces describe the NORMALIZED form each parser returns:
// parsers own every wire-shape quirk (BOM/CRLF, comments, array-vs-object
// workspaces, missing sections) so downstream phases (P-108 union, P-109
// semver resolve, P-116 report) never branch on raw file shapes.

/**
 * Normalized `package.json` manifest (P-104).
 *
 * Normalization rules applied by `parsePackageJson`:
 * - `dependencies` defaults to `{}` when absent or empty, so merge logic
 *   (P-108) never checks for undefined on the primary map.
 * - `workspaces` is always the normalized `string[]` form: array input is
 *   copied, `{ packages: [...] }` input is unwrapped, absent stays absent.
 *   (The spec's wire shape `string[] | { packages: string[] }` never
 *   escapes the parser.)
 * - Every other section is present only when the input file defined it;
 *   values are shallow-copied so callers can mutate the result freely.
 * - Unknown top-level fields (`name`, `version`, `private`, ...) are
 *   validated when present (name/version must be strings) and then dropped:
 *   the manifest carries dependency data only.
 */
export interface NpmManifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
  scripts?: Record<string, string>;
  engines?: Record<string, string>;
  overrides?: Record<string, string>;
  workspaces?: string[];
}

/**
 * Normalized Python manifest (P-105): unifies legacy `requirements.txt`
 * (pip) and modern `pyproject.toml` (PEP 621, Poetry, uv/PEP 735) into one
 * shape the P-108 union logic can merge.
 *
 * Normalization rules applied by the parsers:
 * - `dependencies` is always present (`{}` when the file declares none).
 * - requirements `[bracket]` extras land in `extras[package] = [names]`;
 *   `pyproject` optional-dependency groups land in `extras[group] = [raw
 *   requirement strings]`; Poetry `[tool.poetry.extras]` lands in
 *   `extras[group] = [member package names]`.
 * - PEP 508 direct references (`name @ url`), Poetry `{ git/url = ... }`
 *   tables, and uv `{ git/url = ... }` sources land in `urls[name]` with
 *   the dependency spec normalized to `'*'` (the manifest carries no
 *   comment field, so URLs get their own map rather than being dropped).
 * - `source` records which dialect produced the manifest: Poetry tables
 *   win over uv markers, which win over plain PEP 621 (`pyproject.toml`);
 *   requirements files always report `requirements.txt`. P-114 uses this
 *   to pick the lockfile regenerator (`pip compile` vs `uv pip compile`).
 */
export interface PythonManifest {
  dependencies: Record<string, string>;
  devDependencies?: Record<string, string>;
  extras?: Record<string, string[]>;
  pythonVersion?: string;
  urls?: Record<string, string>;
  source: 'requirements.txt' | 'pyproject.toml' | 'poetry' | 'uv';
}

/**
 * Normalized `Cargo.toml` manifest (P-106).
 *
 * Normalization rules applied by `parseCargoToml`:
 * - `package` (`name` + `version`, optional `edition`) is required: a
 *   manifest without it is `DEPS_PARSE_ERROR`, never a partial manifest.
 * - `dependencies` is always present (`{}` when the file declares none).
 * - `[dependencies]` bare-string values (`"1.0"`) are preserved as strings;
 *   inline tables become `{ version, features?, optional? }`. Tables without
 *   a version (`{ git = ... }`, `{ path = ... }`) store `version: '*'` with
 *   a warning. Non-string/non-table values warn and store `'*'`.
 * - `[dev-dependencies]` uses the same normalization, narrowed to
 *   `string | { version }` per the spec type (extra table keys dropped).
 * - `[build-dependencies]` coerces to plain version strings (tables
 *   contribute `version`, or `'*'` with a warning when versionless).
 * - `features` and `workspace.members`, when present, are preserved.
 * - `[patch]` / `[replace]` are logged and ignored (not merged in MVP).
 */
export interface CargoManifest {
  package: { name: string; version: string; edition?: string };
  dependencies: Record<
    string,
    string | { version: string; features?: string[]; optional?: boolean }
  >;
  devDependencies?: Record<string, string | { version: string }>;
  buildDependencies?: Record<string, string>;
  features?: Record<string, string[]>;
  workspace?: { members: string[] };
}

/**
 * Normalized `go.mod` manifest (P-107).
 *
 * Normalization rules applied by `parseGoMod`:
 * - `module` is required: a file without it is `DEPS_PARSE_ERROR`, never
 *   a partial manifest (go tooling refuses to build such files too).
 * - `require` is always present (`{}` when the file declares none); both
 *   single-line (`require a/b v1.0.0`) and block (`require ( ... )`) forms
 *   fold into the same map with last-wins deduplication.
 * - `// indirect` markers (single or block) land in `indirect`; the marker
 *   comment itself is not preserved in `require` values.
 * - `replace` maps old module path -> new target string (`new-path vX.Y.Z`
 *   or bare `new-path`); both single and block forms fold into one map.
 * - `exclude` maps module path -> excluded version.
 * - `go` feeds `goVersion`; `toolchain` (Go 1.21+) is logged and ignored
 *   (not merged in MVP); `retract` is logged and ignored.
 */
export interface GoManifest {
  module: string;
  goVersion?: string;
  require: Record<string, string>;
  replace?: Record<string, string>;
  exclude?: Record<string, string>;
  indirect?: Set<string>;
}

/**
 * One parsed manifest file, tagged with the ecosystem that owns it.
 * P-103's `DetectedEcosystem.parser` selects which parser produces each
 * member; P-108 switches on `ecosystem` to union them.
 */
export type ParsedManifest =
  | { ecosystem: 'npm'; manifest: NpmManifest; path: string }
  | { ecosystem: 'python'; manifest: PythonManifest; path: string }
  | { ecosystem: 'cargo'; manifest: CargoManifest; path: string }
  | { ecosystem: 'go'; manifest: GoManifest; path: string };

/**
 * One merge collision between two (or more) source repos (P-108).
 *
 * `values` maps the positional source label (`repo-a`, `repo-b`, ... in
 * input order — see `unionManifests`) to that source's spec string, so
 * the UI panel (P-219) and the report (P-116) can render both sides
 * without knowing which files were merged.
 *
 * `suggestedResolution` stays absent until P-109's semver resolver fills
 * it (intersected range) or P-110/P-111 refine it (peer overrides /
 * dedupe strategy); its absence means "no automatic fix known".
 */
export interface Conflict {
  type: 'version' | 'peer' | 'script' | 'config';
  package: string;
  values: Record<string, string>;
  suggestedResolution?: string;
  dedupeStrategy?: 'hoist' | 'nest' | 'error';
  severity: 'error' | 'warning';
}

/** Any single-ecosystem merged manifest (P-108 output). */
export type UnifiedManifest = NpmManifest | PythonManifest | CargoManifest | GoManifest;

/**
 * The result of `unionManifests` (P-108): the merged manifest plus every
 * collision found and every non-collision note. An empty `conflicts`
 * array means the merge is clean; `severity: 'warning'` conflicts (npm
 * peers, npm scripts) never block the merge, `severity: 'error'`
 * conflicts need P-109 resolution or human review.
 */
export interface MergeResult {
  merged: UnifiedManifest;
  conflicts: Conflict[];
  warnings: string[];
}

export interface LockfileResult {
  ecosystem: 'npm' | 'python' | 'cargo' | 'go';
  lockfilePath: string;
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  createdAt: string;
}

export type ConflictStatus = 'auto-resolved' | 'needs-attention' | 'warning';

export interface DependencyReport {
  generatedAt: string;
  ecosystem: 'npm' | 'python' | 'cargo' | 'go';
  inputSources: { repoName: string; manifestPath: string }[];
  merged: UnifiedManifest;
  dependencyCount: { direct: number; dev: number; peer: number; total: number };
  conflicts: (Conflict & { status: ConflictStatus; resolution?: string })[];
  dedupe: import('./dedupe.js').DedupeResult[];
  scripts: { merged: Record<string, string>; collisions: Conflict[] };
  lockfile: {
    status: 'generated' | 'failed' | 'skipped';
    path?: string;
    command?: string;
    error?: string;
  } | null;
  summary: { mergeable: boolean; needsHuman: boolean; blockedBy: string[] };
}
