// P-342 — the harness the python ids drive: it shows all three confidence
// tags through the registry (P-341): a language-server answer is `lsp-high`,
// the heuristic answer is `heuristic-medium`, and an import nothing could
// resolve is ONE `unresolved` edge with an empty target.
//
// One line: `RESOLVE {json}`

import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ok, type Result } from 'neverthrow';
import { createResolverRegistry } from '../../resolve/registry.js';
import type { LspClient, LspInitializeResult } from '../../resolve/lsp-client.js';
import type { ResolvedImport } from '../../resolve/types.js';
import type { StitchError } from '../../result/index.js';

const REPO_ROOT = join(import.meta.dirname, '..', '..', '..', '..', '..');
const TS_FIXTURE = join(REPO_ROOT, 'packages', 'core', 'test-fixtures', 'ts-resolver-repo');

/** A language server that answers every definition with the same target. */
class AnsweringClient implements LspClient {
  private readonly target: string;

  constructor(target: string) {
    this.target = target;
  }

  async initialize(): Promise<Result<LspInitializeResult, StitchError>> {
    return ok({ capabilities: {} });
  }

  async request<T>(method: string): Promise<Result<T, StitchError>> {
    if (method === 'textDocument/definition') {
      return ok([{ uri: this.target }] as unknown as T);
    }
    return ok(undefined as T);
  }

  notify(): Result<void, StitchError> {
    return ok(undefined);
  }

  onNotification(): () => void {
    return () => undefined;
  }

  isAlive(): boolean {
    return true;
  }

  async shutdown(): Promise<Result<void, StitchError>> {
    return ok(undefined);
  }

  dispose(): void {
    // nothing to clean up
  }
}

// The workspace carries ONLY the fixture's src + tsconfig: a fixture-local
// package directory at the root would win the baseUrl lookup and shadow
// node_modules (the P-340 lesson).
const workspace = mkdtempSync(join(tmpdir(), 'stitch-confidence-'));
cpSync(join(TS_FIXTURE, 'src'), join(workspace, 'src'), { recursive: true });
cpSync(join(TS_FIXTURE, 'tsconfig.json'), join(workspace, 'tsconfig.json'));

interface EdgeReport {
  readonly ok: boolean;
  readonly confidence: string | null;
  readonly target: string | null;
  readonly count: number;
}

function edgeReport(result: Result<ResolvedImport[], StitchError>): EdgeReport {
  const edges: readonly ResolvedImport[] = result.isOk() ? result.value : [];
  const first = edges[0];
  return {
    ok: result.isOk(),
    confidence: first?.confidence ?? null,
    target: first?.targetFile ?? null,
    count: edges.length,
  };
}

const target = pathToFileURL(join(workspace, 'src', 'helper.ts')).toString();

const lspRegistry = createResolverRegistry({
  rootDir: workspace,
  lspClients: { node: new AnsweringClient(target) },
});
const lsp = edgeReport(await lspRegistry.resolve('src/index.ts', './helper'));
const lspDistribution = lspRegistry.getConfidenceDistribution();

const heuristicRegistry = createResolverRegistry({ rootDir: workspace, lspMode: 'never' });
const heuristic = edgeReport(await heuristicRegistry.resolve('src/index.ts', './helper'));
const heuristicDistribution = heuristicRegistry.getConfidenceDistribution();

const unresolvedRegistry = createResolverRegistry({ rootDir: workspace, lspMode: 'never' });
const unresolved = edgeReport(await unresolvedRegistry.resolve('src/index.ts', './does-not-exist'));
const distribution = unresolvedRegistry.getConfidenceDistribution();

const report = {
  mode: 'confidence',
  lsp,
  heuristic,
  unresolved,
  distribution,
  lspDistribution,
  heuristicDistribution,
};

process.stdout.write(`RESOLVE ${JSON.stringify(report)}\n`);
rmSync(workspace, { recursive: true, force: true });
