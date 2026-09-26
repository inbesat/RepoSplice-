// P-152 tests: agent tool `edit_config`.
//
// Fully offline. The stage is an in-memory map served through
// `GitFacade.readStagedFile` / `GitFacade.writeFile`, so the edit/rollback/
// undo behaviour is observable without a filesystem. The fixture is a JSONC
// tsconfig with comments, because P-152's handoff calls out comment stability
// specifically.

import { describe, it, expect, beforeEach } from 'vitest';
import { ok, err, type Result } from 'neverthrow';
import {
  applyConfigEdit,
  revertConfigEdit,
  assertWithinRoot,
  getUndoEntry,
  listUndoEntries,
  clearUndoStackForTests,
  editConfigTool,
} from './edit_config.js';
import {
  selectFilesTool,
  resolveDepsTool,
  detectGapsTool,
  fixDependencyTool,
  registerAgentTool,
  clearAgentToolsForTests,
  listAgentTools,
} from './index.js';
import { unifiedDiff } from '../diff.js';
import { parseKeyPath, stripJsonComments, deepMerge } from '../configDoc.js';
import type { ToolContext } from '../../ai/types.js';
import { stitchErrorMessage, type StitchError } from '../../result/index.js';

const TSCONFIG_JSONC = `{
  // Which files are compiled.
  "include": ["src"],
  "compilerOptions": {
    /* keep this strict */
    "strict": true,
    "paths": { "@app/*": ["src/*"] }
  }
}
`;

/** Build a ctx whose stage is a mutable in-memory map. */
function makeCtx(files: Record<string, string> = {}): {
  ctx: ToolContext;
  files: Record<string, string>;
  writes: string[];
} {
  const state: Record<string, string> = { ...files };
  const writes: string[] = [];
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
  const ctx = {
    cwd: '/repo',
    // stageRoot drives the containment check; the tool edits paths under it.
    config: { stageRoot: 'C' },
    logger: { ...inert, info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    costTracker: { ...inert, add: () => {}, totalTokens: { input: 0, output: 0, total: 0 } },
    git: {
      ...inert,
      readStagedFile: async (path: string): Promise<Result<string, StitchError>> => {
        const content = state[path];
        return content === undefined
          ? err({ code: 'FILE_NOT_FOUND', path, message: `no staged file ${path}` })
          : ok(content);
      },
      writeFile: async (
        _cwd: string,
        _repo: 'A' | 'B',
        path: string,
        content: string
      ): Promise<Result<void, StitchError>> => {
        writes.push(path);
        state[path] = content;
        return ok(undefined);
      },
    },
    deps: inert,
    license: inert,
  } as unknown as ToolContext;
  return { ctx, files: state, writes };
}

beforeEach(() => {
  clearAgentToolsForTests();
  clearUndoStackForTests();
  for (const t of [
    selectFilesTool,
    resolveDepsTool,
    detectGapsTool,
    fixDependencyTool,
    editConfigTool,
  ]) {
    expect(registerAgentTool(t).isOk()).toBe(true);
  }
});

describe('P-152 edit_config', () => {
  it('sets a key', async () => {
    // Staged files are keyed repo-relative (ADR-023: StagingFacade speaks
    // repo-relative paths). The CALLER may pass the stage-root-prefixed path;
    // `edit_config` checks containment and then addresses the file relatively.
    const { ctx, files } = makeCtx({ 'tsconfig.json': TSCONFIG_JSONC });
    const result = await applyConfigEdit(
      'C/tsconfig.json',
      { path: 'C/tsconfig.json', op: 'set', key: 'compilerOptions.noEmit', value: true },
      ctx
    );
    expect(result.isOk()).toBe(true);
    const edit = result._unsafeUnwrap();

    // The value landed, existing keys survived, and the edit is on disk.
    const written = files['tsconfig.json'] ?? '';
    expect(JSON.parse(written)).toMatchObject({
      include: ['src'],
      compilerOptions: { strict: true, noEmit: true, paths: { '@app/*': ['src/*'] } },
    });
    expect(edit.before).toBe(TSCONFIG_JSONC);
    expect(edit.after).toBe(written);
    // A diff is returned for P-217's DiffViewer.
    expect(edit.diff).toContain('--- a/tsconfig.json');
    expect(edit.diff).toContain('+++ b/tsconfig.json');
    expect(edit.diff).toContain('+    "noEmit": true');
    expect(edit.diff).toMatch(/@@ -\d+,\d+ \+\d+,\d+ @@/);
  });

  it('merges nested', async () => {
    const { ctx, files } = makeCtx({ 'tsconfig.json': TSCONFIG_JSONC });
    const result = await applyConfigEdit(
      'C/tsconfig.json',
      {
        path: 'C/tsconfig.json',
        op: 'merge',
        key: 'compilerOptions',
        value: { esModuleInterop: true, paths: { '@lib/*': ['lib/*'] } },
      },
      ctx
    );
    expect(result.isOk()).toBe(true);
    const written = JSON.parse(files['tsconfig.json'] ?? '') as {
      compilerOptions: Record<string, unknown>;
    };
    // Siblings are NOT clobbered...
    expect(written.compilerOptions['strict']).toBe(true);
    // ...and a nested object is merged, not replaced.
    expect(written.compilerOptions['paths']).toEqual({
      '@app/*': ['src/*'],
      '@lib/*': ['lib/*'],
    });
    expect(written.compilerOptions['esModuleInterop']).toBe(true);

    // deepMerge is exported and independently correct.
    expect(deepMerge({ a: { x: 1, y: 2 } }, { a: { y: 3 } })).toEqual({ a: { x: 1, y: 3 } });
  });

  it('removes a key', async () => {
    const { ctx, files } = makeCtx({ 'tsconfig.json': TSCONFIG_JSONC });
    const result = await applyConfigEdit(
      'C/tsconfig.json',
      { path: 'C/tsconfig.json', op: 'remove', key: 'compilerOptions.paths' },
      ctx
    );
    expect(result.isOk()).toBe(true);
    const written = JSON.parse(files['tsconfig.json'] ?? '') as {
      compilerOptions: Record<string, unknown>;
    };
    expect(written.compilerOptions['paths']).toBeUndefined();
    // Siblings survive a removal.
    expect(written.compilerOptions['strict']).toBe(true);
  });

  it('rejects dangerous key', async () => {
    const { ctx, files, writes } = makeCtx({ 'tsconfig.json': TSCONFIG_JSONC });
    // Every prototype-polluting segment is refused, at any depth.
    for (const key of ['__proto__', 'a.__proto__', 'prototype', 'a.constructor']) {
      const result = await applyConfigEdit(
        'C/tsconfig.json',
        { path: 'C/tsconfig.json', op: 'set', key, value: { polluted: true } },
        ctx
      );
      expect(result.isErr()).toBe(true);
      const error = result._unsafeUnwrapErr();
      expect(error.code).toBe('CONFIG_ERROR');
      expect(stitchErrorMessage(error)).toContain('prototype-polluting');
    }
    // Nothing was written and the document is untouched.
    expect(writes).toEqual([]);
    expect(files['tsconfig.json']).toBe(TSCONFIG_JSONC);
    // And Object.prototype was genuinely not polluted.
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();

    // A bracket-quoted dangerous key is caught too.
    const quoted = await applyConfigEdit(
      'C/tsconfig.json',
      { path: 'C/tsconfig.json', op: 'set', key: 'a["__proto__"]', value: 1 },
      ctx
    );
    expect(quoted.isErr()).toBe(true);
  });

  it('rejects traversal', async () => {
    const { ctx, files, writes } = makeCtx({ 'tsconfig.json': TSCONFIG_JSONC });
    // Escaping the stage root in any form is refused BEFORE any read/write.
    for (const path of [
      '../outside.json',
      'C/../../outside.json',
      '../../etc/passwd',
      '/absolute/outside.json',
    ]) {
      const result = await applyConfigEdit(path, { path, op: 'set', key: 'a', value: 1 }, ctx);
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().code).toBe('CONFIG_ERROR');
    }
    expect(writes).toEqual([]);
    expect(files['tsconfig.json']).toBe(TSCONFIG_JSONC);

    // The containment helper is correct on its own terms.
    expect(assertWithinRoot('C/a/b.json', 'C')._unsafeUnwrap()).toBe('a/b.json');
    expect(assertWithinRoot('/C/a/b.json', 'C')._unsafeUnwrap()).toBe('a/b.json');
    expect(assertWithinRoot('C/../x', 'C').isErr()).toBe(true);
    expect(assertWithinRoot('D/a.json', 'C').isErr()).toBe(true);
  });

  it('rolls back on failed validation', async () => {
    const { ctx, files } = makeCtx({ 'tsconfig.json': TSCONFIG_JSONC });
    // A validator that rejects the post-edit document.
    const result = await applyConfigEdit(
      'C/tsconfig.json',
      { path: 'C/tsconfig.json', op: 'set', key: 'compilerOptions.module', value: 'commonjs' },
      ctx,
      {
        validate: parsed => {
          const doc = parsed as { compilerOptions?: { module?: string } };
          return doc.compilerOptions?.module === 'esnext'
            ? ok(undefined)
            : err('compilerOptions.module must be "esnext"');
        },
      }
    );
    expect(result.isErr()).toBe(true);
    const error = result._unsafeUnwrapErr();
    expect(error.code).toBe('CONFIG_ERROR');
    expect(stitchErrorMessage(error)).toContain('rejected by validator');
    // The file is byte-identical to before: no partial corruption.
    expect(files['tsconfig.json']).toBe(TSCONFIG_JSONC);
    // And nothing was recorded for revert, because the edit never landed.
    expect(getUndoEntry('tsconfig.json')).toBeUndefined();

    // A passing validator does write and does record undo.
    const accepted = await applyConfigEdit(
      'C/tsconfig.json',
      { path: 'C/tsconfig.json', op: 'set', key: 'compilerOptions.module', value: 'esnext' },
      ctx,
      {
        validate: parsed => {
          const doc = parsed as { compilerOptions?: { module?: string } };
          return doc.compilerOptions?.module === 'esnext' ? ok(undefined) : err('must be esnext');
        },
      }
    );
    expect(accepted.isOk()).toBe(true);
    expect(files['tsconfig.json']).not.toBe(TSCONFIG_JSONC);
    expect(getUndoEntry('tsconfig.json')).toBeDefined();
  });

  it('records undo', async () => {
    const { ctx, files } = makeCtx({ 'tsconfig.json': TSCONFIG_JSONC });
    await applyConfigEdit(
      'C/tsconfig.json',
      { path: 'C/tsconfig.json', op: 'set', key: 'compilerOptions.outDir', value: 'dist' },
      ctx
    );
    const afterFirst = files['tsconfig.json'];
    expect(afterFirst).toContain('dist');

    // The undo stack holds the last edit per path.
    const entry = getUndoEntry('tsconfig.json');
    expect(entry).toBeDefined();
    expect(entry?.before).toBe(TSCONFIG_JSONC);
    expect(entry?.after).toBe(afterFirst);
    expect(listUndoEntries().map(e => e.path)).toEqual(['tsconfig.json']);

    // A second edit collapses onto the same path. P-152 specifies a "short
    // undo stack (last edit per path)", so the retained `before` is the state
    // immediately before the LAST edit (edit 1's output), not the pristine
    // original — revert undoes exactly one step.
    await applyConfigEdit(
      'C/tsconfig.json',
      { path: 'C/tsconfig.json', op: 'set', key: 'compilerOptions.declaration', value: true },
      ctx
    );
    const afterSecond = files['tsconfig.json'] ?? '';
    expect(afterSecond).toContain('declaration');
    expect(listUndoEntries()).toHaveLength(1);
    expect(getUndoEntry('tsconfig.json')?.before).toBe(afterFirst);
    expect(getUndoEntry('tsconfig.json')?.after).toBe(afterSecond);

    // Reverting restores the state as it was between the two edits: outDir is
    // still there, declaration is gone.
    const reverted = await revertConfigEdit('C/tsconfig.json', ctx);
    expect(reverted.isOk()).toBe(true);
    expect(files['tsconfig.json']).toBe(afterFirst);
    expect(files['tsconfig.json']).toContain('dist');
    expect(files['tsconfig.json']).not.toContain('declaration');
    expect(reverted._unsafeUnwrap().diff).toContain('-');
    // The entry is consumed, so a second revert fails loudly.
    expect(getUndoEntry('tsconfig.json')).toBeUndefined();
    const again = await revertConfigEdit('C/tsconfig.json', ctx);
    expect(again.isErr()).toBe(true);

    // The tool is auto and registered.
    expect(editConfigTool.autonomy).toBe('auto');
    expect(listAgentTools().map(t => t.name)).toContain('edit_config');
  });
});

describe('P-152 config primitives', () => {
  it('strips jsonc comments without corrupting string literals', () => {
    // A URL inside a string is NOT a comment.
    const src = '{ "url": "https://example.com/a//b", // trailing\n  "x": 1 /* block */ }';
    const stripped = stripJsonComments(src);
    const parsed = JSON.parse(stripped) as { url: string; x: number };
    expect(parsed.url).toBe('https://example.com/a//b');
    expect(parsed.x).toBe(1);
  });

  it('parses bracket key paths', () => {
    expect(parseKeyPath('a.b')._unsafeUnwrap()).toEqual(['a', 'b']);
    expect(parseKeyPath('compilerOptions.paths["@app/*"]')._unsafeUnwrap()).toEqual([
      'compilerOptions',
      'paths',
      '@app/*',
    ]);
    expect(parseKeyPath('a["b.c"].d')._unsafeUnwrap()).toEqual(['a', 'b.c', 'd']);
    expect(parseKeyPath('a["unterminated').isErr()).toBe(true);
    expect(parseKeyPath('  ').isErr()).toBe(true);
  });

  it('produces empty diff for identical content', () => {
    expect(unifiedDiff('a.json', 'same\n', 'same\n')).toBe('');
    expect(unifiedDiff('a.json', '', 'new\n')).toContain('+new');
  });
});
