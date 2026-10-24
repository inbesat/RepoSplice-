// P-358 - the bun harness behind `packages/mcp/test_select_files.py`.
//
// The three mandated python ids need a real repository walk, a remote-shaped
// listing with no network, and pagination over a large tree. Every case drives
// the REAL default ports (core `listFiles` / `languageForFile` /
// `detectEcosystems` plus git); only the remote case swaps `materialize`, so
// the driver observes the code an MCP host would actually run.

import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { ok, type Result } from 'neverthrow';
import type { StitchError } from '@repo-stitcher/core';

import {
  createSelectFilesHandler,
  loadSelectFilesPorts,
  type SelectFilesOutput,
  type SelectFilesPorts,
} from '../select-files.js';

const execFileAsync = promisify(execFile);

const LOCAL_FILES: Readonly<Record<string, string>> = {
  'package.json': '{\n  "name": "select-files-local",\n  "version": "1.0.0"\n}\n',
  'README.md': '# select-files local fixture\n',
  'src/alpha.ts': 'export const alpha = 1;\n',
  'src/beta.ts': 'export const beta = 2;\n',
};

const PAGED_FILE_COUNT = 25;
const PAGED_PAGE_SIZE = 10;
const REMOTE_URL = 'https://example.invalid/select-files.git';

async function git(cwd: string, argv: readonly string[]): Promise<void> {
  await execFileAsync('git', ['-C', cwd, ...argv], { maxBuffer: 32 * 1024 * 1024 });
}

async function makeRepo(files: Readonly<Record<string, string>>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'select-files-'));
  for (const [relative, body] of Object.entries(files)) {
    const absolute = join(root, relative);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, body, 'utf8');
  }
  await git(root, ['init', '-q']);
  await git(root, ['config', 'user.email', 'harness@example.invalid']);
  await git(root, ['config', 'user.name', 'select files harness']);
  await git(root, ['add', '-A']);
  await git(root, ['commit', '-qm', 'fixture']);
  return root;
}

/** A repo big enough that the default page size cannot hold it in one page. */
function pagedFiles(): Record<string, string> {
  const files: Record<string, string> = {};
  for (let index = 0; index < PAGED_FILE_COUNT; index += 1) {
    const name = `file-${String(index).padStart(2, '0')}.ts`;
    files[`src/${name}`] = `export const value${index} = ${index};\n`;
  }
  return files;
}

function unwrap(outcome: Result<SelectFilesOutput, StitchError>): SelectFilesOutput {
  if (outcome.isErr()) {
    const error = outcome.error;
    throw new Error(`the tool failed: ${'message' in error ? error.message : error.code}`);
  }
  return outcome.value;
}

async function runTool(
  ports: SelectFilesPorts,
  args: Readonly<Record<string, unknown>>
): Promise<SelectFilesOutput> {
  const outcome = await createSelectFilesHandler(ports)(args);
  return unwrap(outcome as Result<SelectFilesOutput, StitchError>);
}

function summarize(output: SelectFilesOutput): Record<string, unknown> {
  return {
    tree: output.tree,
    repo_meta: output.repo_meta,
    page: output.page,
    page_size: output.page_size,
    total: output.total,
    has_more: output.has_more,
    ...(output.path_filter !== undefined ? { path_filter: output.path_filter } : {}),
  };
}

async function main(): Promise<void> {
  const temporary: string[] = [];
  try {
    const loaded = await loadSelectFilesPorts();
    if (loaded.isErr()) {
      throw new Error(`the core ports did not load: ${loaded.error.code}`);
    }
    const ports = loaded.value;

    // 1. the local repository, through the real default ports.
    const localRoot = await makeRepo(LOCAL_FILES);
    temporary.push(localRoot);
    const local = await runTool(ports, { local_path: localRoot, page_size: 50 });

    // 2. the remote shape: only `materialize` is swapped, so the listing, the
    //    inspection and the language detection stay real and offline.
    let cleaned = 0;
    const remotePorts: SelectFilesPorts = {
      ...ports,
      materialize: async () =>
        ok({
          root: localRoot,
          source: 'remote' as const,
          url: REMOTE_URL,
          cleanup: async (): Promise<void> => {
            cleaned += 1;
          },
        }),
    };
    const remote = await runTool(remotePorts, { repo_url: REMOTE_URL, page_size: 50 });

    // 3. pagination over a large tree.
    const pagedRoot = await makeRepo(pagedFiles());
    temporary.push(pagedRoot);
    const first = await runTool(ports, {
      local_path: pagedRoot,
      page_size: PAGED_PAGE_SIZE,
      page: 1,
    });
    const last = await runTool(ports, {
      local_path: pagedRoot,
      page_size: PAGED_PAGE_SIZE,
      page: 3,
    });

    process.stdout.write(
      `SELECT_FILES ${JSON.stringify({
        local: summarize(local),
        remote: { ...summarize(remote), cleaned },
        pagination: {
          page_size: PAGED_PAGE_SIZE,
          total: first.total,
          first_count: first.tree.length,
          first_has_more: first.has_more,
          last_count: last.tree.length,
          last_has_more: last.has_more,
          last_paths: last.tree.map(node => node.path),
        },
      })}\n`
    );
  } finally {
    for (const root of temporary) {
      await rm(root, { recursive: true, force: true });
    }
  }
}

await main();
