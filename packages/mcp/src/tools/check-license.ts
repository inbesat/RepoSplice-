// P-360 - the `stitch_check_license` tool.
//
// A standalone pre-merge licence check: it scans BOTH repositories and applies
// the SPDX compatibility matrix (P-120), so a host can do licence due diligence
// without starting a merge. The licence capability itself stays in core (the
// P-118 scan and the P-120 matrix); this module owns the tool contract, and
// every project capability arrives as an injectable PORT so the pairing is
// testable and the remote case needs no network.
//
// A host whose core barrel cannot supply the scan is told plainly rather than
// handed an empty verdict: a missing capability is never a zero (ADR-169).

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { err, ok, type Result } from 'neverthrow';
import type { StitchError } from '@repo-stitcher/core';

import type { ToolDefinition, ToolHandler, ToolInputSchema, ToolRegistry } from './registry.js';

export const STITCH_CHECK_LICENSE_TOOL_NAME = 'stitch_check_license';

/** The three verdicts the spec names. */
export type CheckLicenseVerdict = 'compatible' | 'conditional' | 'incompatible';

/** One licence as the host sees it: SPDX id, human name and policy category. */
export interface LicenseRef {
  readonly spdx_id: string;
  readonly name: string;
  readonly category: string;
}

/** What one scan of one repository found. */
export interface LicenseScan {
  readonly ref: string;
  readonly source: 'local' | 'remote';
  readonly spdx_ids: readonly string[];
  readonly licenses: readonly LicenseRef[];
  readonly warnings: readonly string[];
  /** Whether a host-supplied cache answered instead of a fresh scan. */
  readonly cached: boolean;
}

/** The compatibility matrix's answer for the pair. */
export interface CompatibilityVerdict {
  readonly verdict: CheckLicenseVerdict;
  readonly requirements: readonly string[];
  readonly blockers: readonly string[];
  readonly failing_categories: readonly string[];
}

export interface CheckLicenseInput {
  readonly repoA: string;
  readonly repoB: string;
}

/**
 * The seam. `scan` reports one repository's declared licences and
 * `compatibility` applies the matrix to the pair; the real implementations come
 * from the core public barrel, tests inject them.
 */
export interface CheckLicensePorts {
  readonly scan: (repo: string) => Promise<Result<LicenseScan, StitchError>>;
  readonly compatibility: (
    leftIds: readonly string[],
    rightIds: readonly string[]
  ) => Promise<Result<CompatibilityVerdict, StitchError>>;
}

export interface RepoLicenseDetail {
  readonly ref: string;
  readonly source: 'local' | 'remote';
  readonly spdx_ids: readonly string[];
  readonly licenses: readonly LicenseRef[];
  readonly warnings: readonly string[];
  readonly cached: boolean;
}

export interface CheckLicenseOutput {
  readonly verdict: CheckLicenseVerdict;
  readonly spdx_ids: readonly string[];
  readonly details: {
    readonly repo_a: RepoLicenseDetail;
    readonly repo_b: RepoLicenseDetail;
    readonly requirements: readonly string[];
    readonly blockers: readonly string[];
    readonly failing_categories: readonly string[];
  };
}

export const CHECK_LICENSE_INPUT_SCHEMA: ToolInputSchema = {
  type: 'object',
  properties: {
    repo_a: {
      type: 'string',
      description: 'The first repository: an https url or a local path.',
    },
    repo_b: {
      type: 'string',
      description: 'The second repository: an https url or a local path.',
    },
  },
  required: ['repo_a', 'repo_b'],
  additionalProperties: false,
};

export const CHECK_LICENSE_TOOL: ToolDefinition = {
  name: STITCH_CHECK_LICENSE_TOOL_NAME,
  description:
    'Checks whether two repositories are licence-compatible before a merge: scans the declared licences of both and applies the SPDX compatibility matrix, returning a compatible/conditional/incompatible verdict with the SPDX ids, licence names, requirements and blockers.',
  inputSchema: CHECK_LICENSE_INPUT_SCHEMA,
};

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** The only error code this tool constructs, with a field naming the input. */
function configError(field: string, message: string): StitchError {
  return { code: 'CONFIG_ERROR', field, message };
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

/** Code-unit order, so the listing is stable across platforms. */
function compareIds(left: string, right: string): number {
  if (left < right) return -1;
  return left > right ? 1 : 0;
}

export function parseCheckLicenseInput(
  args: Readonly<Record<string, unknown>>
): Result<CheckLicenseInput, StitchError> {
  const repoA = asNonEmptyString(args['repo_a']);
  if (repoA === undefined) {
    return err(
      configError('stitch_check_license.repo_a', 'repo_a must be a non-empty url or path')
    );
  }
  const repoB = asNonEmptyString(args['repo_b']);
  if (repoB === undefined) {
    return err(
      configError('stitch_check_license.repo_b', 'repo_b must be a non-empty url or path')
    );
  }
  return ok({ repoA, repoB });
}

function toRepoDetail(scan: LicenseScan): RepoLicenseDetail {
  return {
    ref: scan.ref,
    source: scan.source,
    spdx_ids: scan.spdx_ids,
    licenses: scan.licenses,
    warnings: scan.warnings,
    cached: scan.cached,
  };
}

/** Assemble the output: the pair's verdict plus each side's evidence. */
export function buildCheckLicenseOutput(
  left: LicenseScan,
  right: LicenseScan,
  compatibility: CompatibilityVerdict
): CheckLicenseOutput {
  const ids = [...new Set([...left.spdx_ids, ...right.spdx_ids])].sort(compareIds);
  return {
    verdict: compatibility.verdict,
    spdx_ids: ids,
    details: {
      repo_a: toRepoDetail(left),
      repo_b: toRepoDetail(right),
      requirements: compatibility.requirements,
      blockers: compatibility.blockers,
      failing_categories: compatibility.failing_categories,
    },
  };
}

/** The tool handler: scan both repositories in parallel, then apply the matrix. */
export function createCheckLicenseHandler(ports: CheckLicensePorts): ToolHandler {
  return async args => {
    const parsed = parseCheckLicenseInput(args);
    if (parsed.isErr()) return err(parsed.error);
    const input = parsed.value;
    const [left, right] = await Promise.all([ports.scan(input.repoA), ports.scan(input.repoB)]);
    if (left.isErr()) return err(left.error);
    if (right.isErr()) return err(right.error);
    const compatibility = await ports.compatibility(left.value.spdx_ids, right.value.spdx_ids);
    if (compatibility.isErr()) return err(compatibility.error);
    return ok(buildCheckLicenseOutput(left.value, right.value, compatibility.value));
  };
}

export function registerCheckLicenseTool(
  registry: ToolRegistry,
  ports: CheckLicensePorts
): Result<readonly string[], StitchError> {
  const registered = registry.register(CHECK_LICENSE_TOOL, createCheckLicenseHandler(ports));
  if (registered.isErr()) return err(registered.error);
  return ok([STITCH_CHECK_LICENSE_TOOL_NAME]);
}

/** Ports that answer the honest reason: used when the barrel cannot supply one. */
export function unavailableCheckLicensePorts(reason: StitchError): CheckLicensePorts {
  return {
    scan: async () => err(reason),
    compatibility: async () => err(reason),
  };
}

interface DeclaredLicenseLike {
  readonly licenses: string;
}

interface LicenseInfoLike {
  readonly id: string;
  readonly name: string;
}

interface CompatibilityResultLike {
  readonly decision: 'allow' | 'deny' | 'review';
  readonly reasons: readonly string[];
  readonly failingCategories: readonly string[];
}

interface BarrelPorts {
  readonly scanDeclared: (
    depsDir: string,
    options?: Readonly<Record<string, unknown>>
  ) => Promise<Result<readonly DeclaredLicenseLike[], StitchError>>;
  readonly normalizeToSPDX: (raw: string) => string;
  readonly lookupLicense: (id: string) => Result<LicenseInfoLike, StitchError>;
  readonly licenseCategories: Readonly<Record<string, string>>;
  readonly checkCompatibility: (licenses: string[], policy: unknown) => CompatibilityResultLike;
  readonly defaultPolicy: unknown;
  readonly cloneRepo: (options: {
    readonly url: string;
    readonly targetDir: string;
  }) => Promise<Result<string, StitchError>>;
}

/** A url (any scheme), an scp-like `git@host:path`, or a `.git` suffix. */
function isRemoteRef(ref: string): boolean {
  return (
    /^[a-z][a-z0-9+.-]*:\/\//i.test(ref) || /^[^@\s]+@[^:\s]+:/.test(ref) || ref.endsWith('.git')
  );
}

/**
 * The repository's OWN licence from its manifest, when it declares one.
 * An absent or unparseable manifest is simply "nothing declared here".
 */
async function readManifestLicense(root: string): Promise<string | undefined> {
  try {
    const text = await readFile(join(root, 'package.json'), 'utf8');
    const manifest = JSON.parse(text) as { license?: unknown; licenses?: unknown };
    const single = typeof manifest.license === 'string' ? manifest.license.trim() : '';
    if (single !== '') return single;
    if (!Array.isArray(manifest.licenses)) return undefined;
    const types = manifest.licenses
      .map(entry => (entry as { type?: unknown }).type)
      .filter((type): type is string => typeof type === 'string' && type.trim() !== '');
    return types.length > 0 ? types.join(' OR ') : undefined;
  } catch {
    return undefined;
  }
}

function collectIds(
  ports: BarrelPorts,
  raw: readonly string[]
): { ids: readonly string[]; warnings: readonly string[] } {
  const ids = new Set<string>();
  const warnings: string[] = [];
  for (const value of raw) {
    const id = ports.normalizeToSPDX(value);
    ids.add(id);
    if (ports.licenseCategories[id] === undefined) {
      warnings.push(
        `the declared licence "${value}" resolves to "${id}", which has no known category`
      );
    }
  }
  if (raw.length === 0) warnings.push('the scan found no declared licences');
  return { ids: [...ids].sort(compareIds), warnings };
}

function toLicenseRefs(ports: BarrelPorts, ids: readonly string[]): LicenseRef[] {
  return ids.map(id => {
    const lookup = ports.lookupLicense(id);
    return {
      spdx_id: id,
      name: lookup.isOk() ? lookup.value.name : id,
      category: ports.licenseCategories[id] ?? 'unknown',
    };
  });
}

async function scanRoot(
  ports: BarrelPorts,
  ref: string,
  root: string,
  source: 'local' | 'remote'
): Promise<Result<LicenseScan, StitchError>> {
  const declared = await ports.scanDeclared(root);
  if (declared.isErr()) return err(declared.error);
  const raw: string[] = [];
  const manifest = await readManifestLicense(root);
  if (manifest !== undefined) raw.push(manifest);
  for (const entry of declared.value) raw.push(entry.licenses);
  const collected = collectIds(ports, raw);
  return ok({
    ref,
    source,
    spdx_ids: collected.ids,
    licenses: toLicenseRefs(ports, collected.ids),
    warnings: collected.warnings,
    // The P-303 repo-metadata cache is not reachable from the public barrel, so
    // a fresh scan is honestly reported as uncached (ADR-169).
    cached: false,
  });
}

function toCompatibilityVerdict(result: CompatibilityResultLike): CompatibilityVerdict {
  if (result.decision === 'review') {
    return {
      verdict: 'conditional',
      requirements: result.reasons,
      blockers: [],
      failing_categories: result.failingCategories,
    };
  }
  if (result.decision === 'deny') {
    return {
      verdict: 'incompatible',
      requirements: [],
      blockers: result.reasons,
      failing_categories: result.failingCategories,
    };
  }
  return {
    verdict: 'compatible',
    requirements: [],
    blockers: [],
    failing_categories: result.failingCategories,
  };
}

export function createCheckLicensePorts(ports: BarrelPorts): CheckLicensePorts {
  return {
    scan: async ref => {
      if (!isRemoteRef(ref)) return scanRoot(ports, ref, ref, 'local');
      const target = await mkdtemp(join(tmpdir(), 'stitch-check-license-'));
      try {
        const cloned = await ports.cloneRepo({ url: ref, targetDir: target });
        if (cloned.isErr()) return err(cloned.error);
        return await scanRoot(ports, ref, cloned.value, 'remote');
      } finally {
        await rm(target, { recursive: true, force: true });
      }
    },
    compatibility: async (leftIds, rightIds) => {
      const result = ports.checkCompatibility([...leftIds, ...rightIds], ports.defaultPolicy);
      return ok(toCompatibilityVerdict(result));
    },
  };
}

/**
 * Build the ports from the core public barrel.
 *
 * Returns refusing ports (never a throw) when a name is missing, so the server
 * still starts and `tools/list` still shows the tool while every call reports
 * the honest reason.
 */
export async function loadCheckLicensePorts(): Promise<CheckLicensePorts> {
  let barrel: Record<string, unknown>;
  try {
    barrel = (await import('@repo-stitcher/core')) as unknown as Record<string, unknown>;
  } catch (cause) {
    return unavailableCheckLicensePorts(
      configError('mcp.core', `the core barrel could not be loaded: ${messageOf(cause)} (ADR-169)`)
    );
  }
  const missing: string[] = [];
  const pick = <T>(name: string): T | undefined => {
    const value = barrel[name];
    if (value === undefined) missing.push(name);
    return value as T | undefined;
  };
  const scanDeclared = pick<BarrelPorts['scanDeclared']>('scanDeclared');
  const normalizeToSPDX = pick<BarrelPorts['normalizeToSPDX']>('normalizeToSPDX');
  const lookupLicense = pick<BarrelPorts['lookupLicense']>('lookupLicense');
  const checkCompatibility = pick<BarrelPorts['checkCompatibility']>('checkCompatibility');
  const cloneRepo = pick<BarrelPorts['cloneRepo']>('cloneRepo');
  const licenseCategories = pick<Readonly<Record<string, string>>>('LICENSE_CATEGORIES');
  const defaultPolicy = barrel['DEFAULT_LICENSE_POLICY'];
  if (defaultPolicy === undefined) missing.push('DEFAULT_LICENSE_POLICY');
  if (
    scanDeclared === undefined ||
    normalizeToSPDX === undefined ||
    lookupLicense === undefined ||
    checkCompatibility === undefined ||
    cloneRepo === undefined ||
    licenseCategories === undefined ||
    defaultPolicy === undefined
  ) {
    return unavailableCheckLicensePorts(
      configError(
        'mcp.core',
        `the core barrel is missing ${missing.join(', ')}: stitch_check_license cannot scan licences (ADR-169)`
      )
    );
  }
  return createCheckLicensePorts({
    scanDeclared,
    normalizeToSPDX,
    lookupLicense,
    licenseCategories,
    checkCompatibility,
    defaultPolicy,
    cloneRepo,
  });
}
