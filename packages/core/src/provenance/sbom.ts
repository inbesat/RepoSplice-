// P-183 — Provenance: SBOM (CycloneDX primary, SPDX optional).
//
// Regulatory and supply-chain tooling expects a MACHINE-readable bill of
// materials. CREDITS (P-182) is the human read of P-181's provenance map; this is
// the legal/automated one, and it carries TWO kinds of fact:
//
//   - the COMPONENTS: direct and transitive dependencies from the merged
//     manifest (P-108/P-116), each with a `purl` and its licence verdict (P-128);
//   - the FILES: P-181's `FileOrigin`s, so a consumer can trace a file in the
//     composed app back to the repo and commit it came from.
//
// CycloneDX JSON is PRIMARY (broader tooling support, per the handoff) and SPDX
// is optional; `format: 'both'` emits each.
//
// Three decisions worth stating up front (ADR-056):
//
//   1. THE RESULT CARRIES ONE DOCUMENT PER FORMAT, not a single string. The
//      phase declares `Promise<Result<string, …>>`, but `format: 'both'` cannot
//      be one string without inventing an envelope format; `documents` keeps the
//      requested set explicit and nothing is silently dropped.
//   2. EVERYTHING IS DERIVED FROM THE INPUT, so the same inputs render
//      byte-identical output: `created` defaults to `deps.generatedAt`, and the
//      CycloneDX `serialNumber` / SPDX `documentNamespace` are content hashes
//      rather than `randomUUID()`. `now`/`serialSeed` override when a caller
//      genuinely wants a fresh stamp (the P-182 precedent).
//   3. MALFORMED OUTPUT IS REFUSED, never written. A document that fails its own
//      shape check becomes `SBOM_INVALID` (P-183's own error code) because
//      compliance export (P-307) and the web view (P-220) PARSE these files —
//      a broken artifact is worse than an absent one.

import { ok, err, type Result } from 'neverthrow';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { outputFile } from 'fs-extra';
import { type StitchError } from '../result/index.js';
import { type UnifiedManifest, type DependencyReport } from '../deps/types.js';
import { type LicenseReportData, type LicenseReportRow } from '../license/types.js';
import { type FileOrigin, type ProvenanceMap } from './map.js';

/** The SBOM flavours this phase can emit. */
export type SbomFormat = 'cyclonedx' | 'spdx';

/** The file each format is written to, at the root of child repo C. */
export const SBOM_FILENAMES: Readonly<Record<SbomFormat, string>> = {
  cyclonedx: 'sbom.cyclonedx.json',
  spdx: 'sbom.spdx.json',
};

/** The generating tool, recorded in both formats. */
export const TOOL_NAME = 'repo-stitcher';

/** The CycloneDX spec version emitted. */
export const CYCLONEDX_SPEC_VERSION = '1.5';

/** The SPDX spec version emitted. */
export const SPDX_VERSION = 'SPDX-2.3';

/** The license id used when nothing is known. SPDX's own "no assertion". */
export const NOASSERTION = 'NOASSERTION';

/**
 * purl type per P-115 parser ecosystem.
 *
 * The report's `ecosystem` is already the parser id, so this is a rename rather
 * than a translation — which is why no lookup table of package names is needed.
 */
const PURL_TYPES: Readonly<Record<DependencyReport['ecosystem'], string>> = {
  npm: 'npm',
  python: 'pypi',
  cargo: 'cargo',
  go: 'golang',
};

/** One dependency, normalized out of the manifest union. */
export interface SbomComponent {
  name: string;
  version: string;
  purl: string;
  /** The declared licence term (from P-128), or `NOASSERTION`. */
  licenseDeclared: string;
  /** The concluded term — the policy verdict's normalized licence. */
  licenseConcluded: string;
  /** The policy decision for this component, when known. */
  decision?: 'allow' | 'review' | 'deny';
}

/** What the caller knows about the composed app. */
export interface SbomMetadata {
  /** The composed app's name. */
  name: string;
  /** Its version. */
  version: string;
  /** Its ecosystem label (the report's own `ecosystem`). */
  ecosystem: string;
}

/** The three inputs (phase step 1). */
export interface SbomInput {
  deps: DependencyReport;
  provenance: ProvenanceMap;
  metadata: SbomMetadata;
}

/** Options for {@link generateSbom}. */
export interface SbomOptions {
  /** Which document(s) to build. Default `'cyclonedx'` (the primary format). */
  format?: SbomFormat | 'both';
  /** Where to write the document(s). Absent ⇒ render only. */
  repoC?: string;
  /** Override the deterministic `created` timestamp. */
  now?: () => string;
  /** Override the content-derived serial seed. */
  serialSeed?: string;
  /** The P-128 verdict, mapped into `licenseConcluded`. */
  licenses?: LicenseReportData;
}

/** What {@link generateSbom} produced. */
export interface SbomOutput {
  format: SbomFormat | 'both';
  /** One document per requested format. */
  documents: { cyclonedx?: string; spdx?: string };
  /** The absolute paths written, when `repoC` was supplied. */
  written: string[];
  /** The components and purls, so a caller (P-220/P-307) need not re-parse. */
  components: SbomComponent[];
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

/** The runtime dependency map of a merged manifest, whichever ecosystem it is. */
function runtimeDependencies(manifest: UnifiedManifest): { name: string; version: string }[] {
  // `in`-narrowing, not a cast: each variant is distinguishable by a field the
  // others do not declare (ADR-041's no-cast rule).
  if ('require' in manifest) {
    return Object.entries(manifest.require).map(([name, version]) => ({ name, version }));
  }
  if ('package' in manifest) {
    return Object.entries(manifest.dependencies).map(([name, value]) => ({
      name,
      version: typeof value === 'string' ? value : value.version,
    }));
  }
  if ('source' in manifest) {
    return Object.entries(manifest.dependencies).map(([name, version]) => ({ name, version }));
  }
  const collected: { name: string; version: string }[] = [];
  for (const map of [
    manifest.dependencies,
    manifest.devDependencies,
    manifest.peerDependencies,
    manifest.optionalDependencies,
  ]) {
    if (map === undefined) continue;
    for (const [name, version] of Object.entries(map)) collected.push({ name, version });
  }
  return collected;
}

/** Build a purl for a component (phase step 2). */
export function buildPurl(
  ecosystem: DependencyReport['ecosystem'],
  name: string,
  version: string
): string {
  const type = PURL_TYPES[ecosystem];
  // An npm scoped name is a namespace + name pair; `@` must be percent-encoded
  // or the purl does not round-trip (`pkg:npm/%40angular/core@17.0.0`).
  if (type === 'npm' && name.startsWith('@')) {
    const withoutAt = name.slice(1);
    const slash = withoutAt.indexOf('/');
    const scope = slash === -1 ? withoutAt : withoutAt.slice(0, slash);
    const pkg = slash === -1 ? '' : withoutAt.slice(slash + 1);
    return `pkg:npm/${encodeURIComponent(`@${scope}`)}/${pkg}@${version}`;
  }
  return `pkg:${type}/${name}@${version}`;
}

/** Index P-128's rows by `package@version` — the component↔licence bridge. */
function licenseIndex(data: LicenseReportData | undefined): Map<string, LicenseReportRow> {
  const index = new Map<string, LicenseReportRow>();
  if (data === undefined) return index;
  for (const row of data.rows) index.set(`${row.package}@${row.version}`, row);
  return index;
}

function toComponent(
  ecosystem: DependencyReport['ecosystem'],
  dep: { name: string; version: string },
  index: Map<string, LicenseReportRow>
): SbomComponent {
  const row = index.get(`${dep.name}@${dep.version}`);
  const declared = row?.declared !== undefined && row.declared !== '' ? row.declared : NOASSERTION;
  const normalized =
    row?.normalized !== undefined && row.normalized !== '' ? row.normalized : declared;
  return {
    name: dep.name,
    version: dep.version,
    purl: buildPurl(ecosystem, dep.name, dep.version),
    licenseDeclared: declared,
    licenseConcluded: normalized,
    ...(row !== undefined ? { decision: row.decision } : {}),
  };
}

/** The components, sorted by purl for deterministic output (P-282). */
export function sbomComponents(input: {
  deps: DependencyReport;
  licenses?: LicenseReportData;
}): SbomComponent[] {
  const index = licenseIndex(input.licenses);
  const components = runtimeDependencies(input.deps.merged).map(dep =>
    toComponent(input.deps.ecosystem, dep, index)
  );
  components.sort((a, b) => a.purl.localeCompare(b.purl));
  return components;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Deterministic SPDX id for a component. */
function spdxIdFor(prefix: string, value: string): string {
  const safe = value.replace(/[^A-Za-z0-9.-]/g, '-');
  return `SPDXRef-${prefix}-${safe.slice(0, 80)}-${sha256(value).slice(0, 8)}`;
}

function createdStamp(input: SbomInput, opts: SbomOptions): string {
  if (opts.now !== undefined) return opts.now();
  // Input-derived, so the same inputs render identically (decision 2 above).
  return input.deps.generatedAt;
}

/** CycloneDX 1.5 JSON (phase step 1, primary format). */
export function renderCycloneDx(
  input: SbomInput,
  components: readonly SbomComponent[],
  opts: SbomOptions = {}
): string {
  const created = createdStamp(input, opts);
  const serialSeed =
    opts.serialSeed ?? `${input.deps.ecosystem}|${input.metadata.name}|${input.metadata.version}`;
  const origins = input.provenance.origins();

  const document = {
    bomFormat: 'CycloneDX',
    specVersion: CYCLONEDX_SPEC_VERSION,
    serialNumber: `urn:uuid:${sha256(serialSeed).slice(0, 32)}`,
    version: 1,
    metadata: {
      timestamp: created,
      tools: [{ vendor: TOOL_NAME, name: TOOL_NAME, version: input.metadata.version }],
      component: {
        type: 'application',
        name: input.metadata.name,
        version: input.metadata.version,
      },
    },
    components: components.map(component => ({
      type: 'library',
      'bom-ref': component.purl,
      name: component.name,
      version: component.version,
      purl: component.purl,
      licenses: [{ license: { id: component.licenseConcluded } }],
      properties: [
        { name: 'stitch:license-declared', value: component.licenseDeclared },
        ...(component.decision !== undefined
          ? [{ name: 'stitch:license-decision', value: component.decision }]
          : []),
      ],
    })),
    // Provenance rides in `properties` rather than inflating `components`, so a
    // consumer counting libraries gets the dependency set only.
    properties: origins.map(origin => ({
      name: `stitch:file-origin:${origin.file}`,
      value: `repo=${origin.repo};commit=${origin.sourceCommit === '' ? 'unknown' : origin.sourceCommit};sourcePath=${origin.sourcePath};stitchedBy=${origin.stitchedBy}`,
    })),
  };

  return `${JSON.stringify(document, null, 2)}\n`;
}

/** SPDX 2.3 JSON (phase step 1, optional format). */
export function renderSpdx(
  input: SbomInput,
  components: readonly SbomComponent[],
  opts: SbomOptions = {}
): string {
  const created = createdStamp(input, opts);
  const serialSeed =
    opts.serialSeed ?? `${input.deps.ecosystem}|${input.metadata.name}|${input.metadata.version}`;
  const origins = input.provenance.origins();

  const document = {
    spdxVersion: SPDX_VERSION,
    dataLicense: 'CC0-1.0',
    SPDXID: 'SPDXRef-DOCUMENT',
    name: input.metadata.name,
    documentNamespace: `https://repo-stitcher.invalid/${sha256(serialSeed)}`,
    creationInfo: { created, creators: [`Tool: ${TOOL_NAME}`] },
    packages: components.map(component => ({
      SPDXID: spdxIdFor('Package', component.purl),
      name: component.name,
      versionInfo: component.version,
      licenseDeclared: component.licenseDeclared,
      licenseConcluded: component.licenseConcluded,
      externalRefs: [
        {
          referenceCategory: 'PACKAGE-MANAGER',
          referenceType: 'purl',
          referenceLocator: component.purl,
        },
      ],
    })),
    files: origins.map(origin => ({
      SPDXID: spdxIdFor('File', origin.file),
      fileName: origin.file,
      // The phase asks for `artifactOf` attribution: which project this file
      // came from, and where that project lives.
      artifactOf: {
        name: origin.repo === 'unknown' ? 'unattributed' : `repo-${origin.repo}`,
        ...(origin.remoteUrl !== undefined ? { homepage: origin.remoteUrl } : {}),
      },
      comment: `sourceCommit=${origin.sourceCommit === '' ? 'unknown' : origin.sourceCommit}; sourcePath=${origin.sourcePath}; stitchedBy=${origin.stitchedBy}`,
    })),
  };

  return `${JSON.stringify(document, null, 2)}\n`;
}

// ---------------------------------------------------------------------------
// Validation (phase step 5)
// ---------------------------------------------------------------------------

/** A required-string check that also reports WHICH field failed. */
function requireStrings(
  record: Record<string, unknown>,
  fields: readonly string[],
  where: string
): string | undefined {
  for (const field of fields) {
    if (typeof record[field] !== 'string') return `${where}.${field} is not a string`;
  }
  return undefined;
}

/** Why the CycloneDX document is malformed, or `undefined` when it is fine. */
export function validateCycloneDx(document: unknown): string | undefined {
  if (typeof document !== 'object' || document === null) return 'document is not an object';
  const record = document as Record<string, unknown>;
  const missing = requireStrings(record, ['bomFormat', 'specVersion', 'serialNumber'], 'cyclonedx');
  if (missing !== undefined) return missing;
  if (record['bomFormat'] !== 'CycloneDX') return 'bomFormat must be CycloneDX';
  if (!Array.isArray(record['components'])) return 'components is not an array';
  for (const component of record['components']) {
    if (typeof component !== 'object' || component === null) return 'a component is not an object';
    const entry = component as Record<string, unknown>;
    const bad = requireStrings(entry, ['name', 'version', 'purl'], 'component');
    if (bad !== undefined) return bad;
    if (!Array.isArray(entry['licenses']))
      return `component ${String(entry['name'])} has no licenses array`;
  }
  if (!Array.isArray(record['properties'])) return 'properties is not an array';
  return undefined;
}

/** Why the SPDX document is malformed, or `undefined` when it is fine. */
export function validateSpdx(document: unknown): string | undefined {
  if (typeof document !== 'object' || document === null) return 'document is not an object';
  const record = document as Record<string, unknown>;
  const missing = requireStrings(
    record,
    ['spdxVersion', 'SPDXID', 'name', 'documentNamespace'],
    'spdx'
  );
  if (missing !== undefined) return missing;
  if (!Array.isArray(record['packages'])) return 'packages is not an array';
  for (const pkg of record['packages']) {
    if (typeof pkg !== 'object' || pkg === null) return 'a package is not an object';
    const entry = pkg as Record<string, unknown>;
    const bad = requireStrings(
      entry,
      ['SPDXID', 'name', 'versionInfo', 'licenseConcluded'],
      'package'
    );
    if (bad !== undefined) return bad;
    if (!Array.isArray(entry['externalRefs']))
      return `package ${String(entry['name'])} has no externalRefs`;
  }
  if (!Array.isArray(record['files'])) return 'files is not an array';
  return undefined;
}

// ---------------------------------------------------------------------------
// generateSbom
// ---------------------------------------------------------------------------

function detailOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * Validate a rendered SBOM, mapping a malformed document to `SBOM_INVALID`.
 *
 * Exported because this IS the gate rather than a detail of it: `generateSbom`
 * calls it before writing, and a test can call it with a malformed document to
 * prove the malformed path returns the typed error instead of writing a broken
 * artifact for compliance export (P-307) and the web view (P-220) to parse.
 */
export function checkSbom(text: string, format: SbomFormat): Result<void, StitchError> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (cause: unknown) {
    const detail = `does not parse as JSON: ${detailOf(cause)}`;
    return err({
      code: 'SBOM_INVALID',
      format,
      detail,
      message: `the generated ${format} SBOM failed validation: ${detail}`,
    });
  }
  const invalid = format === 'cyclonedx' ? validateCycloneDx(parsed) : validateSpdx(parsed);
  if (invalid !== undefined) {
    return err({
      code: 'SBOM_INVALID',
      format,
      detail: invalid,
      message: `the generated ${format} SBOM failed validation: ${invalid}`,
    });
  }
  return ok(undefined);
}

/**
 * Assemble the SBOM, validate it, and optionally write it out.
 *
 * Returns `err(SBOM_INVALID)` rather than writing a document that failed its own
 * shape check — the consumers of this file parse it.
 */
export async function generateSbom(
  input: SbomInput,
  opts: SbomOptions = {}
): Promise<Result<SbomOutput, StitchError>> {
  if (input.metadata.name.trim() === '' || input.metadata.version.trim() === '') {
    return err({
      code: 'CONFIG_ERROR',
      field: 'metadata',
      message: 'generateSbom: metadata.name and metadata.version are required',
    });
  }

  const format = opts.format ?? 'cyclonedx';
  const components = sbomComponents({
    deps: input.deps,
    ...(opts.licenses !== undefined ? { licenses: opts.licenses } : {}),
  });
  const documents: SbomOutput['documents'] = {};
  const written: string[] = [];

  const requested: SbomFormat[] = format === 'both' ? ['cyclonedx', 'spdx'] : [format];
  for (const one of requested) {
    const text =
      one === 'cyclonedx'
        ? renderCycloneDx(input, components, opts)
        : renderSpdx(input, components, opts);

    // Validate BEFORE writing: a rejected document must not reach disk.
    const checked = checkSbom(text, one);
    if (checked.isErr()) return err(checked.error);

    if (one === 'cyclonedx') documents.cyclonedx = text;
    else documents.spdx = text;
  }

  if (opts.repoC !== undefined) {
    if (opts.repoC.trim() === '') {
      return err({
        code: 'CONFIG_ERROR',
        field: 'repoC',
        message: 'generateSbom: repoC must not be blank when provided',
      });
    }
    const base = opts.repoC.replace(/[/\\]+$/, '');
    for (const one of requested) {
      const text = one === 'cyclonedx' ? documents.cyclonedx : documents.spdx;
      if (text === undefined) continue;
      const target = join(base, SBOM_FILENAMES[one]);
      try {
        await outputFile(target, text);
      } catch (cause: unknown) {
        return err({
          code: 'INTERNAL',
          message: `generateSbom: cannot write ${target}: ${detailOf(cause)}`,
        });
      }
      written.push(target);
    }
  }

  return ok({ format, documents, written, components });
}

/** The origins of a map, sorted — re-exported for callers rendering alongside. */
export function sortedOrigins(map: ProvenanceMap): FileOrigin[] {
  return map.origins();
}
