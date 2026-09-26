// P-148 — agent tool contracts.
//
// The agent chooses which files from source repos A and B to carry into child
// repo C. `select_files` is the first tool of Epic 7 and establishes the shape
// every later tool (P-149–P-156) follows: a typed result the merge pipeline
// can execute, carrying paths that are **relative** and a `repo` label that is
// **explicit**, so the merge writer (P-076) and the provenance mapper (P-181)
// can consume the same selection without re-deriving either fact.

import type { Result } from 'neverthrow';
import type { StitchError } from '../result/index.js';

/**
 * Which source repo a selection entry came from.
 *
 * A child repo C is stitched from exactly two sources. Keeping the label in
 * the type (rather than inferring it from a path prefix) is what lets P-149's
 * closure resolver and P-181's provenance map address a file unambiguously.
 */
export type SourceRepo = 'A' | 'B';

/** One file proposed for inclusion in child repo C. */
export interface SelectedFile {
  repo: SourceRepo;
  /**
   * Path relative to the root of the source repo, POSIX separators.
   *
   * Relative (never absolute) because the same selection is replayed against
   * different checkout locations; absolute paths would bake one machine's
   * layout into the plan.
   */
  path: string;
  /** Model-supplied justification, carried through to the UI. */
  reason?: string;
}

/** Optional narrowing applied to a selection. */
export interface SelectionFilter {
  /**
   * picomatch glob (P-036) used to expand the selection from the source
   * repo's scanned listing instead of naming every file by hand.
   */
  glob?: string;
  /** Directory prefixes to drop from the expansion (e.g. `node_modules`). */
  excludeDirs?: string[];
}

/** The structured plan `select_files` returns for the merge pipeline. */
export interface FileSelection {
  files: SelectedFile[];
  filter?: SelectionFilter;
  /**
   * Free-form operator-facing note. P-148 also uses it to report a bounded
   * glob expansion (see `MAX_SELECTED_FILES`) so a truncated selection is
   * visible instead of silent.
   */
  notes?: string;
}

/** Parsed arguments accepted by the `select_files` tool. */
export interface SelectFilesArgs {
  repo: SourceRepo;
  /** Explicit repo-relative paths. 1..2000 (schema-enforced). */
  paths: string[];
  filter?: SelectionFilter;
  reason?: string;
}

/** Hard bound on a single selection, mirroring the schema's `.max(2000)`. */
export const MAX_SELECTED_FILES = 2000;

// ---------------------------------------------------------------------------
// P-149 — dependency closure over a selection
// ---------------------------------------------------------------------------

/** How a required package entered the closure. */
export type DepSeverity = 'direct' | 'transitive';

/**
 * The dependency closure of a selection (P-149).
 *
 * The four mandated fields are `required` / `missing` / `satisfied` /
 * `byFile`. The rest are additive, because step 5 of P-149 additionally
 * requires severity hints ("transitive-only vs direct") for the fixer, and the
 * phase Context requires reporting missing *files* as well as packages so the
 * agent can pull them in.
 *
 * Determinism: every array is sorted, and `byFile` keys are `repo:path` so the
 * same relative path in A and B never collides. Two runs over the same inputs
 * produce byte-identical output (P-149 handoff requires comparing manifests
 * across runs).
 */
export interface DepClosure {
  /** Every package the selection needs, direct and transitive, sorted. */
  required: string[];
  /** Required packages absent from child repo C's merged manifest, sorted. */
  missing: string[];
  /** Required packages already present in C's merged manifest, sorted. */
  satisfied: string[];
  /** `repo:path` -> the packages that file imports directly. */
  byFile: Record<string, string[]>;
  /** Packages imported directly by a selected file, sorted. */
  direct: string[];
  /** Packages required only through another file/package, sorted. */
  transitive: string[];
  /** Missing packages that a selected file imports directly, sorted. */
  missingDirect: string[];
  /** Missing packages reachable only transitively, sorted. */
  missingTransitive: string[];
  /** Per-package severity, for the fixer (P-149 step 5). */
  severity: Record<string, DepSeverity>;
  /**
   * Internal files imported by the selection but absent from it, as
   * `repo:path`, sorted. These are the files the agent must also select or the
   * result will not build.
   */
  missingFiles: string[];
  /** Internal files the closure traversed, `repo:path`, sorted (diagnostics). */
  visitedFiles: string[];
}

/** An empty closure — returned for an empty selection, never an error. */
export function emptyDepClosure(): DepClosure {
  return {
    required: [],
    missing: [],
    satisfied: [],
    byFile: {},
    direct: [],
    transitive: [],
    missingDirect: [],
    missingTransitive: [],
    severity: {},
    missingFiles: [],
    visitedFiles: [],
  };
}

// ---------------------------------------------------------------------------
// P-150 — gap detection over the child-repo staging state
// ---------------------------------------------------------------------------

/**
 * The kinds of breakage a composed repo can carry (P-150).
 *
 * Treat as immutable: P-151–P-153 (the auto-fix tools) match on these exact
 * strings, and P-150's handoff explicitly requires that adding a kind not be
 * a breaking change for downstream matchers.
 */
export type GapKind =
  | 'missing_dep'
  | 'missing_file'
  | 'missing_env'
  | 'config_mismatch'
  | 'missing_test'
  | 'broken_import';

/** One detected problem, with enough context for an operator or fixer to act. */
export interface Gap {
  kind: GapKind;
  /** Repo-relative file the gap belongs to, when it is file-scoped. */
  file?: string;
  /** Package name, for dependency gaps. */
  package?: string;
  /** Human-readable explanation, safe to render in the CLI/web. */
  detail: string;
  severity: 'error' | 'warning';
}

/** Options accepted by `detectGaps` (P-150). */
export interface DetectGapsOptions {
  /**
   * Restrict the run to these check kinds. Omit to run every check. An empty
   * array is treated as "run nothing", which is distinct from omitting.
   */
  focus?: GapKind[];
  /**
   * The P-148 selection to run the `missing_dep` closure over. Required for
   * that check; ignored by the staging checks. The spec's `opts` carries only
   * `focus`, so this is additive — the closure needs to know *what* was
   * selected, and `ToolContext` deliberately holds no job state.
   */
  selection?: SelectedFile[];
}

/** The six check kinds, in the order `detectGaps` runs them. */
export const GAP_KINDS: readonly GapKind[] = [
  'missing_dep',
  'broken_import',
  'missing_file',
  'missing_env',
  'missing_test',
  'config_mismatch',
];

// ---------------------------------------------------------------------------
// P-151 — dependency fix
// ---------------------------------------------------------------------------

/** The manifest sections `fix_dependency` may write. */
export type DepSection = 'dependencies' | 'devDependencies' | 'peerDependencies';

/** What a dependency fix did (P-151). */
export interface FixResult {
  action: 'added' | 'updated' | 'unchanged';
  package: string;
  /** The range now pinned in the manifest. */
  version: string;
  section: DepSection;
}

/**
 * Resolves a package's current published version.
 *
 * Injected rather than called directly: P-151 is explicit that registry
 * resolution is "best-effort offline (semver range; no network in tests)", so
 * a production implementation can hit a registry in the sandbox (P-170) while
 * tests supply a deterministic map.
 */
export type LatestVersionResolver = (pkg: string) => Promise<Result<string, StitchError>>;

/** Optional inputs for `applyDependencyFix`. */
export interface ApplyDependencyFixOptions {
  /**
   * Ranges already pinned for a package by source repos A or B, keyed by
   * package name. `'auto'` prefers these, because P-151's handoff requires
   * preserving A/B's original range choice ("as-authored" provenance).
   *
   * The orchestrator builds this map — it owns the A/B checkout mapping
   * (ADR-021), so a tool cannot derive it itself.
   */
  sourceRanges?: Readonly<Record<string, string>>;
}

// ---------------------------------------------------------------------------
// P-152 — config edit
// ---------------------------------------------------------------------------

/**
 * A targeted edit to one config key (P-152).
 *
 * `key` is a dot-path into the parsed document, with optional bracket segments
 * for keys that contain dots or slashes — e.g.
 * `compilerOptions.paths["@app/*"]`. Both `__proto__` and `prototype`
 * segments are rejected: assigning through them is prototype pollution, and a
 * config file is exactly the kind of untrusted-shaped input that gets one.
 */
export interface ConfigEdit {
  path: string;
  op: 'set' | 'append' | 'merge' | 'remove';
  key: string;
  value?: unknown;
}

/** What a config edit changed (P-152 step 2). */
export interface ConfigEditResult {
  path: string;
  /** File content before the edit. */
  before: string;
  /** File content after the edit. */
  after: string;
  /** Unified diff (P-217 renders this in the web DiffViewer). */
  diff: string;
  op: ConfigEdit['op'];
  key: string;
}

/** Formats `edit_config` can parse, keyed by the extension that selects it. */
export type ConfigFormat = 'json' | 'jsonc' | 'toml' | 'yaml' | 'env' | 'ini';

// ---------------------------------------------------------------------------
// P-153 — file move
// ---------------------------------------------------------------------------

/** One relative-import reference that a move invalidates. */
export interface ImportRewrite {
  /** Repo-relative path of the file whose import must change. */
  file: string;
  /** The specifier as written today, e.g. `./util/format`. */
  oldRef: string;
  /** The specifier it must become, e.g. `../shared/format`. */
  newRef: string;
}

/**
 * A planned relocation of one staged file (P-153).
 *
 * Planning and execution are deliberately separate: `planMove` performs every
 * check and computes every rewrite without writing anything, so a dry run is
 * the *same code path* as a real plan rather than a parallel implementation
 * that can drift.
 */
export interface MovePlan {
  /** Repo-relative source path. */
  from: string;
  /** Repo-relative destination path. */
  to: string;
  /** When true, `executeMove` is a no-op and nothing is written. */
  dryRun?: boolean;
  importRewrites: ImportRewrite[];
}

// ---------------------------------------------------------------------------
// P-161 - undo a tool action
// ---------------------------------------------------------------------------

/** The kinds of mutation the undo stack knows how to reverse. */
export type UndoKind =
  'file_write' | 'file_move' | 'config_edit' | 'dep_fix' | 'manifest' | 'proposal_apply';

/**
 * One file's content before a tool touched it.
 *
 * `content: null` means **the file did not exist**. That case is the whole
 * reason this is a list of snapshots rather than a string: reverting a file a
 * tool *created* means deleting it, and a plain before-string cannot express
 * "there was nothing there".
 */
export interface FileSnapshot {
  path: string;
  content: string | null;
}

/** A reversible record of one tool action (P-161). */
export interface UndoRecord {
  id: string;
  ts: string;
  /** The tool that produced the change. */
  tool: string;
  kind: UndoKind;
  /**
   * The before-state, shaped by `kind`:
   * - `file_write` / `config_edit` / `manifest` / `dep_fix`: `FileSnapshot[]`
   * - `file_move`: `{ from: string; to: string }`
   * - `proposal_apply`: `FileSnapshot[]` for the *appended-to* file only (the
   *   created files are reverted by deletion and need no snapshot)
   */
  before: unknown;
  /** The after-state, for reporting. Never used to perform the revert. */
  after: unknown;
  /** Every path the action touched, for reporting and dry runs. */
  paths: string[];
  /**
   * The import rewrites a `file_move` performed, so the revert can invert them.
   *
   * The spec's `UndoRecord` has only `{before, after}`, which cannot express
   * this: a move rewrites third-party files too, and inverting those is half
   * the work of undoing the move. Recorded in ADR-034.
   */
  importRewrites?: ImportRewrite[];
}

// ---------------------------------------------------------------------------
// P-154 - gated component proposal
// ---------------------------------------------------------------------------

/**
 * A drafted, NOT-yet-written component awaiting human approval (P-154).
 *
 * The field set is deliberately stable: P-160's HIL queue and P-218's
 * web Approve/Reject gate serialize this object directly, so renaming or
 * reordering a field is a breaking change for both.
 */
export interface ComponentProposal {
  /** PascalCase component or camelCase module name. */
  name: string;
  /** Repo-relative path the component would be written to. */
  path: string;
  /** One-line description for the approval list. */
  summary: string;
  /** The drafted source. */
  code: string;
  /** The drafted sibling test. */
  tests: string;
  /** A barrel/registration edit the component needs, when one applies. */
  registration?: { file: string; snippet: string };
  /** Why this component is needed, shown to the approver. */
  rationale: string;
  /** Repo-relative path the sibling test would be written to. */
  testPath: string;
}

/** What the model asks for when drafting a component. */
export interface ComponentSpec {
  name: string;
  language: 'typescript' | 'javascript' | 'python';
  framework: 'none' | 'react';
  /** One sentence describing what the component should do. */
  purpose: string;
  /** Directory the component belongs in, optionally stage-root-prefixed. */
  targetDir: string;
}

// ---------------------------------------------------------------------------
// P-155 — sandbox build verification
// ---------------------------------------------------------------------------

/** The outcome of one sandbox build+test verification (P-155). */
export interface BuildOutcome {
  /**
   * Whether the stage is buildable.
   *
   * `pass` is true when the build step succeeded AND at least one test run
   * succeeded (see `flaky`). A backend that never ran produces
   * `SANDBOX_UNAVAILABLE` rather than `pass: false`, so the loop never mistakes
   * "no verdict" for "failing verdict".
   */
  pass: boolean;
  /** The combined build+test command line that was executed. */
  command: string;
  exitCode: number;
  durationMs: number;
  /** Captured output, bounded to the last `MAX_BUILD_LOG_LINES` lines. */
  logs: { stdout: string[]; stderr: string[] };
  /**
   * True when repeated test runs disagreed. P-176 repeat detection, kept so
   * the loop does not iterate forever against a flaky suite (ties to
   * P-176/P-267).
   */
  flaky: boolean;
  /** Which ecosystem's commands were selected. */
  ecosystem: BuildEcosystem;
  /** Backend that executed the run, for the UI/audit trail. */
  backend: 'docker' | 'github-actions';
}

/** Ecosystems `run_build` knows how to verify. */
export type BuildEcosystem = 'node' | 'python' | 'rust' | 'go';

/** The commands `run_build` should run for a stage. */
export interface BuildCmd {
  ecosystem: BuildEcosystem;
  /** Override the ecosystem's build command. */
  build?: string;
  /** Override the ecosystem's test command. */
  test?: string;
}

/**
 * Hard cap on retained log lines per stream.
 *
 * P-155 mandates bounded logs ("e.g. last 500 lines"). Keeping only the tail
 * matters: a failing `bun run build` can emit thousands of lines, and an
 * unbounded array would bloat both the tool result the model reads and the
 * audit row.
 */
export const MAX_BUILD_LOG_LINES = 500;

// ---------------------------------------------------------------------------
// P-156 — ask_user
// ---------------------------------------------------------------------------

/**
 * A structured question for the human (P-156).
 *
 * Field set is serialisation-stable: P-160's HIL queue and P-218's web gate
 * both round-trip it, so renaming a field breaks both.
 *
 * Satisfies `HumanQuestion` in the `ai` contract module structurally, so the
 * agent layer and the injected responder share one runtime shape without an
 * import cycle.
 */
export interface UserQuestion {
  id: string;
  prompt: string;
  /** Fixed choices. When present, a non-free-form answer must be one of them. */
  options?: string[];
  /** Pre-selected answer used when the human accepts the default. */
  defaultValue?: string;
  /** Allow the human to type a value not in `options`. */
  freeForm?: boolean;
}

/** The human's reply to a `UserQuestion` (P-156). */
export interface UserAnswer {
  /** The `UserQuestion.id` this answers. */
  id: string;
  value: string;
  /** ISO timestamp of the reply. */
  ts: string;
  /** True when the value came from free-form text rather than a picked option. */
  freeForm: boolean;
}

/**
 * Default bound on waiting for a human (P-156 step 4).
 *
 * A gated agent loop must not block forever: an unanswered question has to
 * become a terminal outcome so the loop can decide to stop rather than spin.
 */
export const DEFAULT_MAX_ASK_TIMEOUT_MS = 120_000;

// ---------------------------------------------------------------------------
// P-157 — autonomy policy
// ---------------------------------------------------------------------------

/**
 * The autonomy mode of a single tool.
 *
 * NAMING NOTE: P-009's `config/schema.ts` already exports an `Autonomy` type,
 * but it is the `[agent]` **config block** (`{ auto: string[]; gated: string[] }`)
 * — a different concept from this per-tool mode. Both are public, so the
 * config one keeps the plain name and this one is re-exported from
 * `@repo-stitcher/core` as `ToolAutonomy` (the same disambiguation the barrel
 * already applies to `LicensePolicy` / `LicenseCompliancePolicy`).
 */
export type Autonomy = 'auto' | 'gated';

/** Per-tool override of the effective autonomy mode (P-157). */
export interface AutonomyOverride {
  tool: string;
  mode: Autonomy;
}

/** What the policy decided about one tool execution (P-157). */
export interface PolicyDecision {
  /** `allow` runs it, `ask` routes to the HIL queue, `deny` never runs it. */
  action: 'allow' | 'ask' | 'deny';
  /** Human-readable justification, logged to the audit trail. */
  reason: string;
}

/** Configuration for {@link AutonomyPolicy} (P-157). */
export interface AutonomyPolicyConfig {
  /** Per-tool overrides, applied before the tool's own flag. */
  overrides: AutonomyOverride[];
  /** Mode for tools with no flag and no override. Conservative by default. */
  defaultMode: Autonomy;
  /** Tools that must never run, whatever any other flag says. */
  denyTools: string[];
}
