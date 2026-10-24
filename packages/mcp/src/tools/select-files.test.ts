// P-358 - the unit tests for the `stitch_select_files` tool.
//
// The ports are the only seam, so every case here is deterministic and
// offline: fake ports stand in for the core barrel and for git.

import { err, ok, type Result } from 'neverthrow';
import type { StitchError } from '@repo-stitcher/core';
import { describe, expect, it } from 'vitest';
import { createMCPServer } from '../server.js';
import { createToolRegistry } from './registry.js';
import {
  createSelectFilesHandler,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  parseLastCommits,
  parseSelectFilesInput,
  registerSelectFilesTool,
  SELECT_FILES_TOOL_NAME,
  type MaterializedRepo,
  type RawEntry,
  type RepoInspection,
  type SelectFilesOutput,
  type SelectFilesPorts,
} from './select-files.js';

const ROOT = '/repo';

const FILES: readonly RawEntry[] = [
  { path: 'README.md', size: 10 },
  { path: 'src/alpha.ts', size: 20 },
  { path: 'src/beta.ts', size: 30 },
];

function fakePorts(overrides: Partial<SelectFilesPorts> = {}): SelectFilesPorts {
  return {
    materialize: async (): Promise<Result<MaterializedRepo, StitchError>> =>
      ok({ root: ROOT, source: 'local' }),
    list: async (): Promise<Result<readonly RawEntry[], StitchError>> => ok(FILES),
    inspect: async (): Promise<Result<RepoInspection, StitchError>> =>
      ok({ commit: 'head-sha', branch: 'main', lastCommits: { 'src/alpha.ts': 'alpha-sha' } }),
    ecosystems: async (): Promise<Result<readonly string[], StitchError>> => ok(['node']),
    language: path => (path.endsWith('.ts') ? 'typescript' : 'markdown'),
    ...overrides,
  };
}

/** Run the tool the way the registry does and unwrap the success. */
async function callOk(
  ports: SelectFilesPorts,
  args: Record<string, unknown>
): Promise<SelectFilesOutput> {
  const outcome = (await createSelectFilesHandler(ports)(args)) as Result<
    SelectFilesOutput,
    StitchError
  >;
  if (outcome.isErr()) throw new Error(`expected a listing, got ${outcome.error.code}`);
  return outcome.value;
}

/** Run the tool the way the registry does and unwrap the failure. */
async function callErr(
  ports: SelectFilesPorts,
  args: Record<string, unknown>
): Promise<StitchError> {
  const outcome = (await createSelectFilesHandler(ports)(args)) as Result<
    SelectFilesOutput,
    StitchError
  >;
  if (outcome.isOk()) throw new Error('expected an error, got a listing');
  return outcome.error;
}

describe('stitch_select_files (P-358)', () => {
  it('lists a local repository with size, language and last commit', async () => {
    const output = await callOk(fakePorts(), { local_path: ROOT });
    expect(output.tree.map(node => node.path)).toEqual([
      'README.md',
      'src/alpha.ts',
      'src/beta.ts',
    ]);
    expect(output.tree[0]?.language).toBe('markdown');
    expect(output.tree[0]?.lastCommit).toBeUndefined();
    expect(output.tree[1]).toEqual({
      path: 'src/alpha.ts',
      type: 'file',
      size: 20,
      language: 'typescript',
      lastCommit: 'alpha-sha',
    });
    expect(output.repo_meta).toEqual({
      source: 'local',
      commit: 'head-sha',
      branch: 'main',
      fileCount: 3,
      ecosystems: ['node'],
    });
    expect(output.page).toBe(1);
    expect(output.page_size).toBe(DEFAULT_PAGE_SIZE);
    expect(output.total).toBe(3);
    expect(output.has_more).toBe(false);
  });

  it('refuses a call with both sources or with neither', async () => {
    expect((await callErr(fakePorts(), {})).code).toBe('CONFIG_ERROR');
    expect((await callErr(fakePorts(), { repo_url: 'u', local_path: ROOT })).code).toBe(
      'CONFIG_ERROR'
    );
  });

  it('paginates and reports has_more', async () => {
    const first = await callOk(fakePorts(), { local_path: ROOT, page: 1, page_size: 2 });
    expect(first.tree).toHaveLength(2);
    expect(first.total).toBe(3);
    expect(first.has_more).toBe(true);

    const second = await callOk(fakePorts(), { local_path: ROOT, page: 2, page_size: 2 });
    expect(second.tree.map(node => node.path)).toEqual(['src/beta.ts']);
    expect(second.has_more).toBe(false);

    const beyond = await callOk(fakePorts(), { local_path: ROOT, page: 9, page_size: 2 });
    expect(beyond.tree).toHaveLength(0);
    expect(beyond.has_more).toBe(false);
    expect(beyond.total).toBe(3);
  });

  it('scopes the listing with a directory path filter', async () => {
    const directory = await callOk(fakePorts(), { local_path: ROOT, path_filter: 'src' });
    expect(directory.tree.map(node => node.path)).toEqual(['src/alpha.ts', 'src/beta.ts']);
    expect(directory.path_filter).toBe('src');
    expect(directory.total).toBe(2);

    const single = await callOk(fakePorts(), { local_path: ROOT, path_filter: 'src/alpha.ts' });
    expect(single.tree.map(node => node.path)).toEqual(['src/alpha.ts']);
  });

  it('validates page and page_size', async () => {
    expect((await callErr(fakePorts(), { local_path: ROOT, page: 0 })).code).toBe('CONFIG_ERROR');
    expect((await callErr(fakePorts(), { local_path: ROOT, page: 1.5 })).code).toBe('CONFIG_ERROR');
    expect((await callErr(fakePorts(), { local_path: ROOT, page_size: 0 })).code).toBe(
      'CONFIG_ERROR'
    );

    const oversize = await callErr(fakePorts(), { local_path: ROOT, page_size: MAX_PAGE_SIZE + 1 });
    expect(oversize.code).toBe('CONFIG_ERROR');
  });

  it('materializes a repository url and cleans the temporary copy up', async () => {
    let cleaned = 0;
    const ports = fakePorts({
      materialize: async (input): Promise<Result<MaterializedRepo, StitchError>> => {
        expect(input.repoUrl).toBe('https://example.invalid/demo.git');
        return ok({
          root: '/tmp/clone',
          source: 'remote',
          url: 'https://example.invalid/demo.git',
          cleanup: async (): Promise<void> => {
            cleaned += 1;
          },
        });
      },
    });

    const output = await callOk(ports, { repo_url: 'https://example.invalid/demo.git' });
    expect(output.repo_meta.source).toBe('remote');
    expect(output.repo_meta.url).toBe('https://example.invalid/demo.git');
    expect(cleaned).toBe(1);
  });

  it('keeps the newest commit recorded for a path', () => {
    const map = parseLastCommits('@@newer\n\nsrc/a.ts\n\nsrc/b.ts\n\n@@older\n\nsrc/a.ts\n');
    expect(map).toEqual({ 'src/a.ts': 'newer', 'src/b.ts': 'newer' });
  });

  it('refuses a missing local path and surfaces an enumeration failure', async () => {
    const missing = await callErr(
      fakePorts({
        materialize: async (): Promise<Result<MaterializedRepo, StitchError>> =>
          err({
            code: 'CONFIG_ERROR',
            field: 'stitch_select_files.local_path',
            message: 'the path does not exist',
          }),
      }),
      { local_path: '/nope' }
    );
    expect(missing.code).toBe('CONFIG_ERROR');

    const failed = await callErr(
      fakePorts({
        list: async (): Promise<Result<readonly RawEntry[], StitchError>> =>
          err({ code: 'INTERNAL', message: 'the walk failed' }),
      }),
      { local_path: ROOT }
    );
    expect(failed.code).toBe('INTERNAL');
  });

  it('parses the input shape directly', () => {
    expect(parseSelectFilesInput({ local_path: ROOT })._unsafeUnwrap().localPath).toBe(ROOT);
    expect(parseSelectFilesInput({}).isErr()).toBe(true);
  });

  it('registers the tool and serves it through the MCP server', async () => {
    const registry = createToolRegistry();
    const registered = registerSelectFilesTool(registry, fakePorts());
    expect(registered.isOk()).toBe(true);
    expect(registered._unsafeUnwrap()).toBe(SELECT_FILES_TOOL_NAME);
    expect(registry.names()).toEqual([SELECT_FILES_TOOL_NAME]);
    expect(registry.list()[0]?.inputSchema.type).toBe('object');

    const server = createMCPServer({ registry });
    const response = await server.handleFrame(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: SELECT_FILES_TOOL_NAME, arguments: { local_path: ROOT } },
      })
    );
    expect(response).toBeDefined();
    const result = (
      response as { result: { content: readonly { text: string }[]; isError: boolean } }
    ).result;
    expect(result.isError).toBe(false);

    const payload = JSON.parse(result.content[0]?.text ?? '{}') as SelectFilesOutput;
    expect(payload.tree).toHaveLength(3);
    expect(payload.repo_meta.fileCount).toBe(3);
  });
});
