// P-362 — the shared user config, as the MCP server reads it.
//
// Every case is hermetic: the temp store is written per case and the provider
// env is injected as `{}` by default, so a developer's own `ANTHROPIC_API_KEY`
// can never make a refusal case pass for the wrong reason.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DEFAULT_AUTO_APPROVE_THRESHOLD, redactPaths } from '@repo-stitcher/core';
import { describe, expect, it } from 'vitest';

import {
  describeMCPConfig,
  githubFrom,
  loadMCPConfig,
  logMCPConfig,
  logMCPConfigProblem,
  MCP_CONFIG_FILE,
  MCP_CONFIG_RESTART_NOTE,
  MCP_REDACTED,
  providerNamesFrom,
  readConfigDocument,
  redactConfigValue,
  sandboxFrom,
  validateMCPConfig,
  type MCPConfig,
} from './config.js';

const GITHUB_TOKEN = 'ghp_shared_github_secret';
const ANTHROPIC_KEY = 'sk-ant-shared-secret';

const SHARED: Readonly<Record<string, unknown>> = {
  github: { authType: 'pat', token: GITHUB_TOKEN },
  anthropic: { apiKey: ANTHROPIC_KEY },
  sandbox: { backend: 'docker', mode: 'auto', networkAllow: false },
  confidence: { auto_approve_threshold: 80 },
  credentials: { nested: { token: 'nested-secret' } },
};

function withDir<T>(case_: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'stitch-mcp-config-'));
  try {
    return case_(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function writeFile(dir: string, text: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, MCP_CONFIG_FILE), text, 'utf8');
}

function writeConfig(dir: string, value: unknown): void {
  writeFile(dir, JSON.stringify(value));
}

/** Load with an empty provider env unless a case says otherwise. */
function loaded(dir: string, env: Record<string, string | undefined> = {}): MCPConfig {
  const result = loadMCPConfig({ dir, env });
  if (result.isErr()) throw new Error(`expected a config, got ${result.error.code}`);
  return result.value;
}

function refusalField(config: MCPConfig): string {
  const result = validateMCPConfig(config);
  if (result.isOk()) throw new Error('expected a refusal, got a validated config');
  return 'field' in result.error ? result.error.field : result.error.code;
}

describe('MCP shared config (P-362)', () => {
  it('reads the store the CLI writes, with no second credential flow', () => {
    withDir(dir => {
      writeConfig(dir, SHARED);
      const config = loaded(dir);

      expect(config.path).toBe(join(dir, MCP_CONFIG_FILE));
      expect(config.present).toBe(true);
      expect(config.github).toEqual({ authType: 'pat', hasToken: true, hasAppCredentials: false });
      expect(config.ai.providers).toEqual(['anthropic']);
      expect(config.sandbox).toEqual({
        configured: true,
        backend: 'docker',
        mode: 'auto',
        networkAllow: false,
      });
      expect(config.confidenceThreshold).toBe(80);
      expect(validateMCPConfig(config)._unsafeUnwrap()).toEqual([
        'github',
        'ai',
        'sandbox',
        'confidence',
      ]);
    });
  });

  it('treats a missing file as an unconfigured store, not as a failure', () => {
    withDir(dir => {
      const config = loaded(dir);

      expect(config.present).toBe(false);
      expect(config.github.hasToken).toBe(false);
      expect(config.ai.providers).toEqual([]);
      expect(config.sandbox.configured).toBe(false);
      expect(config.confidenceThreshold).toBe(DEFAULT_AUTO_APPROVE_THRESHOLD);
      expect(refusalField(config)).toBe('github');
    });
  });

  it('counts an env credential without reading a value', () => {
    withDir(dir => {
      writeConfig(dir, {
        github: { token: GITHUB_TOKEN },
        anthropic: { apiKey: ANTHROPIC_KEY },
        sandbox: { backend: 'docker' },
      });

      expect(loaded(dir).ai.providers).toEqual(['anthropic']);
      expect(loaded(dir, { OPENROUTER_API_KEY: 'env-secret' }).ai.providers).toEqual([
        'anthropic',
        'openrouter',
      ]);
      expect(loaded(dir, { OLLAMA_HOST: 'http://localhost:11434' }).ai.providers).toEqual([
        'anthropic',
      ]);
    });
  });

  it('validates the required fields in the order the phase names them', () => {
    withDir(dir => {
      writeConfig(dir, {});
      expect(refusalField(loaded(dir))).toBe('github');

      writeConfig(dir, { github: { authType: 'pat', token: GITHUB_TOKEN } });
      expect(refusalField(loaded(dir))).toBe('ai.provider');

      writeConfig(dir, {
        github: { authType: 'pat', token: GITHUB_TOKEN },
        anthropic: { apiKey: ANTHROPIC_KEY },
      });
      expect(refusalField(loaded(dir))).toBe('sandbox');

      writeConfig(dir, SHARED);
      expect(validateMCPConfig(loaded(dir)).isOk()).toBe(true);
    });
  });

  it('refuses a malformed or non-object store instead of reading it as empty', () => {
    withDir(dir => {
      writeFile(dir, '{ not json');
      const malformed = loadMCPConfig({ dir, env: {} });
      expect(malformed.isErr()).toBe(true);
      expect(malformed._unsafeUnwrapErr().code).toBe('CONFIG_ERROR');
      expect('field' in malformed._unsafeUnwrapErr()).toBe(true);

      writeFile(dir, '[1, 2, 3]');
      const list = loadMCPConfig({ dir, env: {} });
      expect(list.isErr()).toBe(true);
      expect(list._unsafeUnwrapErr()).toMatchObject({ code: 'CONFIG_ERROR', field: 'config' });
    });
  });

  it('refuses an out-of-range stored threshold on core\u2019s own field', () => {
    withDir(dir => {
      writeConfig(dir, { ...SHARED, confidence: { auto_approve_threshold: 150 } });
      const result = loadMCPConfig({ dir, env: {} });

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr()).toMatchObject({
        code: 'CONFIG_ERROR',
        field: 'confidence.auto_approve_threshold',
      });
    });
  });

  it('redacts secret-keyed subtrees all the way down', () => {
    withDir(dir => {
      writeConfig(dir, SHARED);
      const redacted = redactConfigValue(SHARED) as Record<string, unknown>;
      const text = JSON.stringify(redacted);

      expect(redacted['github']).toEqual({ authType: MCP_REDACTED, token: MCP_REDACTED });
      expect(redacted['anthropic']).toEqual({ apiKey: MCP_REDACTED });
      expect(redacted['credentials']).toBe(MCP_REDACTED);
      expect(redacted['sandbox']).toEqual({
        backend: 'docker',
        mode: 'auto',
        networkAllow: false,
      });
      expect(text).not.toContain(GITHUB_TOKEN);
      expect(text).not.toContain(ANTHROPIC_KEY);
      expect(text).not.toContain('nested-secret');
      expect(loaded(dir).redacted).toEqual(redacted);
    });
  });

  it('never puts a secret in the summary, the snapshot or the log call', () => {
    withDir(dir => {
      writeConfig(dir, SHARED);
      const config = loaded(dir);
      const summary = logMCPConfig(config);

      expect(summary).toContain(`github: token`);
      expect(summary).toContain('ai: anthropic');
      expect(summary).toContain('threshold: 80');
      expect(summary).not.toContain(GITHUB_TOKEN);
      expect(summary).not.toContain(ANTHROPIC_KEY);
      expect(JSON.stringify(config.redacted)).not.toContain(ANTHROPIC_KEY);
      expect(describeMCPConfig(config)).not.toContain(GITHUB_TOKEN);

      // The logger's own redact paths (P-010/P-037) cover the raw fields too,
      // so even an unredacted snapshot could not print them.
      expect(redactPaths).toContain('github.auth.token');
      expect(redactPaths).toContain('openrouter.apiKey');
      expect(redactPaths).toContain('anthropic.apiKey');
      expect(redactPaths).toContain('apiKey');
      expect(redactPaths).toContain('token');

      expect(() =>
        logMCPConfigProblem({ code: 'CONFIG_ERROR', field: 'config', message: 'broken' })
      ).not.toThrow();
    });
  });

  it('re-reads the file instead of caching it, and documents the restart', () => {
    withDir(dir => {
      writeConfig(dir, { github: { token: GITHUB_TOKEN }, sandbox: { backend: 'docker' } });
      expect(loaded(dir).ai.providers).toEqual([]);

      writeConfig(dir, SHARED);
      expect(loaded(dir).ai.providers).toEqual(['anthropic']);
      expect(MCP_CONFIG_RESTART_NOTE).toContain('restart');
    });
  });

  it('reads the github, sandbox and provider halves independently of a full config', () => {
    expect(
      githubFrom({ github: { authType: 'app', appId: 12, privateKeyPath: 'key.pem' } })
    ).toEqual({ authType: 'app', hasToken: false, hasAppCredentials: true });
    expect(githubFrom({ github: { appId: 0, privateKeyPath: '' } })).toEqual({
      authType: undefined,
      hasToken: false,
      hasAppCredentials: false,
    });
    expect(sandboxFrom({ sandbox: 'nope' })).toEqual({
      configured: false,
      backend: undefined,
      mode: undefined,
      networkAllow: undefined,
    });
    expect(providerNamesFrom({ openrouter: { apiKey: 'k' } }, {})).toEqual(['openrouter']);
    expect(providerNamesFrom({ openrouter: { apiKey: '' } }, {})).toEqual([]);
    expect(providerNamesFrom({}, { OPENAI_API_KEY: 'k', GITHUB_TOKEN: 'ignored' })).toEqual([
      'openai',
    ]);
  });

  it('reads a store through readConfigDocument, absent or not', () => {
    withDir(dir => {
      expect(readConfigDocument(join(dir, MCP_CONFIG_FILE))._unsafeUnwrap()).toEqual({});

      writeConfig(dir, { sources: [] });
      expect(readConfigDocument(join(dir, MCP_CONFIG_FILE))._unsafeUnwrap()).toEqual({
        sources: [],
      });

      writeFile(dir, '"a string"');
      expect(readConfigDocument(join(dir, MCP_CONFIG_FILE))._unsafeUnwrapErr()).toMatchObject({
        code: 'CONFIG_ERROR',
        field: 'config',
      });
    });
  });
});
