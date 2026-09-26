// P-161 tests: the undo stack.
//
// The reverts are tested against a REAL in-memory GitFacade recorder rather than
// a mock, because "reverts land as git changes" is a claim about what was
// written to the tree, and a mock that records calls proves less than a
// filesystem-shaped record that can be inspected and mutated between steps.
//
// Every reverter is driven through `UndoStack.undo()`, not called directly, so
// the tests exercise the same path the `revert_last` tool takes — including the
// "a failed revert keeps its record" behaviour, which is only observable through
// the stack.

import { describe, it, expect, beforeEach } from 'vitest';
import { ok, err, type Result } from 'neverthrow';
import {
  UndoStack,
  REVERTERS,
  UNDO_DERIVERS,
  MAX_UNDO_DEPTH,
  deriveUndoRecord,
  createUndoRecorder,
  revertLastToolAction,
} from './revert.js';
import { createRevertLastTool } from './tools/revert_last.js';
import { rewriteImportRefs } from './tools/move_file.js';
import { clearAgentToolsForTests, registerAgentTool, selectFilesTool } from './index.js';
import { logger } from '../logger/index.js';
import { CostTracker } from '../ai/cost.js';
import { stitchErrorMessage, type StitchError } from '../result/index.js';
import type { ToolContext, GitFacade } from '../index.js';
import type { UndoRecord, FileSnapshot } from './types.js';

/** A file tree the reverts actually write into, so results can be inspected. */
class FakeTree {
  readonly files = new Map<string, string>();
  /** Every facade call, in order — proves the revert used the facade. */
  readonly calls: string[] = [];
  /** When set, the next matching write fails, to exercise revert failures. */
  failWriteFor: string | null = null;
  failDelete = false;
}

function facadeFor(
  tree: FakeTree,
  opts: { withWrite?: boolean; withDelete?: boolean; withMove?: boolean; withRead?: boolean } = {}
): GitFacade {
  const withWrite = opts.withWrite !== false;
  const withDelete = opts.withDelete !== false;
  const withMove = opts.withMove !== false;
  const withRead = opts.withRead !== false;
  return {
    diff: async () => '',
    status: async () => '',
    commit: async () => undefined,
    add: async () => undefined,
    ...(withWrite
      ? {
          writeFile: async (
            _cwd: string,
            _repo: 'A' | 'B',
            path: string,
            content: string
          ): Promise<Result<void, StitchError>> => {
            tree.calls.push(`write:${path}`);
            if (tree.failWriteFor !== null && path.includes(tree.failWriteFor)) {
              return err({ code: 'GIT_ERROR', message: `simulated write failure for ${path}` });
            }
            tree.files.set(path, content);
            return ok(undefined);
          },
        }
      : {}),
    ...(withDelete
      ? {
          deleteFile: async (
            _cwd: string,
            _repo: 'A' | 'B',
            path: string
          ): Promise<Result<void, StitchError>> => {
            tree.calls.push(`delete:${path}`);
            if (tree.failDelete) {
              return err({ code: 'GIT_ERROR', message: `simulated delete failure for ${path}` });
            }
            tree.files.delete(path);
            return ok(undefined);
          },
        }
      : {}),
    ...(withMove
      ? {
          move: async (
            _cwd: string,
            _repo: 'A' | 'B',
            from: string,
            to: string
          ): Promise<Result<void, StitchError>> => {
            tree.calls.push(`move:${from}->${to}`);
            const content = tree.files.get(from);
            if (content === undefined) {
              return err({ code: 'GIT_ERROR', message: `move source missing: ${from}` });
            }
            tree.files.delete(from);
            tree.files.set(to, content);
            return ok(undefined);
          },
        }
      : {}),
    ...(withRead
      ? {
          readStagedFile: async (path: string): Promise<Result<string, StitchError>> => {
            tree.calls.push(`read:${path}`);
            const content = tree.files.get(path);
            if (content === undefined) {
              return err({ code: 'GIT_ERROR', message: `no such file: ${path}` });
            }
            return ok(content);
          },
        }
      : {}),
  };
}

function contextFor(git: GitFacade): ToolContext {
  return {
    cwd: '/repo',
    config: {},
    logger,
    costTracker: new CostTracker({
      id: 'mock/mock-model',
      provider: 'mock',
      contextWindow: 128000,
      supportsTools: true,
      toolCalling: 'allowed',
      maxOutput: 4096,
      cost: { input: 0, output: 0 },
      recommendedFor: [],
    }),
    git,
    deps: { analyze: async () => ({}), install: async () => undefined },
    license: { scan: async () => [], check: async () => true },
  };
}

/** A deterministic stack, so ids and timestamps are assertable. */
function stackWith(maxDepth?: number): UndoStack {
  let n = 0;
  return new UndoStack({
    ...(maxDepth !== undefined ? { maxDepth } : {}),
    clock: { now: () => `t${(n += 1)}`, newId: () => `u${(n += 1)}` },
  });
}

function snap(path: string, content: string | null): FileSnapshot {
  return { path, content };
}

beforeEach(() => {
  clearAgentToolsForTests();
  expect(registerAgentTool(selectFilesTool).isOk()).toBe(true);
});

describe('P-161 UndoStack', () => {
  it('undoes config edit', async () => {
    const tree = new FakeTree();
    tree.files.set('tsconfig.json', '{ "a": 1 }');
    const ctx = contextFor(facadeFor(tree));
    const stack = stackWith();

    // This is exactly what P-152's `edit_config` returns, and the record is the
    // direct projection of it — no changes to the tool were needed.
    const editResult = {
      path: 'tsconfig.json',
      before: '{ "a": 1 }',
      after: '{ "a": 2 }',
      diff: '@@ -1 +1 @@\n-{"a":1}\n+{"a":2}',
      op: 'set',
      key: 'a',
    };
    const derived = deriveUndoRecord('edit_config', editResult, stack.clock);
    expect(derived).not.toBeNull();
    expect(derived?.kind).toBe('config_edit');
    expect(derived?.paths).toEqual(['tsconfig.json']);
    expect(derived?.before).toEqual([snap('tsconfig.json', '{ "a": 1 }')]);

    // The tree now holds the edited content, as the tool left it.
    tree.files.set('tsconfig.json', '{ "a": 2 }');
    const pushed = stack.push({ ...(derived as Omit<UndoRecord, 'id' | 'ts'>) });
    expect(pushed.isOk()).toBe(true);
    expect(stack.depth).toBe(1);

    const undone = await stack.undo(ctx);
    expect(undone.isOk()).toBe(true);
    expect(undone._unsafeUnwrap().kind).toBe('config_edit');
    // The prior content is back.
    expect(tree.files.get('tsconfig.json')).toBe('{ "a": 1 }');
    // It went through the facade, not around it.
    expect(tree.calls).toContain('write:tsconfig.json');
    expect(stack.depth).toBe(0);

    // Undoing again on an empty stack is `NOTHING_TO_UNDO` — a distinct,
    // honest outcome, not a generic failure.
    const empty = await stack.undo(ctx);
    expect(empty.isErr()).toBe(true);
    if (empty.isErr()) expect(empty.error.code).toBe('NOTHING_TO_UNDO');

    // A file that did not exist before is DELETED on revert, not written empty.
    // This is why `before` is a snapshot list with `content: null` rather than a
    // plain string.
    const created = new FakeTree();
    created.files.set('new.json', '{}');
    const createdCtx = contextFor(facadeFor(created));
    const stack2 = stackWith();
    stack2.push({
      tool: 'edit_config',
      kind: 'file_write',
      before: [snap('new.json', null)],
      after: [snap('new.json', '{}')],
      paths: ['new.json'],
    });
    const undone2 = await stack2.undo(createdCtx);
    expect(undone2.isOk()).toBe(true);
    expect(created.files.has('new.json')).toBe(false);
    expect(created.calls).toContain('delete:new.json');

    // A failed revert KEEPS its record: the tree was not restored, so the
    // history must not claim otherwise.
    const failing = new FakeTree();
    failing.files.set('a.json', 'x');
    failing.failWriteFor = 'a.json';
    const failingCtx = contextFor(facadeFor(failing));
    const stack3 = stackWith();
    stack3.push({
      tool: 'edit_config',
      kind: 'config_edit',
      before: [snap('a.json', 'original')],
      after: [snap('a.json', 'changed')],
      paths: ['a.json'],
    });
    const broke = await stack3.undo(failingCtx);
    expect(broke.isErr()).toBe(true);
    if (broke.isErr()) expect(broke.error.code).toBe('GIT_ERROR');
    expect(stack3.depth).toBe(1);
  });

  it('undoes file move incl rewrites', async () => {
    const tree = new FakeTree();
    // The tool moved util.ts -> shared/util.ts and rewrote two importers.
    tree.files.set('src/shared/util.ts', 'export const f = 1;\n');
    tree.files.set(
      'src/a.ts',
      "import { f } from '../shared/util';\nimport { g } from './other';\n"
    );
    tree.files.set('src/b.ts', "const m = require('../shared/util');\n");
    const ctx = contextFor(facadeFor(tree));
    const stack = stackWith();

    // Exactly P-153's MovePlan.
    const plan = {
      from: 'src/util.ts',
      to: 'src/shared/util.ts',
      importRewrites: [
        { file: 'src/a.ts', oldRef: './util', newRef: '../shared/util' },
        { file: 'src/b.ts', oldRef: './util', newRef: '../shared/util' },
      ],
    };
    const derived = deriveUndoRecord('move_file', plan, stack.clock);
    expect(derived?.kind).toBe('file_move');
    expect(derived?.before).toEqual({ from: 'src/util.ts', to: 'src/shared/util.ts' });
    expect(derived?.importRewrites).toHaveLength(2);
    expect(derived?.paths).toEqual(['src/util.ts', 'src/shared/util.ts', 'src/a.ts', 'src/b.ts']);

    // Apply the rewrites the way the move would have, so the tree is realistic.
    tree.files.set(
      'src/a.ts',
      rewriteImportRefs(
        tree.files.get('src/a.ts') as string,
        new Map([['./util', '../shared/util']])
      )
    );
    tree.files.set(
      'src/b.ts',
      rewriteImportRefs(
        tree.files.get('src/b.ts') as string,
        new Map([['./util', '../shared/util']])
      )
    );

    const pushed = stack.push({ ...(derived as Omit<UndoRecord, 'id' | 'ts'>) });
    expect(pushed.isOk()).toBe(true);

    const undone = await stack.undo(ctx);
    expect(undone.isOk()).toBe(true);

    // The file is back where it started.
    expect(tree.files.has('src/util.ts')).toBe(true);
    expect(tree.files.has('src/shared/util.ts')).toBe(false);
    // And the move itself is inverted, not applied forward again.
    expect(tree.calls).toContain('move:src/shared/util.ts->src/util.ts');

    // The import specifiers are back to the original, in BOTH syntaxes the
    // reverter must handle (ESM `from` and CommonJS `require`).
    expect(tree.files.get('src/a.ts')).toContain("from './util'");
    expect(tree.files.get('src/a.ts')).not.toContain('../shared/util');
    expect(tree.files.get('src/b.ts')).toContain("require('./util')");

    // An UNRELATED edit made after the move survives the revert. This is the
    // reason rewrites are inverted with `rewriteImportRefs` instead of
    // restoring whole files: a whole-file restore would silently destroy work
    // that happened after the move.
    const later = new FakeTree();
    later.files.set('src/shared/util.ts', 'moved\n');
    later.files.set('src/a.ts', "import { f } from '../shared/util';\nexport const mine = 42;\n");
    const laterCtx = contextFor(facadeFor(later));
    const stack2 = stackWith();
    stack2.push({
      tool: 'move_file',
      kind: 'file_move',
      before: { from: 'src/util.ts', to: 'src/shared/util.ts' },
      after: { from: 'src/shared/util.ts', to: 'src/util.ts' },
      paths: ['src/util.ts', 'src/shared/util.ts', 'src/a.ts'],
      importRewrites: [{ file: 'src/a.ts', oldRef: './util', newRef: '../shared/util' }],
    });
    expect((await stack2.undo(laterCtx)).isOk()).toBe(true);
    expect(later.files.get('src/a.ts')).toContain('export const mine = 42;');
    expect(later.files.get('src/a.ts')).toContain("from './util'");

    // A move with no rewrites still reverts the move itself.
    const plain = new FakeTree();
    plain.files.set('to/x.ts', 'body\n');
    const plainCtx = contextFor(facadeFor(plain));
    const stack3 = stackWith();
    stack3.push({
      tool: 'move_file',
      kind: 'file_move',
      before: { from: 'from/x.ts', to: 'to/x.ts' },
      after: { from: 'to/x.ts', to: 'from/x.ts' },
      paths: ['from/x.ts', 'to/x.ts'],
    });
    expect((await stack3.undo(plainCtx)).isOk()).toBe(true);
    expect(plain.files.has('from/x.ts')).toBe(true);
    expect(plain.files.has('to/x.ts')).toBe(false);
  });

  it('undoes dep fix', async () => {
    const tree = new FakeTree();
    const originalManifest = JSON.stringify(
      { dependencies: { left: '^1.0.0' }, devDependencies: {} },
      null,
      2
    );
    const fixedManifest = JSON.stringify(
      { dependencies: { left: '^1.2.3' }, devDependencies: {} },
      null,
      2
    );
    tree.files.set('package.json', fixedManifest);
    const ctx = contextFor(facadeFor(tree));
    const stack = stackWith();

    // `dep_fix` and `manifest` are content restorations, exactly like a config
    // edit: the manifest is written back whole, so the reverted file is the
    // file as it was before the tool parsed and re-serialised it.
    stack.push({
      tool: 'fix_dependency',
      kind: 'dep_fix',
      before: [snap('package.json', originalManifest)],
      after: [snap('package.json', fixedManifest)],
      paths: ['package.json'],
    });

    const undone = await stack.undo(ctx);
    expect(undone.isOk()).toBe(true);
    expect(undone._unsafeUnwrap().kind).toBe('dep_fix');
    expect(tree.files.get('package.json')).toBe(originalManifest);
    expect(stack.depth).toBe(0);

    // A multi-section manifest is restored in full, not merged: a revert that
    // merged would leave the tool's own additions in place.
    const multi = new FakeTree();
    multi.files.set('pyproject.toml', '[project]\nname = "x"\nversion = "2.0.0"\n');
    const multiCtx = contextFor(facadeFor(multi));
    const stack2 = stackWith();
    stack2.push({
      tool: 'fix_dependency',
      kind: 'dep_fix',
      before: [
        snap('pyproject.toml', '[project]\nname = "x"\nversion = "1.0.0"\n'),
        snap('package.json', '{"dependencies":{"a":"^1.0.0"}}'),
      ],
      after: [
        snap('pyproject.toml', '[project]\nname = "x"\nversion = "2.0.0"\n'),
        snap('pyproject.toml', '[project]\nname = "x"\nversion = "2.0.0"\n'),
      ],
      paths: ['pyproject.toml', 'package.json'],
    });
    expect((await stack2.undo(multiCtx)).isOk()).toBe(true);
    expect(multi.files.get('pyproject.toml')).toBe('[project]\nname = "x"\nversion = "1.0.0"\n');
    expect(multi.files.get('package.json')).toBe('{"dependencies":{"a":"^1.0.0"}}');

    // Every registered kind has a reverter — a registry with a hole would mean
    // an action that silently cannot be undone.
    for (const kind of [
      'file_write',
      'file_move',
      'config_edit',
      'dep_fix',
      'manifest',
      'proposal_apply',
    ] as const) {
      expect(typeof REVERTERS[kind]).toBe('function');
    }
  });

  it('deletes proposal files', async () => {
    const tree = new FakeTree();
    // P-154's applyProposal created the two files and appended to a barrel.
    tree.files.set('src/widget.ts', 'export const widget = 1;\n');
    tree.files.set('src/widget.test.ts', "it('w', () => {});\n");
    tree.files.set('src/index.ts', "export { a } from './a';\n");
    const ctx = contextFor(facadeFor(tree));
    const stack = stackWith();

    stack.push({
      tool: 'propose_component',
      kind: 'proposal_apply',
      // `paths` are the created files; the snapshot is the appended-to barrel.
      before: [snap('src/index.ts', "export { a } from './a';\n")],
      after: [
        snap('src/index.ts', "export { a } from './a';\nexport { widget } from './widget';\n"),
      ],
      paths: ['src/widget.ts', 'src/widget.test.ts'],
    });

    const undone = await stack.undo(ctx);
    expect(undone.isErr()).toBe(false);
    expect(undone.isOk()).toBe(true);

    // The created files are gone.
    expect(tree.files.has('src/widget.ts')).toBe(false);
    expect(tree.files.has('src/widget.test.ts')).toBe(false);
    expect(tree.calls).toContain('delete:src/widget.ts');
    // And the barrel is back to its prior content — the append is un-done.
    expect(tree.files.get('src/index.ts')).toBe("export { a } from './a';\n");

    // With no delete capability the revert REFUSES rather than half-applying.
    // P-154 made `writeFile` optional for exactly this reason, and deleting is
    // the same class of destructive capability.
    const noDelete = new FakeTree();
    noDelete.files.set('src/widget.ts', 'x');
    const guardedCtx = contextFor(facadeFor(noDelete, { withDelete: false }));
    const stack2 = stackWith();
    stack2.push({
      tool: 'propose_component',
      kind: 'proposal_apply',
      before: [],
      after: [],
      paths: ['src/widget.ts'],
    });
    const refused = await stack2.undo(guardedCtx);
    expect(refused.isErr()).toBe(true);
    if (refused.isErr()) {
      expect(refused.error.code).toBe('CONFIG_ERROR');
      if (refused.error.code === 'CONFIG_ERROR') expect(refused.error.field).toBe('git.deleteFile');
    }
    // Nothing was written on the way to refusing.
    expect(noDelete.calls).toHaveLength(0);
    // And the record survives, because the tree is unchanged.
    expect(stack2.depth).toBe(1);
  });

  it('caps depth', () => {
    // The spec's cap.
    expect(MAX_UNDO_DEPTH).toBe(50);

    const stack = stackWith();
    expect(stack.maxDepth).toBe(MAX_UNDO_DEPTH);
    for (let i = 0; i < 60; i += 1) {
      const pushed = stack.push({
        tool: 'edit_config',
        kind: 'file_write',
        before: [snap(`f${i}.txt`, `v${i}`)],
        after: [snap(`f${i}.txt`, 'changed')],
        paths: [`f${i}.txt`],
      });
      expect(pushed.isOk()).toBe(true);
    }

    // Capped at 50, and the discards are REPORTED — a silently truncated undo
    // history looks exactly like "there is nothing to undo".
    expect(stack.depth).toBe(50);
    expect(stack.dropped).toBe(10);
    expect(stack.history()).toHaveLength(50);

    // The OLDEST are dropped, because the newest is the one a human most likely
    // wants to roll back.
    expect(stack.history()[0]?.paths).toEqual(['f10.txt']);
    expect(stack.peek()?.paths).toEqual(['f59.txt']);
    // 0..9 are gone.
    expect(stack.history().some(r => r.paths[0] === 'f0.txt')).toBe(false);

    // A custom cap is honoured, and a nonsensical one is clamped to 1 rather
    // than producing a stack that can hold nothing.
    const small = stackWith(3);
    for (let i = 0; i < 5; i += 1) {
      small.push({
        tool: 'edit_config',
        kind: 'file_write',
        before: [],
        after: [],
        paths: [`g${i}.txt`],
      });
    }
    expect(small.depth).toBe(3);
    expect(small.dropped).toBe(2);

    const zero = stackWith(0);
    zero.push({ tool: 'x', kind: 'file_write', before: [], after: [], paths: [] });
    expect(zero.maxDepth).toBe(1);
    expect(zero.depth).toBe(1);

    // An unregistered kind is refused at PUSH, so a stack can never hold an
    // entry it cannot honour.
    const guarded = stackWith();
    const bad = guarded.push({
      tool: 'mystery',
      kind: 'not_a_kind' as never,
      before: [],
      after: [],
      paths: [],
    });
    expect(bad.isErr()).toBe(true);
    if (bad.isErr()) {
      expect(bad.error.code).toBe('CONFIG_ERROR');
      if (bad.error.code === 'CONFIG_ERROR') expect(bad.error.field).toBe('kind');
    }
    expect(guarded.depth).toBe(0);

    // `clear` empties it, for when a job's writes have been committed.
    stack.clear();
    expect(stack.depth).toBe(0);
    expect(stack.peek()).toBeUndefined();
  });

  it('gated revert_last', async () => {
    const tree = new FakeTree();
    tree.files.set('a.json', 'changed');
    const ctx = contextFor(facadeFor(tree));
    const stack = stackWith();
    stack.push({
      tool: 'edit_config',
      kind: 'config_edit',
      before: [snap('a.json', 'original')],
      after: [snap('a.json', 'changed')],
      paths: ['a.json'],
    });

    const tool = createRevertLastTool(stack);
    // GATED, because a revert is itself a mutation: the risk is symmetric, and
    // it must be approved like the change it undoes.
    expect(tool.name).toBe('revert_last');
    expect(tool.autonomy).toBe('gated');

    // The tool performs the revert.
    const ran = await tool.execute({ reason: 'wrong fix' }, ctx);
    expect(ran.isOk()).toBe(true);
    if (ran.isOk()) {
      const value = ran._unsafeUnwrap() as { reverted: { tool: string; kind: string } };
      expect(value.reverted.tool).toBe('edit_config');
      expect(value.reverted.kind).toBe('config_edit');
    }
    expect(tree.files.get('a.json')).toBe('original');
    expect(stack.depth).toBe(0);

    // A second revert has nothing to roll back, and says so with the distinct
    // code rather than a generic failure — the model needs to be able to tell
    // "nothing to undo" from "the undo failed".
    const again = await tool.execute({}, ctx);
    expect(again.isErr()).toBe(true);
    if (again.isErr()) {
      expect(again.error.code).toBe('NOTHING_TO_UNDO');
      expect(stitchErrorMessage(again.error)).toContain('empty');
    }

    // A bad argument is a validation error, not a crash.
    const bad = await tool.execute({ reason: 12345 }, ctx);
    expect(bad.isErr()).toBe(true);
    if (bad.isErr()) expect(bad.error.code).toBe('TOOL_ARGS_VALIDATION');

    // `revertLastToolAction` is the same operation without the tool wrapper.
    const stack2 = stackWith();
    stack2.push({
      tool: 'edit_config',
      kind: 'config_edit',
      before: [snap('b.json', 'prior')],
      after: [snap('b.json', 'now')],
      paths: ['b.json'],
    });
    const direct = await revertLastToolAction(stack2, ctx);
    expect(direct.isOk()).toBe(true);
    if (direct.isOk()) expect(direct._unsafeUnwrap().reverted.paths).toEqual(['b.json']);

    // The loop's `UndoRecorder` seam is satisfied by the stack, so a successful
    // tool is recorded automatically and is then revertable.
    const tree3 = new FakeTree();
    tree3.files.set('c.json', '{ "v": 1 }');
    const ctx3 = contextFor(facadeFor(tree3));
    const stack3 = stackWith();
    const recorder = createUndoRecorder(stack3);
    expect(
      recorder.record('edit_config', { path: 'c.json', before: '{ "v": 0 }', after: '{ "v": 1 }' })
    ).toBe(true);
    expect(stack3.depth).toBe(1);
    // A tool with no deriver records nothing rather than an empty record — and
    // the null-returning deriver is handled inside the adapter, not by callers.
    expect(recorder.record('select_files', { files: [] })).toBe(false);
    expect(recorder.record('edit_config', { notAConfigResult: true })).toBe(false);
    expect(stack3.depth).toBe(1);
    expect((await stack3.undo(ctx3)).isOk()).toBe(true);
    expect(tree3.files.get('c.json')).toBe('{ "v": 0 }');

    // The deriver registry covers exactly the tools whose results carry their
    // own before-state. `fix_dependency` and `applyProposal` return no prior
    // content, so they are deliberately absent rather than recorded with a
    // before-state nobody can honour. See ADR-034.
    expect(Object.keys(UNDO_DERIVERS).sort()).toEqual(['edit_config', 'move_file']);
    expect(UNDO_DERIVERS['fix_dependency' as string]).toBeUndefined();
    expect(deriveUndoRecord('fix_dependency', { action: 'updated' })).toBeNull();
    expect(deriveUndoRecord('nope', {})).toBeNull();
  });
});
