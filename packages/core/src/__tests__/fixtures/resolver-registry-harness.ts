// P-341 — the harness the mandated python tests drive. It exercises the five
// resolvers through the registry (interface compliance), the ecosystem
// selection, the LSP -> Heuristic -> None chain, and one real resolution
// through the chosen chain. One line of output: `RESOLVE {json}`.

import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createResolverRegistry } from '../../resolve/registry.js';
import type { DependencyResolver } from '../../resolve/types.js';

const REPO_ROOT = join(import.meta.dirname, '..', '..', '..', '..', '..');
const TS_FIXTURE = join(REPO_ROOT, 'packages', 'core', 'test-fixtures', 'ts-resolver-repo');

/** A workspace with the TS fixture's src + tsconfig (never its package dirs). */
function workspace(): string {
  const dir = mkdtempSync(join(tmpdir(), 'stitch-registry-'));
  cpSync(join(TS_FIXTURE, 'src'), join(dir, 'src'), { recursive: true });
  cpSync(join(TS_FIXTURE, 'tsconfig.json'), join(dir, 'tsconfig.json'));
  return dir;
}

const root = workspace();
const enabled = createResolverRegistry({ rootDir: root });
const disabled = createResolverRegistry({ rootDir: root, lspMode: 'never' });

const compliance: unknown[] = [];
for (const resolver of [
  enabled.getResolver('node'),
  enabled.getResolver('python'),
  enabled.getResolver('go'),
  enabled.getResolver('rust'),
  disabled.getResolver('node'),
].filter((item): item is DependencyResolver => item !== undefined)) {
  const capabilities = resolver.getCapabilities();
  const health = await resolver.healthCheck();
  const stopped = await resolver.shutdown();
  compliance.push({
    language: resolver.language,
    capabilities: {
      language: capabilities.language,
      strategies: capabilities.strategies,
      lsp: capabilities.lsp,
    },
    healthOk: health.isOk(),
    healthLsp: health.isOk() ? health.value.lsp : null,
    healthy: health.isOk() ? health.value.healthy : false,
    shutdownOk: stopped.isOk(),
  });
}

const selection = {
  node: enabled.getResolver('node')?.language ?? null,
  python: enabled.getResolver('python')?.language ?? null,
  go: enabled.getResolver('go')?.language ?? null,
  rust: enabled.getResolver('rust')?.language ?? null,
};

const chain = {
  auto: enabled.getFallbackChain('node').map(item => item.language),
  never: disabled.getFallbackChain('node').map(item => item.language),
  unknown: enabled.getFallbackChain('cobol' as never).map(item => item.language),
};

const resolution = await (async () => {
  const resolver = enabled.getResolver('node');
  if (resolver === undefined) return { ok: false, target: null, confidence: null };
  const answer = await resolver.resolve('src/index.ts', './helper');
  if (answer.isErr()) return { ok: false, target: null, confidence: null };
  const edge = answer.value[0];
  return {
    ok: edge?.targetFile === 'src/helper.ts',
    target: edge?.targetFile ?? null,
    confidence: edge?.confidence ?? null,
  };
})();

const report = {
  mode: 'registry',
  compliance,
  selection,
  chain,
  unknownResolver: enabled.getResolver('cobol' as never) === undefined ? null : 'unexpected',
  capabilities: enabled.getCapabilities(),
  resolution,
};

process.stdout.write(`RESOLVE ${JSON.stringify(report)}\n`);
rmSync(root, { recursive: true, force: true });
