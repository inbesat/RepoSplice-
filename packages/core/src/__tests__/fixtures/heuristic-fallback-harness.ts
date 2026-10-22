// P-340 — the harness the python test drives: it exercises the heuristic
// fallback over the four EXISTING ground-truth fixtures (no fifth fixture is
// invented), reports the tree-sitter specifier extraction per language, and
// proves the LSP-failure integration really falls back.
//
// The TS fixture needs its fake package inside a real `node_modules` (exactly
// like the P-336 harness), so that fixture is copied into a temp workspace
// first; the other three resolve in place.
//
// One line: `RESOLVE {json}`

import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { err, ok } from 'neverthrow';
import {
  createHeuristicResolver,
  extractSpecifiers,
  withHeuristicFallback,
} from '../../resolve/heuristic-fallback.js';
import type { HeuristicLanguage } from '../../resolve/heuristic-fallback.js';
import type { DependencyResolver, ResolvedImport } from '../../resolve/types.js';
import type { StitchError } from '../../result/index.js';

const REPO_ROOT = join(import.meta.dirname, '..', '..', '..', '..', '..');
const FIXTURES = join(REPO_ROOT, 'packages', 'core', 'test-fixtures');

interface TruthCase {
  readonly name: string;
  readonly source?: string;
  readonly file?: string;
  readonly spec?: string;
  readonly import_spec?: string;
  readonly target: string;
}

interface FixtureSpec {
  readonly language: HeuristicLanguage;
  readonly repo: string;
  readonly extractFrom: string;
  /** A fixture-local package to install as node_modules/<name>. */
  readonly nodeModulesPackage?: string;
}

const FIXTURE_SPECS: readonly FixtureSpec[] = [
  {
    language: 'typescript',
    repo: 'ts-resolver-repo',
    extractFrom: 'src/index.ts',
    nodeModulesPackage: 'fake-pkg',
  },
  { language: 'python', repo: 'python-resolver-repo', extractFrom: 'pkg/consumer.py' },
  { language: 'go', repo: 'go-resolver-repo', extractFrom: 'cmd/app/main.go' },
  { language: 'rust', repo: 'rust-resolver-repo', extractFrom: 'src/main.rs' },
];

interface Workspace {
  readonly root: string;
  cleanup(): void;
}

/** The workspace a fixture resolves in (a temp copy when it needs node_modules). */
function prepareWorkspace(spec: FixtureSpec): Workspace {
  const source = join(FIXTURES, spec.repo);
  const packageName = spec.nodeModulesPackage;
  if (packageName === undefined) {
    return { root: source, cleanup: () => undefined };
  }
  const workspace = mkdtempSync(join(tmpdir(), `stitch-heuristic-${spec.language}-`));
  // Copy src + the tsconfig ONLY: a fixture-local `fake-pkg/` at the workspace
  // root would win the baseUrl lookup and shadow node_modules.
  cpSync(join(source, 'src'), join(workspace, 'src'), { recursive: true });
  cpSync(join(source, 'tsconfig.json'), join(workspace, 'tsconfig.json'));
  mkdirSync(join(workspace, 'node_modules'), { recursive: true });
  cpSync(join(source, packageName), join(workspace, 'node_modules', packageName), {
    recursive: true,
  });
  return {
    root: workspace,
    cleanup: () => rmSync(workspace, { recursive: true, force: true }),
  };
}

function readTruth(root: string): readonly TruthCase[] {
  const raw = JSON.parse(readFileSync(join(root, 'ground-truth.json'), 'utf8')) as {
    cases?: readonly TruthCase[];
  };
  return raw.cases ?? [];
}

function fileOf(item: TruthCase): string {
  return item.file ?? item.source ?? '';
}

function specOf(item: TruthCase): string {
  return item.import_spec ?? item.spec ?? '';
}

async function runFixture(spec: FixtureSpec): Promise<Record<string, unknown>> {
  const workspace = prepareWorkspace(spec);
  try {
    const resolver = createHeuristicResolver({ rootDir: workspace.root });
    const cases: unknown[] = [];
    for (const item of readTruth(join(FIXTURES, spec.repo))) {
      const result = await resolver.resolve(fileOf(item), specOf(item));
      if (result.isErr()) {
        cases.push({ name: item.name, ok: false, expected: item.target, target: null });
        continue;
      }
      const edge = result.value[0];
      const target = edge?.targetFile ?? null;
      const expectedNothing = item.target === '';
      cases.push({
        name: item.name,
        ok: expectedNothing ? edge === undefined : target === item.target,
        expected: item.target,
        target,
        confidence: edge?.confidence ?? null,
      });
    }
    const answered = cases.filter(item => (item as { ok: boolean }).ok).length;
    return {
      language: spec.language,
      cases,
      allOk: answered === cases.length,
      accuracy: `${answered}/${cases.length}`,
    };
  } finally {
    workspace.cleanup();
  }
}

async function runExtraction(spec: FixtureSpec): Promise<Record<string, unknown>> {
  const source = readFileSync(join(FIXTURES, spec.repo, spec.extractFrom), 'utf8');
  const extracted = await extractSpecifiers(source, spec.language);
  if (extracted.isErr()) {
    return { language: spec.language, ok: false, count: 0, specifiers: [] };
  }
  return {
    language: spec.language,
    ok: extracted.value.length > 0,
    count: extracted.value.length,
    specifiers: extracted.value,
  };
}

async function runLspFailure(): Promise<Record<string, unknown>> {
  // A primary resolver that behaves like a language server that just died.
  const dead: DependencyResolver = {
    language: 'typescript',
    resolve: async () =>
      err<ResolvedImport[], StitchError>({
        code: 'INTERNAL',
        message: 'the language server exited',
      }),
    getCapabilities: () => ({
      language: 'typescript',
      strategies: ['lsp-high'],
      lsp: 'configured',
    }),
    healthCheck: async () => ok({ healthy: true, lsp: 'available' }),
    shutdown: async () => ok(undefined),
  };
  const workspace = prepareWorkspace(FIXTURE_SPECS[0] as FixtureSpec);
  try {
    const heuristic = createHeuristicResolver({ rootDir: workspace.root });
    const combined = withHeuristicFallback(dead, heuristic);
    const result = await combined.resolve('src/index.ts', './helper');
    if (result.isErr()) {
      return { ok: false, target: null, confidence: null, reason: result.error.code };
    }
    const edge = result.value[0];
    return {
      ok: edge !== undefined && edge.targetFile === 'src/helper.ts',
      target: edge?.targetFile ?? null,
      confidence: edge?.confidence ?? null,
    };
  } finally {
    workspace.cleanup();
  }
}

const languages: Record<string, unknown> = {};
const extraction: Record<string, unknown> = {};
for (const spec of FIXTURE_SPECS) {
  languages[spec.language] = await runFixture(spec);
  extraction[spec.language] = await runExtraction(spec);
}

const report = {
  mode: 'heuristic',
  languages,
  extraction,
  lspFailure: await runLspFailure(),
};

process.stdout.write(`RESOLVE ${JSON.stringify(report)}\n`);
