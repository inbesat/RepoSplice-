// P-338 — the harness the python test drives.
//
// The Go resolver reads the ground-truth fixture in place (it never writes),
// resolves every case of the fixture's ground truth and reports the accuracy.
// gopls is not installed in every environment, so the language-server path is
// reported as unavailable — a missing measurement is never a zero.

import { join } from 'node:path';
import { createGoResolver } from '../../resolve/go-resolver.js';

const REPO_ROOT = join(import.meta.dirname, '..', '..', '..', '..', '..');
const FIXTURE_ROOT = join(REPO_ROOT, 'packages', 'core', 'test-fixtures', 'go-resolver-repo');

interface GroundTruth {
  readonly cases: readonly {
    readonly name: string;
    readonly file: string;
    readonly import_spec: string;
    readonly target: string;
  }[];
}

const truth = (await Bun.file(join(FIXTURE_ROOT, 'ground-truth.json')).json()) as GroundTruth;

const resolver = createGoResolver({ rootDir: FIXTURE_ROOT });

interface CaseReport {
  readonly name: string;
  readonly ok: boolean;
  readonly target: string | null;
  readonly expected: string;
  readonly confidence: string | null;
}

const cases: CaseReport[] = [];
for (const item of truth.cases) {
  const result = await resolver.resolve(item.file, item.import_spec);
  if (result.isErr()) {
    cases.push({
      name: item.name,
      ok: false,
      target: null,
      expected: item.target,
      confidence: null,
    });
    continue;
  }
  const edge = result.value[0];
  cases.push({
    name: item.name,
    ok: edge !== undefined && edge.targetFile === item.target,
    target: edge?.targetFile ?? null,
    expected: item.target,
    confidence: edge?.confidence ?? null,
  });
}

const answered = cases.filter(item => item.ok).length;
const report = {
  mode: 'modules',
  cases,
  allOk: answered === cases.length,
  accuracy: `${answered}/${cases.length}`,
  lsp: { ok: false, status: 'unavailable' },
};

process.stdout.write(`RESOLVE ${JSON.stringify(report)}\n`);
