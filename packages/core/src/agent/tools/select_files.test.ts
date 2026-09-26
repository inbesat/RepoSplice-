// P-148 tests: agent tool `select_files`.
//
// Five spec-mandated cases, all offline. The "repo listing" the tool validates
// against is an injected `GitFacade.listFiles` backed by a plain in-memory
// array — the tool only ever sees repo-relative paths, so no filesystem,
// fixture repo, or network is needed to prove the selection contract.

import { describe, it, expect, beforeEach } from 'vitest';
import { z } from 'zod';
import { ok, type Result } from 'neverthrow';
import { selectFilesTool, selectFilesSchema } from './select_files.js';
import {
  registerAgentTool,
  getAgentTool,
  listAgentTools,
  hasAgentTool,
  clearAgentToolsForTests,
} from './index.js';
import { MAX_SELECTED_FILES } from '../types.js';
import { runToolLoop } from '../../ai/loop.js';
import { MockProvider } from '../../ai/mock.js';
import type { ChatMessage, ToolContext } from '../../ai/types.js';
import type { StitchError } from '../../result/index.js';

/** Repo A / repo B listings used by the fixture. */
const REPO_A = [
  'src/app.ts',
  'src/util/format.ts',
  'src/components/Button.tsx',
  'README.md',
  'package.json',
  'node_modules/left-pad/index.js',
  'dist/bundle.js',
];
const REPO_B = ['lib/server.ts', 'lib/db/query.ts', 'docs/guide.md'];

/**
 * Build a ToolContext whose `git.listFiles` serves the given listing.
 *
 * Only `listFiles` is meaningful to this tool; the other facade members exist
 * to satisfy the shapes and are never called by `select_files`.
 */
function makeCtx(listing: readonly string[]): ToolContext {
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
  return {
    cwd: '/repo',
    config: {},
    logger: { ...inert, info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    costTracker: {
      ...inert,
      add: () => {},
      totalTokens: { input: 0, output: 0, total: 0 },
    },
    git: {
      ...inert,
      listFiles: async (_cwd: string, _repo: 'A' | 'B'): Promise<Result<string[], StitchError>> =>
        ok([...listing]),
    },
    deps: inert,
    license: inert,
  } as unknown as ToolContext;
}

/** Narrow an unknown tool result to the select_files result shape. */
interface Selected {
  files: Array<{ repo: string; path: string; reason?: string }>;
  filter?: { glob?: string; excludeDirs?: string[] };
  reason?: string;
  notes?: string;
}

async function run(
  args: unknown,
  listing: readonly string[]
): Promise<Result<unknown, StitchError>> {
  return selectFilesTool.execute(args, makeCtx(listing));
}

beforeEach(() => {
  // The registry bootstraps itself with select_files; tests that mutate it
  // restore that baseline so ordering cannot leak.
  clearAgentToolsForTests();
  const restored = registerAgentTool(selectFilesTool);
  expect(restored.isOk()).toBe(true);
});

describe('P-148 select_files', () => {
  it('selects existing files', async () => {
    const result = await run({ repo: 'A', paths: ['src/app.ts', 'README.md'] }, REPO_A);
    expect(result.isOk()).toBe(true);
    const value = result._unsafeUnwrap() as Selected;
    expect(value.files).toEqual([
      { repo: 'A', path: 'src/app.ts' },
      { repo: 'A', path: 'README.md' },
    ]);

    // The `repo` label is carried explicitly, not inferred from the path: the
    // same relative path can exist in both sources and must stay distinct.
    const b = await run({ repo: 'B', paths: ['lib/server.ts'] }, REPO_B);
    expect(b.isOk()).toBe(true);
    const bValue = b._unsafeUnwrap() as Selected;
    expect(bValue.files).toEqual([{ repo: 'B', path: 'lib/server.ts' }]);

    // A path that exists only in repo B is not valid for repo A.
    const crossRepo = await run({ repo: 'A', paths: ['lib/server.ts'] }, REPO_A);
    expect(crossRepo.isErr()).toBe(true);
    expect(crossRepo._unsafeUnwrapErr().code).toBe('SELECT_PATH_NOT_FOUND');
  });

  it('rejects missing path', async () => {
    const result = await run({ repo: 'A', paths: ['src/app.ts', 'src/nope.ts'] }, REPO_A);
    expect(result.isErr()).toBe(true);
    const error = result._unsafeUnwrapErr();
    expect(error.code).toBe('SELECT_PATH_NOT_FOUND');
    if (error.code === 'SELECT_PATH_NOT_FOUND') {
      expect(error.repo).toBe('A');
      expect(error.missing).toEqual(['src/nope.ts']);
    }
  });

  it('expands glob filter', async () => {
    const result = await run(
      {
        repo: 'A',
        paths: ['src/app.ts'],
        filter: { glob: 'src/**/*.ts', excludeDirs: ['src/components'] },
      },
      REPO_A
    );
    expect(result.isOk()).toBe(true);
    const value = result._unsafeUnwrap() as Selected;
    // Explicit app.ts + expanded util/format.ts. Button.tsx is excluded by
    // excludeDirs, and the glob is .ts so .tsx would not match anyway.
    expect(value.files.map(f => f.path).sort()).toEqual(['src/app.ts', 'src/util/format.ts']);
    expect(value.filter).toEqual({ glob: 'src/**/*.ts', excludeDirs: ['src/components'] });
  });

  it('validates schema', () => {
    const objectSchema = z.object(selectFilesSchema);
    // repo must be A or B
    expect(objectSchema.safeParse({ repo: 'C', paths: ['a.ts'] }).success).toBe(false);
    // paths must be non-empty
    expect(objectSchema.safeParse({ repo: 'A', paths: [] }).success).toBe(false);
    // cap of 2000 enforced
    const tooMany = Array.from({ length: MAX_SELECTED_FILES + 1 }, (_, i) => `f${i}.ts`);
    expect(objectSchema.safeParse({ repo: 'A', paths: tooMany }).success).toBe(false);
    // valid minimal
    expect(objectSchema.safeParse({ repo: 'A', paths: ['a.ts'] }).success).toBe(true);
    // optional filter + reason accepted
    expect(
      objectSchema.safeParse({
        repo: 'B',
        paths: ['lib/server.ts'],
        filter: { glob: 'lib/**/*.ts' },
        reason: 'needed for the merge',
      }).success
    ).toBe(true);
  });

  it('runs through loop registry', async () => {
    // The tool is registered and discoverable for the loop.
    expect(hasAgentTool('select_files')).toBe(true);
    const found = getAgentTool('select_files');
    expect(found.isOk()).toBe(true);
    expect(listAgentTools().map(t => t.name)).toContain('select_files');
    // autonomy is auto (no approval gate needed)
    expect(selectFilesTool.autonomy).toBe('auto');

    // Drive it through the real P-140 tool loop with a scripted provider.
    const provider = new MockProvider({
      script: [
        {
          kind: 'tool_call',
          toolCall: {
            id: 'call-1',
            name: 'select_files',
            arguments: { repo: 'A', paths: ['src/app.ts'] },
          },
        },
        { kind: 'finish', finishReason: 'tool_calls' },
      ],
    });
    // Second turn: the model is satisfied.
    const second = new MockProvider({
      script: [
        { kind: 'text', text: 'Selected src/app.ts.' },
        { kind: 'finish', finishReason: 'stop', usage: { input: 5, output: 3, total: 8 } },
      ],
    });
    let turn = 0;
    const loopingProvider = {
      name: 'loop-mock',
      model: 'mock-model',
      provider: 'mock',
      id: 'loop/mock-model',
      chat(...args: Parameters<MockProvider['chat']>) {
        turn++;
        return (turn === 1 ? provider : second).chat(...args);
      },
      countTokens: (messages: ChatMessage[]) =>
        messages.reduce((n, m) => n + Math.ceil(m.content.length / 4), 0),
      isRetryable: () => false,
    };

    const messages: ChatMessage[] = [{ role: 'user', content: 'Select the app entrypoint.' }];
    const result = await runToolLoop(loopingProvider, listAgentTools(), messages, {
      maxIterations: 3,
      // P-148: the loop threads this context into the tool's execute.
      context: makeCtx(REPO_A),
    });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      // The tool actually executed and its result came back in the history.
      const toolMsg = result.value.messages.find(m => m.role === 'tool');
      expect(toolMsg).toBeDefined();
      expect(toolMsg?.content).toContain('src/app.ts');
      expect(toolMsg?.toolCallId).toBe('call-1');
      expect(result.value.finishReason).toBe('stop');
    }
  });
});
