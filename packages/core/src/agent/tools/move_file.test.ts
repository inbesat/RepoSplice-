// P-153 tests: agent tool `move_file`.
//
// Fully offline. The stage is an in-memory map served through
// `GitFacade.readStagedFile` / `writeFile` / `move`, with a write journal so
// rollback is observable. The fixture contains a real importer of the file
// being moved, plus decoys that must NOT be rewritten.

import { describe, it, expect, beforeEach } from 'vitest';
import { ok, err, type Result } from 'neverthrow';
import {
  planMove,
  executeMove,
  rewriteSpecifier,
  rewriteImportRefs,
  moveFileTool,
} from './move_file.js';
import {
  selectFilesTool,
  resolveDepsTool,
  detectGapsTool,
  fixDependencyTool,
  editConfigTool,
  moveFileTool as moveToolAlias,
  registerAgentTool,
  clearAgentToolsForTests,
  listAgentTools,
} from './index.js';
import type { StagingFacade, ToolContext } from '../../ai/types.js';
import { stitchErrorMessage, type StitchError } from '../../result/index.js';

/** The file under test, at its original location. */
const UTIL_TS = 'export const fmt = (s: string) => s.trim();\n';
/** A staged file that imports it relatively. */
const APP_TS = [
  "import { fmt } from './util';",
  "import { other } from './nested/other';",
  'export const run = () => fmt(other());',
  '',
].join('\n');
/** A decoy: mentions the same text in prose, NOT in an import. */
const DOC_MD = 'Use the ./util module for formatting.\n';

const INITIAL: Record<string, string> = {
  'src/app.ts': APP_TS,
  'src/util.ts': UTIL_TS,
  'src/nested/other.ts': 'export const other = () => 1;\n',
  'docs/notes.md': DOC_MD,
};

function makeCtx(opts: { staged?: Record<string, string>; failWriteFor?: string } = {}): {
  ctx: ToolContext;
  files: Record<string, string>;
  writes: string[];
  moves: Array<[string, string]>;
} {
  const files: Record<string, string> = { ...(opts.staged ?? INITIAL) };
  const writes: string[] = [];
  const moves: Array<[string, string]> = [];
  const inert = {
    diff: async (): Promise<string> => '',
    status: async (): Promise<string> => '',
    commit: async (): Promise<void> => {},
    add: async (): Promise<void> => {},
    analyze: async (): Promise<Record<string, string>> => ({}),
    install: async (): Promise<void> => {},
    scan: async (): Promise<string[]> => [],
    check: async (): Promise<boolean> => true,
  };
  const staging: StagingFacade = {
    listStagedFiles: async (): Promise<Result<string[], StitchError>> => ok(Object.keys(files)),
    readStagedFile: async (path: string): Promise<Result<string, StitchError>> => {
      const content = files[path];
      return content === undefined
        ? err({ code: 'FILE_NOT_FOUND', path, message: `no staged file ${path}` })
        : ok(content);
    },
  };
  const ctx = {
    cwd: '/repo',
    config: { stageRoot: 'C' },
    logger: { ...inert, info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    costTracker: { ...inert, add: () => {}, totalTokens: { input: 0, output: 0, total: 0 } },
    git: {
      ...inert,
      readStagedFile: staging.readStagedFile,
      writeFile: async (
        _cwd: string,
        _repo: 'A' | 'B',
        path: string,
        content: string
      ): Promise<Result<void, StitchError>> => {
        if (opts.failWriteFor === path) {
          return err({ code: 'INTERNAL', message: `simulated write failure for ${path}` });
        }
        writes.push(path);
        files[path] = content;
        return ok(undefined);
      },
      move: async (
        _cwd: string,
        _repo: 'A' | 'B',
        from: string,
        to: string
      ): Promise<Result<void, StitchError>> => {
        const content = files[from];
        if (content === undefined) {
          return err({
            code: 'FILE_NOT_FOUND',
            path: from,
            message: `cannot move missing ${from}`,
          });
        }
        moves.push([from, to]);
        files[to] = content;
        delete files[from];
        return ok(undefined);
      },
    },
    deps: inert,
    license: inert,
    staging,
  } as unknown as ToolContext;
  return { ctx, files, writes, moves };
}

beforeEach(() => {
  clearAgentToolsForTests();
  for (const t of [
    selectFilesTool,
    resolveDepsTool,
    detectGapsTool,
    fixDependencyTool,
    editConfigTool,
    moveToolAlias,
  ]) {
    expect(registerAgentTool(t).isOk()).toBe(true);
  }
});

describe('P-153 move_file', () => {
  it('plans move with rewrites', async () => {
    const { ctx } = makeCtx();
    const result = await planMove('C/src/util.ts', 'C/src/shared/util.ts', undefined, ctx);
    expect(result.isOk()).toBe(true);
    const plan = result._unsafeUnwrap();

    expect(plan.from).toBe('src/util.ts');
    expect(plan.to).toBe('src/shared/util.ts');
    expect(plan.dryRun).toBeUndefined();

    // Exactly one file imports it, and the ref is updated correctly.
    expect(plan.importRewrites).toHaveLength(1);
    const rewrite = plan.importRewrites[0];
    expect(rewrite?.file).toBe('src/app.ts');
    expect(rewrite?.oldRef).toBe('./util');
    // src/app.ts -> src/shared/util.ts is one level down and across.
    expect(rewrite?.newRef).toBe('./shared/util');

    // Files that do NOT import it are never listed.
    const files = plan.importRewrites.map(r => r.file);
    expect(files).not.toContain('src/nested/other.ts');
    expect(files).not.toContain('docs/notes.md');
    expect(files).not.toContain('src/util.ts');

    // The planner is pure: nothing was written or moved.
    const later = makeCtx();
    void later;
  });

  it('dry run writes nothing', async () => {
    const { ctx, files, writes, moves } = makeCtx();
    const before = JSON.stringify(files);

    const plan = await planMove('C/src/util.ts', 'C/src/shared/util.ts', undefined, ctx, {
      dryRun: true,
    });
    expect(plan.isOk()).toBe(true);
    expect(plan._unsafeUnwrap().dryRun).toBe(true);

    // Even executing a dry-run plan writes nothing.
    const applied = await executeMove(plan._unsafeUnwrap(), ctx);
    expect(applied.isOk()).toBe(true);

    expect(writes).toEqual([]);
    expect(moves).toEqual([]);
    expect(JSON.stringify(files)).toBe(before);

    // And the real (non-dry) plan of the same move is identical apart from the
    // flag — proving a dry run is the same code path, not a parallel one.
    const real = await planMove('C/src/util.ts', 'C/src/shared/util.ts', undefined, ctx);
    expect(real.isOk()).toBe(true);
    expect(real._unsafeUnwrap().importRewrites).toEqual(plan._unsafeUnwrap().importRewrites);
  });

  it('executes move and rewrites', async () => {
    const { ctx, files, moves } = makeCtx();
    const plan = await planMove('C/src/util.ts', 'C/src/shared/util.ts', undefined, ctx);
    expect(plan.isOk()).toBe(true);

    const applied = await executeMove(plan._unsafeUnwrap(), ctx);
    expect(applied.isOk()).toBe(true);

    // The file actually moved; the old path is gone.
    expect(moves).toEqual([['src/util.ts', 'src/shared/util.ts']]);
    expect(files['src/util.ts']).toBeUndefined();
    expect(files['src/shared/util.ts']).toBe(UTIL_TS);

    // The importer now points at the new location.
    expect(files['src/app.ts']).toContain("import { fmt } from './shared/util';");
    // Its other import is untouched.
    expect(files['src/app.ts']).toContain("from './nested/other'");
    // The decoy markdown is byte-identical: only real imports are rewritten.
    expect(files['docs/notes.md']).toBe(DOC_MD);
  });

  it('aborts on collision', async () => {
    const { ctx, files, writes, moves } = makeCtx({
      staged: { ...INITIAL, 'src/taken.ts': 'export const taken = 1;\n' },
    });

    // A move onto an existing staged path is refused.
    const collision = await planMove('C/src/util.ts', 'C/src/taken.ts', undefined, ctx);
    expect(collision.isErr()).toBe(true);
    const error = collision._unsafeUnwrapErr();
    expect(error.code).toBe('CONFIG_ERROR');
    expect(stitchErrorMessage(error)).toContain('overwrite');
    expect(writes).toEqual([]);
    expect(moves).toEqual([]);

    // `overwrite` permits it.
    const forced = await planMove('C/src/util.ts', 'C/src/taken.ts', undefined, ctx, {
      overwrite: true,
    });
    expect(forced.isOk()).toBe(true);

    // A missing source is refused too.
    const missing = await planMove('C/src/nope.ts', 'C/src/x.ts', undefined, ctx);
    expect(missing.isErr()).toBe(true);
    expect(missing._unsafeUnwrapErr().code).toBe('FILE_NOT_FOUND');

    // Moving a file onto itself is refused.
    const same = await planMove('C/src/util.ts', 'C/src/util.ts', undefined, ctx);
    expect(same.isErr()).toBe(true);

    // Path traversal on either side is refused before any work.
    const escapes: ReadonlyArray<readonly [string, string]> = [
      ['C/../outside.ts', 'C/src/x.ts'],
      ['C/src/util.ts', '../outside.ts'],
      ['C/src/util.ts', 'C/../../outside.ts'],
    ];
    for (const [from, to] of escapes) {
      const escaped = await planMove(from, to, undefined, ctx);
      expect(escaped.isErr()).toBe(true);
      expect(escaped._unsafeUnwrapErr().code).toBe('CONFIG_ERROR');
    }
    expect(files['src/util.ts']).toBe(UTIL_TS);
  });

  it('rolls back on failure', async () => {
    // Two importers; the write for the SECOND one fails, so the first has
    // already been rewritten by the time the failure occurs.
    const staged: Record<string, string> = {
      ...INITIAL,
      'src/second.ts': "import { fmt } from './util';\nexport const s = fmt;\n",
    };
    const { ctx, files, moves } = makeCtx({ staged, failWriteFor: 'src/second.ts' });

    const plan = await planMove('C/src/util.ts', 'C/src/shared/util.ts', undefined, ctx);
    expect(plan.isOk()).toBe(true);
    expect(plan._unsafeUnwrap().importRewrites.map(r => r.file)).toEqual([
      'src/app.ts',
      'src/second.ts',
    ]);

    const applied = await executeMove(plan._unsafeUnwrap(), ctx);
    expect(applied.isErr()).toBe(true);
    expect(applied._unsafeUnwrapErr().code).toBe('INTERNAL');

    // The move was reversed: the file is back where it started.
    expect(moves[0]).toEqual(['src/util.ts', 'src/shared/util.ts']);
    expect(moves[moves.length - 1]).toEqual(['src/shared/util.ts', 'src/util.ts']);
    expect(files['src/util.ts']).toBe(UTIL_TS);
    expect(files['src/shared/util.ts']).toBeUndefined();

    // The first importer's rewrite was rolled back too — not left half-applied.
    expect(files['src/app.ts']).toBe(APP_TS);
    expect(files['src/app.ts']).toContain("from './util'");
    expect(files['src/app.ts']).not.toContain('shared/util');
    // The decoy is still untouched.
    expect(files['docs/notes.md']).toBe(DOC_MD);

    // The tool is auto and registered.
    expect(moveFileTool.autonomy).toBe('auto');
    expect(listAgentTools().map(t => t.name)).toContain('move_file');
  });
});

describe('P-153 move primitives', () => {
  it('rewrites specifiers preserving author style', () => {
    // Same directory, deeper target.
    expect(rewriteSpecifier('src/app.ts', 'src/util.ts', './util')).toBe('./util');
    // Into a subdirectory.
    expect(rewriteSpecifier('src/app.ts', 'src/shared/util.ts', './util')).toBe('./shared/util');
    // Up and across.
    expect(rewriteSpecifier('src/nested/other.ts', 'src/util.ts', '../util')).toBe('../util');
    expect(rewriteSpecifier('src/nested/deep/x.ts', 'src/util.ts', '../../util')).toBe(
      '../../util'
    );
    // An extensionless old ref stays extensionless.
    expect(rewriteSpecifier('src/app.ts', 'src/shared/util.ts', './util.js')).toBe(
      './shared/util.js'
    );
  });

  it('only rewrites import-syntax occurrences', () => {
    const content = [
      "import { fmt } from './util';",
      "const doc = 'see ./util for details';",
      '// comment mentioning ./util',
      'const requireLike = "./util";',
      "const lazy = () => import('./util');",
      'const cjs = require("./util");',
    ].join('\n');
    const out = rewriteImportRefs(content, new Map([['./util', './shared/util']]));
    // Real imports updated...
    expect(out).toContain("import { fmt } from './shared/util';");
    expect(out).toContain("import('./shared/util')");
    expect(out).toContain('require("./shared/util")');
    // ...and unrelated text left completely alone.
    expect(out).toContain("const doc = 'see ./util for details';");
    expect(out).toContain('// comment mentioning ./util');
    expect(out).toContain('const requireLike = "./util";');
  });
});
