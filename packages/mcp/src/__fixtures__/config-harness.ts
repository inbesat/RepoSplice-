// P-362 — the bun harness behind `packages/mcp/test_config.py`.
//
// It writes the SAME store the CLI (P-200) keeps, loads it through the server's
// own view (`../config.js`), and drives a real tool through a real MCPServer to
// show that a shared config means no second credential flow. Only the tool's
// own ports are faked (no git, no network) — the config path is the real one.
//
// The redaction case calls the real pino logger, whose `redact` paths
// (P-010/P-037) cover the raw secret fields, so the harness also proves the
// logging path runs without throwing.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ok, type Result } from 'neverthrow';
import { redactPaths, type StitchError } from '@repo-stitcher/core';

import {
  describeMCPConfig,
  loadMCPConfig,
  logMCPConfig,
  MCP_CONFIG_FILE,
  readConfigDocument,
  redactConfigValue,
  validateMCPConfig,
  type MCPConfig,
} from '../config.js';
import { createMCPServer } from '../server.js';
import { createToolRegistry } from '../tools/registry.js';
import { registerSelectFilesTool, type SelectFilesPorts } from '../tools/select-files.js';

const GITHUB_TOKEN = 'ghp_harness_github_secret';
const ANTHROPIC_KEY = 'sk-ant-harness-secret';
const NESTED_SECRET = 'nested-credentials-secret';

const SHARED = {
  github: { authType: 'pat', token: GITHUB_TOKEN },
  anthropic: { apiKey: ANTHROPIC_KEY },
  sandbox: { backend: 'docker', mode: 'auto', networkAllow: false },
  confidence: { auto_approve_threshold: 80 },
  credentials: { nested: { token: NESTED_SECRET } },
};

const GITHUB_ONLY = { github: { authType: 'pat', token: GITHUB_TOKEN } };
const GITHUB_AND_AI = {
  github: { authType: 'pat', token: GITHUB_TOKEN },
  anthropic: { apiKey: ANTHROPIC_KEY },
};

const created: string[] = [];

function makeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'stitch-mcp-config-harness-'));
  created.push(dir);
  return dir;
}

function writeConfig(dir: string, value: unknown): string {
  const path = join(dir, MCP_CONFIG_FILE);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(value), 'utf8');
  return path;
}

function loaded(dir: string, env: Record<string, string | undefined> = {}): MCPConfig {
  const result = loadMCPConfig({ dir, env });
  if (result.isErr()) throw new Error(`the config did not load: ${result.error.code}`);
  return result.value;
}

/** The refusal of a validation, or the validated field list. */
function refusal(result: Result<readonly string[], StitchError>): Record<string, unknown> {
  if (result.isOk()) return { ok: true, validated: result.value };
  const error = result.error;
  return { ok: false, code: error.code, ...('field' in error ? { field: error.field } : {}) };
}

/** A failed LOAD, reported the same way (used for the bad-threshold case). */
function loadRefusal(dir: string): Record<string, unknown> {
  const result = loadMCPConfig({ dir, env: {} });
  if (result.isOk()) return { ok: true };
  const error = result.error;
  return { ok: false, code: error.code, ...('field' in error ? { field: error.field } : {}) };
}

/** No git, no Docker, no network: the config path is what this harness tests. */
function fakeSelectPorts(): SelectFilesPorts {
  return {
    materialize: async () => ok({ root: '/repo', source: 'local' as const }),
    list: async () => ok([{ path: 'src/index.ts', size: 12 }]),
    inspect: async () => ok({ commit: 'head-sha', lastCommits: {} }),
    ecosystems: async () => ok(['node']),
    language: () => 'typescript',
  };
}

interface ToolReport {
  readonly registered: boolean;
  readonly tool_count: number;
  readonly is_error: boolean;
  readonly paths: readonly string[];
}

/** Drive one tool through the real server, as a host would after loading config. */
async function callSelectFiles(): Promise<ToolReport> {
  const registry = createToolRegistry();
  const registered = registerSelectFilesTool(registry, fakeSelectPorts());
  const server = createMCPServer({ registry });
  const frame = await server.handleFrame(
    JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'stitch_select_files', arguments: { local_path: '/repo' } },
    })
  );
  const call = (
    frame as { result?: { isError?: boolean; content?: readonly { text?: string }[] } } | undefined
  )?.result;
  const text = call?.content?.[0]?.text ?? '';
  let paths: readonly string[] = [];
  if (typeof text === 'string' && text.startsWith('{')) {
    const parsed: unknown = JSON.parse(text);
    const tree = (parsed as { tree?: readonly { path?: string }[] }).tree ?? [];
    paths = tree.map(node => node.path ?? '');
  }
  return {
    registered: registered.isOk(),
    tool_count: registry.names().length,
    is_error: call?.isError === true,
    paths,
  };
}

async function main(): Promise<void> {
  const sharedDir = makeDir();
  const sharedPath = writeConfig(sharedDir, SHARED);
  const shared = loaded(sharedDir);
  const withEnv = loaded(sharedDir, { OPENROUTER_API_KEY: 'env-secret' });
  const validated = refusal(validateMCPConfig(shared));

  // 1. the summary, the redacted snapshot and the logger's own paths.
  const summary = logMCPConfig(shared);
  const redacted = redactConfigValue(SHARED) as Record<string, unknown>;
  const snapshotText = JSON.stringify(shared.redacted);
  const secrets = [GITHUB_TOKEN, ANTHROPIC_KEY, NESTED_SECRET];
  const githubRedacted = redacted['github'] as Record<string, unknown> | undefined;
  const covered = ['github.auth.token', 'openrouter.apiKey', 'anthropic.apiKey', 'apiKey', 'token'];

  // 2. the ordered refusals plus a real load failure.
  const absentDir = makeDir();
  const githubOnlyDir = makeDir();
  writeConfig(githubOnlyDir, GITHUB_ONLY);
  const githubAiDir = makeDir();
  writeConfig(githubAiDir, GITHUB_AND_AI);
  const badThresholdDir = makeDir();
  writeConfig(badThresholdDir, { ...SHARED, confidence: { auto_approve_threshold: 150 } });

  // 3. no caching: the same dir is reloaded after the file changes.
  const cacheDir = makeDir();
  writeConfig(cacheDir, GITHUB_ONLY);
  const before = loaded(cacheDir).ai.providers;
  writeConfig(cacheDir, SHARED);
  const after = loaded(cacheDir).ai.providers;

  // 4. a real tool still works, with the shared config in hand.
  const tool = await callSelectFiles();

  const payload = {
    shared: {
      path_endswith: shared.path.endsWith(MCP_CONFIG_FILE),
      path_matches_loaded: sharedPath.endsWith(MCP_CONFIG_FILE),
      present: shared.present,
      absent_reads_empty: readConfigDocument(join(absentDir, MCP_CONFIG_FILE)).isOk(),
      github_has_token: shared.github.hasToken,
      auth_type: shared.github.authType ?? null,
      providers: shared.ai.providers,
      providers_with_env: withEnv.ai.providers,
      sandbox_configured: shared.sandbox.configured,
      sandbox_backend: shared.sandbox.backend ?? null,
      sandbox_mode: shared.sandbox.mode ?? null,
      sandbox_network_allow: shared.sandbox.networkAllow ?? null,
      threshold: shared.confidenceThreshold,
      summary: describeMCPConfig(shared),
      validated,
    },
    redacted: {
      secrets_in_snapshot: secrets.some(secret => snapshotText.includes(secret)),
      secrets_in_summary: secrets.some(secret => summary.includes(secret)),
      secrets_in_payload: secrets.some(secret => JSON.stringify(redacted).includes(secret)),
      redacted_token: githubRedacted?.['token'] ?? null,
      redacted_api_key:
        (redacted['anthropic'] as Record<string, unknown> | undefined)?.['apiKey'] ?? null,
      redacted_nested_credentials: redacted['credentials'] ?? null,
      sandbox_untouched: JSON.stringify(redacted['sandbox']),
      redact_paths_cover: covered.every(path => redactPaths.includes(path)),
      logger_ran: summary.length > 0,
    },
    required: {
      absent: refusal(validateMCPConfig(loaded(absentDir))),
      github_only: refusal(validateMCPConfig(loaded(githubOnlyDir))),
      github_ai: refusal(validateMCPConfig(loaded(githubAiDir))),
      complete: validated,
      bad_threshold: loadRefusal(badThresholdDir),
    },
    nocache: { before, after },
    tool,
  };

  process.stdout.write(`CONFIG ${JSON.stringify(payload)}\n`);
}

try {
  await main();
} finally {
  for (const dir of created) rmSync(dir, { recursive: true, force: true });
}
