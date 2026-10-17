// P-196 — `stitch license`: inspect and act on the license posture of the
// current selection (P-118–P-128), recording human decisions for unknown
// licenses so the merge gate (P-192/P-205) can honor them.
//
// The command is pure ORCHESTRATION; every heavy edge is an injected port
// (the `status.ts`/`add.ts` injection model):
//
//   resolveSource — a local dir as-is, or a shallow clone for `owner/repo` (P-069)
//   scan          — the declared-license scan (core's `scanDeclared`, P-118)
//   prompt        — the interactive allow/deny/skip question (fake in tests)
//   store         — the durable user config (~/.stitch/config.json, P-200)
//
// Deps input: each recorded source is resolved to a directory and scanned for
// installed packages. A source without `node_modules/` is skipped with a note
// (no installed deps = no licenses to report; scanning it would degrade into a
// whole-tree package.json walk). When nothing is selected, the command renders
// an empty posture and its verdict comes out of the empty matrix — nothing to
// block on.
//
// Deviations and seams, recorded as ADR-081:
//   1. The barrel does not export `buildLicenseReportData` /
//      `LicenseReportData` / `LicenseReportRow` / `evaluatePolicy`
//      (verified against packages/core/src/index.ts, which carries foreign
//      uncommitted edits the CLI lane must not extend). The P-128 row
//      projection below mirrors core's `license/report.ts` locally, typed
//      against the exported `LicenseReport`/`UnknownLicense`/`DualDecision`/
//      `GplWarning`/`LicenseCategory`.
//   2. The override-aware P-127 entry is `createLicenseFacade(...).policy(...)`
//      (the facade's `policy` verb ignores its stage field, while
//      `complianceGate` re-scans its own single stage and the license report
//      aggregators hard-code an empty overrides map). The matrix is composed
//      exactly the way core's own `policy.test.ts` composes it: over ALL
//      normalized ids, unknown ones included; the overrides map carries the
//      human decisions into the real engine.
//   3. Persistence lives in the StitchStore: `licensePolicy` (the config
//      schema's `{allow,warn,deny}` SPDX-id lists) and `licenseDecisions`
//      (per `pkg@version` human decisions for unknown licenses). Nothing
//      writes `stitch.toml` (no TOML writer exists in the repo — ADR-076).
//   4. The interactive prompt is an injected port; the shell wires a readline
//      stand-in (P-198 will bring the Ink surface), so tests drive decisions
//      with fake prompts.
//   5. `--allow`/`--deny` ids are validated (P-119) and recorded, but do not
//      by themselves alter the rendered verdict: the compatibility matrix
//      works on license CATEGORIES (P-120), and mapping id lists onto
//      categories is the deferred policy wiring (P-163). The flags make the
//      decision durable and visible for the merge to consume.
//   6. Row decisions after a human allow show `unknown-resolved` — the record
//      is durable — while the repo verdict still reflects the matrix, which
//      carries the unknown id. Consistent with core's P-127 acceptance list
//      ("Matrix deny → verdict deny regardless of overrides").

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { err, ok, type Result } from 'neverthrow';
import {
  DEFAULT_LICENSE_POLICY,
  LICENSE_CATEGORIES,
  UNKNOWN_LICENSE,
  checkCompatibility,
  checkGpl,
  chooseDualLicense,
  createLicenseFacade,
  detectUnknown,
  normalizeExpression,
  normalizeLicense,
  normalizeToSPDX,
  scanDeclared as realScanDeclared,
  type CompatibilityResult,
  type DeclaredLicense,
  type DualDecision,
  type GplWarning,
  type LicenseCategory,
  type LicenseCompliancePolicy,
  type LicenseReport,
  type ScanDeclaredOptions,
  type StitchError,
  type UnknownLicense,
} from '@repo-stitcher/core';
import type { GlobalOptions } from '../globals.js';
import { readSources, type JsonValue, type StitchStore } from '../config.js';
import type { ThemeLevel } from '../theme.js';
import { theme } from '../theme.js';
import { looksRemote, type SourceSelection } from './add.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Options the commander action hands in: the globals plus the P-196 flags. */
export interface LicenseOptions extends GlobalOptions {
  /** `--json`: emit the full license report data instead of text. */
  json?: boolean;
  /** `--allow <licenseId>`: record an allowed license id (repeatable). */
  allow?: string[];
  /** `--deny <licenseId>`: record a denied license id (repeatable). */
  deny?: string[];
}

/** What the prompt port is asked about: one pending unknown license. */
export interface LicensePromptContext {
  package: string;
  version: string;
  rawLicense: string;
}

/** A human decision for one pending unknown. */
export type LicensePromptResult = 'allow' | 'deny' | 'skip';

/** The interactive decision port (the P-198 surface; faked in tests). */
export type LicensePrompt = (ctx: LicensePromptContext) => Promise<LicensePromptResult>;

/** One persisted unknown-license decision (a `licenseDecisions` entry). */
export interface PersistedLicenseDecision {
  package: string;
  version: string;
  decision: 'allow' | 'deny';
}

/** The `licensePolicy` lists the store persists (config schema shape). */
export interface StoreLicensePolicy {
  allow: string[];
  warn: string[];
  deny: string[];
}

/**
 * The P-127 aggregate fields, typed from the exported component types. Core
 * keeps the exact interface unexported (the floor alias would collide with
 * the compliance engine's internal one), so the CLI structures it and the
 * facade's `policy` verb accepts it.
 */
export interface LicenseEvalFields {
  declared: DeclaredLicense[];
  unknown: UnknownLicense[];
  gplWarnings: GplWarning[];
  matrix: CompatibilityResult;
  dual: DualDecision[];
  deep: null;
}

/** Everything environmental, injected. Defaults are the real edges. */
export interface LicenseDeps {
  /** The user config store. Absent = report only (writes become errors). */
  store?: StitchStore;
  /** Local dir → itself; `owner/repo` → a shallow clone path (shared with add). */
  resolveSource?: (
    source: string,
    opts: { ref?: string; offline: boolean }
  ) => Promise<Result<string, StitchError>>;
  /** The declared-license scanner. Default: core's real `scanDeclared` (P-118). */
  scan?: (
    dir: string,
    options?: ScanDeclaredOptions
  ) => Promise<Result<DeclaredLicense[], StitchError>>;
  /** The override-aware P-127 evaluator. Default: the facade's `policy` verb. */
  evaluate?: (
    fields: LicenseEvalFields,
    policy: LicenseCompliancePolicy,
    overrides: Map<string, 'allow' | 'deny'>
  ) => LicenseReport;
  /** The interactive decision port. Absent = never prompts. */
  prompt?: LicensePrompt;
  /** Where the human-readable output goes. */
  write?: (line: string) => void;
}

// ---------------------------------------------------------------------------
// Store reads/writes (validated entry by entry — the readSources precedent)
// ---------------------------------------------------------------------------

const DECISIONS_KEY = 'licenseDecisions';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function decisionKeyOf(pkg: string, version: string): string {
  return `${pkg}@${version}`;
}

/**
 * readLicenseDecisions: the stored human decisions, invalid entries dropped
 * rather than trusted (the store is a JSON file a user can edit).
 */
export function readLicenseDecisions(store: StitchStore): PersistedLicenseDecision[] {
  const read = store.get(DECISIONS_KEY);
  if (read.isErr() || !Array.isArray(read.value)) return [];
  const decisions: PersistedLicenseDecision[] = [];
  for (const entry of read.value) {
    if (!isRecord(entry)) continue;
    const pkg = entry['package'];
    const version = entry['version'];
    const decision = entry['decision'];
    if (typeof pkg !== 'string' || typeof version !== 'string') continue;
    if (decision !== 'allow' && decision !== 'deny') continue;
    decisions.push({ package: pkg, version, decision });
  }
  return decisions;
}

/**
 * saveLicenseDecisions: merge additions over existing decisions, keyed
 * `pkg@version` (a re-recorded key replaces the earlier decision).
 */
export function saveLicenseDecisions(
  store: StitchStore,
  existing: readonly PersistedLicenseDecision[],
  additions: readonly PersistedLicenseDecision[]
): Result<void, StitchError> {
  const merged = new Map<string, PersistedLicenseDecision>();
  for (const decision of existing) {
    merged.set(decisionKeyOf(decision.package, decision.version), decision);
  }
  for (const decision of additions) {
    merged.set(decisionKeyOf(decision.package, decision.version), decision);
  }
  return store.set(DECISIONS_KEY, [...merged.values()] as unknown as JsonValue);
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string');
}

/** The stored `licensePolicy` id lists (missing keys read as empty arrays). */
export function readLicensePolicy(store: StitchStore): StoreLicensePolicy {
  const read = store.get('licensePolicy');
  if (read.isErr() || !isRecord(read.value)) {
    return { allow: [], warn: [], deny: [] };
  }
  return {
    allow: readStringArray(read.value['allow']),
    warn: readStringArray(read.value['warn']),
    deny: readStringArray(read.value['deny']),
  };
}

function mergeUnique(current: readonly string[], additions?: readonly string[]): string[] {
  if (additions === undefined || additions.length === 0) return [...current];
  return [...new Set([...current, ...additions])];
}

/** Append validated ids to the store's `licensePolicy` lists (dedup, order-stable). */
export function appendLicensePolicyIds(
  store: StitchStore,
  additions: { allow?: string[]; deny?: string[] }
): Result<void, StitchError> {
  const current = readLicensePolicy(store);
  const merged: StoreLicensePolicy = {
    allow: mergeUnique(current.allow, additions.allow),
    warn: current.warn,
    deny: mergeUnique(current.deny, additions.deny),
  };
  return store.set('licensePolicy', merged as unknown as JsonValue);
}

/**
 * normalizeLicenseFlagId: canonicalize one `--allow`/`--deny` argument via
 * P-119 (`normalizeLicense`), rejecting anything that does not resolve to a
 * real SPDX id/expression with CONFIG_ERROR — unknown ids would silently
 * pollute the policy lists downstream.
 */
export function normalizeLicenseFlagId(raw: string): Result<string, StitchError> {
  const normalized = normalizeLicense(raw);
  if (normalized.isErr()) return err(normalized.error);
  if (normalized.value === UNKNOWN_LICENSE) {
    return err({
      code: 'CONFIG_ERROR',
      field: 'license',
      message: `license: "${raw}" is not a known SPDX identifier — keep ids exact SPDX (P-119)`,
    });
  }
  return ok(normalized.value);
}

// ---------------------------------------------------------------------------
// Evaluation inputs (union of the selection) — ADR-081 point 2
// ---------------------------------------------------------------------------

/** Drop duplicate `pkg@version` entries when several sources share a dep. */
export function dedupeDeclared(declared: readonly DeclaredLicense[]): DeclaredLicense[] {
  const seen = new Set<string>();
  const out: DeclaredLicense[] = [];
  for (const entry of declared) {
    const key = decisionKeyOf(entry.package, entry.version);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }
  return out;
}

/** The default evaluator: the facade's `policy` verb (P-127 with overrides). */
function defaultEvaluate(
  fields: LicenseEvalFields,
  policy: LicenseCompliancePolicy,
  overrides: Map<string, 'allow' | 'deny'>
): LicenseReport {
  const facade = createLicenseFacade({ stage: process.cwd() });
  return facade.policy(fields, policy, overrides);
}

/**
 * evaluateLicense: compose the P-127 fields over the union and run the real
 * policy engine with the human overrides. The matrix covers ALL declared
 * licenses normalized to SPDX — unknown ones included — exactly the
 * composition core's own policy tests use; summarizing across sources is
 * correct here because the union is what the merged child would contain.
 */
export function evaluateLicense(
  declared: readonly DeclaredLicense[],
  policy: LicenseCompliancePolicy = DEFAULT_LICENSE_POLICY,
  overrides: ReadonlyMap<string, 'allow' | 'deny'> = new Map(),
  deps: Pick<LicenseDeps, 'evaluate'> = {}
): LicenseReport {
  const statement = [...declared];
  const unknown = detectUnknown(statement);
  const matrix = checkCompatibility(
    statement.map(entry => normalizeToSPDX(entry.licenses)),
    policy
  );
  const gplWarnings = checkGpl(statement, true);
  const dual: DualDecision[] = [];
  for (const entry of statement) {
    if (/\sOR\s/i.test(entry.licenses)) {
      dual.push(chooseDualLicense(entry.licenses, policy, policy.targetLicense));
    }
  }
  const fields: LicenseEvalFields = {
    declared: statement,
    unknown,
    gplWarnings,
    matrix,
    dual,
    deep: null,
  };
  const evaluate = deps.evaluate ?? defaultEvaluate;
  return evaluate(fields, policy, new Map(overrides));
}

// ---------------------------------------------------------------------------
// Local P-128 projection (barrel gap — ADR-081 point 1)
// ---------------------------------------------------------------------------

/** One report row; structurally core's LicenseReportRow (not barrel-exported). */
export interface LicenseReportRow {
  package: string;
  version: string;
  declared: string;
  normalized: string;
  category: LicenseCategory;
  decision: 'allow' | 'review' | 'deny';
  reason?: string;
}

/**
 * The serializable license report data (P-128's shape, mirrored locally):
 * reportVersion 1, verdict, blocking, per-package rows, summary counts, and
 * the dual/GPL/unknown captures. The JSON key set is the consumer contract
 * (P-128: do not rename fields without a contract bump).
 */
export interface LicenseReportData {
  reportVersion: 1;
  generatedAt: string;
  verdict: 'allow' | 'deny' | 'review';
  blocking: boolean;
  rows: LicenseReportRow[];
  summary: {
    total: number;
    allow: number;
    review: number;
    deny: number;
    unknown: number;
    gplWarnings: number;
  };
  dualLicenses: DualDecision[];
  gplWarnings: GplWarning[];
  unknown: UnknownLicense[];
}

type RowDecision = { decision: 'allow' | 'review' | 'deny'; reason?: string };

/**
 * decideRowFor: per-package decision, mirroring core's
 * `buildLicenseReportData` (license/report.ts) exactly — dual first, then
 * GPL, then unknown (reflecting the FINAL human decision), else allow.
 */
// shortcut: row derivation mirrors core's license/report.ts; import from the barrel once it exports buildLicenseReportData.
function decideRowFor(
  pkg: string,
  version: string,
  lic: string,
  verdict: 'allow' | 'deny' | 'review',
  captures: { dual: DualDecision[]; gpl: GplWarning[]; unknown: UnknownLicense[] }
): RowDecision {
  const dualEntry = captures.dual.find(d => d.expression.includes(lic) || d.recommended === lic);
  if (dualEntry !== undefined && dualEntry.allCompliant === false) {
    return {
      decision: verdict === 'deny' ? 'deny' : 'review',
      reason: `dual-${verdict}: ${dualEntry.expression} -> recommended ${dualEntry.recommended}`,
    };
  }
  const gplWarning = captures.gpl.find(w => w.package === pkg && w.version === version);
  if (gplWarning !== undefined) {
    return { decision: 'review', reason: `gpl-warning: ${gplWarning.suggestion}` };
  }
  const unknownEntry = captures.unknown.find(u => u.package === pkg && u.version === version);
  if (unknownEntry !== undefined) {
    if (unknownEntry.decision === 'deny') {
      return { decision: 'deny', reason: 'unknown-denied: human override' };
    }
    if (unknownEntry.decision === 'allow') {
      return { decision: 'allow', reason: 'unknown-resolved: human allow' };
    }
    return {
      decision: 'review',
      reason: `unknown-pending: ${unknownEntry.rawLicense} awaiting decision`,
    };
  }
  return { decision: 'allow' };
}

/**
 * buildLicenseReportData: the P-128 serializable projection over the policy
 * verdict and the captured gates. Pure — no I/O.
 */
export function buildLicenseReportData(
  declared: readonly DeclaredLicense[],
  policyEval: Pick<LicenseReport, 'verdict' | 'blocking'>,
  captures: { dual: DualDecision[]; gpl: GplWarning[]; unknown: UnknownLicense[] }
): LicenseReportData {
  const rows: LicenseReportRow[] = [];
  for (const entry of declared) {
    const normLic = normalizeExpression(entry.licenses);
    const cat: LicenseCategory = LICENSE_CATEGORIES[normLic] ?? 'unknown';
    const decided = decideRowFor(
      entry.package,
      entry.version,
      entry.licenses,
      policyEval.verdict,
      captures
    );
    rows.push({
      package: entry.package,
      version: entry.version,
      declared: entry.licenses,
      normalized: normLic,
      category: cat,
      decision: decided.decision,
      ...(decided.reason !== undefined ? { reason: decided.reason } : {}),
    });
  }

  let allow = 0;
  let review = 0;
  let deny = 0;
  for (const row of rows) {
    if (row.decision === 'allow') allow += 1;
    else if (row.decision === 'review') review += 1;
    else deny += 1;
  }
  const unknownPending = captures.unknown.filter(u => u.decision === 'pending').length;

  return {
    reportVersion: 1,
    generatedAt: new Date().toISOString(),
    verdict: policyEval.verdict,
    blocking: policyEval.blocking,
    rows,
    summary: {
      total: rows.length,
      allow,
      review,
      deny,
      unknown: unknownPending,
      gplWarnings: captures.gpl.length,
    },
    dualLicenses: captures.dual,
    gplWarnings: captures.gpl,
    unknown: captures.unknown,
  };
}

/**
 * stampUnknownDecisions: project the FINAL human decisions onto the report's
 * unknown entries (the policy consumes the overrides separately — this is the
 * display layer, so rows and pending counts reflect what the human decided).
 */
export function stampUnknownDecisions(
  unknown: readonly UnknownLicense[],
  decided: ReadonlyMap<string, 'allow' | 'deny'>
): UnknownLicense[] {
  return unknown.map(entry => {
    const override = decided.get(decisionKeyOf(entry.package, entry.version));
    if (override === undefined || override === entry.decision) return entry;
    return {
      package: entry.package,
      version: entry.version,
      rawLicense: entry.rawLicense,
      decision: override,
      ...(entry.path !== undefined ? { path: entry.path } : {}),
    };
  });
}

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

/** The per-package table: the phase's exact six columns. */
export function renderLicenseTable(rows: readonly LicenseReportRow[]): string[] {
  const cells: string[][] = [
    ['package', 'version', 'declared', 'normalized', 'category', 'decision'],
    ...rows.map(row => [
      row.package,
      row.version,
      row.declared,
      row.normalized,
      row.category,
      row.decision,
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

/** Metadata the text render shows beside the data. */
export interface LicenseRenderMetadata {
  scanned: number;
  skipped: string[];
  reasons: string[];
  policy: StoreLicensePolicy;
  storeNote?: string;
  decisionsRecorded: number;
}

/** The full text render. One string per line; the caller writes them. */
export function renderLicenseReport(
  data: LicenseReportData,
  metadata: LicenseRenderMetadata,
  paint: Paint
): string[] {
  const verdictLevel: ThemeLevel =
    data.verdict === 'allow' ? 'ok' : data.verdict === 'deny' ? 'err' : 'warn';
  const lines: string[] = [
    'stitch license',
    metadata.storeNote !== undefined ? `config store: ${metadata.storeNote}` : 'config store: ok',
    `sources scanned: ${String(metadata.scanned)}${
      metadata.skipped.length > 0
        ? `, skipped (no node_modules): ${metadata.skipped.join(', ')}`
        : ''
    }`,
    `verdict: ${paint(verdictLevel, data.verdict)} (blocking: ${String(data.blocking)})`,
  ];
  if (data.verdict !== 'allow') {
    for (const reason of metadata.reasons) lines.push(`  - ${reason}`);
  }
  lines.push(...renderLicenseTable(data.rows));
  lines.push(`gpl warnings: ${String(data.gplWarnings.length)}`);
  for (const warning of data.gplWarnings) {
    lines.push(
      `  - ${warning.package}@${warning.version} (${warning.license}): ${warning.suggestion}`
    );
  }
  lines.push(`dual licenses: ${String(data.dualLicenses.length)}`);
  for (const decision of data.dualLicenses) {
    lines.push(
      `  - ${decision.expression} -> recommended ${decision.recommended} (${
        decision.allCompliant ? 'compliant' : 'non-compliant'
      })`
    );
  }
  const pendingUnknowns = data.unknown.filter(u => u.decision === 'pending');
  lines.push(`unknown licenses (${String(pendingUnknowns.length)} pending):`);
  for (const entry of pendingUnknowns) {
    lines.push(`  - ${entry.package}@${entry.version} (raw: ${entry.rawLicense}) — pending`);
  }
  const lists = [
    metadata.policy.allow.length > 0 ? `allow [${metadata.policy.allow.join(', ')}]` : undefined,
    metadata.policy.deny.length > 0 ? `deny [${metadata.policy.deny.join(', ')}]` : undefined,
  ].filter((entry): entry is string => entry !== undefined);
  if (lists.length > 0) lines.push(`policy lists: ${lists.join('; ')}`);
  if (metadata.decisionsRecorded > 0) {
    lines.push(`decisions recorded: ${String(metadata.decisionsRecorded)}`);
  }
  return lines;
}

// ---------------------------------------------------------------------------
// The command
// ---------------------------------------------------------------------------

interface ScanOutcome {
  source: string;
  declared: DeclaredLicense[];
}

/**
 * license: run the license pipeline over the current selection, record human
 * decisions for unknown licenses, and render or emit JSON. Never throws;
 * every failure is a typed `StitchError`.
 */
export async function license(
  opts: LicenseOptions,
  deps: LicenseDeps = {}
): Promise<Result<void, StitchError>> {
  const write = deps.write ?? ((line: string): void => void process.stdout.write(`${line}\n`));
  const paint: Paint =
    opts.color === false ? (_level, text) => text : (level, text) => theme(level, text);

  // 1. Validate the flag ids BEFORE any store write or scan (P-119; the
  //    init-phase order: validate, then touch nothing until it is clean).
  const askedAllow: string[] = [];
  const askedDeny: string[] = [];
  for (const id of opts.allow ?? []) {
    const normalized = normalizeLicenseFlagId(id);
    if (normalized.isErr()) return err(normalized.error);
    if (!askedAllow.includes(normalized.value)) askedAllow.push(normalized.value);
  }
  for (const id of opts.deny ?? []) {
    const normalized = normalizeLicenseFlagId(id);
    if (normalized.isErr()) return err(normalized.error);
    if (!askedDeny.includes(normalized.value)) askedDeny.push(normalized.value);
  }

  // 2. Sources. A missing store degrades to an empty selection with a note
  //    (the status precedent), but EVERY write path requires the store.
  const store = deps.store;
  let sources: SourceSelection[] = [];
  let storeNote: string | undefined;
  if (store === undefined) {
    storeNote = 'unavailable (decisions cannot persist)';
  } else {
    const read = readSources(store.get('sources'));
    if (read.isErr()) return err(read.error);
    sources = read.value;
  }

  // 3. Resolve + scan each selection; a source without node_modules is skipped.
  const scanFn = deps.scan ?? (async (dir: string) => realScanDeclared(dir));
  const resolveFn: LicenseDeps['resolveSource'] =
    deps.resolveSource ?? (async (source: string) => ok(source));
  const scanned: ScanOutcome[] = [];
  const skipped: string[] = [];
  for (const selection of sources) {
    // `--offline` is local-only: a remote source needs the network by
    // definition (the same rule the add command applies).
    if (opts.offline === true && looksRemote(selection.source)) {
      return err({
        code: 'CONFIG_ERROR',
        field: 'source',
        message: `license: refused to clone "${selection.source}" while --offline`,
      });
    }
    // The resolve port is caller code — a rejection must never escape.
    let resolved: Result<string, StitchError>;
    try {
      resolved = await resolveFn(selection.source, {
        ...(selection.ref !== undefined ? { ref: selection.ref } : {}),
        offline: opts.offline === true,
      });
    } catch (cause: unknown) {
      return err({
        code: 'CONFIG_ERROR',
        field: 'source',
        message: `license: resolving "${selection.source}" failed: ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
      });
    }
    if (resolved.isErr()) return err(resolved.error);

    if (existsSync(join(resolved.value, 'node_modules')) === false) {
      skipped.push(selection.source);
      continue;
    }
    const oneScan = await scanFn(resolved.value);
    if (oneScan.isErr()) return err(oneScan.error);
    scanned.push({ source: selection.source, declared: oneScan.value });
  }

  // 4. Union + dedupe (the merged child's posture is per package), then the
  //    unknown queue (P-123) is what the human decisions are asked about.
  const declared = dedupeDeclared(scanned.flatMap(entry => entry.declared));

  // 5. Human decisions: stored decisions first, then interactive prompts for
  //    whatever is still pending. 'skip' leaves the entry pending (staying
  //    blocking, the phase's third option).
  const baseDecisions = store === undefined ? [] : readLicenseDecisions(store);
  const decided = new Map<string, 'allow' | 'deny'>();
  for (const decision of baseDecisions) {
    decided.set(decisionKeyOf(decision.package, decision.version), decision.decision);
  }

  const additions: PersistedLicenseDecision[] = [];
  if (deps.prompt !== undefined) {
    for (const entry of detectUnknown(declared)) {
      const key = decisionKeyOf(entry.package, entry.version);
      if (decided.has(key)) continue;
      let answer: LicensePromptResult;
      try {
        answer = await deps.prompt({
          package: entry.package,
          version: entry.version,
          rawLicense: entry.rawLicense,
        });
      } catch {
        // A broken prompt surface degrades to pending, never throws outward.
        answer = 'skip';
      }
      if (answer === 'skip') continue;
      additions.push({ package: entry.package, version: entry.version, decision: answer });
      decided.set(key, answer);
    }
  }

  if (additions.length > 0) {
    if (store === undefined) {
      return err({
        code: 'CONFIG_ERROR',
        field: DECISIONS_KEY,
        message: 'license: decisions were made but there is no config store to persist them',
      });
    }
    const saved = saveLicenseDecisions(store, baseDecisions, additions);
    if (saved.isErr()) return err(saved.error);
  }
  if (askedAllow.length > 0 || askedDeny.length > 0) {
    if (store === undefined) {
      return err({
        code: 'CONFIG_ERROR',
        field: 'licensePolicy',
        message: 'license: --allow/--deny flags cannot be recorded without a config store',
      });
    }
    const storedIds = appendLicensePolicyIds(store, {
      ...(askedAllow.length > 0 ? { allow: askedAllow } : {}),
      ...(askedDeny.length > 0 ? { deny: askedDeny } : {}),
    });
    if (storedIds.isErr()) return err(storedIds.error);
  }

  // 6. Evaluate once, with the final override map, over the union.
  const report = evaluateLicense(declared, DEFAULT_LICENSE_POLICY, decided, deps);
  const data = buildLicenseReportData(declared, report, {
    dual: report.dual,
    gpl: report.gplWarnings,
    unknown: stampUnknownDecisions(report.unknown, decided),
  });

  // 7. Render: JSON is the full data object; text is the human report.
  if (opts.json === true) {
    write(JSON.stringify(data, null, 2));
    return ok(undefined);
  }
  for (const line of renderLicenseReport(
    data,
    {
      scanned: scanned.length,
      skipped,
      reasons: report.reasons,
      policy:
        store === undefined
          ? { allow: askedAllow, warn: [], deny: askedDeny }
          : readLicensePolicy(store),
      ...(storeNote !== undefined ? { storeNote } : {}),
      decisionsRecorded: additions.length,
    },
    paint
  )) {
    write(line);
  }
  return ok(undefined);
}
