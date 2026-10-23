// P-182 — CREDITS.md tests.
//
// The map is built from literal `FileOrigin`s rather than a git fixture: P-181
// already proves the git→origin half against real repositories, and what THIS
// phase must prove is the RENDER (grouping, ordering, the fixed table columns,
// the PII guard) plus the one write. Rendering is pure, so the tests are exact
// string assertions rather than pattern matches.
//
// The five required scenarios from the phase spec:
//
//   it('renders grouped credits')      it('omits emails by default')
//   it('adds unattributed section')    it('writes and returns content')
//   it('stable output')

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type SemanticConfidence } from '../confidence/schema.js';
import { ProvenanceMap, type FileOrigin, type ProvenanceWarning } from './map.js';
import { CREDITS_FILENAME, generateCredits } from './credits.js';

const FIXED_TS = '2026-10-16T00:00:00.000Z';
const SHA_A = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
const SHA_B = 'b1b2c3d4e5f60718293a4b5c6d7e8f9012345678';

/** A `manual`, attributed origin with sensible defaults. */
function origin(over: Partial<FileOrigin> & { file: string }): FileOrigin {
  const base: FileOrigin = {
    file: over.file,
    repo: 'A',
    sourceCommit: SHA_A,
    sourcePath: over.file,
    sourceAuthor: 'Ada Lovelace',
    copiedAt: FIXED_TS,
    stitchedBy: 'manual',
  };
  return { ...base, ...over };
}

/** A minimal `SemanticConfidence` document for the P-351 renderer tests. */
function confidence(score: number, flags: string[]): SemanticConfidence {
  return {
    composite_score: score,
    components: {
      sandbox_pass: 1,
      self_confidence: score,
      resolver_confidence: score,
      license_risk: 0,
      test_coverage: score,
    },
    rationale: 'fixture',
    flags,
    contributing_factors: {},
  };
}

let scratch: string;

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'stitch-credits-'));
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

describe('P-182 credits', () => {
  it('renders grouped credits', async () => {
    const map = ProvenanceMap.from([
      origin({ file: 'lib/util.ts', repo: 'A', sourceAuthor: 'Ada Lovelace' }),
      origin({ file: 'cmd/main.go', repo: 'B', sourceCommit: SHA_B, sourceAuthor: 'Grace Hopper' }),
      origin({
        file: 'repo-a/app.ts',
        repo: 'A',
        sourcePath: 'app.ts',
        sourceCommit: SHA_A,
        sourceAuthor: 'Ada Lovelace',
      }),
    ]);

    const rendered = await generateCredits(map);
    expect(rendered.isOk()).toBe(true);
    if (rendered.isErr()) return;
    const text = rendered.value;

    // Title block + the deterministic (map-derived) timestamp.
    expect(text).toContain('# Credits');
    expect(text).toContain(`> Generated from provenance recorded at ${FIXED_TS}`);

    // One section per source repo, A before B.
    expect(text).toContain('## A');
    expect(text).toContain('## B');
    expect(text.indexOf('## A')).toBeLessThan(text.indexOf('## B'));

    // The table columns the web preview and CI parse: P-182's three (unchanged,
    // same indices) then the two P-351 appended.
    expect(text).toContain('| File in C | Source Commit | Author | Confidence | Flags |');
    expect(text).toContain('| --- | --- | --- | --- | --- |');

    // Short commit (7 chars) + author.
    expect(text).toContain('| `lib/util.ts` | a1b2c3d | Ada Lovelace |');
    expect(text).toContain('| `cmd/main.go` | b1b2c3d | Grace Hopper |');

    // Sorted by file path WITHIN a group: `lib/util.ts` before `repo-a/app.ts`
    // under `## A`.
    const sectionA = text.slice(text.indexOf('## A'), text.indexOf('## B'));
    expect(sectionA.indexOf('lib/util.ts')).toBeLessThan(sectionA.indexOf('repo-a/app.ts'));

    // A teleported file shows the C path first and the ORIGINAL path alongside.
    expect(text).toContain('| `repo-a/app.ts` (from `app.ts`) | a1b2c3d | Ada Lovelace |');
  });

  it('omits emails by default', async () => {
    const map = ProvenanceMap.from([
      origin({ file: 'lib/util.ts', sourceEmail: 'ada@example.test' }),
    ]);

    const byDefault = await generateCredits(map);
    expect(byDefault.isOk()).toBe(true);
    if (byDefault.isOk()) {
      // Default OFF — and this is a real guard: the address is SCRUBBED, not
      // merely left out of a template.
      expect(byDefault.value).not.toContain('ada@example.test');
      expect(byDefault.value).toContain('Ada Lovelace');
    }

    const withEmails = await generateCredits(map, { includeEmails: true });
    expect(withEmails.isOk()).toBe(true);
    if (withEmails.isOk()) expect(withEmails.value).toContain('<ada@example.test>');
  });

  it('adds unattributed section', async () => {
    const warnings: ProvenanceWarning[] = [
      { file: 'orphan.ts', reason: 'no-line-origins', message: 'no line origins' },
    ];
    const map = ProvenanceMap.from(
      [
        origin({ file: 'lib/util.ts' }),
        // Built literally: an unattributed entry has no author at all, and
        // `exactOptionalPropertyTypes` forbids expressing that as `undefined`.
        {
          file: 'orphan.ts',
          repo: 'unknown',
          sourceCommit: '',
          sourcePath: 'orphan.ts',
          copiedAt: FIXED_TS,
          stitchedBy: 'manual',
        },
        origin({ file: 'generated/api.ts', stitchedBy: 'agent' }),
      ],
      warnings
    );

    const rendered = await generateCredits(map);
    expect(rendered.isOk()).toBe(true);
    if (rendered.isErr()) return;
    const text = rendered.value;

    // A dedicated section, and the unattributed file is IN it (not dropped).
    expect(text).toContain('## Unattributed');
    const section = text.slice(text.indexOf('## Unattributed'), text.indexOf('## Notes'));
    expect(section).toContain('`orphan.ts`');
    // No commit ⇒ an explicit placeholder, not a blank cell.
    expect(section).toContain('| — |');

    // Transparency: the agent-stitched file is listed in Notes.
    expect(text).toContain('## Notes');
    const notes = text.slice(text.indexOf('## Notes'));
    expect(notes).toContain('`generated/api.ts`');
    expect(notes).not.toContain('No files were stitched by the agent.');

    // And P-181's retained warnings are surfaced with their reason.
    expect(text).toContain('### Attribution warnings');
    expect(text).toContain('`orphan.ts`: no-line-origins');

    // With nothing agent-stitched, Notes says so rather than being empty.
    const clean = await generateCredits(ProvenanceMap.from([origin({ file: 'lib/util.ts' })]));
    if (clean.isOk()) expect(clean.value).toContain('No files were stitched by the agent.');
  });

  it('writes and returns content', async () => {
    const map = ProvenanceMap.from([origin({ file: 'lib/util.ts' })]);

    // Render-only when no target is given (the preview path).
    const preview = await generateCredits(map);
    expect(preview.isOk()).toBe(true);

    const written = await generateCredits(map, { repoC: scratch });
    expect(written.isOk()).toBe(true);
    if (written.isErr()) return;

    const target = join(scratch, CREDITS_FILENAME);
    await expect(stat(target)).resolves.toBeTruthy();
    const onDisk = await readFile(target, 'utf8');
    // The returned string IS what was written — no divergence to drift.
    expect(onDisk).toBe(written.value);
    expect(written.value).toBe(preview.isOk() ? preview.value : '');

    // A trailing separator on the target does not double up.
    const nested = join(scratch, 'child');
    const nestedWrite = await generateCredits(map, { repoC: `${nested}/` });
    expect(nestedWrite.isOk()).toBe(true);
    await expect(stat(join(nested, CREDITS_FILENAME))).resolves.toBeTruthy();

    // A blank target is a typed config error, not a silent skip or a throw.
    const blank = await generateCredits(map, { repoC: '   ' });
    expect(blank.isErr()).toBe(true);
    if (blank.isErr()) expect(blank.error.code).toBe('CONFIG_ERROR');
  });

  it('stable output', async () => {
    const origins = [
      origin({ file: 'b.ts', repo: 'B', sourceCommit: SHA_B, sourceAuthor: 'Grace Hopper' }),
      origin({ file: 'a.ts', repo: 'A' }),
      origin({ file: 'c.ts', repo: 'unknown', sourceCommit: '' }),
      origin({ file: 'd.ts', stitchedBy: 'agent' }),
    ];

    // Same map contents, two independent maps, two renders — byte-identical,
    // because the timestamp comes from the data rather than the wall clock.
    const first = await generateCredits(ProvenanceMap.from(origins));
    const second = await generateCredits(ProvenanceMap.from([...origins].reverse()));
    expect(first.isOk() && second.isOk()).toBe(true);
    if (first.isOk() && second.isOk()) expect(second.value).toBe(first.value);

    // Re-rendering the SAME map is trivially stable too.
    const same = ProvenanceMap.from(origins);
    const a = await generateCredits(same);
    const b = await generateCredits(same);
    if (a.isOk() && b.isOk()) expect(b.value).toBe(a.value);

    // An explicit clock overrides the derived stamp (documented as breaking
    // stability, which is why it is opt-in).
    const stamped = await generateCredits(ProvenanceMap.from(origins), {
      now: () => '2030-01-01T00:00:00.000Z',
    });
    if (stamped.isOk()) expect(stamped.value).toContain('2030-01-01T00:00:00.000Z');

    // A custom header replaces the title block; repo names are configurable.
    const custom = await generateCredits(ProvenanceMap.from(origins), {
      header: '# Our attribution notice',
      repoNameA: 'upstream-a',
    });
    if (custom.isOk()) {
      expect(custom.value).toContain('# Our attribution notice');
      expect(custom.value).not.toContain('# Credits');
      expect(custom.value).toContain('## upstream-a');
    }

    // A remote URL is surfaced under its repo section.
    const withUrl = await generateCredits(
      ProvenanceMap.from([origin({ file: 'a.ts', remoteUrl: 'https://example.test/a.git' })])
    );
    if (withUrl.isOk()) expect(withUrl.value).toContain('Repository: https://example.test/a.git');
  });

  it('adds the confidence and flags columns', async () => {
    const map = ProvenanceMap.from([origin({ file: 'lib/util.ts' })]);
    const rendered = await generateCredits(map, {
      confidence: { 'lib/util.ts': confidence(77, ['low_test_coverage']) },
    });
    expect(rendered.isOk()).toBe(true);
    if (rendered.isErr()) return;
    const text = rendered.value;

    expect(text).toContain('| File in C | Source Commit | Author | Confidence | Flags |');
    expect(text).toContain('| --- | --- | --- | --- | --- |');
    expect(text).toContain('| `lib/util.ts` | a1b2c3d | Ada Lovelace | 77 | low_test_coverage |');
  });

  it('renders the no-flags cell when a score has no warnings', async () => {
    const map = ProvenanceMap.from([origin({ file: 'a.ts' })]);
    const rendered = await generateCredits(map, {
      confidence: { 'a.ts': confidence(90, []) },
    });
    if (rendered.isErr()) return;
    expect(rendered.value).toContain('| `a.ts` | a1b2c3d | Ada Lovelace | 90 | — |');
  });

  it('shows N/A and says why for files with no recorded score', async () => {
    const map = ProvenanceMap.from([origin({ file: 'legacy.ts' })]);
    const rendered = await generateCredits(map, { confidence: {} });
    if (rendered.isErr()) return;
    const text = rendered.value;
    expect(text).toContain('| `legacy.ts` | a1b2c3d | Ada Lovelace | N/A | — |');
    expect(text).toContain('Files showing N/A in the Confidence column');
  });

  it('omits the N/A note when every file is scored', async () => {
    const map = ProvenanceMap.from([origin({ file: 'a.ts' }), origin({ file: 'b.ts' })]);
    const rendered = await generateCredits(map, {
      confidence: { 'a.ts': confidence(88, []), 'b.ts': confidence(40, ['license_risk']) },
    });
    if (rendered.isErr()) return;
    expect(rendered.value).not.toContain('Files showing N/A in the Confidence column');
    expect(rendered.value).toContain('| 40 | license_risk |');
  });

  it('joins several flags and reads a malformed record defensively', async () => {
    const map = ProvenanceMap.from([origin({ file: 'a.ts' }), origin({ file: 'b.ts' })]);
    const rendered = await generateCredits(map, {
      confidence: {
        'a.ts': confidence(55, ['low_resolver_confidence', 'license_risk']),
        // A record from an unknown writer must not make the renderer throw or
        // print 'undefined': it falls back to the cells a missing value gets.
        'b.ts': { composite_score: Number.NaN, flags: undefined } as unknown as SemanticConfidence,
      },
    });
    if (rendered.isErr()) return;
    expect(rendered.value).toContain('| 55 | low_resolver_confidence, license_risk |');
    expect(rendered.value).toContain('| N/A | — |');
  });

  it('keeps the render stable with confidence data', async () => {
    const origins = [origin({ file: 'a.ts' }), origin({ file: 'b.ts' })];
    const opts = { confidence: { 'a.ts': confidence(77, ['x']), 'b.ts': confidence(20, []) } };
    const first = await generateCredits(ProvenanceMap.from(origins), opts);
    const second = await generateCredits(ProvenanceMap.from([...origins].reverse()), opts);
    expect(first.isOk() && second.isOk()).toBe(true);
    if (first.isOk() && second.isOk()) expect(second.value).toBe(first.value);
  });
});
