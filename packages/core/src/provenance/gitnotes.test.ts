// P-184 — git notes tests, against REAL temp git repositories.
//
// Git notes are the one part of provenance that must survive a clone, so the
// suite drives actual git (`makeTempRepo` + `commitFiles` + the fixture `git`
// helper) rather than a stubbed command runner — a fake would prove nothing
// about the `add`-refuses-to-overwrite behaviour this module exists to handle.
//
// The five required scenarios from the phase spec:
//
//   it('writes a note')            it('appends to existing')
//   it('reads note json')          it('returns undefined when absent')
//   it('warns on failure')

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  commitFiles,
  disposeRepo,
  git,
  headSha,
  makeTempRepo,
} from '../../test-utils/gitFixtures.js';
import { ProvenanceMap, type FileOrigin } from './map.js';
import {
  attachProvenanceNote,
  buildProvenanceNote,
  fetchAllProvenanceNotes,
  mapChecksum,
  mergeNoteFragments,
  readGitNotes,
  writeGitNotes,
  type ProvenanceNoteWarning,
} from './gitnotes.js';

const FIXED_TS = '2026-10-16T00:00:00.000Z';
const NS = 'refs/notes/stitch-prov';
const SHA_A = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';

function provenance(): ProvenanceMap {
  const a: FileOrigin = {
    file: 'lib/util.go',
    repo: 'A',
    sourceCommit: SHA_A,
    sourcePath: 'lib/util.go',
    copiedAt: FIXED_TS,
    stitchedBy: 'manual',
  };
  const b: FileOrigin = {
    file: 'cmd/main.go',
    repo: 'B',
    sourceCommit: SHA_A,
    sourcePath: 'cmd/main.go',
    copiedAt: FIXED_TS,
    stitchedBy: 'agent',
  };
  return ProvenanceMap.from([a, b]);
}

let repo: string;
let secondRepo: string;
let sha: string;

beforeAll(async () => {
  repo = await makeTempRepo('stitch-notes-', { seed: { 'a.txt': 'first\n' } });
  sha = await headSha(repo);
  secondRepo = await makeTempRepo('stitch-notes-2-', { seed: { 'b.txt': 'second\n' } });
}, 60_000);

afterAll(async () => {
  await disposeRepo(repo);
  await disposeRepo(secondRepo);
});

describe('P-184 git notes', () => {
  it('writes a note', async () => {
    const note = buildProvenanceNote(provenance());
    expect(note.schemaVersion).toBe(1);
    expect(note.provenanceRef).toBe('sbom.cyclonedx.json');
    expect(note.mapChecksum).toMatch(/^[0-9a-f]{64}$/);
    expect(note.statistics).toEqual({ files: 2, repos: 2 });
    // The note is derived from the map, so the same map yields the same stamp.
    expect(note.generatedAt).toBe(FIXED_TS);

    const written = await writeGitNotes(repo, sha, { ...note });
    expect(written.isOk()).toBe(true);

    // …and it is readable by ordinary git tooling, which is the point of putting
    // provenance in a note rather than only in scratch storage.
    const viaGit = await git(repo, ['notes', `--ref=${NS}`, 'show', sha]);
    expect(JSON.parse(viaGit)).toMatchObject({
      schemaVersion: 1,
      provenanceRef: 'sbom.cyclonedx.json',
    });

    // A blank repo/commit is a typed config error, not a git invocation.
    const blank = await writeGitNotes('   ', sha, {});
    expect(blank.isErr()).toBe(true);
    if (blank.isErr()) expect(blank.error.code).toBe('CONFIG_ERROR');
  });

  it('appends to existing', async () => {
    // `git notes add` REFUSES to overwrite, so a second write must merge or it
    // loses the first one entirely — the case the phase's "append" clause exists
    // for.
    const first = await writeGitNotes(repo, sha, {
      provenanceRef: 'sbom.cyclonedx.json',
      runId: 'run-1',
    });
    expect(first.isOk()).toBe(true);
    const second = await writeGitNotes(repo, sha, { mapChecksum: 'deadbeef', runId: 'run-2' });
    expect(second.isOk()).toBe(true);

    const back = await readGitNotes(repo, sha);
    expect(back.isOk()).toBe(true);
    if (back.isErr() || back.value === undefined) return;
    // Nothing is lost: the first fragment's own keys survive…
    expect(back.value['provenanceRef']).toBe('sbom.cyclonedx.json');
    // …the second fragment's keys are added…
    expect(back.value['mapChecksum']).toBe('deadbeef');
    // …and on a conflicting scalar the NEW value wins, so a re-run can refresh.
    expect(back.value['runId']).toBe('run-2');

    // Nested fragments merge recursively rather than replacing wholesale.
    const deep = mergeNoteFragments(
      { statistics: { files: 2, repos: 2 }, keep: 'yes' },
      { statistics: { files: 5 } }
    );
    expect(deep).toEqual({ statistics: { files: 5, repos: 2 }, keep: 'yes' });
  });

  it('reads note json', async () => {
    const attached = await attachProvenanceNote(provenance(), repo, sha, { now: () => FIXED_TS });
    expect(attached.isOk()).toBe(true);
    if (attached.isOk()) expect(attached.value).toBe(true);

    const read = await readGitNotes(repo, sha);
    expect(read.isOk()).toBe(true);
    if (read.isErr() || read.value === undefined) return;
    expect(read.value).toMatchObject({
      schemaVersion: 1,
      provenanceRef: 'sbom.cyclonedx.json',
      statistics: { files: 2, repos: 2 },
    });
    expect(read.value['mapChecksum']).toBe(mapChecksum(provenance()));

    // Enumeration for audits (P-187) keys by the annotated commit.
    const all = await fetchAllProvenanceNotes(repo);
    expect(all.isOk()).toBe(true);
    if (all.isOk()) {
      expect(Object.keys(all.value)).toContain(sha);
      expect(all.value[sha]?.['provenanceRef']).toBe('sbom.cyclonedx.json');
    }

    // A note that EXISTS but is not JSON is an ERROR, not "absent" — collapsing
    // the two would hide a corrupt record from an audit.
    const other = await makeTempRepo('stitch-notes-bad-', { seed: { 'c.txt': 'x\n' } });
    try {
      const badSha = await headSha(other);
      await git(other, ['notes', `--ref=${NS}`, 'add', '-f', '-m', 'not json', badSha]);
      const corrupt = await readGitNotes(other, badSha);
      expect(corrupt.isErr()).toBe(true);
      if (corrupt.isErr()) expect(corrupt.error.code).toBe('GIT_ERROR');
    } finally {
      await disposeRepo(other);
    }
  });

  it('returns undefined when absent', async () => {
    // A commit with no note under the namespace is a NORMAL state, and the
    // acceptance says so explicitly: `undefined`, not an error.
    const fresh = await commitFiles(secondRepo, { 'd.txt': 'x\n' }, 'second commit');
    const absent = await readGitNotes(secondRepo, fresh);
    expect(absent.isOk()).toBe(true);
    if (absent.isOk()) expect(absent.value).toBeUndefined();

    // A namespace nobody wrote to behaves the same way.
    const otherNs = await readGitNotes(secondRepo, fresh, 'refs/notes/stitch-none');
    expect(otherNs.isOk()).toBe(true);
    if (otherNs.isOk()) expect(otherNs.value).toBeUndefined();

    // An empty namespace therefore enumerates to an empty map, not an error.
    const none = await fetchAllProvenanceNotes(secondRepo, 'refs/notes/stitch-none');
    expect(none.isOk()).toBe(true);
    if (none.isOk()) expect(none.value).toEqual({});
  });

  it('warns on failure', async () => {
    const warnings: ProvenanceNoteWarning[] = [];

    // The PRIMITIVE reports the failure as a typed error…
    const missing = `${repo}-does-not-exist`;
    const primitive = await writeGitNotes(missing, sha, { provenanceRef: 'x' });
    expect(primitive.isErr()).toBe(true);
    if (primitive.isErr()) expect(primitive.error.code).toBe('GIT_ERROR');

    // …while the FINALIZE path degrades it to a warning: a stitch that succeeded
    // must not fail because a note could not be written.
    const attached = await attachProvenanceNote(provenance(), missing, sha, {
      onWarning: warning => warnings.push(warning),
    });
    expect(attached.isOk()).toBe(true);
    if (attached.isOk()) expect(attached.value).toBe(false);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.reason).toBe('write-failed');
    expect(warnings[0]?.repoPath).toBe(missing);
    expect(warnings[0]?.message).toContain('git notes add failed');

    // A successful attach writes and reports true, with no warning.
    const clean: ProvenanceNoteWarning[] = [];
    const ok = await attachProvenanceNote(
      provenance(),
      secondRepo,
      await commitFiles(secondRepo, { 'e.txt': 'y\n' }, 'third'),
      {
        onWarning: warning => clean.push(warning),
      }
    );
    expect(ok.isOk()).toBe(true);
    if (ok.isOk()) expect(ok.value).toBe(true);
    expect(clean).toEqual([]);
  });
});
