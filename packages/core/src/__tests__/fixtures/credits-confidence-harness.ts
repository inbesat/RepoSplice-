// P-351 — the harness the python ids drive.
//
// It renders CREDITS.md through the REAL P-182 renderer with the P-346/P-349
// confidence documents (so the rendered number is provably that pipeline's
// output, not a hand-written constant) and reports the exact table cells.

import { buildSemanticConfidence } from '../../confidence/schema.js';
import { ProvenanceMap, type FileOrigin } from '../../provenance/map.js';
import {
  CREDITS_COLUMNS,
  generateCredits,
  NO_CONFIDENCE_CELL,
  NO_FLAGS_CELL,
} from '../../provenance/credits.js';

const FIXED_TS = '2026-10-16T00:00:00.000Z';
const SHA_A = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';

function origin(file: string): FileOrigin {
  return {
    file,
    repo: 'A',
    sourceCommit: SHA_A,
    sourcePath: file,
    sourceAuthor: 'Ada Lovelace',
    copiedAt: FIXED_TS,
    stitchedBy: 'manual',
  };
}

/** The P-348 pinned components: the score renders as 77, no flags fire. */
const strong = buildSemanticConfidence({
  components: {
    sandbox_pass: 1,
    self_confidence: 82,
    resolver_confidence: 60,
    license_risk: 40,
    test_coverage: 50,
  },
});

/** A deliberately weak proposal: every derived flag fires. */
const weak = buildSemanticConfidence({
  components: {
    sandbox_pass: 0,
    self_confidence: 30,
    resolver_confidence: 20,
    license_risk: 80,
    test_coverage: 10,
  },
});

interface RowReport {
  readonly file: string;
  readonly cells: readonly string[];
  readonly score: string | null;
  readonly flags: string | null;
}

function parseRows(text: string): RowReport[] {
  const rows: RowReport[] = [];
  for (const line of text.split('\n')) {
    if (!line.startsWith('| `')) continue;
    const cells = line
      .split('|')
      .map(cell => cell.trim())
      .filter(cell => cell !== '');
    const file = /^`([^`]+)`/.exec(cells[0] ?? '')?.[1] ?? '';
    rows.push({ file, cells, score: cells[3] ?? null, flags: cells[4] ?? null });
  }
  return rows;
}

async function main(): Promise<number> {
  if (strong.isErr() || weak.isErr()) {
    process.stdout.write(
      `CREDITS ${JSON.stringify({ mode: 'credits-confidence', ok: false, error: 'the fixture confidence documents did not build' })}\n`
    );
    return 1;
  }

  const map = ProvenanceMap.from([origin('a.ts'), origin('b.ts'), origin('legacy.ts')]);
  const confidence = { 'a.ts': weak.value, 'b.ts': strong.value };
  const rendered = await generateCredits(map, { confidence });
  if (rendered.isErr()) {
    process.stdout.write(
      `CREDITS ${JSON.stringify({ mode: 'credits-confidence', ok: false, error: rendered.error.code })}\n`
    );
    return 1;
  }
  const text = rendered.value;
  const lines = text.split('\n');
  const header = lines.find(line => line.includes('File in C')) ?? '';
  const separator = lines.find(line => line.includes('---')) ?? '';
  const noteLine = lines.find(line => line.includes('Files showing N/A')) ?? null;

  // The note must disappear once every rendered file carries a score.
  const allScored = await generateCredits(
    ProvenanceMap.from([origin('a.ts'), origin('b.ts'), origin('legacy.ts')]),
    { confidence: { 'a.ts': weak.value, 'b.ts': strong.value, 'legacy.ts': strong.value } }
  );
  const second = await generateCredits(map, { confidence });

  const report = {
    mode: 'credits-confidence',
    ok: true,
    columns: [...CREDITS_COLUMNS],
    header,
    separator,
    rows: parseRows(text),
    note: noteLine,
    hasNote: noteLine !== null,
    noteWhenAllScored:
      allScored.isOk() && allScored.value.includes('Files showing N/A in the Confidence column'),
    scoredComposite: strong.value.composite_score,
    weakComposite: weak.value.composite_score,
    strongFlags: strong.value.flags,
    weakFlags: weak.value.flags,
    noConfidenceCell: NO_CONFIDENCE_CELL,
    noFlagsCell: NO_FLAGS_CELL,
    determinism: second.isOk() && second.value === text,
  };
  process.stdout.write(`CREDITS ${JSON.stringify(report)}\n`);
  return 0;
}

process.exit(await main());
