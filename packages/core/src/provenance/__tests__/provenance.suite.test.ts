// P-188 — the provenance suite: the whole trust chain, end to end.
//
// Provenance is the trust layer, so this file tests the modules TOGETHER rather
// than one at a time: each module's own suite proves its contract, and this one
// proves they wire up. The chain runs against ONE staged tree:
//
//   fixtures A/B → staged tree C (P-070 teleport shape) → blame (P-079) →
//   ProvenanceMap (P-181) → CREDITS (P-182) → SBOM (P-183) → git note (P-184) →
//   HTTP contract (P-185) → checksum manifest (P-186) → audit (P-187)
//
// The five required scenarios from the phase spec:
//
//   it('attribution full chain')        it('deterministic map')
//   it('sbom license matches verdict')  it('detects tampering')
//   it('audit append only')
//
// Two notes on scope. The git-core MERGE (P-072/P-076) has its own suite and its
// own fixtures; re-driving it here would make this a git-core integration test, so
// C is staged in the teleport shape P-181's suite already models. And the
// dependency report below is an INDEPENDENT fixture input — a `GoManifest` because
// every required field of that variant is knowable (P-183's reasoning) — not a
// description of the JS fixture repos.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  disposeRepo,
  headSha,
  makeTempRepo,
  FIXTURE_IDENTITY,
  type SeedFiles,
} from '../../../test-utils/gitFixtures.js';
import { buildBlameMap, type BlameMap, type BlameSource } from '../../git/blameMap.js';
import { type DependencyReport, type GoManifest } from '../../deps/types.js';
import { type LicenseReportData } from '../../license/types.js';
import { makeDbAdapter } from '../../sandbox/__tests__/fake-docker.js';
import { buildProvenanceMap } from '../map.js';
import { generateCredits } from '../credits.js';
import { generateSbom } from '../sbom.js';
import { mapChecksum, readGitNotes, writeGitNotes } from '../gitnotes.js';
import { buildChecksumManifest, verifyChecksums } from '../checksums.js';
import { ProvenanceAudit, AUDIT_ACTIONS } from '../audit.js';
import { serializeProvenanceMap } from '../api.js';
import {
  FIXTURE_PREFIX_A,
  FIXTURE_PREFIX_B,
  FIXTURE_REPO_A,
  FIXTURE_REPO_B,
} from './fixtures/index.js';

const FIXED_TS = '2026-10-16T00:00:00.000Z';

let repoA: string;
let repoB: string;
let repoC: string;
let shaA: string;
let shaB: string;
let shaC: string;
let sources: BlameSource[];
let blame: BlameMap;

/** The composite child seed: each repo's files under its teleport prefix. */
function childSeed(): SeedFiles {
  const seed: Record<string, string> = {};
  for (const [rel, content] of Object.entries(FIXTURE_REPO_A)) {
    seed[`${FIXTURE_PREFIX_A}/${rel}`] = content;
  }
  for (const [rel, content] of Object.entries(FIXTURE_REPO_B)) {
    seed[`${FIXTURE_PREFIX_B}/${rel}`] = content;
  }
  return seed;
}

beforeAll(async () => {
  repoA = await makeTempRepo('stitch-suite-a-', { seed: FIXTURE_REPO_A, message: 'a: seed' });
  repoB = await makeTempRepo('stitch-suite-b-', { seed: FIXTURE_REPO_B, message: 'b: seed' });
  shaA = await headSha(repoA);
  shaB = await headSha(repoB);

  repoC = await makeTempRepo('stitch-suite-c-', { seed: childSeed(), message: 'c: stitch' });
  shaC = await headSha(repoC);
  sources = [
    { name: 'repo-a', prefix: FIXTURE_PREFIX_A, tipSha: shaA },
    { name: 'repo-b', prefix: FIXTURE_PREFIX_B, tipSha: shaB },
  ];

  const blamed = await buildBlameMap(repoC, sources);
  expect(blamed.isOk()).toBe(true);
  if (blamed.isErr()) throw new Error(`fixture blame failed: ${blamed.error.code}`);
  blame = blamed.value;
}, 180_000);

afterAll(async () => {
  await disposeRepo(repoA);
  await disposeRepo(repoB);
  await disposeRepo(repoC);
});

/** The dependency-report fixture (independent of the JS repos — see header). */
function depReport(): DependencyReport {
  const merged: GoManifest = {
    module: 'example.test/stitched',
    goVersion: '1.23',
    require: { 'github.com/pkg/errors': 'v0.9.1' },
  };
  return {
    generatedAt: FIXED_TS,
    ecosystem: 'go',
    inputSources: [
      { repoName: 'repo-a', manifestPath: 'go.mod' },
      { repoName: 'repo-b', manifestPath: 'go.mod' },
    ],
    merged,
    dependencyCount: { direct: 1, dev: 0, peer: 0, total: 1 },
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
    verdict: 'allow',
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

describe('P-188 provenance suite', () => {
  it('attribution full chain', async () => {
    const db = makeDbAdapter();
    try {
      // 1. MAP — every staged file carries a real repo, commit and author.
      const built = await buildProvenanceMap(blame, { sources, now: () => FIXED_TS });
      expect(built.isOk()).toBe(true);
      if (built.isErr()) return;
      const map = built.value;

      const stagedPaths = blame.files.map(file => file.path);
      expect(stagedPaths.length).toBeGreaterThanOrEqual(5);
      for (const path of stagedPaths) {
        const origin = map.getOrigin(path);
        expect(origin, `no origin for ${path}`).toBeDefined();
        // The commit C actually blames for these lines. In a real pipeline the
        // git-core merge (P-072) IMPORTS A/B's objects, so this would be the
        // upstream commit; this suite stages the tree directly (see the header),
        // so the honest expectation is C's own commit — asserted as such rather
        // than asserted against a SHA this fixture cannot produce.
        expect(origin?.sourceCommit).toBe(shaC);
        expect(origin?.repo).toBe(path.startsWith(FIXTURE_PREFIX_A) ? 'A' : 'B');
        expect(origin?.sourceAuthor).toBe(FIXTURE_IDENTITY.name);
        // The teleport prefix is stripped, so the ORIGINAL path is what a reader sees.
        expect(origin?.sourcePath.startsWith(FIXTURE_PREFIX_A)).toBe(false);
        expect(origin?.sourcePath.startsWith(FIXTURE_PREFIX_B)).toBe(false);
      }
      expect(map.warnings()).toEqual([]);

      // 2. CREDITS — grouped by repo, with the files and short commits.
      const credits = await generateCredits(map, { includeEmails: false });
      expect(credits.isOk()).toBe(true);
      if (credits.isOk()) {
        expect(credits.value).toContain('## A');
        expect(credits.value).toContain('## B');
        expect(credits.value).toContain('`repo-a/lib/util.js` (from `lib/util.js`)');
        expect(credits.value).toContain(shaC.slice(0, 7));
        expect(credits.value).toContain(FIXTURE_IDENTITY.name);
        expect(credits.value).toContain('No files were stitched by the agent.');
      }

      // 3. SBOM — deps with purls AND the provenance entries.
      const sbom = await generateSbom(
        {
          deps: depReport(),
          provenance: map,
          metadata: { name: 'stitched-child', version: '1.0.0', ecosystem: 'go' },
        },
        { format: 'both', licenses: licenseData() }
      );
      expect(sbom.isOk()).toBe(true);
      if (sbom.isOk()) {
        const cdx = JSON.parse(sbom.value.documents.cyclonedx ?? '{}') as {
          components: { purl: string }[];
          properties: { name: string; value: string }[];
        };
        expect(cdx.components.map(c => c.purl)).toContain(
          'pkg:golang/github.com/pkg/errors@v0.9.1'
        );
        const originProp = cdx.properties.find(p =>
          p.name.startsWith('stitch:file-origin:repo-a/lib/util.js')
        );
        expect(originProp?.value).toContain(`commit=${shaC}`);
        expect(sbom.value.documents.spdx).toBeDefined();
      }

      // 4. GIT NOTE — the durable reference round-trips.
      const note = await writeGitNotes(repoC, 'HEAD', {
        schemaVersion: 1,
        provenanceRef: 'sbom.cyclonedx.json',
        mapChecksum: mapChecksum(map),
        generatedAt: FIXED_TS,
        statistics: { files: map.size, repos: 2 },
      });
      expect(note.isOk()).toBe(true);
      const readBack = await readGitNotes(repoC, 'HEAD');
      expect(readBack.isOk()).toBe(true);
      if (readBack.isOk() && readBack.value !== undefined) {
        expect(readBack.value['mapChecksum']).toBe(mapChecksum(map));
        expect(readBack.value['provenanceRef']).toBe('sbom.cyclonedx.json');
      }

      // 5. CHECKSUMS — the manifest describes C and verifies clean.
      const manifest = await buildChecksumManifest(repoC, { now: () => FIXED_TS });
      expect(manifest.isOk()).toBe(true);
      if (manifest.isOk()) {
        expect(manifest.value.entries.length).toBeGreaterThanOrEqual(5);
        const clean = await verifyChecksums(repoC, manifest.value);
        expect(clean.isOk()).toBe(true);
        if (clean.isOk()) expect(clean.value.valid).toBe(true);
      }

      // 6. AUDIT — a representative action set over the same job.
      const audit = new ProvenanceAudit({ db, now: () => FIXED_TS });
      for (const action of [
        'clone',
        'merge',
        'license_verdict',
        'sbom',
        'checksum',
        'git_notes',
      ] as const) {
        const appended = await audit.append({
          action,
          actor: 'pipeline',
          jobId: 'job-1',
          detail: {},
          ok: true,
        });
        expect(appended.isOk()).toBe(true);
      }
      const recorded = await audit.query({ jobId: 'job-1' });
      expect(recorded.isOk()).toBe(true);
      if (recorded.isOk()) expect(recorded.value).toHaveLength(6);

      // 7. HTTP CONTRACT — the same map the UI will read.
      const dto = serializeProvenanceMap(map);
      expect(dto.stats.total).toBe(map.size);
      expect(dto.stats.byRepo).toEqual({ A: expect.any(Number), B: expect.any(Number) });
      expect(dto.stats.agentEdited).toBe(0);
      expect(dto.stats.unattributed).toBe(0);
      // The transport preserves the map's own order (path-sorted, P-282). Note it
      // is `localeCompare` order, which is NOT the same as a default code-unit
      // `.sort()` — asserting the latter would be asserting the wrong contract.
      expect(dto.files.map(file => file.file)).toEqual(map.origins().map(origin => origin.file));
      const ordered = [...dto.files.map(f => f.file)];
      expect(ordered).toEqual([...ordered].sort((a, b) => a.localeCompare(b)));
    } finally {
      db.close();
    }
  }, 180_000);

  it('deterministic map', async () => {
    // TWO INDEPENDENT PASSES over the same tree — a fresh blame and a fresh map
    // each time. Same inputs must mean the same output; that is the acceptance's
    // wording, and the reason the map's clock is injectable.
    const firstBlame = await buildBlameMap(repoC, sources);
    const secondBlame = await buildBlameMap(repoC, sources);
    expect(firstBlame.isOk() && secondBlame.isOk()).toBe(true);
    if (firstBlame.isErr() || secondBlame.isErr()) return;
    expect(secondBlame.value).toEqual(firstBlame.value);

    const first = await buildProvenanceMap(firstBlame.value, { sources, now: () => FIXED_TS });
    const second = await buildProvenanceMap(secondBlame.value, { sources, now: () => FIXED_TS });
    expect(first.isOk() && second.isOk()).toBe(true);
    if (first.isErr() || second.isErr()) return;

    expect(second.value.origins()).toEqual(first.value.origins());
    expect(serializeProvenanceMap(second.value)).toEqual(serializeProvenanceMap(first.value));
    // The checksum is stable for the same map, which is what makes the git note
    // and the SBOM reference comparable across runs.
    expect(mapChecksum(second.value)).toBe(mapChecksum(first.value));

    // And CREDITS is byte-stable for the same map.
    const creditsA = await generateCredits(first.value);
    const creditsB = await generateCredits(second.value);
    if (creditsA.isOk() && creditsB.isOk()) expect(creditsB.value).toBe(creditsA.value);

    // The manifest hash is stable too, even across a different clock — the
    // property ADR-059 pinned.
    const m1 = await buildChecksumManifest(repoC, { now: () => FIXED_TS });
    const m2 = await buildChecksumManifest(repoC, { now: () => '2030-01-01T00:00:00.000Z' });
    if (m1.isOk() && m2.isOk()) expect(m2.value.manifestSha256).toBe(m1.value.manifestSha256);
  }, 180_000);

  it('sbom license matches verdict', async () => {
    const built = await buildProvenanceMap(blame, { sources, now: () => FIXED_TS });
    expect(built.isOk()).toBe(true);
    if (built.isErr()) return;

    const sbom = await generateSbom(
      {
        deps: depReport(),
        provenance: built.value,
        metadata: { name: 'stitched-child', version: '1.0.0', ecosystem: 'go' },
      },
      { format: 'cyclonedx', licenses: licenseData() }
    );
    expect(sbom.isOk()).toBe(true);
    if (sbom.isErr()) return;

    const component = sbom.value.components.find(c => c.name === 'github.com/pkg/errors');
    // The P-128 verdict supplies the concluded term, and the decision rides along.
    expect(component?.licenseConcluded).toBe('BSD-2-Clause');
    expect(component?.licenseDeclared).toBe('BSD-2-Clause');
    expect(component?.decision).toBe('allow');

    // A component the report does not cover asserts exactly that.
    const withUnknownDep = await generateSbom(
      {
        deps: {
          ...depReport(),
          merged: {
            ...(depReport().merged as GoManifest),
            require: { 'example.test/other': 'v1.0.0' },
          },
        },
        provenance: built.value,
        metadata: { name: 'stitched-child', version: '1.0.0', ecosystem: 'go' },
      },
      { format: 'cyclonedx', licenses: licenseData() }
    );
    if (withUnknownDep.isOk()) {
      expect(withUnknownDep.value.components[0]?.licenseConcluded).toBe('NOASSERTION');
      expect(withUnknownDep.value.components[0]?.decision).toBeUndefined();
    }
  }, 180_000);

  it('detects tampering', async () => {
    const manifest = await buildChecksumManifest(repoC);
    expect(manifest.isOk()).toBe(true);
    if (manifest.isErr()) return;

    const target = join(repoC, FIXTURE_PREFIX_A, 'lib/util.js');
    const original = await readFile(target, 'utf8');
    try {
      // A single appended comment is enough — the anchor is byte-exact.
      await writeFile(target, `${original}// tampered\n`, 'utf8');
      const drifted = await verifyChecksums(repoC, manifest.value);
      expect(drifted.isOk()).toBe(true);
      if (drifted.isOk()) {
        expect(drifted.value.valid).toBe(false);
        expect(drifted.value.mismatches).toContain(`${FIXTURE_PREFIX_A}/lib/util.js`);
      }

      // The same perturbation moves the manifest hash, so the anchor would not
      // silently match a re-generated manifest either.
      const regenerated = await buildChecksumManifest(repoC);
      if (regenerated.isOk()) {
        expect(regenerated.value.manifestSha256).not.toBe(manifest.value.manifestSha256);
      }
    } finally {
      await writeFile(target, original, 'utf8');
    }

    // Restored ⇒ clean again.
    const restored = await verifyChecksums(repoC, manifest.value);
    expect(restored.isOk()).toBe(true);
    if (restored.isOk()) expect(restored.value.valid).toBe(true);
  }, 180_000);

  it('audit append only', async () => {
    const db = makeDbAdapter();
    try {
      const audit = new ProvenanceAudit({ db, now: () => FIXED_TS });

      // There is no mutation to call. This is the guarantee, checked structurally.
      const surface = new Set(Object.getOwnPropertyNames(Object.getPrototypeOf(audit)));
      for (const forbidden of [
        'update',
        'delete',
        'remove',
        'edit',
        'clear',
        'reset',
        'truncate',
      ]) {
        expect(surface.has(forbidden), `audit exposes ${forbidden}`).toBe(false);
      }

      for (const action of AUDIT_ACTIONS.slice(0, 4)) {
        await audit.append({ action, actor: 'agent', jobId: 'job-2', detail: {}, ok: true });
      }
      const before = await audit.fullAudit();
      expect(before.isOk()).toBe(true);
      if (before.isErr()) return;
      expect(before.value).toHaveLength(4);

      // Appending is the ONLY mutation, so the earlier rows are untouched.
      await audit.append({
        action: 'push',
        actor: 'pipeline',
        jobId: 'job-2',
        detail: {},
        ok: false,
      });
      const after = await audit.fullAudit();
      if (after.isOk()) {
        expect(after.value).toHaveLength(5);
        const ids = new Set(after.value.map(record => record.id));
        for (const record of before.value) expect(ids.has(record.id)).toBe(true);
      }

      // A credential in a detail is scrubbed before it can reach the dump.
      await audit.append({
        action: 'commit',
        actor: 'agent',
        detail: { env: 'GITHUB_TOKEN=ghp_ABCDEFGHIJKLMNOPQRST' },
        ok: true,
      });
      const exported = await audit.exportJson();
      expect(exported.isOk()).toBe(true);
      if (exported.isOk()) {
        expect(exported.value).not.toContain('ghp_ABCDEFGHIJKLMNOPQRST');
        expect(exported.value).toContain('[REDACTED]');
        const parsed = JSON.parse(exported.value) as AuditShape[];
        expect(parsed).toHaveLength(6);
      }
    } finally {
      db.close();
    }
  });
});

/** The exported shape, typed rather than `any`. */
interface AuditShape {
  ts: string;
  action: string;
  id: string;
}
