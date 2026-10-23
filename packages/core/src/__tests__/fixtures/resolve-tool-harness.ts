// P-343 — the harness the mandated python ids drive.
//
// It measures the import-resolution failures BEFORE and AFTER wiring the
// resolver registry (P-341) into `resolve_dependency_closure`:
//   * before — `resolveDependenciesForFiles` with no options: the P-149 lexical
//     path, which records package requirements but produces no
//     confidence-tagged internal edges (and cannot read Go or Rust at all);
//   * after  — the same walk with a heuristic-only registry, whose resolved
//     edges carry their own confidence tags (P-342).
//
// The Epic 16 corpus itself is NOT re-run here: it needs Docker and an AI
// provider key, so the corpus-level number stays honestly unmeasured (a
// missing measurement is never a zero). What this harness does measure is the
// local, fixture-level improvement, and it records both facts in
// `eval/resolve_tool/comparison.json`.
//
// One line of output: `RESOLVE {json}`

import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { ok } from 'neverthrow';
import { createResolverRegistry } from '../../resolve/registry.js';
import { resolveDependencyClosure } from '../../tools/resolve-dependency-closure.js';
import { resolveDependenciesForFiles } from '../../agent/tools/resolve_deps.js';
import type { SelectedFile, SourceRepo } from '../../agent/index.js';
import type { ToolContext } from '../../ai/types.js';

const REPO_ROOT = join(import.meta.dirname, '..', '..', '..', '..', '..');
const FIXTURES = join(REPO_ROOT, 'packages', 'core', 'test-fixtures');
const ARTIFACT = join(REPO_ROOT, 'eval', 'resolve_tool', 'comparison.json');
const TAXONOMY = join(REPO_ROOT, 'eval', 'taxonomy', 'failure_categories.json');

type Language = 'typescript' | 'python' | 'go' | 'rust';

interface FixtureSpec {
  readonly language: Language;
  readonly dir: string;
  readonly entry: string;
  readonly packageDirs: readonly string[];
}

const FIXTURE_SPECS: readonly FixtureSpec[] = [
  {
    language: 'typescript',
    dir: 'ts-resolver-repo',
    entry: 'src/index.ts',
    packageDirs: ['fake-pkg'],
  },
  { language: 'python', dir: 'python-resolver-repo', entry: 'pkg/consumer.py', packageDirs: [] },
  { language: 'go', dir: 'go-resolver-repo', entry: 'cmd/app/main.go', packageDirs: [] },
  { language: 'rust', dir: 'rust-resolver-repo', entry: 'src/main.rs', packageDirs: [] },
];

interface TruthCase {
  readonly name: string;
  readonly file?: string;
  readonly source?: string;
  readonly import_spec?: string;
  readonly spec?: string;
  readonly target: string;
}

interface CaseReport {
  readonly fixture: Language;
  readonly name: string;
  readonly target: string;
  readonly resolved: boolean;
}

interface Comparison {
  readonly before: readonly CaseReport[];
  readonly after: readonly CaseReport[];
}

/** Every file of a workspace, posix-relative, excluding node_modules. */
function listAll(root: string): string[] {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else files.push(relative(root, full).split(sep).join('/'));
    }
  };
  walk(root);
  return files;
}

/** A ToolContext over a real directory: reads and listings only. */
function ctxFor(root: string): ToolContext {
  const inert = {
    diff: async () => ok(''),
    status: async () => ok([]),
    commit: async () => ok(''),
    add: async () => ok(undefined),
    analyze: async () => ({}),
    install: async () => ok(undefined),
    scan: async () => ok([]),
    check: async () => ok([]),
  };
  return {
    cwd: root,
    config: {},
    logger: { ...inert, info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    costTracker: { ...inert, add: () => {}, totalTokens: { input: 0, output: 0, total: 0 } },
    git: {
      ...inert,
      listFiles: async () => ok(listAll(root)),
      readFile: async (_cwd: string, _repo: string, path: string) => {
        try {
          return ok(readFileSync(join(root, path), 'utf8'));
        } catch {
          return ok('');
        }
      },
    },
    deps: inert,
    license: inert,
  } as unknown as ToolContext;
}

function sel(path: string, repo: SourceRepo = 'A'): SelectedFile {
  return { repo, path };
}

/** A workspace holding one fixture, ready to be resolved. */
function workspaceFor(spec: FixtureSpec): string {
  const fixtureRoot = join(FIXTURES, spec.dir);
  const workspace = mkdtempSync(join(tmpdir(), `stitch-resolve-${spec.language}-`));
  if (spec.language === 'typescript') {
    // Only the sources and the tsconfig: a fixture-local package directory at
    // the workspace root would win the baseUrl lookup (the P-340 lesson).
    cpSync(join(fixtureRoot, 'src'), join(workspace, 'src'), { recursive: true });
    cpSync(join(fixtureRoot, 'tsconfig.json'), join(workspace, 'tsconfig.json'));
    mkdirSync(join(workspace, 'node_modules'), { recursive: true });
    for (const pkg of spec.packageDirs) {
      cpSync(join(fixtureRoot, pkg), join(workspace, 'node_modules', pkg), { recursive: true });
    }
    return workspace;
  }
  cpSync(fixtureRoot, workspace, { recursive: true });
  return workspace;
}

function truthCases(spec: FixtureSpec): readonly TruthCase[] {
  const raw = readFileSync(join(FIXTURES, spec.dir, 'ground-truth.json'), 'utf8');
  const parsed = JSON.parse(raw) as { cases?: readonly TruthCase[] };
  return parsed.cases ?? [];
}

/** Does one closure answer the case? */
function answersCase(
  edges: readonly { sourceFile: string; targetFile: string }[],
  required: readonly string[],
  entryFile: string,
  truth: TruthCase
): boolean {
  if (truth.target === '') {
    // "no edges expected": no edge may claim a target for this file.
    return !edges.some(edge => edge.sourceFile === entryFile && edge.targetFile === '');
  }
  if (edges.some(edge => edge.targetFile === truth.target)) return true;
  // A package target is deliberately NOT an internal edge: the walker records
  // it as a requirement instead, which is the correct answer for a merge.
  const pkg = truth.target.split('/')[1];
  return pkg !== undefined && required.includes(pkg);
}

async function measure(): Promise<Comparison> {
  const before: CaseReport[] = [];
  const after: CaseReport[] = [];
  for (const spec of FIXTURE_SPECS) {
    const workspace = workspaceFor(spec);
    // One registry per workspace: its rootDir defines the relative paths of
    // every edge it reports, so a shared registry would report the wrong ones.
    const registry = createResolverRegistry({ rootDir: workspace, lspMode: 'never' });
    try {
      const ctx = ctxFor(workspace);
      const cases = truthCases(spec);
      const files = new Set(cases.map(item => item.file ?? item.source ?? spec.entry));
      for (const file of files) {
        const lexical = await resolveDependenciesForFiles([sel(file)], ctx);
        const withRegistry = await resolveDependenciesForFiles([sel(file)], ctx, { registry });
        for (const truth of cases) {
          const caseFile = truth.file ?? truth.source ?? spec.entry;
          if (caseFile !== file) continue;
          const lexEdges = lexical.isOk() ? lexical.value.resolvedEdges : [];
          const lexRequired = lexical.isOk() ? lexical.value.required : [];
          const regEdges = withRegistry.isOk() ? withRegistry.value.resolvedEdges : [];
          const regRequired = withRegistry.isOk() ? withRegistry.value.required : [];
          before.push({
            fixture: spec.language,
            name: truth.name,
            target: truth.target,
            resolved: answersCase(lexEdges, lexRequired, caseFile, truth),
          });
          after.push({
            fixture: spec.language,
            name: truth.name,
            target: truth.target,
            resolved: answersCase(regEdges, regRequired, caseFile, truth),
          });
        }
      }
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  }
  return { before, after };
}

/** The corpus-level statement: measured or honestly deferred. */
function corpusState(): Record<string, unknown> {
  try {
    const raw = readFileSync(TAXONOMY, 'utf8');
    const parsed = JSON.parse(raw) as {
      import_resolution_share?: number;
      decision?: string;
    };
    return {
      measured: false,
      import_resolution_share: parsed.import_resolution_share ?? null,
      decision: parsed.decision ?? null,
      reason:
        'the Epic 16 corpus re-run needs Docker and an AI provider key; ' +
        'the corpus-level import-resolution rate stays unmeasured (a missing ' +
        'measurement is never a zero)',
    };
  } catch {
    return {
      measured: false,
      import_resolution_share: null,
      decision: null,
      reason: 'the P-331 taxonomy artifact is not available in this environment',
    };
  }
}

const firstSpec = FIXTURE_SPECS[0];
const workspace = workspaceFor(firstSpec as FixtureSpec);
let registryReport: Record<string, unknown>;
try {
  const registry = createResolverRegistry({ rootDir: workspace, lspMode: 'never' });
  const ctx = ctxFor(workspace);
  const closure = await resolveDependencyClosure([sel('src/index.ts')], ctx, { registry });
  registryReport = closure.isOk()
    ? {
        ok: true,
        edges: closure.value.resolvedEdges.map(edge => ({
          sourceFile: edge.sourceFile,
          targetFile: edge.targetFile,
          confidence: edge.confidence,
        })),
        required: [...closure.value.required].sort(),
        missingFiles: [...closure.value.missingFiles].sort(),
      }
    : { ok: false, code: closure.error.code };
  registry.shutdown();
} finally {
  rmSync(workspace, { recursive: true, force: true });
}

const comparison = await measure();
const beforeFailures = comparison.before.filter(item => !item.resolved).length;
const afterFailures = comparison.after.filter(item => !item.resolved).length;
const report = {
  mode: 'resolve-tool',
  registry: registryReport,
  before: { resolved: comparison.before.length - beforeFailures, total: comparison.before.length },
  after: { resolved: comparison.after.length - afterFailures, total: comparison.after.length },
  comparison: {
    beforeFailures,
    afterFailures,
    improvement: beforeFailures - afterFailures,
    cases: comparison,
    artifact: relative(REPO_ROOT, ARTIFACT).split(sep).join('/'),
  },
  corpus: corpusState(),
};

mkdirSync(join(REPO_ROOT, 'eval', 'resolve_tool'), { recursive: true });
await Bun.write(ARTIFACT, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`RESOLVE ${JSON.stringify(report)}\n`);
