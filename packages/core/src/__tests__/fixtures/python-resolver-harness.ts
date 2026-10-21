// P-337 — the harness the python test drives: it resolves the fixture's
// import chain with the REAL jedi bridge and reports what the language
// server path would have answered (pyright is not installed in this
// environment, so that path reports 'unavailable' — a missing measurement is
// never a zero).
//
// The fixture lives OUTSIDE src (packages/core/test-fixtures/...): the root
// typecheck covers packages/*/src/**/*, and a fixture that imports a package
// which only exists in the temp workspace must not be compiled in place.

import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPythonResolver } from '../../resolve/python-resolver.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..', '..', '..');
const FIXTURE_ROOT = join(REPO_ROOT, 'packages', 'core', 'test-fixtures', 'python-resolver-repo');
const HELPER = join(REPO_ROOT, 'packages', 'core', 'src', 'resolve', 'jedi_helper.py');

interface GroundTruthCase {
  readonly name: string;
  readonly file: string;
  readonly import_spec: string;
  readonly target: string;
}

interface GroundTruth {
  readonly cases: readonly GroundTruthCase[];
}

interface CaseReport {
  readonly name: string;
  readonly ok: boolean;
  readonly target: string | null;
  readonly confidence: string | null;
  readonly expected: string;
  readonly detail: string | null;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

const truth = readJson<GroundTruth>(join(FIXTURE_ROOT, 'ground-truth.json'));
const workspace = mkdtempSync(join(tmpdir(), 'stitch-py-resolver-'));
cpSync(FIXTURE_ROOT, workspace, { recursive: true });

const resolver = createPythonResolver({ rootDir: workspace, jediHelperPath: HELPER });

const cases: CaseReport[] = [];
for (const item of truth.cases) {
  const result = await resolver.resolve(item.file, item.import_spec);
  if (result.isErr()) {
    const error = result.error;
    cases.push({
      name: item.name,
      ok: false,
      target: null,
      confidence: null,
      expected: item.target,
      detail: 'message' in error ? error.message : error.code,
    });
    continue;
  }
  const edge = result.value[0];
  const target = edge?.targetFile ?? null;
  cases.push({
    name: item.name,
    ok: target === item.target,
    target,
    confidence: edge?.confidence ?? null,
    expected: item.target,
    detail: null,
  });
}

const passed = cases.filter(item => item.ok).length;
const report = {
  mode: 'jedi',
  cases,
  allOk: passed === cases.length,
  accuracy: `${passed}/${cases.length}`,
  lsp: {
    ok: false,
    status: 'unavailable',
    reason: 'pyright is not installed in this environment',
  },
};

process.stdout.write(`RESOLVE ${JSON.stringify(report)}\n`);
rmSync(workspace, { recursive: true, force: true });
