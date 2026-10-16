// P-183 — SBOM tests.
//
// The inputs are built from REAL types rather than mocks: a `DependencyReport`
// whose `merged` manifest is a genuine `GoManifest` (every required field of that
// variant is known, so no guessed shape enters the fixture), a real
// `LicenseReportData`, and a real P-181 `ProvenanceMap`. The documents are then
// parsed back and asserted, so a renderer that emits the right words in the wrong
// structure fails here.
//
// The five required scenarios from the phase spec:
//
//   it('builds cyclonedx with deps+licenses')   it('builds spdx packages')
//   it('forms purls')                          it('maps license verdict')
//   it('validates schema')

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type DependencyReport, type GoManifest } from '../deps/types.js';
import { type LicenseReportData } from '../license/types.js';
import { ProvenanceMap, type FileOrigin } from './map.js';
import {
  SBOM_FILENAMES,
  buildPurl,
  checkSbom,
  generateSbom,
  renderCycloneDx,
  sbomComponents,
  validateCycloneDx,
  validateSpdx,
  type SbomInput,
} from './sbom.js';

const FIXED_TS = '2026-10-16T00:00:00.000Z';
const SHA_A = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';

/** A genuine Go manifest: the variant whose required fields are all known. */
const GO_MANIFEST: GoManifest = {
  module: 'example.test/child',
  goVersion: '1.23',
  require: {
    'github.com/pkg/errors': 'v0.9.1',
    'golang.org/x/text': 'v0.14.0',
  },
};

function depReport(): DependencyReport {
  return {
    generatedAt: FIXED_TS,
    ecosystem: 'go',
    inputSources: [{ repoName: 'repo-a', manifestPath: 'go.mod' }],
    merged: GO_MANIFEST,
    dependencyCount: { direct: 2, dev: 0, peer: 0, total: 2 },
    conflicts: [],
    dedupe: [],
    scripts: { merged: {}, collisions: [] },
    lockfile: null,
    summary: { mergeable: true, needsHuman: false, blockedBy: [] },
  };
}

function licenseData(): LicenseReportData {
  return {
    reportVersion: 1,
    generatedAt: FIXED_TS,
    verdict: 'review',
    blocking: false,
    rows: [
      {
        package: 'github.com/pkg/errors',
        version: 'v0.9.1',
        declared: 'BSD-2-Clause',
        normalized: 'BSD-2-Clause',
        category: 'permissive',
        decision: 'allow',
      },
    ],
    summary: { total: 1, allow: 1, review: 0, deny: 0, unknown: 0, gplWarnings: 0 },
    dualLicenses: [],
    gplWarnings: [],
    unknown: [],
  };
}

function provenance(): ProvenanceMap {
  const origin: FileOrigin = {
    file: 'repo-a/lib/util.go',
    repo: 'A',
    remoteUrl: 'https://example.test/a.git',
    sourceCommit: SHA_A,
    sourcePath: 'lib/util.go',
    sourceAuthor: 'Ada Lovelace',
    copiedAt: FIXED_TS,
    stitchedBy: 'agent',
  };
  return ProvenanceMap.from([origin]);
}

function input(): SbomInput {
  return {
    deps: depReport(),
    provenance: provenance(),
    metadata: { name: 'stitched-child', version: '1.0.0', ecosystem: 'go' },
  };
}

/** The shapes the assertions read back (typed, never `any`). */
interface CdxComponent {
  name: string;
  version: string;
  purl: string;
  licenses: { license: { id: string } }[];
  properties: { name: string; value: string }[];
}
interface CdxDoc {
  bomFormat: string;
  specVersion: string;
  serialNumber: string;
  metadata: { timestamp: string; tools: { name: string }[]; component: { name: string } };
  components: CdxComponent[];
  properties: { name: string; value: string }[];
}
interface SpdxPackage {
  SPDXID: string;
  name: string;
  versionInfo: string;
  licenseDeclared: string;
  licenseConcluded: string;
  externalRefs: { referenceType: string; referenceLocator: string }[];
}
interface SpdxFile {
  SPDXID: string;
  fileName: string;
  artifactOf: { name: string; homepage?: string };
  comment: string;
}
interface SpdxDoc {
  spdxVersion: string;
  SPDXID: string;
  documentNamespace: string;
  creationInfo: { created: string; creators: string[] };
  packages: SpdxPackage[];
  files: SpdxFile[];
}

let scratch: string;

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'stitch-sbom-'));
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

describe('P-183 sbom', () => {
  it('builds cyclonedx with deps+licenses', async () => {
    const built = await generateSbom(input(), { format: 'cyclonedx', licenses: licenseData() });
    expect(built.isOk()).toBe(true);
    if (built.isErr()) return;

    // The phase's declared single-string return cannot express `both`, so the
    // result carries one document per requested format (ADR-056).
    expect(built.value.format).toBe('cyclonedx');
    expect(built.value.documents.spdx).toBeUndefined();
    const text = built.value.documents.cyclonedx;
    expect(text).toBeDefined();
    if (text === undefined) return;

    const doc = JSON.parse(text) as CdxDoc;
    expect(doc.bomFormat).toBe('CycloneDX');
    expect(doc.specVersion).toBe('1.5');
    expect(doc.metadata.tools[0]?.name).toBe('repo-stitcher');
    expect(doc.metadata.component.name).toBe('stitched-child');

    // Every dependency is a component with a purl and a licence entry.
    expect(doc.components).toHaveLength(2);
    const names = doc.components.map(c => c.name).sort();
    expect(names).toEqual(['github.com/pkg/errors', 'golang.org/x/text']);
    for (const component of doc.components) {
      expect(component.purl).toMatch(/^pkg:golang\//);
      expect(component.licenses).toHaveLength(1);
    }

    // Provenance rides in `properties`, keyed by the C path, carrying the REAL
    // source commit — that is the whole point of putting it in the SBOM.
    const origin = doc.properties.find(p => p.name === 'stitch:file-origin:repo-a/lib/util.go');
    expect(origin).toBeDefined();
    expect(origin?.value).toContain(`commit=${SHA_A}`);
    expect(origin?.value).toContain('repo=A');
    expect(origin?.value).toContain('stitchedBy=agent');

    // Deterministic: the serial is content-derived, not random.
    const again = await generateSbom(input(), { format: 'cyclonedx', licenses: licenseData() });
    if (again.isOk() && again.value.documents.cyclonedx !== undefined) {
      expect(JSON.parse(again.value.documents.cyclonedx)).toEqual(doc);
    }

    // `both` emits each document rather than picking one.
    const both = await generateSbom(input(), { format: 'both', licenses: licenseData() });
    if (both.isOk()) {
      expect(both.value.documents.cyclonedx).toBeDefined();
      expect(both.value.documents.spdx).toBeDefined();
    }
  });

  it('builds spdx packages', async () => {
    const built = await generateSbom(input(), { format: 'spdx', licenses: licenseData() });
    expect(built.isOk()).toBe(true);
    if (built.isErr()) return;
    const text = built.value.documents.spdx;
    expect(text).toBeDefined();
    if (text === undefined) return;

    const doc = JSON.parse(text) as SpdxDoc;
    expect(doc.spdxVersion).toBe('SPDX-2.3');
    expect(doc.SPDXID).toBe('SPDXRef-DOCUMENT');
    expect(doc.creationInfo.creators).toEqual(['Tool: repo-stitcher']);
    expect(doc.documentNamespace).toContain('https://repo-stitcher.invalid/');

    expect(doc.packages).toHaveLength(2);
    const pkg = doc.packages.find(p => p.name === 'github.com/pkg/errors');
    expect(pkg).toBeDefined();
    expect(pkg?.SPDXID.startsWith('SPDXRef-Package-')).toBe(true);
    expect(pkg?.versionInfo).toBe('v0.9.1');
    expect(pkg?.licenseConcluded).toBe('BSD-2-Clause');
    expect(pkg?.externalRefs[0]?.referenceType).toBe('purl');
    expect(pkg?.externalRefs[0]?.referenceLocator).toBe('pkg:golang/github.com/pkg/errors@v0.9.1');

    // Provenance files carry `artifactOf` attribution, as the phase asks.
    expect(doc.files).toHaveLength(1);
    const file = doc.files[0];
    expect(file?.fileName).toBe('repo-a/lib/util.go');
    expect(file?.SPDXID.startsWith('SPDXRef-File-')).toBe(true);
    expect(file?.artifactOf.name).toBe('repo-A');
    expect(file?.artifactOf.homepage).toBe('https://example.test/a.git');
    expect(file?.comment).toContain(`sourceCommit=${SHA_A}`);
  });

  it('forms purls', () => {
    // The report's ecosystem is P-115's parser id, which maps 1:1 onto purl types.
    expect(buildPurl('go', 'github.com/pkg/errors', 'v0.9.1')).toBe(
      'pkg:golang/github.com/pkg/errors@v0.9.1'
    );
    expect(buildPurl('python', 'requests', '2.31.0')).toBe('pkg:pypi/requests@2.31.0');
    expect(buildPurl('cargo', 'serde', '1.0.0')).toBe('pkg:cargo/serde@1.0.0');
    expect(buildPurl('npm', 'lodash', '4.17.21')).toBe('pkg:npm/lodash@4.17.21');
    // A scoped npm name is a namespace + name pair, and `@` must be encoded or
    // the purl does not round-trip.
    expect(buildPurl('npm', '@angular/core', '17.0.0')).toBe('pkg:npm/%40angular/core@17.0.0');

    // Components carry the purl built the same way.
    const components = sbomComponents({ deps: depReport(), licenses: licenseData() });
    expect(components.map(c => c.purl)).toEqual([
      'pkg:golang/github.com/pkg/errors@v0.9.1',
      'pkg:golang/golang.org/x/text@v0.14.0',
    ]);
  });

  it('maps license verdict', () => {
    const components = sbomComponents({ deps: depReport(), licenses: licenseData() });
    const withRow = components.find(c => c.name === 'github.com/pkg/errors');
    const withoutRow = components.find(c => c.name === 'golang.org/x/text');

    // The P-128 verdict supplies both terms, and the decision is exposed.
    expect(withRow?.licenseDeclared).toBe('BSD-2-Clause');
    expect(withRow?.licenseConcluded).toBe('BSD-2-Clause');
    expect(withRow?.decision).toBe('allow');

    // A component with no licence row asserts exactly that — it does not
    // silently claim a permissive licence.
    expect(withoutRow?.licenseDeclared).toBe('NOASSERTION');
    expect(withoutRow?.licenseConcluded).toBe('NOASSERTION');
    expect(withoutRow?.decision).toBeUndefined();

    // …and with no P-128 data at all, nothing is invented.
    const bare = sbomComponents({ deps: depReport() });
    expect(bare.every(c => c.licenseConcluded === 'NOASSERTION')).toBe(true);
  });

  it('validates schema', async () => {
    const cdx = renderCycloneDx(
      input(),
      sbomComponents({ deps: depReport(), licenses: licenseData() })
    );
    const spdx = await generateSbom(input(), { format: 'spdx', licenses: licenseData() });
    expect(validateCycloneDx(JSON.parse(cdx) as unknown)).toBeUndefined();
    if (spdx.isOk() && spdx.value.documents.spdx !== undefined) {
      expect(validateSpdx(JSON.parse(spdx.value.documents.spdx) as unknown)).toBeUndefined();
    }

    // Malformed documents are rejected with the ACTUAL reason, so a caller can
    // act on it rather than guess.
    expect(validateCycloneDx(null)).toBe('document is not an object');
    expect(validateCycloneDx({})).toContain('bomFormat');
    expect(validateCycloneDx({ bomFormat: 'SPDX' })).toContain('specVersion');
    expect(
      validateCycloneDx({
        bomFormat: 'CycloneDX',
        specVersion: '1.5',
        serialNumber: 'urn:uuid:x',
        components: [{ name: 'a', version: '1', purl: 'pkg:npm/a@1' }],
        properties: [],
      })
    ).toContain('licenses');
    expect(validateSpdx({ spdxVersion: 'SPDX-2.3' })).toContain('SPDXID');

    // The GATE `generateSbom` itself uses: a malformed document returns the
    // typed SBOM_INVALID (P-183's own code) rather than being written.
    const rejected = checkSbom('{}', 'cyclonedx');
    expect(rejected.isErr()).toBe(true);
    if (rejected.isErr()) {
      expect(rejected.error.code).toBe('SBOM_INVALID');
      if (rejected.error.code === 'SBOM_INVALID') {
        expect(rejected.error.format).toBe('cyclonedx');
        expect(rejected.error.detail).toContain('bomFormat');
      }
    }
    const unparseable = checkSbom('not json', 'spdx');
    expect(unparseable.isErr()).toBe(true);
    if (unparseable.isErr()) expect(unparseable.error.code).toBe('SBOM_INVALID');
    expect(checkSbom(cdx, 'cyclonedx').isOk()).toBe(true);

    // Written to `<repoC>/sbom.cyclonedx.json`, and the file matches the text.
    const written = await generateSbom(input(), {
      format: 'cyclonedx',
      licenses: licenseData(),
      repoC: scratch,
    });
    expect(written.isOk()).toBe(true);
    if (written.isErr()) return;
    const target = join(scratch, SBOM_FILENAMES.cyclonedx);
    await expect(stat(target)).resolves.toBeTruthy();
    const onDisk = await readFile(target, 'utf8');
    expect(onDisk).toBe(written.value.documents.cyclonedx);
    expect(written.value.written).toEqual([target]);

    // A blank target is a typed config error, and blank metadata is refused
    // before any rendering happens.
    const blank = await generateSbom(input(), { repoC: '  ' });
    expect(blank.isErr()).toBe(true);
    if (blank.isErr()) expect(blank.error.code).toBe('CONFIG_ERROR');
    const noMeta = await generateSbom({
      deps: depReport(),
      provenance: provenance(),
      metadata: { name: '', version: '1.0.0', ecosystem: 'go' },
    });
    expect(noMeta.isErr()).toBe(true);
    if (noMeta.isErr()) expect(noMeta.error.code).toBe('CONFIG_ERROR');
  });
});
