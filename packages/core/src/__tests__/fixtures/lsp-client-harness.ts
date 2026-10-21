// P-335 — the harness the mandated python tests drive. It exercises the real
// LSP client against the REAL language server when one is installed
// (typescript-language-server, the LSP bridge over the real tsserver) and
// falls back to the protocol-faithful stub otherwise. One line of output:
//   LSP {json}

import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createLspClient } from '../../resolve/lsp-client.js';
import type { LspClientOptions } from '../../resolve/lsp-client.js';

const REPO_ROOT = join(import.meta.dirname, '..', '..', '..', '..', '..');
const STUB = join(
  REPO_ROOT,
  'packages',
  'core',
  'src',
  '__tests__',
  'fixtures',
  'lsp-stub-server.ts'
);

const A_TS = 'export const answer = 42;\n';
const B_TS = "import { answer } from './a';\nexport const doubled = answer * 2;\n";

interface ServerChoice {
  readonly mode: 'tsserver' | 'stub';
  readonly options: LspClientOptions;
}

function realServer(workspace: string): ServerChoice | undefined {
  const candidates: { command: string; args: string[] }[] = [
    {
      command: process.execPath,
      args: [
        join(
          REPO_ROOT,
          'packages',
          'core',
          'node_modules',
          'typescript-language-server',
          'lib',
          'cli.mjs'
        ),
        '--stdio',
      ],
    },
    {
      command: join(
        REPO_ROOT,
        'packages',
        'core',
        'node_modules',
        '.bin',
        'typescript-language-server.exe'
      ),
      args: ['--stdio'],
    },
    {
      command: process.execPath,
      args: [
        join(REPO_ROOT, 'node_modules', 'typescript-language-server', 'lib', 'cli.mjs'),
        '--stdio',
      ],
    },
    {
      command: join(REPO_ROOT, 'node_modules', '.bin', 'typescript-language-server.exe'),
      args: ['--stdio'],
    },
  ];
  for (const candidate of candidates) {
    if (!candidate.args[0]?.includes('cli.mjs')) continue;
    if (!existsSync(candidate.args[0])) continue;
    return {
      mode: 'tsserver',
      options: { command: candidate.command, args: candidate.args, cwd: workspace },
    };
  }
  const exe = join(
    REPO_ROOT,
    'packages',
    'core',
    'node_modules',
    '.bin',
    'typescript-language-server.exe'
  );
  if (existsSync(exe)) {
    return { mode: 'tsserver', options: { command: exe, args: ['--stdio'], cwd: workspace } };
  }
  return undefined;
}

function stubServer(workspace: string): ServerChoice {
  return {
    mode: 'stub',
    options: { command: process.execPath, args: [STUB], cwd: workspace },
  };
}

async function main(): Promise<number> {
  const workspace = mkdtempSync(join(tmpdir(), 'stitch-lsp-'));
  const aPath = join(workspace, 'a.ts');
  const bPath = join(workspace, 'b.ts');
  writeFileSync(aPath, A_TS, 'utf8');
  writeFileSync(bPath, B_TS, 'utf8');

  const choice = realServer(workspace) ?? stubServer(workspace);
  const client = createLspClient(choice.options);
  const report: Record<string, unknown> = { mode: choice.mode };

  const init = await client.initialize({
    processId: process.pid,
    rootUri: pathToFileURL(workspace).href,
    capabilities: {},
    workspaceFolders: null,
  });
  report['initialize'] = init.isOk()
    ? {
        ok: true,
        capabilities: init.value.capabilities,
        serverInfo: init.value.serverInfo ?? null,
      }
    : {
        ok: false,
        code: init.error.code,
        message: 'message' in init.error ? init.error.message : init.error.code,
      };

  // The definition request (the spec's real-world case).
  if (choice.mode === 'tsserver') {
    const uri = pathToFileURL(bPath).href;
    client.notify('textDocument/didOpen', {
      textDocument: { uri, languageId: 'typescript', version: 1, text: B_TS },
    });
    const definition = await client.request('textDocument/definition', {
      textDocument: { uri },
      position: { line: 1, character: 24 },
    });
    report['definition'] = definition.isOk()
      ? { ok: true, uri: JSON.stringify(definition.value).slice(0, 200) }
      : {
          ok: false,
          code: definition.error.code,
          message: 'message' in definition.error ? definition.error.message : definition.error.code,
        };
  } else {
    const definition = await client.request('textDocument/definition', {
      textDocument: { uri: 'file:///stub/b.ts' },
      position: { line: 1, character: 24 },
    });
    report['definition'] = definition.isOk()
      ? { ok: true, uri: JSON.stringify(definition.value).slice(0, 200) }
      : {
          ok: false,
          code: definition.error.code,
          message: 'message' in definition.error ? definition.error.message : definition.error.code,
        };
  }

  // Three concurrent requests: every one must get ITS OWN answer.
  const pending = [1, 2, 3].map(value =>
    choice.mode === 'tsserver'
      ? client.request('textDocument/definition', {
          textDocument: { uri: pathToFileURL(bPath).href },
          position: { line: 1, character: 20 + value },
        })
      : client.request('echo', { value })
  );
  const answers = await Promise.all(pending);
  const ok = answers.filter(answer => answer.isOk()).length;
  const distinct = new Set(
    answers.map(answer =>
      answer.isOk() ? JSON.stringify(answer.value) : `err:${answer.error.code}`
    )
  ).size;
  report['concurrent'] = {
    count: answers.length,
    answered: ok,
    distinct,
    allOk: ok === answers.length,
  };

  const shutdown = await client.shutdown();
  report['shutdown'] = { ok: shutdown.isOk(), aliveAfter: client.isAlive() };

  process.stdout.write(`LSP ${JSON.stringify(report)}\n`);
  return 0;
}

process.exit(await main());
