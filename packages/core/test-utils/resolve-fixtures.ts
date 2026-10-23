// P-345 — the shared fixture runner for the resolver accuracy tests.
//
// The four fixture repos live OUTSIDE src (packages/core/test-fixtures) and
// carry a ground-truth.json naming, per case, the importing file plus the
// import specifier and the workspace-relative target the resolver must land
// on. This module is the ONE place that turns a fixture plus a registry into
// an accuracy report, so the vitest mirror and the bun harness measure
// exactly the same thing.
//
// It is deliberately a plain module: no vitest import, no test framework, so
// bun can run it directly and vitest can import it.

import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ok, type Result } from 'neverthrow';
import type { Ecosystem } from '../src/deps/ecosystem.js';
import {
  createLspClient,
  type LspClient,
  type LspInitializeResult,
} from '../src/resolve/lsp-client.js';
import { createLspPool } from '../src/resolve/lsp-pool.js';
import { createResolverRegistry, type ResolverRegistry } from '../src/resolve/registry.js';
import type { ConfidenceTag, ResolvedImport } from '../src/resolve/types.js';
import type { StitchError } from '../src/result/index.js';

/** The accuracy bar the phase mandates. */
export const ACCURACY_THRESHOLD = 0.95;

/** The four ecosystems of the cross-language stack. */
export type FixtureLanguage = 'typescript' | 'python' | 'go' | 'rust';

export interface FixtureSpec {
  readonly language: FixtureLanguage;
  readonly ecosystem: Ecosystem;
  /** The fixture directory under packages/core/test-fixtures. */
  readonly dir: string;
  /** A file of the fixture used by the fallback and performance checks. */
  readonly entry: string;
  /** A fixture-local directory the harness must place under node_modules. */
  readonly packageCopy?: string;
  readonly importSpec: string;
}

/** The fixtures the accuracy tests run against. */
// A fixed four-way tuple (not a plain array): the callers index it directly
// (`ACCURACY_FIXTURES[0]`) and `noUncheckedIndexedAccess` must not widen that
// to `FixtureSpec | undefined`.
export const ACCURACY_FIXTURES: readonly [FixtureSpec, FixtureSpec, FixtureSpec, FixtureSpec] = [
  {
    language: 'typescript',
    ecosystem: 'node',
    dir: 'ts-resolver-repo',
    entry: 'src/index.ts',
    packageCopy: 'fake-pkg',
    importSpec: './helper',
  },
  {
    language: 'python',
    ecosystem: 'python',
    dir: 'python-resolver-repo',
    entry: 'pkg/consumer.py',
    importSpec: '.module',
  },
  {
    language: 'go',
    ecosystem: 'go',
    dir: 'go-resolver-repo',
    entry: 'cmd/app/main.go',
    importSpec: 'example.com/fixture/pkg',
  },
  {
    language: 'rust',
    ecosystem: 'rust',
    dir: 'rust-resolver-repo',
    entry: 'src/main.rs',
    importSpec: 'crate::a',
  },
];

/** One ground-truth case, normalised across the two JSON shapes. */
export interface GroundTruthCase {
  readonly name: string;
  readonly file: string;
  readonly spec: string;
  readonly target: string;
}

interface RawCase {
  readonly name?: string;
  readonly file?: string;
  readonly source?: string;
  readonly import_spec?: string;
  readonly spec?: string;
  readonly target?: string;
}

/** The fixtures directory (a sibling of this test-utils directory). */
export function fixturesRoot(): string {
  return join(import.meta.dirname, '..', 'test-fixtures');
}

/** The fixture's directory, inside or outside a prepared workspace. */
export function fixtureDir(spec: FixtureSpec, rootDir?: string): string {
  return rootDir === undefined ? join(fixturesRoot(), spec.dir) : join(rootDir, spec.dir);
}

/**
 * Read a fixture's ground truth. The TS fixture stores `source`/`spec`, the
 * other three `file`/`import_spec`; both shapes come back normalised.
 */
export function loadGroundTruth(dir: string): readonly GroundTruthCase[] {
  const raw = JSON.parse(readFileSync(join(dir, 'ground-truth.json'), 'utf8')) as {
    cases?: readonly RawCase[];
  };
  const cases: GroundTruthCase[] = [];
  for (const entry of raw.cases ?? []) {
    const file = entry.file ?? entry.source;
    const spec = entry.import_spec ?? entry.spec;
    if (file === undefined || spec === undefined) continue;
    cases.push({
      name: entry.name ?? `${file}:${spec}`,
      file,
      spec,
      target: entry.target ?? '',
    });
  }
  return cases;
}

export interface PreparedWorkspace {
  readonly rootDir: string;
  readonly cleanup: () => void;
}

/**
 * Prepare a fixture for the resolvers.
 *
 * Three fixtures are read in place. The TypeScript one is copied into a temp
 * workspace carrying ONLY src, tsconfig.json and the fixture-local package
 * under node_modules: copying the whole fixture would let the package at the
 * workspace root win the baseUrl lookup and shadow node_modules (the P-340
 * lesson).
 */
export function prepareWorkspace(spec: FixtureSpec): PreparedWorkspace {
  const source = fixtureDir(spec);
  if (spec.packageCopy !== 'node_modules' && spec.language !== 'typescript') {
    return { rootDir: source, cleanup: () => undefined };
  }
  const workspace = mkdtempSync(join(tmpdir(), `stitch-accuracy-${spec.language}-`));
  cpSync(join(source, 'src'), join(workspace, 'src'), { recursive: true });
  cpSync(join(source, 'tsconfig.json'), join(workspace, 'tsconfig.json'));
  mkdirSync(join(workspace, 'node_modules'), { recursive: true });
  cpSync(
    join(source, spec.packageCopy ?? 'fake-pkg'),
    join(workspace, 'node_modules', spec.packageCopy ?? 'fake-pkg'),
    { recursive: true }
  );
  return {
    rootDir: workspace,
    cleanup: () => {
      rmSync(workspace, { recursive: true, force: true });
    },
  };
}

export interface RegistryOptions {
  readonly lspClients?: Partial<Record<Ecosystem, LspClient>>;
  readonly lspMode?: 'auto' | 'never';
}

/** The heuristic-only registry the accuracy suite measures by default. */
export function createAccuracyRegistry(
  rootDir: string,
  options: RegistryOptions = {}
): ResolverRegistry {
  return createResolverRegistry({
    rootDir,
    lspMode: options.lspMode ?? 'never',
    ...(options.lspClients !== undefined ? { lspClients: options.lspClients } : {}),
  });
}

/** A language server whose process is gone — the LSP-kill simulation. */
export function deadClient(): LspClient {
  return {
    initialize: async (): Promise<Result<LspInitializeResult, StitchError>> =>
      ok({ capabilities: {} }),
    request: async <T>(): Promise<Result<T, StitchError>> => ok(undefined as T),
    notify: () => ok(undefined),
    onNotification: () => () => undefined,
    isAlive: () => false,
    shutdown: async () => ok(undefined),
    dispose: () => undefined,
  };
}

export interface CaseResult {
  readonly name: string;
  readonly expected: string;
  readonly target: string | null;
  readonly confidence: ConfidenceTag | null;
  readonly ok: boolean;
}

export interface AccuracyReport {
  readonly language: FixtureLanguage;
  readonly ecosystem: Ecosystem;
  readonly cases: readonly CaseResult[];
  readonly resolved: number;
  readonly total: number;
  readonly accuracy: number;
  readonly accuracyPercent: number;
  readonly threshold: number;
  readonly met: boolean;
}

/** Resolve one ground-truth case through a registry. */
async function resolveCase(
  registry: ResolverRegistry,
  entry: GroundTruthCase
): Promise<CaseResult> {
  const answer = await registry.resolve(entry.file, entry.spec);
  if (answer.isErr()) {
    return {
      name: entry.name,
      expected: entry.target,
      target: null,
      confidence: null,
      ok: false,
    };
  }
  const edges: readonly ResolvedImport[] = answer.value;
  // The registry reports an emptiness as ONE `unresolved` marker edge, which
  // is data ("nothing answered"), not an answer.
  const meaningful = edges.filter(edge => edge.confidence !== 'unresolved');
  const match = meaningful.find(edge => edge.targetFile === entry.target);
  const expectNothing = entry.target === '';
  const ok = expectNothing ? meaningful.length === 0 : match !== undefined;
  const first = meaningful[0];
  return {
    name: entry.name,
    expected: entry.target,
    target: match?.targetFile ?? first?.targetFile ?? null,
    confidence: match?.confidence ?? first?.confidence ?? null,
    ok,
  };
}

/** Measure one fixture against its ground truth. */
export async function measureFixture(
  spec: FixtureSpec,
  registry: ResolverRegistry
): Promise<AccuracyReport> {
  const truth = loadGroundTruth(join(fixturesRoot(), spec.dir));
  const cases: CaseResult[] = [];
  for (const entry of truth) {
    cases.push(await resolveCase(registry, entry));
  }
  const resolved = cases.filter(item => item.ok).length;
  const total = cases.length;
  const accuracy = total === 0 ? 0 : resolved / total;
  return {
    language: spec.language,
    ecosystem: spec.ecosystem,
    cases,
    resolved,
    total,
    accuracy,
    accuracyPercent: Math.round(accuracy * 1000) / 10,
    threshold: ACCURACY_THRESHOLD,
    met: total > 0 && accuracy >= ACCURACY_THRESHOLD,
  };
}

/** The tags a report's edges carry, plus whether they are all heuristic. */
export function tagSummary(report: AccuracyReport): {
  readonly tags: readonly ConfidenceTag[];
  readonly allHeuristic: boolean;
  readonly allValid: boolean;
} {
  const tags = report.cases
    .map(item => item.confidence)
    .filter((tag): tag is ConfidenceTag => tag !== null);
  const allowed: readonly ConfidenceTag[] = ['lsp-high', 'heuristic-medium', 'unresolved'];
  return {
    tags,
    allHeuristic: tags.length > 0 && tags.every(tag => tag === 'heuristic-medium'),
    allValid: tags.every(tag => allowed.includes(tag)),
  };
}

export interface FallbackResult {
  readonly ok: boolean;
  readonly crashed: boolean;
  readonly confidence: ConfidenceTag | null;
  readonly target: string | null;
}

/**
 * The LSP-kill check: a registry whose language server is already dead must
 * still answer through the deterministic fallback — and must not throw.
 */
export async function runFallbackCheck(spec: FixtureSpec): Promise<FallbackResult> {
  const prepared = prepareWorkspace(spec);
  try {
    const registry = createAccuracyRegistry(prepared.rootDir, {
      lspMode: 'auto',
      lspClients: { [spec.ecosystem]: deadClient() },
    });
    const caseResult = await resolveCase(registry, {
      name: 'fallback',
      file: spec.entry,
      spec: spec.importSpec,
      target: '',
    });
    await registry.shutdown();
    return {
      ok: caseResult.target !== null,
      crashed: false,
      confidence: caseResult.confidence,
      target: caseResult.target,
    };
  } catch (cause) {
    return {
      ok: false,
      crashed: true,
      confidence: null,
      target: cause instanceof Error ? cause.message : String(cause),
    };
  } finally {
    prepared.cleanup();
  }
}

export interface PerformanceResult {
  readonly coldMs: number;
  readonly warmMs: number;
  readonly warmUnder200Ms: boolean;
  readonly coldUnder3000Ms: boolean;
}

/**
 * The performance check: the P-344 pool pays the server start once (cold) and
 * then answers from the warm process. The numbers are MEASURED here, never
 * claimed.
 */
export async function runPerformanceCheck(): Promise<PerformanceResult> {
  const stub = join(
    import.meta.dirname,
    '..',
    'src',
    '__tests__',
    'fixtures',
    'lsp-stub-server.ts'
  );
  const pool = createLspPool({
    createClient: (_ecosystem, _spec) =>
      createLspClient({
        command: process.execPath,
        args: [stub],
        requestTimeoutMs: 5_000,
        initializeTimeoutMs: 10_000,
        autoReconnect: false,
      }),
  });
  try {
    const coldStart = Date.now();
    const cold = await pool.getClient('node');
    const coldMs = Date.now() - coldStart;
    if (cold.isErr()) return { coldMs, warmMs: 0, warmUnder200Ms: false, coldUnder3000Ms: false };
    const warmStart = Date.now();
    await pool.request('node', 'echo', { value: 1 });
    const warmMs = Date.now() - warmStart;
    return {
      coldMs,
      warmMs,
      warmUnder200Ms: warmMs < 200,
      coldUnder3000Ms: coldMs < 3000,
    };
  } finally {
    await pool.shutdownAll();
  }
}
