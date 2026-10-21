// P-336 — the resolver harness: it copies the ground-truth fixture repo into
// a temp workspace (with a fake node_modules package), asks the resolver for
// every import in the ground truth and prints the report.
//
// The compiler-API path is the primary answer here (it is the fallback the
// spec asks for and it is hermetic); the language-server path is attempted
// as well and reported separately, so a missing server never fails the run —
// the client simply falls back, exactly as it does in production.
//
// One line: `RESOLVE {json}`

import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createLspClient } from '../../resolve/lsp-client.js';
import { createTsResolver } from '../../resolve/ts-resolver.js';

interface TruthCase {
  readonly name: string;
  readonly source: string;
  readonly spec: string;
  readonly target: string;
}

// The ground-truth fixture repo lives OUTSIDE src (packages/core/test-fixtures)
// so the root typecheck (packages/*/src/**/*) never compiles it - the fixture
// imports a fake node_modules package that only exists inside the temp
// workspace, so type-checking it in place would fail.
const FIXTURE_ROOT = join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  'test-fixtures',
  'ts-resolver-repo'
);
const SERVER_ENTRY = join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  'node_modules',
  'typescript-language-server',
  'lib',
  'cli.mjs'
);

function buildWorkspace(): string {
  const workspace = mkdtempSync(join(tmpdir(), 'stitch-ts-resolver-'));
  cpSync(join(FIXTURE_ROOT, 'src'), join(workspace, 'src'), { recursive: true });
  cpSync(join(FIXTURE_ROOT, 'tsconfig.json'), join(workspace, 'tsconfig.json'));
  mkdirSync(join(workspace, 'node_modules'), { recursive: true });
  cpSync(join(FIXTURE_ROOT, 'fake-pkg'), join(workspace, 'node_modules', 'fake-pkg'), {
    recursive: true,
  });
  // The language server needs a TypeScript installation inside the workspace.
  const typescriptDir = join(import.meta.dirname, '..', '..', '..', 'node_modules', 'typescript');
  if (existsSync(typescriptDir)) {
    symlinkSync(typescriptDir, join(workspace, 'node_modules', 'typescript'), 'junction');
  }
  return workspace;
}

function readTruth(): readonly TruthCase[] {
  const raw = readFileSync(join(FIXTURE_ROOT, 'ground-truth.json'), 'utf8');
  const parsed = JSON.parse(raw) as { cases?: readonly TruthCase[] };
  return parsed.cases ?? [];
}

async function runCompilerPath(
  workspace: string,
  truth: readonly TruthCase[]
): Promise<{ readonly cases: unknown[]; readonly allOk: boolean }> {
  const resolver = createTsResolver({ rootDir: workspace });
  const cases: unknown[] = [];
  for (const entry of truth) {
    const answer = await resolver.resolve(entry.source, entry.spec);
    if (answer.isErr()) {
      cases.push({
        name: entry.name,
        ok: false,
        expected: entry.target,
        target: null,
        confidence: null,
        error: 'message' in answer.error ? answer.error.message : answer.error.code,
      });
      continue;
    }
    const edges = answer.value;
    const first = edges[0];
    cases.push({
      name: entry.name,
      ok: first !== undefined && first.targetFile === entry.target,
      expected: entry.target,
      target: first?.targetFile ?? null,
      confidence: first?.confidence ?? null,
      source: first?.sourceFile ?? null,
      count: edges.length,
    });
  }
  const allOk = cases.every(entry => (entry as { ok: boolean }).ok);
  return { cases, allOk };
}

async function runLspPath(workspace: string): Promise<Record<string, unknown>> {
  if (!existsSync(SERVER_ENTRY)) {
    return { ok: false, error: 'the language server is not installed' };
  }
  const client = createLspClient({
    command: process.execPath,
    args: [SERVER_ENTRY, '--stdio'],
    cwd: workspace,
    requestTimeoutMs: 10_000,
    initializeTimeoutMs: 20_000,
    shutdownTimeoutMs: 5_000,
  });
  try {
    const initialized = await client.initialize({
      processId: process.pid,
      rootUri: pathToFileURL(workspace).toString(),
      capabilities: {},
      workspaceFolders: null,
    });
    if (initialized.isErr()) {
      return {
        ok: false,
        error: 'message' in initialized.error ? initialized.error.message : initialized.error.code,
      };
    }
    const resolver = createTsResolver({ rootDir: workspace, lspClient: client });
    const answer = await resolver.resolve('src/index.ts', './helper');
    if (answer.isErr()) {
      return {
        ok: false,
        error: 'message' in answer.error ? answer.error.message : answer.error.code,
      };
    }
    const first = answer.value[0];
    return {
      ok: first !== undefined && first.targetFile === 'src/helper.ts',
      target: first?.targetFile ?? null,
      confidence: first?.confidence ?? null,
    };
  } catch (cause) {
    return { ok: false, error: cause instanceof Error ? cause.message : String(cause) };
  } finally {
    client.dispose();
  }
}

const workspace = buildWorkspace();
try {
  const truth = readTruth();
  const compiler = await runCompilerPath(workspace, truth);
  const lsp = await runLspPath(workspace);
  const report = {
    mode: 'compiler',
    cases: compiler.cases,
    allOk: compiler.allOk,
    accuracy: `${compiler.cases.filter(entry => (entry as { ok: boolean }).ok).length}/${compiler.cases.length}`,
    lsp,
  };
  process.stdout.write(`RESOLVE ${JSON.stringify(report)}\n`);
} finally {
  rmSync(workspace, { recursive: true, force: true });
}
