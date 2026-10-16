// P-181 — provenance tests, against REAL git repositories.
//
// The mandated fixtures are "two fixture git repos merged", so the blame maps
// are produced by running actual git (`makeTempRepo` + `commitFiles`) and the
// attribution is asserted against the REAL commit SHAs those repos produced —
// a hand-built blame map would prove nothing about the git seam P-079 owns.
//
// The five required scenarios from the phase spec:
//
//   it('attributes A file to A commit')   it('marks agent edits')
//   it('maps teleported path')            it('flags unattributed')
//   it('persists and queries')

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { migrate } from '../store/schema.js';
import { buildBlameMap, type BlameMap, type BlameSource } from '../git/blameMap.js';
import { parseOriginTrailer } from '../agent/gitFacade.js';
import {
  FIXTURE_IDENTITY,
  commitFiles,
  disposeRepo,
  headSha,
  makeTempRepo,
} from '../../test-utils/gitFixtures.js';
import { makeDbAdapter } from '../sandbox/__tests__/fake-docker.js';
import {
  ProvenanceMap,
  buildProvenanceMap,
  describeProvenanceWarning,
  UNKNOWN_COMMIT,
  type ProvenanceWarning,
} from './map.js';

// A's file carries the P-070 filter-repo teleport prefix (`repo-a/`), B's does
// not — so one fixture covers the plain case and the nested one.
const TELEPORT_PREFIX = 'repo-a';
const A_PATH_IN_C = `${TELEPORT_PREFIX}/lib/util.ts`;
const B_PATH_IN_C = 'cmd/main.go';

const SOURCES_ORDER = ['repo-a', 'repo-b'] as const;

let repoA: string;
let repoB: string;
let shaA: string;
let shaB: string;
let blameA: BlameMap;
let blameB: BlameMap;
// Assigned in `beforeAll`: a source's `tipSha` is only known once the fixture
// repo has committed, and a source with NO teleport `prefix` cannot be resolved
// by ancestry without it (the file then blames to no source at all).
let SOURCES: BlameSource[];

beforeAll(async () => {
  repoA = await makeTempRepo('stitch-prov-a-', {
    seed: {
      [`${TELEPORT_PREFIX}/lib/util.ts`]: 'export const a = 1;\nexport const b = 2;\n',
    },
    message: 'a: seed util',
  });
  repoB = await makeTempRepo('stitch-prov-b-', {
    seed: { [B_PATH_IN_C]: 'package main\nfunc main() {}\n' },
    message: 'b: seed main',
  });
  shaA = await headSha(repoA);
  shaB = await headSha(repoB);

  SOURCES = [
    { name: SOURCES_ORDER[0], prefix: TELEPORT_PREFIX, tipSha: shaA },
    { name: SOURCES_ORDER[1], tipSha: shaB },
  ];

  const blamedA = await buildBlameMap(repoA, [SOURCES[0] as BlameSource]);
  expect(blamedA.isOk()).toBe(true);
  if (blamedA.isErr()) throw new Error(`fixture blame A failed: ${blamedA.error.code}`);
  blameA = blamedA.value;

  const blamedB = await buildBlameMap(repoB, [SOURCES[1] as BlameSource]);
  expect(blamedB.isOk()).toBe(true);
  if (blamedB.isErr()) throw new Error(`fixture blame B failed: ${blamedB.error.code}`);
  blameB = blamedB.value;
}, 180_000);

afterAll(async () => {
  await disposeRepo(repoA);
  await disposeRepo(repoB);
});

describe('P-181 provenance map', () => {
  it('attributes A file to A commit', async () => {
    const built = await buildProvenanceMap([blameA, blameB], { sources: SOURCES });
    expect(built.isOk()).toBe(true);
    if (built.isErr()) return;

    const map = built.value;
    expect(map.size).toBe(2);

    const fromA = map.getOrigin(A_PATH_IN_C);
    expect(fromA).toBeDefined();
    // The REAL commit SHA the fixture repo produced — not a placeholder.
    expect(fromA?.repo).toBe('A');
    expect(fromA?.sourceCommit).toBe(shaA);
    expect(fromA?.sourceAuthor).toBe(FIXTURE_IDENTITY.name);
    expect(fromA?.stitchedBy).toBe('manual');
    // Unchanged-from-A keeps its identity; the timestamp is present and ISO.
    expect(fromA?.copiedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const fromB = map.getOrigin(B_PATH_IN_C);
    expect(fromB?.repo).toBe('B');
    expect(fromB?.sourceCommit).toBe(shaB);

    // Email is PII and OFF by default — attribution, not address harvesting.
    expect(fromA?.sourceEmail).toBeUndefined();

    // Opting in surfaces it (the phase's `recordEmail` behaviour, as an option
    // because the config key it cites does not exist — see ADR-054).
    const withEmail = await buildProvenanceMap([blameA], { sources: SOURCES, recordEmail: true });
    if (withEmail.isOk()) {
      expect(withEmail.value.getOrigin(A_PATH_IN_C)?.sourceEmail).toBe(FIXTURE_IDENTITY.email);
    }
  });

  it('marks agent edits', async () => {
    // The trailer P-165 actually writes, parsed back by its own parser — so the
    // merge→provenance seam is exercised, not a hand-built object.
    const message = `merge: adopt util\n\nStitch-Origin: ${JSON.stringify({
      source: 'agent',
      path: `${TELEPORT_PREFIX}/lib/util.ts`,
      op: 'write',
    })}`;
    const trailer = parseOriginTrailer(message);
    expect(trailer).toBeDefined();
    if (trailer === undefined) return;

    const built = await buildProvenanceMap(blameA, {
      sources: SOURCES,
      origins: new Map([[A_PATH_IN_C, trailer]]),
    });
    expect(built.isOk()).toBe(true);
    if (built.isErr()) return;

    const origin = built.value.getOrigin(A_PATH_IN_C);
    // Marked as the agent's, while still recording the commit it derived from.
    expect(origin?.stitchedBy).toBe('agent');
    expect(origin?.sourceCommit).toBe(shaA);
  });

  it('maps teleported path', async () => {
    const built = await buildProvenanceMap([blameA], { sources: SOURCES });
    expect(built.isOk()).toBe(true);
    if (built.isErr()) return;

    const origin = built.value.getOrigin(A_PATH_IN_C);
    // The file lives at `repo-a/lib/util.ts` in C by P-070's mapping; attribution
    // must report the ORIGINAL source path, or CREDITS points at a path that
    // never existed in A.
    expect(origin?.file).toBe(A_PATH_IN_C);
    expect(origin?.sourcePath).toBe('lib/util.ts');
    expect(origin?.repo).toBe('A');

    // A source with no prefix keeps the path as-is.
    const plain = await buildProvenanceMap([blameB], { sources: SOURCES });
    if (plain.isOk()) {
      expect(plain.value.getOrigin(B_PATH_IN_C)?.sourcePath).toBe(B_PATH_IN_C);
    }

    // A trailer's recorded source path wins over the prefix strip.
    const built2 = await buildProvenanceMap([blameA], {
      sources: SOURCES,
      origins: new Map([[A_PATH_IN_C, { source: 'A', path: 'lib/original.ts', op: 'move' }]]),
    });
    if (built2.isOk()) {
      expect(built2.value.getOrigin(A_PATH_IN_C)?.sourcePath).toBe('lib/original.ts');
    }
  });

  it('flags unattributed', async () => {
    const warnings: ProvenanceWarning[] = [];

    // A file git could not blame (no line origins at all).
    const empty: BlameMap = {
      repoPath: repoA,
      files: [{ path: 'ghost.ts', blobSha: '0'.repeat(40), origins: [] }],
    };
    const builtEmpty = await buildProvenanceMap(empty, {
      sources: SOURCES,
      onWarning: warning => warnings.push(warning),
    });
    expect(builtEmpty.isOk()).toBe(true);
    if (builtEmpty.isOk()) {
      const origin = builtEmpty.value.getOrigin('ghost.ts');
      expect(origin?.repo).toBe('unknown');
      expect(origin?.sourceCommit).toBe(UNKNOWN_COMMIT);
      expect(origin?.stitchedBy).toBe('manual');
      expect(origin?.sourcePath).toBe('ghost.ts');
    }
    expect(warnings.map(w => w.reason)).toEqual(['no-line-origins']);
    expect(describeProvenanceWarning(warnings[0] as ProvenanceWarning)).toContain('ghost.ts');

    // An uncommitted file (all-zero blame) is warned about differently…
    warnings.length = 0;
    const uncommitted: BlameMap = {
      repoPath: repoA,
      files: [
        {
          path: 'wip.ts',
          blobSha: '1'.repeat(40),
          origins: [
            {
              startLine: 1,
              endLine: 1,
              sha: null,
              author: 'Not Committed Yet',
              authorMail: null,
              authorTime: null,
              sourceRepo: null,
              sourceRef: null,
              license: null,
            },
          ],
        },
      ],
    };
    const builtWip = await buildProvenanceMap(uncommitted, {
      sources: SOURCES,
      onWarning: warning => warnings.push(warning),
    });
    if (builtWip.isOk()) {
      expect(builtWip.value.getOrigin('wip.ts')?.repo).toBe('unknown');
      expect(builtWip.value.getOrigin('wip.ts')?.sourceCommit).toBe(UNKNOWN_COMMIT);
    }
    expect(warnings.map(w => w.reason)).toEqual(['uncommitted']);

    // …and a file that blames to a commit no SOURCE claims.
    warnings.length = 0;
    const unknownSource: BlameMap = {
      repoPath: repoA,
      files: [
        {
          path: 'orphan.ts',
          blobSha: '2'.repeat(40),
          origins: [
            {
              startLine: 1,
              endLine: 3,
              sha: shaB,
              author: 'someone',
              authorMail: null,
              authorTime: null,
              sourceRepo: null,
              sourceRef: null,
              license: null,
            },
          ],
        },
      ],
    };
    const builtOrphan = await buildProvenanceMap(unknownSource, {
      sources: SOURCES,
      onWarning: warning => warnings.push(warning),
    });
    if (builtOrphan.isOk()) {
      const origin = builtOrphan.value.getOrigin('orphan.ts');
      expect(origin?.repo).toBe('unknown');
      // The commit IS known even though the repo is not — reported honestly.
      expect(origin?.sourceCommit).toBe(shaB);
    }
    expect(warnings.map(w => w.reason)).toEqual(['unknown-source']);

    // The map keeps the warnings for consumers (P-182 renders them).
    const kept = await buildProvenanceMap(empty, { sources: SOURCES });
    if (kept.isOk()) expect(kept.value.warnings()).toHaveLength(1);
  });

  it('persists and queries', async () => {
    const db = makeDbAdapter();
    // The v1 migration already defines the `provenance` table; P-181 does not
    // create a second one.
    const migrated = migrate(db);
    expect(migrated.isOk()).toBe(true);

    const built = await buildProvenanceMap([blameA, blameB], { sources: SOURCES, db });
    expect(built.isOk()).toBe(true);
    if (built.isErr()) return;
    expect(built.value.size).toBe(2);

    // Reload from sqlite and query the documented path.
    const loaded = await ProvenanceMap.load(db);
    expect(loaded.isOk()).toBe(true);
    if (loaded.isErr()) return;
    const back = loaded.value.getOrigin(A_PATH_IN_C);
    expect(back?.repo).toBe('A');
    expect(back?.sourceCommit).toBe(shaA);
    expect(back?.sourcePath).toBe('lib/util.ts');
    expect(back?.stitchedBy).toBe('manual');
    expect(loaded.value.getOrigin(B_PATH_IN_C)?.repo).toBe('B');

    // A later save wins for the same file (newest row), so attribution can be
    // corrected without the map silently keeping a stale answer.
    const corrections = ProvenanceMap.from([
      {
        file: A_PATH_IN_C,
        repo: 'A',
        sourceCommit: shaA,
        sourcePath: 'lib/util.ts',
        copiedAt: '2026-10-16T00:00:00.000Z',
        stitchedBy: 'agent',
      },
    ]);
    const saved = await corrections.save(db);
    expect(saved.isOk()).toBe(true);
    if (saved.isOk()) expect(saved.value).toBe(1);

    const reloaded = await ProvenanceMap.load(db);
    if (reloaded.isOk()) {
      expect(reloaded.value.getOrigin(A_PATH_IN_C)?.stitchedBy).toBe('agent');
      // The other file survived the correction.
      expect(reloaded.value.getOrigin(B_PATH_IN_C)?.repo).toBe('B');
    }

    // A genuinely new commit changes the attribution end-to-end. The content is
    // ENTIRELY different, so every line re-blames to the new commit — changing
    // one line would leave the other attributed to the old one and the
    // dominant-origin rule would (correctly) report the older commit.
    const newShaA = await commitFiles(
      repoA,
      {
        [`${TELEPORT_PREFIX}/lib/util.ts`]:
          'export const x = 10;\nexport const y = 20;\nexport const z = 30;\n',
      },
      'a: rewrite util'
    );
    const reBlamed = await buildBlameMap(repoA, [SOURCES[0] as BlameSource]);
    expect(reBlamed.isOk()).toBe(true);
    if (reBlamed.isOk()) {
      const rebuilt = await buildProvenanceMap(reBlamed.value, { sources: SOURCES });
      if (rebuilt.isOk()) {
        expect(rebuilt.value.getOrigin(A_PATH_IN_C)?.sourceCommit).toBe(newShaA);
        expect(newShaA).not.toBe(shaA);
      }
    }
  }, 180_000);
});
