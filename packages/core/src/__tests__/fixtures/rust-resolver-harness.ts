// P-339 — the harness the python test drives.
//
// The Rust resolver is BEST-EFFORT: the module-graph fallback answers the
// ground truth, and the real rust-analyzer is attempted when it is installed
// so the `lsp-high` path is measured rather than assumed. A server that never
// answers is reported as unavailable — a missing measurement is never a zero.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createLspClient } from '../../resolve/lsp-client.js';
import { createRustResolver } from '../../resolve/rust-resolver.js';

const REPO_ROOT = join(import.meta.dirname, '..', '..', '..', '..', '..');
const FIXTURE_ROOT = join(REPO_ROOT, 'packages', 'core', 'test-fixtures', 'rust-resolver-repo');

const ANALYZER_CANDIDATES: readonly string[] = [
  'C:\\Users\\Lenovo\\.cargo\\bin\\rust-analyzer.exe',
  'rust-analyzer',
];

interface GroundTruth {
  readonly cases: readonly {
    readonly name: string;
    readonly file: string;
    readonly import_spec: string;
    readonly target: string;
  }[];
}

interface CaseReport {
  readonly name: string;
  readonly ok: boolean;
  readonly target: string | null;
  readonly expected: string;
  readonly confidence: string | null;
}

const truth = JSON.parse(
  readFileSync(join(FIXTURE_ROOT, 'ground-truth.json'), 'utf8')
) as GroundTruth;

const resolver = createRustResolver({ rootDir: FIXTURE_ROOT });

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
  const target = edge?.targetFile ?? '';
  cases.push({
    name: item.name,
    ok: target === item.target,
    target: target === '' ? null : target,
    expected: item.target,
    confidence: edge?.confidence ?? null,
  });
}

const answered = cases.filter(item => item.ok).length;

/** Attempt the real rust-analyzer so the language-server path is measured. */
async function tryAnalyzer(): Promise<Record<string, unknown>> {
  const command = ANALYZER_CANDIDATES.find(
    candidate => candidate === 'rust-analyzer' || existsSync(candidate)
  );
  if (command === undefined) {
    return { ok: false, status: 'unavailable' };
  }
  const client = createLspClient({
    command,
    args: [],
    cwd: FIXTURE_ROOT,
    requestTimeoutMs: 8_000,
    initializeTimeoutMs: 45_000,
    shutdownTimeoutMs: 5_000,
  });
  try {
    const initialized = await client.initialize({
      processId: process.pid,
      rootUri: pathToFileURL(FIXTURE_ROOT).toString(),
      capabilities: {},
      workspaceFolders: null,
    });
    if (initialized.isErr()) {
      return {
        ok: false,
        status: 'error',
        reason: 'message' in initialized.error ? initialized.error.message : 'initialize failed',
      };
    }
    const withServer = createRustResolver({ rootDir: FIXTURE_ROOT, lspClient: client });
    // rust-analyzer indexes lazily: give it a few tries before giving up.
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const answer = await withServer.resolve('src/main.rs', 'crate::a');
      if (answer.isOk() && answer.value.length > 0) {
        return {
          ok: true,
          target: answer.value[0]?.targetFile ?? null,
          confidence: answer.value[0]?.confidence ?? null,
          attempts: attempt,
        };
      }
      await new Promise(resolve => setTimeout(resolve, 1_500));
    }
    return { ok: false, status: 'no-answer' };
  } catch (cause) {
    return {
      ok: false,
      status: 'error',
      reason: cause instanceof Error ? cause.message : String(cause),
    };
  } finally {
    client.dispose();
  }
}

const report = {
  mode: 'module-graph',
  cases,
  allOk: answered === cases.length,
  accuracy: `${answered}/${cases.length}`,
  lsp: await tryAnalyzer(),
};

process.stdout.write(`RESOLVE ${JSON.stringify(report)}\n`);
