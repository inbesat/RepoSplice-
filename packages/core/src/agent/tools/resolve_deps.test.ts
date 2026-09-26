// P-149 tests: agent tool `resolve_dependency_closure`.
//
// Fully offline. The source repos are in-memory maps served through
// `GitFacade.listFiles` / `GitFacade.readFile`, and C's "merged manifest" is a
// plain object served through `DepsFacade.analyze` — so the closure, the
// transitive walk, and the severity split are all exercised without touching a
// filesystem or a network.

import { describe, it, expect, beforeEach } from 'vitest';
import { resolveDependenciesForFiles, resolveDepsTool } from './resolve_deps.js';
import { registerAgentTool, listAgentTools, clearAgentToolsForTests } from './index.js';
import { selectFilesTool } from './select_files.js';
import type { SelectedFile, SourceRepo } from '../index.js';
import type { ToolContext } from '../../ai/types.js';
import type { Result } from 'neverthrow';
import { ok } from 'neverthrow';
import type { StitchError } from '../../result/index.js';

/** In-memory source repo: repo label -> { path -> content }. */
type Repo = Readonly<Record<string, string>>;

const REPO_A: Repo = {
  // Directly imports `left-pad` and reaches `chalk` only through `util.ts`.
  'src/app.ts': "import leftPad from 'left-pad';\nimport { help } from './util';\n",
  'src/util.ts': "import chalk from 'chalk';\nexport const help = () => chalk.green('hi');\n",
  // Pulled in transitively by src/app.ts but NOT in the selection.
  'src/deep/helper.ts': "import debug from 'debug';\nexport const d = () => debug('x');\n",
  'package.json': JSON.stringify({
    name: 'repo-a',
    dependencies: { 'left-pad': '^1.3.0' },
  }),
};

const REPO_B: Repo = {
  'lib/server.ts': "import express from 'express';\nimport { pool } from './db';\n",
  'lib/db.ts': "import pg from 'pg';\nexport const pool = pg;\n",
  'requirements.txt': 'requests==2.31.0\nflask==3.0.0\n',
  'Cargo.toml': '[package]\nname = "b"\nversion = "0.1.0"\n\n[dependencies]\nserde = "1"\n',
  // Go manifest deps must be reported too (P-149 acceptance criterion 3).
  // go.mod spells the dependency set `require`, not `dependencies`.
  'go.mod':
    'module example.com/b\n\ngo 1.22\n\nrequire (\n\tgithub.com/gin-gonic/gin v1.9.1\n\tgoogle.golang.org/grpc v1.62.0\n)\n',
};

function makeCtx(
  repos: Readonly<Record<SourceRepo, Repo>>,
  mergedManifest: Record<string, string>
): ToolContext {
  const inert = {
    diff: async (): Promise<string> => '',
    status: async (): Promise<string> => '',
    commit: async (): Promise<void> => {},
    add: async (): Promise<void> => {},
    analyze: async (): Promise<Record<string, string>> => mergedManifest,
    install: async (): Promise<void> => {},
    scan: async (): Promise<string[]> => [],
    check: async (): Promise<boolean> => true,
  };
  return {
    cwd: '/repo',
    config: {},
    logger: { ...inert, info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    costTracker: { ...inert, add: () => {}, totalTokens: { input: 0, output: 0, total: 0 } },
    git: {
      ...inert,
      listFiles: async (_cwd: string, repo: 'A' | 'B'): Promise<Result<string[], StitchError>> =>
        ok(Object.keys(repos[repo] ?? {})),
      readFile: async (
        _cwd: string,
        repo: 'A' | 'B',
        path: string
      ): Promise<Result<string, StitchError>> => {
        const content = (repos[repo] ?? {})[path];
        return content === undefined ? ok('') : ok(content);
      },
    },
    deps: inert,
    license: inert,
  } as unknown as ToolContext;
}

function sel(repo: SourceRepo, path: string): SelectedFile {
  return { repo, path };
}

beforeEach(() => {
  clearAgentToolsForTests();
  for (const t of [selectFilesTool, resolveDepsTool]) {
    expect(registerAgentTool(t).isOk()).toBe(true);
  }
});

describe('P-149 resolve_dependency_closure', () => {
  it('reports satisfied vs missing', async () => {
    // C already has left-pad and grpc; it does not have chalk, express, or gin.
    const ctx = makeCtx(
      { A: REPO_A, B: REPO_B },
      { 'left-pad': '^1.3.0', 'google.golang.org/grpc': 'v1.62.0' }
    );
    const result = await resolveDependenciesForFiles(
      [sel('A', 'src/app.ts'), sel('B', 'lib/server.ts')],
      ctx
    );
    expect(result.isOk()).toBe(true);
    const closure = result._unsafeUnwrap();

    // left-pad is direct AND already in C's manifest -> satisfied.
    expect(closure.satisfied).toContain('left-pad');
    // chalk is reached only via ./util, which is not selected -> missing.
    expect(closure.missing).toContain('chalk');
    // express is imported directly by the selected B file -> missing.
    expect(closure.missing).toContain('express');
    // Nothing that is present may appear in missing, and vice versa.
    for (const name of closure.satisfied) expect(closure.missing).not.toContain(name);
    for (const name of closure.missing) expect(closure.satisfied).not.toContain(name);
    // required is the union and is sorted.
    expect(closure.required).toEqual([...closure.required].sort());
    expect([...closure.required].sort()).toEqual([...new Set([...closure.required])].sort());

    // Non-npm ecosystems report their manifest deps too: the python
    // requirements, the cargo [dependencies] table, and the go `require`
    // blocks all feed `required` (P-149 acceptance criterion 3).
    expect(closure.required).toContain('requests');
    expect(closure.required).toContain('flask');
    expect(closure.required).toContain('serde');
    expect(closure.required).toContain('github.com/gin-gonic/gin');
    // grpc is declared in go.mod AND present in C -> satisfied, proving the go
    // `require` block is read (not just the npm-style `dependencies` key).
    expect(closure.satisfied).toContain('google.golang.org/grpc');
    // gin is declared in go.mod but absent from C -> missing.
    expect(closure.missing).toContain('github.com/gin-gonic/gin');
  });

  it('maps byFile closures', async () => {
    const ctx = makeCtx({ A: REPO_A, B: REPO_B }, {});
    const result = await resolveDependenciesForFiles(
      [sel('A', 'src/app.ts'), sel('B', 'lib/server.ts')],
      ctx
    );
    expect(result.isOk()).toBe(true);
    const closure = result._unsafeUnwrap();

    // Keys are repo-qualified so the same relative path in A and B cannot collide.
    expect(Object.keys(closure.byFile).sort()).toEqual(
      expect.arrayContaining(['A:src/app.ts', 'B:lib/server.ts'])
    );
    expect(closure.byFile['A:src/app.ts']).toEqual(['left-pad']);
    expect(closure.byFile['B:lib/server.ts']).toEqual(['express']);

    // Each byFile list is itself sorted and only contains required packages.
    for (const list of Object.values(closure.byFile)) {
      expect(list).toEqual([...list].sort());
      for (const name of list) expect(closure.required).toContain(name);
    }
  });

  it('flags transitive vs direct', async () => {
    const ctx = makeCtx({ A: REPO_A, B: REPO_B }, {});
    const result = await resolveDependenciesForFiles([sel('A', 'src/app.ts')], ctx);
    expect(result.isOk()).toBe(true);
    const closure = result._unsafeUnwrap();

    // left-pad is imported by the selected file -> direct.
    expect(closure.direct).toContain('left-pad');
    expect(closure.missingDirect).toContain('left-pad');
    expect(closure.severity['left-pad']).toBe('direct');

    // chalk is only reachable through the unselected ./util -> transitive-only.
    expect(closure.transitive).toContain('chalk');
    expect(closure.missingTransitive).toContain('chalk');
    expect(closure.severity['chalk']).toBe('transitive');
    // The two missing buckets partition `missing` exactly.
    expect([...closure.missingDirect, ...closure.missingTransitive].sort()).toEqual(
      closure.missing
    );
    // A transitive package is never also classified direct.
    for (const name of closure.missingTransitive) {
      expect(closure.direct).not.toContain(name);
    }

    // The internal file that was reached but not selected is reported so the
    // agent knows to add it.
    expect(closure.missingFiles).toContain('A:src/util.ts');
  });

  it('is read-only', async () => {
    const ctx = makeCtx({ A: REPO_A, B: REPO_B }, {});
    let writes = 0;
    // Any mutation attempt by the tool would be observable here. The facade
    // exposes no write surface, and the tool must not reach for one.
    const guarded = {
      ...ctx,
      deps: {
        ...ctx.deps,
        install: async (): Promise<void> => {
          writes += 1;
        },
      },
    } as ToolContext;

    const before = JSON.stringify(REPO_A);
    const result = await resolveDependenciesForFiles(
      [sel('A', 'src/app.ts'), sel('B', 'lib/server.ts')],
      guarded
    );
    expect(result.isOk()).toBe(true);
    // No install, and the source content is byte-identical afterwards.
    expect(writes).toBe(0);
    expect(JSON.stringify(REPO_A)).toBe(before);
    // The tool is registered as auto (read-only proposals need no approval).
    expect(resolveDepsTool.autonomy).toBe('auto');
    expect(listAgentTools().map(t => t.name)).toContain('resolve_dependency_closure');
  });

  it('handles empty selection', async () => {
    const ctx = makeCtx({ A: REPO_A, B: REPO_B }, {});
    const result = await resolveDependenciesForFiles([], ctx);
    // An empty selection is an empty closure, NOT an error.
    expect(result.isOk()).toBe(true);
    const closure = result._unsafeUnwrap();
    expect(closure.required).toEqual([]);
    expect(closure.missing).toEqual([]);
    expect(closure.satisfied).toEqual([]);
    expect(closure.byFile).toEqual({});
    expect(closure.missingFiles).toEqual([]);
    expect(closure.visitedFiles).toEqual([]);
  });
});
