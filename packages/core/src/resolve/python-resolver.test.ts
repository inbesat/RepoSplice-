// P-337 — the python resolver's contract, exercised without a python
// interpreter: the jedi fallback is injected, so every case is hermetic.
// The real jedi path is measured by the python test through the harness.

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ok } from 'neverthrow';
import { createPythonResolver, type PythonResolver } from './python-resolver.js';
import type { LspClient } from './lsp-client.js';

const ROOT = '/workspace';

/** A resolver whose jedi fallback answers with the given workspace paths. */
function withJedi(targets: readonly string[]): PythonResolver {
  return createPythonResolver({
    rootDir: ROOT,
    jediRunner: async () => ok(targets),
  });
}

/** A language server that answers one definition and nothing else. */
function serverWith(uri: string): LspClient {
  return {
    initialize: async () => ok({ capabilities: {} }),
    request: async () => ok({ uri }),
    notify: () => ok(undefined),
    onNotification: () => () => undefined,
    isAlive: () => true,
    shutdown: async () => ok(undefined),
    dispose: () => undefined,
  } as unknown as LspClient;
}

describe('python resolver (P-337)', () => {
  it('implements the resolver contract', async () => {
    const resolver = withJedi([]);
    expect(resolver.language).toBe('python');
    const result = await resolver.resolve('pkg/consumer.py', '.module');
    expect(result.isOk()).toBe(true);
  });

  it('resolves a relative import', async () => {
    const resolver = withJedi([`${ROOT}/pkg/module.py`]);
    const result = await resolver.resolve('pkg/consumer.py', '.module');
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const edge = result.value[0];
      expect(edge?.sourceFile).toBe('pkg/consumer.py');
      expect(edge?.targetFile).toBe('pkg/module.py');
      expect(edge?.confidence).toBe('heuristic-medium');
    }
  });

  it('resolves an absolute import', async () => {
    const resolver = withJedi([`${ROOT}/pkg/module.py`]);
    const result = await resolver.resolve('app.py', 'pkg.module');
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value[0]?.targetFile).toBe('pkg/module.py');
      expect(result.value[0]?.confidence).toBe('heuristic-medium');
    }
  });

  it('resolves a submodule import', async () => {
    const resolver = withJedi([`${ROOT}/pkg/sub/child.py`]);
    const result = await resolver.resolve('pkg/consumer.py', 'pkg.sub.child');
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value[0]?.targetFile).toBe('pkg/sub/child.py');
    }
  });

  it('resolves a conditional import', async () => {
    const resolver = withJedi([`${ROOT}/pkg/typing_only.py`]);
    const result = await resolver.resolve('pkg/consumer.py', '.typing_only');
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value[0]?.targetFile).toBe('pkg/typing_only.py');
    }
  });

  it('tags a language-server answer as lsp-high', async () => {
    // The language-server path reads the file it opens, so the workspace is
    // real here (the jedi cases never touch the disk).
    const workspace = mkdtempSync(join(tmpdir(), 'stitch-py-resolver-'));
    mkdirSync(join(workspace, 'pkg'), { recursive: true });
    writeFileSync(
      join(workspace, 'pkg', 'consumer.py'),
      'from .module import helper_value\n',
      'utf8'
    );
    const resolver = createPythonResolver({
      rootDir: workspace,
      lspClient: serverWith(pathToFileURL(join(workspace, 'pkg', 'module.py')).toString()),
      jediRunner: async () => ok([]),
    });
    const result = await resolver.resolve('pkg/consumer.py', '.module');
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value[0]?.targetFile).toBe('pkg/module.py');
      expect(result.value[0]?.confidence).toBe('lsp-high');
    }
  });

  it('reports no edges for an unresolved import', async () => {
    const resolver = withJedi([]);
    const result = await resolver.resolve('pkg/consumer.py', '.missing');
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toEqual([]);
    }
  });
});
