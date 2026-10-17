// P-197 — `stitch deps`: preview the dependency merge before a full stitch.
//
// The command runs the deps pipeline (P-104–P-116) over the selected sources —
// detect + parse each selection's manifests (P-103–P-107), union per ecosystem
// (P-108; the version/peer/scripts resolvers P-109/P-110/P-111 run inside the
// merge), then build and render the `DependencyReport` (P-116) — so the user
// can inspect and approve conflict resolutions before P-192/P-205 consume them.
//
// The command is pure ORCHESTRATION; every heavy edge is an injected port
// (the `license.ts` injection model):
//
//   resolveSource — a local dir as-is, or a shallow clone for `owner/repo` (P-069)
//   loadManifests — detect + parse the manifests under one resolved dir
//   prompt        — the interactive resolution question (fake in tests)
//   runLockfile   — the --lockfile regeneration flow (fake in tests)
//   store         — the durable user config (~/.stitch/config.json, P-200)
//
// Deviations and seams, recorded as ADR-082:
//   1. The union runs PER ECOSYSTEM GROUP. `unionManifests` refuses
//      mixed-ecosystem input (ECOSYSTEM_MISMATCH) by design, and a selection
//      set can legitimately carry an npm repo and a python repo; each group
//      becomes its own DependencyReport section. `--json` emits the plain
//      report for a single group and an ARRAY of reports for several.
//   2. ONE MANIFEST PER SELECTION AND ECOSYSTEM: the root-most (shortest
//      path, ties broken lexicographically). A repo's workspace-internal
//      package.json files describe the child's own layout, not competing
//      sources — feeding them into a merge whose source labels are
//      positional (`repo-a`, `repo-b`…) would fabricate conflicts.
//   3. The python parser's argument order is `(filePath, content)` — the
//      opposite of every sibling. Verified against core's own dispatcher in
//      `agent/depsLicenseFacade.ts` (not assumed).
//   4. Resolutions persist in the StitchStore as `depResolutions` (validated
//      `{package, resolution}` entries, merged by package). The spec says
//      "persist to config"; no TOML writer exists (ADR-076), and the store
//      is already the CLI's durable surface (the P-196 precedent). P-192's
//      merge wiring should read these to pre-answer its own prompts.
//   5. `--auto` applies each conflict's `suggestedResolution` (the P-151
//      auto-fix input) and persists the ones not already recorded. A
//      needs-attention conflict (severity `error`, no suggestion) has no
//      automatic fix — the run renders everything and THEN fails typed:
//      `DEPENDENCY_CONFLICT` (print-then-fail, the doctor precedent).
//   6. `--lockfile` materializes the merged manifest in a scratch dir (the
//      package manager needs an on-disk package.json to lock against) and
//      runs core's `regenerateLockfile` there; the scratch dir is removed
//      afterwards. In tests the whole flow is a stub.
//   7. A failed lockfile generation is an environment problem, not a data
//      problem: the report keeps its lockfile section null, a WARN note is
//      rendered, and `mergeable` honestly stays false. The exit code is
//      governed by the conflicts, not by the registry.
//   8. Unresolvable conflicts fail the RUN (exit 1) but never truncate the
//      output — "exit codes reflect unresolvable conflicts" while the user
//      still sees the full report they were asked to review.

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { err, ok, type Result } from 'neverthrow';
import {
  detectEcosystems,
  friendlyError,
  generateDepReport,
  parseCargoToml,
  parseGoMod,
  parsePackageJson,
  parsePythonManifest,
  regenerateLockfile,
  renderReportJson,
  serializePackageJson,
  unionManifests,
  type DependencyReport,
  type DetectedEcosystem,
  type LockfileResult,
  type NpmManifest,
  type ParsedManifest,
  type StitchError,
  type UnifiedManifest,
} from '@repo-stitcher/core';
import type { GlobalOptions } from '../globals.js';
import { readSources, type JsonValue, type StitchStore } from '../config.js';
import type { ThemeLevel } from '../theme.js';
import { theme } from '../theme.js';
import { looksRemote, type SourceSelection } from './add.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Options the commander action hands in: the globals plus the P-197 flags. */
export interface DepsOptions extends GlobalOptions {
  /** `--json`: emit the DependencyReport (an array of them — one per ecosystem). */
  json?: boolean;
  /** `--auto`: apply the resolver's suggestion to every fixable conflict. */
  auto?: boolean;
  /** `--lockfile`: regenerate the ecosystem lockfile for the merged manifest. */
  lockfile?: boolean;
}

/** What the prompt port is asked about: one needs-attention conflict. */
export interface DepsPromptContext {
  package: string;
  severity: ConflictShape['severity'];
  /** The positional source labels and specs that compete for the package. */
  values: Record<string, string>;
}

/** The conflict entries inside a DependencyReport (core's `Conflict & …`). */
export type ConflictShape = DependencyReport['conflicts'][number];

/** A resolution the human typed, or null to leave the conflict pending. */
export type DepsPrompt = (ctx: DepsPromptContext) => Promise<string | null>;

/** One persisted resolution (a `depResolutions` entry). */
export interface PersistedDepResolution {
  package: string;
  resolution: string;
}

/** The merged-manifest lockfile flow (`--lockfile`). Default: scratch dir + core. */
export type RunLockfile = (
  manifest: UnifiedManifest,
  opts: { offline: boolean }
) => Promise<Result<LockfileResult, StitchError>>;

/** Everything environmental, injected. Defaults are the real edges. */
export interface DepsDeps {
  /** The user config store. Absent = report only (writes become errors). */
  store?: StitchStore;
  /** Local dir → itself; `owner/repo` → a shallow clone path (shared with add). */
  resolveSource?: (
    source: string,
    opts: { ref?: string; offline: boolean }
  ) => Promise<Result<string, StitchError>>;
  /** Detect + parse the manifests under a resolved dir. Default: the real loader. */
  loadManifests?: (dir: string) => Promise<Result<ParsedManifest[], StitchError>>;
  /** The interactive decision port. Absent = never prompts. */
  prompt?: DepsPrompt;
  /** The --lockfile flow. Default: scratch package.json + core's runner. */
  runLockfile?: RunLockfile;
  /** Where the human-readable output goes. */
  write?: (line: string) => void;
}

// ---------------------------------------------------------------------------
// Store reads/writes (validated entry by entry — the readSources precedent)
// ---------------------------------------------------------------------------

const RESOLUTIONS_KEY = 'depResolutions';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * readDepResolutions: the stored human resolutions, invalid entries dropped
 * rather than trusted (the store is a JSON file a user can edit).
 */
export function readDepResolutions(store: StitchStore): PersistedDepResolution[] {
  const read = store.get(RESOLUTIONS_KEY);
  if (read.isErr() || !Array.isArray(read.value)) return [];
  const out: PersistedDepResolution[] = [];
  for (const entry of read.value) {
    if (!isRecord(entry)) continue;
    const pk = entry['package'];
    const resolution = entry['resolution'];
    if (typeof pk !== 'string' || typeof resolution !== 'string') continue;
    if (pk.trim().length === 0 || resolution.trim().length === 0) continue;
    out.push({ package: pk, resolution });
  }
  return out;
}

/**
 * saveDepResolutions: merge additions over existing resolutions, keyed by
 * package (a re-recorded package replaces the earlier resolution).
 */
export function saveDepResolutions(
  store: StitchStore,
  existing: readonly PersistedDepResolution[],
  additions: readonly PersistedDepResolution[]
): Result<void, StitchError> {
  const merged = new Map<string, PersistedDepResolution>();
  for (const entry of existing) merged.set(entry.package, entry);
  for (const entry of additions) merged.set(entry.package, entry);
  return store.set(RESOLUTIONS_KEY, [...merged.values()] as unknown as JsonValue);
}

// ---------------------------------------------------------------------------
// The default loader (the real detect + parse edges)
// ---------------------------------------------------------------------------

/** The barrel's own dispatch, replicated verbatim (ADR-082 point 3 in play). */
function parseDetected(
  parser: DetectedEcosystem['parser'],
  content: string,
  path: string
): Result<ParsedManifest, StitchError> {
  switch (parser) {
    case 'npm':
      return parsePackageJson(content, path);
    case 'python':
      // P-105's dispatcher takes (filePath, content) — the opposite order to
      // its siblings (verified against deps/parse/python.ts, not assumed).
      return parsePythonManifest(path, content);
    case 'cargo':
      return parseCargoToml(content, path);
    case 'gomod':
      return parseGoMod(content, path);
  }
}

/**
 * pickRootMost: the shortest manifest path per ecosystem tag wins; ties fall
 * to the lexicographically smaller path (deterministic on every platform).
 * A repo's workspace-internal manifests stay out of the union (ADR-082 pt 2).
 */
export function pickRootMost(manifests: readonly ParsedManifest[]): ParsedManifest[] {
  const byEcosystem = new Map<string, ParsedManifest>();
  for (const entry of manifests) {
    const current = byEcosystem.get(entry.ecosystem);
    if (
      current === undefined ||
      entry.path.length < current.path.length ||
      (entry.path.length === current.path.length && entry.path < current.path)
    ) {
      byEcosystem.set(entry.ecosystem, entry);
    }
  }
  return [...byEcosystem.values()];
}

/**
 * loadManifests: detect the ecosystems under a resolved dir and parse the
 * root-most manifest of each. An unparseable manifest is skipped, not fatal
 * (a listing may contain files the parser cannot own yet); a fully empty
 * selection yields `[]` — the caller turns that into a skip note.
 */
export const defaultLoadManifests: NonNullable<DepsDeps['loadManifests']> = async dir => {
  if (existsSync(dir) === false) {
    return err({
      code: 'CONFIG_ERROR',
      field: 'source',
      message: `deps: resolved source does not exist: ${dir}`,
    });
  }
  const detected = await detectEcosystems(dir);
  if (detected.isErr()) return err(detected.error);
  const manifests: ParsedManifest[] = [];
  for (const entry of detected.value) {
    if (existsSync(entry.manifestPath) === false) continue;
    const content = readFileSync(entry.manifestPath, 'utf8');
    const parsed = parseDetected(entry.parser, content, entry.manifestPath);
    if (parsed.isErr()) continue;
    manifests.push(parsed.value);
  }
  return ok(pickRootMost(manifests));
};

// ---------------------------------------------------------------------------
// Conflict classification and display stamping
// ---------------------------------------------------------------------------

/** Decided or repairable; needs a human; advisory only. */
export type ConflictVerdict = 'resolved' | 'attention' | 'warning';

/** The status core's P-116 assigns: suggestion present → auto; else severity. */
export function classifyConflict(
  conflict: Pick<ConflictShape, 'suggestedResolution' | 'severity'>
): ConflictVerdict {
  if (conflict.suggestedResolution !== undefined && conflict.suggestedResolution.length > 0) {
    return 'resolved';
  }
  return conflict.severity === 'error' ? 'attention' : 'warning';
}

/**
 * stampResolvedConflicts: project the final decisions onto the report's
 * conflict entries (the merge, not this preview, consumes them) — the display
 * layer, exactly like `stampUnknownDecisions` in P-196. The returned report
 * is a shallow copy; nothing core built is mutated. The summary is RECOMPUTED
 * because core's own was computed before any decision existed: a conflict the
 * human resolved is no longer needs-attention, and `mergeable` follows.
 */
export function stampResolvedConflicts(
  report: DependencyReport,
  resolved: ReadonlyMap<string, string>
): DependencyReport {
  const conflicts = report.conflicts.map(conflict => {
    const resolution = resolved.get(conflict.package);
    return resolution === undefined
      ? conflict
      : { ...conflict, status: 'auto-resolved' as const, resolution };
  });
  const needsHuman = conflicts.some(conflict => conflict.status === 'needs-attention');
  const blockedBy = conflicts
    .filter(conflict => conflict.status === 'needs-attention')
    .map(conflict => conflict.package);
  return {
    ...report,
    conflicts,
    summary: {
      mergeable: !needsHuman && report.lockfile?.status === 'generated',
      needsHuman,
      blockedBy,
    },
  };
}

/**
 * attentionConflicts: the conflicts still needing a human after decisions
 * have been applied. Runs on a STAMPED report: a decided conflict reads
 * `auto-resolved`, so only no-decision error conflicts remain — and the
 * resolved map is checked again for runs where stamping did not happen.
 */
export function attentionConflicts(
  report: DependencyReport,
  resolved: ReadonlyMap<string, string>
): ConflictShape[] {
  return report.conflicts.filter(
    conflict => conflict.status === 'needs-attention' && resolved.has(conflict.package) === false
  );
}

// ---------------------------------------------------------------------------
// The default --lockfile flow: scratch dir + core's regenerateLockfile
// ---------------------------------------------------------------------------

function isNpmShape(manifest: UnifiedManifest): boolean {
  return 'dependencies' in manifest && typeof manifest.dependencies === 'object';
}

/**
 * defaultRunLockfile: write the merged manifest into a fresh scratch dir so
 * the package manager locks against IT (not against whatever package.json
 * happens to sit in a source tree), regenerate, clean up.
 */
// shortcut: only npm manifests can be scratched (no serializer is exported for
// python/cargo/go manifests); upgrade when the barrel surface grows one.
export const defaultRunLockfile: RunLockfile = async (manifest, opts) => {
  if (isNpmShape(manifest) === false) {
    return err({
      code: 'CONFIG_ERROR',
      field: 'ecosystem',
      message:
        'deps: --lockfile today only materializes npm manifests' +
        ' (the other ecosystems lack a serializer in the public API)',
    });
  }
  const scratch = mkdtempSync(join(tmpdir(), 'stitch-lock-'));
  try {
    writeFileSync(
      join(scratch, 'package.json'),
      serializePackageJson(manifest as unknown as NpmManifest)
    );
    return await regenerateLockfile(manifest, scratch, { allowNetwork: opts.offline === false });
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
};

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/** The paint used by the report (plain when `--no-color`). */
type Paint = (level: ThemeLevel, text: string) => string;

function tableWidths(rows: readonly (readonly string[])[]): number[] {
  return rows.reduce<number[]>((widths, row) => {
    for (let i = 0; i < row.length; i += 1) {
      widths[i] = Math.max(widths[i] ?? 0, row[i]?.length ?? 0);
    }
    return widths;
  }, []);
}

/** The conflicts table: the phase's exact four columns. */
export function renderConflictsTable(conflicts: readonly ConflictShape[]): string[] {
  const cells: string[][] = [
    ['package', 'severity', 'resolution', 'status'],
    ...conflicts.map(conflict => [
      conflict.package,
      conflict.severity,
      conflict.resolution ?? conflict.suggestedResolution ?? '—',
      conflict.status,
    ]),
  ];
  const widths = tableWidths(cells);
  return cells.map(row =>
    row
      .map((value, index) => value.padEnd(widths[index] ?? 0, ' '))
      .join('  ')
      .trimEnd()
  );
}

/** One merged-manifest section as `label (count): pkg@range, …` lines. */
export function renderMergedSections(merged: UnifiedManifest): string[] {
  const sections: string[] = [];
  const map = merged as unknown as Record<string, unknown>;
  // npm sections plus the python/go `require` and go `indirect` shapes.
  for (const label of [
    'dependencies',
    'devDependencies',
    'peerDependencies',
    'optionalDependencies',
    'overrides',
    'require',
    'indirect',
  ]) {
    const value = map[label];
    if (typeof value !== 'object' || value === null) continue;
    const entries = Object.entries(value as Record<string, unknown>).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string'
    );
    if (entries.length === 0) continue;
    sections.push(
      `  ${label} (${String(entries.length)}): ${entries
        .map(([n, spec]) => `${n}@${spec}`)
        .join(', ')}`
    );
  }
  return sections;
}

/** Per-report metadata the text render needs beside the numbers. */
export interface DepRenderMetadata {
  sources: string[];
  skippedNoManifest: string[];
  storeNote?: string;
  lockNote?: string;
  decisionsRecorded: number;
  auto: boolean;
}

/** The full text render for ONE ecosystem group; the caller writes them. */
export function renderDepReport(
  report: DependencyReport,
  metadata: DepRenderMetadata,
  paint: Paint
): string[] {
  const lines: string[] = [
    'stitch deps',
    metadata.storeNote !== undefined ? `config store: ${metadata.storeNote}` : 'config store: ok',
    `sources: ${String(metadata.sources.length)}${
      metadata.sources.length > 0 ? ` — ${metadata.sources.join(', ')}` : ''
    }${
      metadata.skippedNoManifest.length > 0
        ? ` (skipped, no manifests: ${metadata.skippedNoManifest.join(', ')})`
        : ''
    }`,
    `ecosystem: ${report.ecosystem}`,
    `dependencies: direct ${String(report.dependencyCount.direct)}, dev ${String(
      report.dependencyCount.dev
    )}, peer ${String(report.dependencyCount.peer)} (total ${String(
      report.dependencyCount.total
    )})`,
    'merged manifest:',
    ...renderMergedSections(report.merged),
  ];

  const conflicts = report.conflicts;
  lines.push(`conflicts (${String(conflicts.length)}):`);
  if (conflicts.length > 0) {
    lines.push(...renderConflictsTable(conflicts));
    for (const conflict of conflicts) {
      if (report.summary.blockedBy.includes(conflict.package) === false) continue;
      const values = Object.entries(conflict.values)
        .map(([label, spec]) => `${label} wanted ${spec}`)
        .join('; ');
      lines.push(`  needs a resolution: ${values} — answer the prompt, pass --auto, or`);
      lines.push('  record it in the store (depResolutions) for the merge to consume.');
    }
  }

  const dedupes = conflicts.filter(c => c.dedupeStrategy !== undefined);
  lines.push(`dedupe notes (${String(dedupes.length)}):`);
  for (const conflict of dedupes) {
    lines.push(`  - ${conflict.package}: ${conflict.dedupeStrategy}`);
  }

  const collisions = report.scripts.collisions;
  lines.push(
    `scripts: ${String(Object.keys(report.scripts.merged).length)} merged, ${String(
      collisions.length
    )} collisions`
  );

  if (report.lockfile === null) {
    lines.push(
      metadata.lockNote !== undefined ? `lockfile: ${metadata.lockNote}` : 'lockfile: not requested'
    );
  } else if (report.lockfile.status === 'generated') {
    lines.push(`lockfile: generated (${report.lockfile.path} via ${report.lockfile.command})`);
  } else {
    lines.push(`lockfile: failed (${report.lockfile.error ?? 'unknown error'})`);
  }
  if (metadata.decisionsRecorded > 0) {
    lines.push(`resolutions recorded: ${String(metadata.decisionsRecorded)}`);
  }
  if (metadata.auto) {
    lines.push('auto mode: applied the resolver\u2019s suggestion to every fixable conflict');
  }
  lines.push(
    report.summary.mergeable
      ? `mergeable: ${paint('ok', 'yes')}`
      : report.summary.needsHuman
        ? `mergeable: ${paint('err', 'no')} — needs a human: ${report.summary.blockedBy.join(', ')}`
        : `mergeable: ${paint('warn', 'no')}${
            report.lockfile === null ? ' — no lockfile generated' : ''
          }`
  );
  return lines;
}

// ---------------------------------------------------------------------------
// The command
// ---------------------------------------------------------------------------

interface GroupPipeline {
  ecosystem: string;
  result: import('@repo-stitcher/core').DepsMergeResult;
  sources: string[];
  inputSources: { repoName: string; manifestPath: string }[];
}

/**
 * deps: run the deps pipeline over the current selection, collect resolution
 * decisions, and render or emit JSON. Never throws; every failure is a typed
 * `StitchError`.
 */
export async function deps(
  opts: DepsOptions,
  depsIn: DepsDeps = {}
): Promise<Result<void, StitchError>> {
  const write = depsIn.write ?? ((line: string): void => void process.stdout.write(`${line}\n`));
  const paint: Paint =
    opts.color === false ? (_level, text) => text : (level, text) => theme(level, text);

  // 1. Sources. A missing store degrades to an empty selection with a note
  //    (the status precedent), but EVERY write path requires the store.
  const store = depsIn.store;
  let sources: SourceSelection[] = [];
  let storeNote: string | undefined;
  if (store === undefined) {
    storeNote = 'unavailable (resolutions cannot persist)';
  } else {
    const read = readSources(store.get('sources'));
    if (read.isErr()) return err(read.error);
    sources = read.value;
  }

  // 2. Resolve + load each selection. A selection with no manifests is
  //    skipped with a note (nothing to merge from it), not an error.
  const loadFn = depsIn.loadManifests ?? defaultLoadManifests;
  const resolveFn: DepsDeps['resolveSource'] =
    depsIn.resolveSource ?? (async (source: string) => ok(source));
  const groups = new Map<string, ParsedManifest[]>();
  const selectionOf = new Map<ParsedManifest, string>();
  const skippedNoManifest: string[] = [];
  for (const selection of sources) {
    // `--offline` is local-only: a remote source needs the network by
    // definition (the same rule the add command applies).
    if (opts.offline === true && looksRemote(selection.source)) {
      return err({
        code: 'CONFIG_ERROR',
        field: 'source',
        message: `deps: refused to clone "${selection.source}" while --offline`,
      });
    }
    // The resolve port is caller code — a rejection must never escape.
    let resolvedDir: Result<string, StitchError>;
    try {
      resolvedDir = await resolveFn(selection.source, {
        ...(selection.ref !== undefined ? { ref: selection.ref } : {}),
        offline: opts.offline === true,
      });
    } catch (cause: unknown) {
      return err({
        code: 'CONFIG_ERROR',
        field: 'source',
        message: `deps: resolving "${selection.source}" failed: ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
      });
    }
    if (resolvedDir.isErr()) return err(resolvedDir.error);

    const loaded = await loadFn(resolvedDir.value);
    if (loaded.isErr()) return err(loaded.error);
    if (loaded.value.length === 0) {
      skippedNoManifest.push(selection.source);
      continue;
    }
    for (const manifest of loaded.value) {
      selectionOf.set(manifest, selection.source);
      const bucket = groups.get(manifest.ecosystem) ?? [];
      bucket.push(manifest);
      groups.set(manifest.ecosystem, bucket);
    }
  }

  if (groups.size === 0) {
    if (opts.json === true) {
      // Zero groups is the natural empty case of the multi-ecosystem array shape.
      write(JSON.stringify([], null, 2));
      return ok(undefined);
    }
    write('stitch deps');
    write(
      storeNote !== undefined
        ? `config store: ${storeNote}`
        : `sources: ${String(sources.length)}${
            skippedNoManifest.length > 0
              ? ` (skipped, no manifests: ${skippedNoManifest.join(', ')})`
              : ''
          }`
    );
    write('nothing to merge — record sources with `stitch add` first');
    return ok(undefined);
  }

  // 3. Union + report PER ECOSYSTEM GROUP (the union refuses mixed groups by
  //    design; each group becomes its own report, sorted by ecosystem name).
  const pipelines: GroupPipeline[] = [];
  for (const [ecosystem, manifests] of [...groups.entries()].sort((a, b) =>
    a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0
  )) {
    const unioned = unionManifests(manifests);
    if (unioned.isErr()) return err(unioned.error);
    const inputSources: { repoName: string; manifestPath: string }[] = [];
    for (const manifest of manifests) {
      const source = selectionOf.get(manifest);
      if (source === undefined) continue;
      inputSources.push({ repoName: source, manifestPath: manifest.path });
    }
    pipelines.push({
      ecosystem,
      result: unioned.value,
      sources: [...new Set(inputSources.map(entry => entry.repoName))],
      inputSources,
    });
  }

  // 4. Lockfile (flagged runs only): one regeneration per group.
  const runLockfile = depsIn.runLockfile ?? defaultRunLockfile;
  const lockResults = new Map<string, Result<LockfileResult, StitchError>>();
  if (opts.lockfile === true) {
    for (const pipeline of pipelines) {
      lockResults.set(
        pipeline.ecosystem,
        await runLockfile(pipeline.result.merged, { offline: opts.offline === true })
      );
    }
  }

  // 5. Decisions: stored resolutions first, then --auto, then prompts. A
  //    stored resolution covers its package in every later path.
  const stored = store === undefined ? [] : readDepResolutions(store);
  const resolved = new Map<string, string>();
  for (const entry of stored) resolved.set(entry.package, entry.resolution);
  const additions: PersistedDepResolution[] = [];

  if (opts.auto === true) {
    for (const pipeline of pipelines) {
      for (const conflict of pipeline.result.conflicts) {
        if (resolved.has(conflict.package)) continue;
        const suggestion = conflict.suggestedResolution;
        if (suggestion === undefined || suggestion.length === 0) continue;
        resolved.set(conflict.package, suggestion);
        additions.push({ package: conflict.package, resolution: suggestion });
      }
    }
  } else if (depsIn.prompt !== undefined) {
    for (const pipeline of pipelines) {
      for (const conflict of pipeline.result.conflicts) {
        if (classifyConflict(conflict) !== 'attention') continue;
        if (resolved.has(conflict.package)) continue;
        let answer: string | null;
        try {
          answer = await depsIn.prompt({
            package: conflict.package,
            severity: conflict.severity,
            values: conflict.values,
          });
        } catch {
          // A broken prompt surface degrades to pending, never throws outward.
          answer = null;
        }
        if (answer === null || answer.trim().length === 0) continue;
        const trimmed = answer.trim();
        resolved.set(conflict.package, trimmed);
        additions.push({ package: conflict.package, resolution: trimmed });
      }
    }
  }

  if (additions.length > 0) {
    if (store === undefined) {
      return err({
        code: 'CONFIG_ERROR',
        field: RESOLUTIONS_KEY,
        message: 'deps: resolutions were chosen but there is no config store to persist them',
      });
    }
    const saved = saveDepResolutions(store, stored, additions);
    if (saved.isErr()) return err(saved.error);
  }

  // 6. Build each group's report, then stamp the final resolutions on the
  //    display copies (the merge consumes the store, not the preview).
  const reports: { report: DependencyReport; metadata: DepRenderMetadata }[] = [];
  for (const pipeline of pipelines) {
    const lockResult = lockResults.get(pipeline.ecosystem);
    let lockPayload: LockfileResult | null = null;
    let lockNote: string | undefined;
    if (lockResult !== undefined) {
      if (lockResult.isOk()) {
        lockPayload = lockResult.value;
      } else {
        const message = lockResult.error as { message?: string };
        lockNote = `generation failed: ${
          typeof message.message === 'string' ? message.message : friendlyError(lockResult.error)
        }`;
      }
    }
    const report = generateDepReport(pipeline.result, lockPayload, pipeline.inputSources);
    reports.push({
      report: stampResolvedConflicts(report, resolved),
      metadata: {
        sources: pipeline.sources,
        skippedNoManifest,
        ...(storeNote !== undefined ? { storeNote } : {}),
        ...(lockNote !== undefined ? { lockNote } : {}),
        decisionsRecorded: additions.length,
        auto: opts.auto === true,
      },
    });
  }

  // 7. Render: JSON is the report (one, or an array across ecosystems); text
  //    is one section per ecosystem group. THEN the unresolvable verdict.
  if (opts.json === true) {
    if (reports.length === 1) {
      write(renderReportJson(reports[0]!.report));
    } else {
      const sorted = reports.map(entry => JSON.parse(renderReportJson(entry.report)) as unknown);
      write(JSON.stringify(sorted, null, 2));
    }
  } else {
    for (const entry of reports) {
      for (const line of renderDepReport(entry.report, entry.metadata, paint)) write(line);
    }
  }

  const unresolvable = reports.flatMap(entry => attentionConflicts(entry.report, resolved));
  if (unresolvable.length > 0) {
    return err({
      code: 'DEPENDENCY_CONFLICT',
      packages: [...new Set(unresolvable.map(conflict => conflict.package))],
      details:
        `${String(unresolvable.length)} conflict(s) cannot be resolved automatically — ` +
        'answer the prompt without --auto, or record resolutions in the store.',
    });
  }
  return ok(undefined);
}
