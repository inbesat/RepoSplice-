// P-166 — Agent tools: deps / license integration.
//
// The production `ToolContext['deps']` and `ToolContext['license']` facades.
// Both are THIN DELEGATES (the handoff note's requirement): every method calls
// the real P-104–P-117 / P-118–P-130 module and adds nothing of its own, so a
// dependency change never needs two code paths.
//
// The P-140 declarations (`ai/types.ts`) are deliberately minimal —
// `DepsFacade { analyze(); install() }` and `LicenseFacade { scan(); check() }`
// — exactly as thin as `GitFacade` was before P-165. The classes below
// implement those declared members, and additionally expose the richer verb
// set the phase mandates as CONCRETE methods on the class (the same
// "extra capability on the implementation, not on the interface" arrangement
// P-165 used for `commitStage`/`mergeSources`/`stageStatus`). Nothing in
// `ai/types.ts` is widened, so every pre-P-166 facade still compiles.
//
// Two declared members have no error channel (`analyze`, `install`, `scan`,
// `check`) and therefore reject on failure instead of returning a `Result`.
// That is not a shortcut: `resolve_deps.ts` and `fix_dependency.ts` both wrap
// `ctx.deps.analyze()` in a `try { … } catch` and map the caught message to a
// typed `INTERNAL`, so a rejection IS the contract they already expect.
// `install` is realised as a documented refusal — dependency installation runs
// in the sandbox (P-170) and the agent facade never shells out to a package
// manager on the host (ADR-028).
//
// Where the phase's step-1 sketches name a signature the real module does not
// have, the module wins (the P-165 precedent): `resolve` takes two ranges
// (P-109's `resolveCollision` has no `pkg` input), `dedupe` takes the
// `(versions, requested)` pair P-111 needs, and `mergeScripts` requires the
// `prefixA`/`prefixB` options P-112 needs to disambiguate collisions.

import { type Result } from 'neverthrow';
import { readFile as fsReadFile } from 'node:fs/promises';
import type {
  DepsFacade as DepsFacadeContract,
  LicenseFacade as LicenseFacadeContract,
} from '../ai/types.js';
import { type StitchError, stitchErrorMessage } from '../result/index.js';
import { pathExists } from '../util/fs.js';
import {
  unionManifests,
  resolveCollision,
  maxSatisfying,
  detectPeerConflicts,
  chooseDedupeStrategy,
  mergeScripts,
  regenerateLockfile,
  generateDepReport,
  detectEcosystems,
  parsePackageJson,
  parsePythonManifest,
  parseCargoToml,
  parseGoMod,
} from '../deps/index.js';
import type {
  ParsedManifest,
  UnifiedManifest,
  MergeResult,
  Conflict,
  DependencyReport,
  LockfileResult,
  PeerConflict,
  CollisionResolution,
  DedupeResult,
  DedupeOptions,
  NpmManifest,
  CargoManifest,
  RangeOptions,
  RegenerateLockfileOptions,
  DetectedEcosystem,
} from '../deps/index.js';
import type { MergeScriptsOptions } from '../deps/scripts.js';
import {
  scanDeclaredLicenses,
  normalizeToSPDX,
  parseLicenses,
  checkCompatibility,
  checkGpl,
  chooseDualLicense,
  detectUnknown,
  evaluatePolicy,
  buildLicenseReportData,
} from '../license/index.js';
import type {
  DeclaredLicense,
  ScanDeclaredOptions,
  LicensePolicy,
  CompatibilityResult,
  LicenseReport,
  LicenseReportData,
  DualDecision,
  GplWarning,
  UnknownLicense,
  DeepScanResult,
  NoticeResult,
  GeneratedLicense,
} from '../license/index.js';

/** Where the facades read from: the child stage (repo C). */
export interface DepsLicensePaths {
  /** Absolute path of the child stage — the tree the agent mutates. */
  stage: string;
}

/** A dependency map for one parsed manifest: name -> version range. */
export type DependencyMap = Record<string, string>;

// ---------------------------------------------------------------------------
// Manifest flattening (P-104-P-107 normalized forms -> one name->range map).
// ---------------------------------------------------------------------------

/** Flatten an npm manifest's four install sections into one map. */
function npmDependencyMap(manifest: NpmManifest): DependencyMap {
  return {
    ...(manifest.dependencies ?? {}),
    ...(manifest.devDependencies ?? {}),
    ...(manifest.optionalDependencies ?? {}),
    ...(manifest.peerDependencies ?? {}),
  };
}

/** Flatten a Cargo manifest; dependency values may be a string or a table. */
function cargoDependencyMap(manifest: CargoManifest): DependencyMap {
  const out: DependencyMap = {};
  for (const [name, spec] of Object.entries(manifest.dependencies ?? {})) {
    out[name] = typeof spec === 'string' ? spec : spec.version;
  }
  for (const [name, spec] of Object.entries(manifest.devDependencies ?? {})) {
    out[name] = typeof spec === 'string' ? spec : spec.version;
  }
  for (const [name, spec] of Object.entries(manifest.buildDependencies ?? {})) {
    out[name] = spec;
  }
  return out;
}

/**
 * The `name -> range` map of one parsed manifest. Exhaustive over the
 * `ParsedManifest` union, so a new ecosystem is a compile error here.
 */
export function manifestDependencyMap(parsed: ParsedManifest): DependencyMap {
  switch (parsed.ecosystem) {
    case 'npm':
      return npmDependencyMap(parsed.manifest);
    case 'python':
      return {
        ...parsed.manifest.dependencies,
        ...(parsed.manifest.devDependencies ?? {}),
      };
    case 'cargo':
      return cargoDependencyMap(parsed.manifest);
    case 'go':
      return { ...parsed.manifest.require };
  }
}

/** Dispatch one manifest to the parser its detected ecosystem mandates. */
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

// ---------------------------------------------------------------------------
// DepsFacade
// ---------------------------------------------------------------------------

/**
 * The production `ToolContext['deps']`.
 *
 * `analyze()` reads the stage's own manifests so `fix_dependency`/`detect_gaps`
 * see exactly what C currently declares. The richer P-104–P-116 verbs are thin
 * delegates.
 */
export class DepsFacade implements DepsFacadeContract {
  private readonly stage: string;

  constructor(paths: DepsLicensePaths) {
    this.stage = paths.stage;
  }

  /**
   * C's current dependency map (`name -> range`), aggregated across every
   * manifest the stage contains.
   *
   * Rejects when the stage cannot be walked: `resolve_deps.ts`/`fix_dependency`
   * treat a rejection as a typed `INTERNAL`, and returning `{}` instead would
   * silently report every imported package as *missing* — a false gap, which is
   * worse than a loud failure. An unparseable or stale manifest entry is
   * skipped (a listing can legitimately be stale), never fatal.
   */
  async analyze(): Promise<DependencyMap> {
    const detected = await detectEcosystems(this.stage);
    if (detected.isErr()) {
      throw new Error(stitchErrorMessage(detected.error));
    }
    const out: DependencyMap = {};
    for (const entry of detected.value) {
      let content: string;
      try {
        content = await fsReadFile(entry.manifestPath, 'utf8');
      } catch {
        continue;
      }
      const parsed = parseDetected(entry.parser, content, entry.manifestPath);
      if (parsed.isErr()) continue;
      Object.assign(out, manifestDependencyMap(parsed.value));
    }
    return out;
  }

  /**
   * The declared P-140 `install` placeholder, realised as a refusal.
   *
   * Dependency installation belongs to the sandbox (P-170) and the host-side
   * agent facade must never spawn a package manager (ADR-028: "never run on the
   * host"). Refusing loudly is the only honest implementation of a method with
   * no error channel that this layer must not perform.
   */
  async install(spec: string): Promise<void> {
    throw new Error(
      `DepsFacade.install("${spec}") is unavailable here: dependency installation runs in the ` +
        `sandbox (P-170), and the agent facade never shells out to a package manager on the host ` +
        `(ADR-028).`
    );
  }

  // ---- P-108–P-116 delegates (phase step 1) --------------------------------

  /** Union manifests across ecosystems (P-108). */
  union(manifests: ParsedManifest[]): Result<MergeResult, StitchError> {
    return unionManifests(manifests);
  }

  /** Resolve a version-range collision between two sources (P-109). */
  resolve(
    rangeA: string,
    rangeB: string,
    options: RangeOptions = {}
  ): Result<CollisionResolution, StitchError> {
    return resolveCollision(rangeA, rangeB, options);
  }

  /** Highest version satisfying a range (P-109). */
  maxSatisfying(
    versions: readonly string[],
    range: string,
    options: RangeOptions = {}
  ): Result<string | null, StitchError> {
    return maxSatisfying(versions, range, options);
  }

  /** Peer-dependency conflicts over a merged npm manifest (P-110). */
  detectPeers(merged: NpmManifest, manifests: ParsedManifest[]): PeerConflict[] {
    return detectPeerConflicts(merged, manifests);
  }

  /** Dedupe/nest strategy for one package's competing ranges (P-111). */
  dedupe(
    versions: string[],
    requested: Record<string, string>,
    opts: DedupeOptions = {}
  ): DedupeResult {
    return chooseDedupeStrategy(versions, requested, opts);
  }

  /** Merge two `scripts` maps, prefixing colliding keys (P-112). */
  mergeScripts(
    a: Record<string, string> | undefined,
    b: Record<string, string> | undefined,
    opts: MergeScriptsOptions
  ): { merged: Record<string, string>; conflicts: Conflict[] } {
    return mergeScripts(a, b, opts);
  }

  /** Regenerate the ecosystem lockfile for a merged manifest (P-114). */
  lockfile(
    manifest: UnifiedManifest,
    repoPath: string,
    opts: RegenerateLockfileOptions = {}
  ): Promise<Result<LockfileResult, StitchError>> {
    return regenerateLockfile(manifest, repoPath, opts);
  }

  /** Build the deterministic deps report (P-116). */
  report(
    result: MergeResult,
    lockfile: LockfileResult | null,
    inputSources: { repoName: string; manifestPath: string }[]
  ): DependencyReport {
    return generateDepReport(result, lockfile, inputSources);
  }
}

// ---------------------------------------------------------------------------
// LicenseFacade
// ---------------------------------------------------------------------------

/**
 * Structurally the P-127 `evaluatePolicy` input. The real interface
 * (`LicenseAggregateFields`) is module-private, so this is the ADR-030
 * structural seam: identical fields, no import of a private type.
 */
export interface LicenseAggregateFieldsLike {
  declared: DeclaredLicense[];
  unknown: UnknownLicense[];
  gplWarnings: GplWarning[];
  matrix: CompatibilityResult;
  dual: DualDecision[];
  deep: DeepScanResult | null;
  notice?: NoticeResult;
  generatedLicense?: GeneratedLicense;
}

/** Human decisions for unknown packages, keyed `pkg@version` or `pkg`. */
export type PolicyOverridesLike = Map<string, 'allow' | 'deny'>;

/** What `complianceGate` returns: the verdict plus the full report. */
export interface ComplianceGateResult {
  blocking: boolean;
  report: LicenseReport;
}

/**
 * The default policy `complianceGate`/`check` apply when a caller passes none:
 * permissive + weak-copyleft allowed, unknown denied, attribution required,
 * targeting an MIT child. A caller that needs a different bar supplies its own.
 */
export const DEFAULT_LICENSE_POLICY: LicensePolicy = {
  allow: ['permissive', 'weak-copyleft'],
  denyUnknown: true,
  requireAttribution: true,
  targetLicense: 'MIT',
};

/**
 * The production `ToolContext['license']`.
 *
 * `scanDeclared`/`complianceGate` run the real P-118–P-128 pipeline against the
 * stage; the individual verbs are thin delegates. Fails CLOSED: a scan that
 * cannot run reports `blocking: true` rather than reading as compliant.
 */
export class LicenseFacade implements LicenseFacadeContract {
  private readonly stage: string;

  constructor(paths: DepsLicensePaths) {
    this.stage = paths.stage;
  }

  /** Declared licenses installed in the stage (P-118). */
  scanDeclared(
    repoPath: string = this.stage,
    opts: ScanDeclaredOptions = {}
  ): Promise<Result<DeclaredLicense[], StitchError>> {
    return scanDeclaredLicenses(repoPath, opts);
  }

  /**
   * The declared P-140 `scan()`: the distinct, normalized SPDX ids the stage's
   * dependencies declare. Rejects when the scan cannot run (see `analyze`).
   */
  async scan(): Promise<string[]> {
    const declared = await this.scanDeclared();
    if (declared.isErr()) {
      throw new Error(stitchErrorMessage(declared.error));
    }
    const ids = new Set<string>();
    for (const entry of declared.value) {
      for (const part of parseLicenses(entry.licenses)) {
        const normalized = normalizeToSPDX(part);
        if (normalized.trim() !== '') ids.add(normalized);
      }
    }
    return [...ids].sort();
  }

  /** The declared P-140 `check()`: true when the compliance gate is not blocking. */
  async check(): Promise<boolean> {
    const gate = await this.complianceGate();
    return !gate.blocking;
  }

  /** Normalize a single license id to SPDX (P-119). */
  normalize(expr: string): string {
    return normalizeToSPDX(expr);
  }

  /** Compatibility matrix over declared licenses (P-120/P-121/P-122/P-123). */
  compat(licenses: string[], policy: LicensePolicy): CompatibilityResult {
    return checkCompatibility(licenses, policy);
  }

  /** GPL/AGPL warnings for declared licenses (P-121). */
  gpl(declared: DeclaredLicense[], isJsTs: boolean): GplWarning[] {
    return checkGpl(declared, isJsTs);
  }

  /** Most-permissive compliant branch of a dual-licensed expression (P-122). */
  dual(expr: string, policy: LicensePolicy, target?: string): DualDecision {
    return chooseDualLicense(expr, policy, target ?? policy.targetLicense);
  }

  /** Unknown/unparseable declared licenses (P-123). */
  unknown(declared: DeclaredLicense[]): UnknownLicense[] {
    return detectUnknown(declared);
  }

  /** Evaluate the policy verdict from aggregated signals (P-127). */
  policy(
    fields: LicenseAggregateFieldsLike,
    policy: LicensePolicy,
    overrides: PolicyOverridesLike = new Map()
  ): LicenseReport {
    return evaluatePolicy(fields, policy, overrides);
  }

  /** Serialize the report data for the UI/CLI (P-128). */
  reportData(
    declared: DeclaredLicense[],
    policyEval: LicenseReport,
    captures: { dual: DualDecision[]; gpl: GplWarning[]; unknown: UnknownLicense[] }
  ): LicenseReportData {
    return buildLicenseReportData(declared, policyEval, captures);
  }

  /**
   * The full pipeline gate: scan → unknown → GPL → dual → matrix → policy.
   *
   * A blocking verdict means the loop must halt C creation (ties to P-205).
   * A scan failure is reported as `blocking: true` with the failure as the
   * reason — "we could not check" must never be read as "it is compliant".
   */
  async complianceGate(
    policy: LicensePolicy = DEFAULT_LICENSE_POLICY,
    overrides: PolicyOverridesLike = new Map()
  ): Promise<ComplianceGateResult> {
    const declared = await this.scanDeclared();
    if (declared.isErr()) {
      const report = evaluatePolicy(
        {
          declared: [],
          unknown: [],
          gplWarnings: [],
          matrix: {
            decision: 'review',
            reasons: [`license scan failed: ${stitchErrorMessage(declared.error)}`],
            failingCategories: [],
          },
          dual: [],
          deep: null,
        },
        policy,
        overrides
      );
      return { blocking: true, report };
    }

    const found = declared.value;
    const unknown = detectUnknown(found);
    const gplWarnings = checkGpl(found, await this.stageIsJsTs());
    const dual = found
      .filter(entry => /\sOR\s/i.test(entry.licenses))
      .map(entry => chooseDualLicense(entry.licenses, policy, policy.targetLicense));
    const matrix = checkCompatibility(
      found.map(entry => normalizeToSPDX(entry.licenses)),
      policy
    );
    const report = evaluatePolicy(
      { declared: found, unknown, gplWarnings, matrix, dual, deep: null },
      policy,
      overrides
    );
    return { blocking: report.blocking, report };
  }

  /** JS/TS stages get the conservative GPL linking heuristic (P-121). */
  private async stageIsJsTs(): Promise<boolean> {
    const exists = await pathExists(this.stage, 'package.json');
    return exists.isOk() && exists.value;
  }
}

// ---------------------------------------------------------------------------
// Factories (the orchestrator, P-238, builds the ToolContext from these).
// ---------------------------------------------------------------------------

export function createDepsFacade(paths: DepsLicensePaths): DepsFacade {
  return new DepsFacade(paths);
}

export function createLicenseFacade(paths: DepsLicensePaths): LicenseFacade {
  return new LicenseFacade(paths);
}

/** Optional convenience: both facades from one layout. */
export function createDepsLicenseFacades(paths: DepsLicensePaths): {
  deps: DepsFacade;
  license: LicenseFacade;
} {
  return { deps: new DepsFacade(paths), license: new LicenseFacade(paths) };
}
