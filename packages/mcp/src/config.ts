// P-362 — the MCP server's view of the SHARED user config.
//
// The CLI (P-200) keeps the durable user config in `~/.stitch/config.json`; the
// MCP server reads that SAME file, so moving between `stitch` and an MCP host
// needs no second credential flow. The store is a loose JSON document
// (configstore), so — like the CLI's own `readSources`/`providerNames` — this
// module validates the sections it reads instead of a whole-document schema.
// Core supplies the pieces that must not drift: `stitchHomeDir` (the same
// `~/.stitch`), `PROVIDER_ENV_KEYS`, `resolveThreshold`, and the pino `logger`
// whose redact paths already cover every secret field (P-010/P-037, ADR-171).
//
// Nothing is cached: an edited file is re-read on the next call, so a restart
// is what picks a change up — documented, never silently half-live.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { err, ok, type Result } from 'neverthrow';
import {
  logger,
  PROVIDER_ENV_KEYS,
  resolveThreshold,
  stitchHomeDir,
  type StitchError,
} from '@repo-stitcher/core';

/** The store file inside the stitch home dir (the CLI's P-200 `config.json`). */
export const MCP_CONFIG_FILE = 'config.json';

/** Placeholder written over secret values in redacted snapshots (P-206). */
export const MCP_REDACTED = '[REDACTED]';

/**
 * Why an edited config needs a server restart (step 3's documented option):
 * the server never caches the file, so it picks the edit up the next time it
 * starts rather than swapping half of itself out underneath a running job.
 */
export const MCP_CONFIG_RESTART_NOTE =
  'the MCP server reads ~/.stitch/config.json fresh from disk and never caches it, so an edited config is picked up on the next server restart; a running server keeps the configuration it started with';

/**
 * Case-insensitive key-fragment match for secret material — the same rule the
 * CLI's store snapshot applies (cli/src/config.ts). That copy is not reachable
 * from this package, so the rule is restated rather than imported.
 */
const SECRET_KEY_RE =
  /api[_-]?key|token|secret|password|passwd|pwd|auth|private[_-]?key|credentials?/i;

/** The GitHub half of the shared config, as presence flags (never values). */
export interface MCPGitHubConfig {
  readonly authType: string | undefined;
  readonly hasToken: boolean;
  readonly hasAppCredentials: boolean;
}

/** The AI-provider half: which providers have a resolvable credential. */
export interface MCPAiConfig {
  readonly providers: readonly string[];
}

/** The sandbox half of the shared config (P-174). */
export interface MCPSandboxConfig {
  readonly configured: boolean;
  readonly backend: string | undefined;
  readonly mode: string | undefined;
  readonly networkAllow: boolean | undefined;
}

/** What the MCP server needs to know about the shared config (no secrets). */
export interface MCPConfig {
  /** Absolute path of the file that was read. */
  readonly path: string;
  /** Whether the file exists at all; `{}` reads as an empty, unconfigured store. */
  readonly present: boolean;
  readonly github: MCPGitHubConfig;
  readonly ai: MCPAiConfig;
  readonly sandbox: MCPSandboxConfig;
  /** The effective P-350 auto-approve threshold (the stored value or the default). */
  readonly confidenceThreshold: number;
  /** The whole document with every secret-keyed subtree replaced (P-206). */
  readonly redacted: Readonly<Record<string, unknown>>;
}

/** Injectable seams; both default to the real environment. */
export interface MCPConfigOptions {
  /** The stitch home dir to read (tests point this at a temp dir). */
  readonly dir?: string;
  /** Injectable for tests; defaults to `process.env`. */
  readonly env?: Record<string, string | undefined>;
}

function configError(field: string, message: string): StitchError {
  return { code: 'CONFIG_ERROR', field, message };
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function isMissingFile(cause: unknown): boolean {
  return (
    typeof cause === 'object' && cause !== null && (cause as { code?: unknown }).code === 'ENOENT'
  );
}

/** The provider env var names, for the AI refusal message below. */
function providerEnvNames(): string[] {
  return Object.values(PROVIDER_ENV_KEYS)
    .filter(name => name !== '')
    .sort();
}

/** The shared config path: `<stitch home>/config.json`, i.e. `~/.stitch/config.json`. */
export function defaultMCPConfigPath(dir: string = stitchHomeDir()): string {
  return join(dir, MCP_CONFIG_FILE);
}

/**
 * Deep-clone `value`, replacing secret-keyed subtrees with `MCP_REDACTED`. A
 * matching key redacts its whole subtree, so a nested `credentials` object can
 * never leak a field; arrays and other objects recurse, primitives pass.
 */
export function redactConfigValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactConfigValue);
  if (typeof value === 'object' && value !== null) {
    const redacted: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      redacted[key] = SECRET_KEY_RE.test(key) ? MCP_REDACTED : redactConfigValue(nested);
    }
    return redacted;
  }
  return value;
}

/**
 * The store as a JSON object. A MISSING file is `ok({})` — "not configured
 * yet" is not a failure (the CLI's `loadConfig` precedent: no file means
 * defaults plus env). Anything else that stops us reading it — an unreadable
 * file, invalid JSON, a non-object root — is a `CONFIG_ERROR` naming the file,
 * because a corrupt store must never read as an empty one.
 */
export function readConfigDocument(path: string): Result<Record<string, unknown>, StitchError> {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (cause: unknown) {
    if (isMissingFile(cause)) return ok({});
    return err(configError('config', `cannot read ${path}: ${messageOf(cause)}`));
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (cause: unknown) {
    return err(configError('config', `could not parse ${path} as JSON: ${messageOf(cause)}`));
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return err(configError('config', `the config in ${path} is not a JSON object`));
  }
  return ok(parsed as Record<string, unknown>);
}

/**
 * Which providers have a resolvable credential, WITHOUT reading any value: an
 * env var name from `PROVIDER_ENV_KEYS`, or a top-level section carrying an
 * `apiKey` (configstore nests dotted keys, so `openrouter.apiKey` lands as the
 * section `openrouter`). Sorted and deduped.
 */
export function providerNamesFrom(
  document: Readonly<Record<string, unknown>>,
  env: Readonly<Record<string, string | undefined>>
): readonly string[] {
  const providers = new Set<string>();
  for (const [provider, envKey] of Object.entries(PROVIDER_ENV_KEYS)) {
    if (envKey !== '' && env[envKey] !== undefined) providers.add(provider);
  }
  for (const [section, value] of Object.entries(document)) {
    const apiKey = asRecord(value)['apiKey'];
    if (typeof apiKey === 'string' && apiKey !== '') providers.add(section);
  }
  return [...providers].sort();
}

/** The GitHub credential flags the store carries (core's `GitHubConfigSchema` shape). */
export function githubFrom(document: Readonly<Record<string, unknown>>): MCPGitHubConfig {
  const record = asRecord(document['github']);
  const authType = record['authType'];
  const token = record['token'];
  const appId = record['appId'];
  const privateKeyPath = record['privateKeyPath'];
  return {
    authType: typeof authType === 'string' ? authType : undefined,
    hasToken: typeof token === 'string' && token !== '',
    hasAppCredentials:
      typeof appId === 'number' &&
      Number.isInteger(appId) &&
      appId > 0 &&
      typeof privateKeyPath === 'string' &&
      privateKeyPath !== '',
  };
}

/** The sandbox section flags (P-174: backend, mode, network posture). */
export function sandboxFrom(document: Readonly<Record<string, unknown>>): MCPSandboxConfig {
  const raw = document['sandbox'];
  const record = asRecord(raw);
  const backend = record['backend'];
  const mode = record['mode'];
  const networkAllow = record['networkAllow'];
  return {
    configured: typeof raw === 'object' && raw !== null && !Array.isArray(raw),
    backend: typeof backend === 'string' ? backend : undefined,
    mode: typeof mode === 'string' ? mode : undefined,
    networkAllow: typeof networkAllow === 'boolean' ? networkAllow : undefined,
  };
}

/**
 * The P-350 threshold the store carries (`confidence.auto_approve_threshold`).
 * The range check is core's, so an out-of-range or non-numeric stored value is
 * refused on core's own field name rather than silently clamped to a default.
 */
export function confidenceThresholdFrom(
  document: Readonly<Record<string, unknown>>
): Result<number, StitchError> {
  const stored = asRecord(document['confidence'])['auto_approve_threshold'];
  if (stored === undefined) return resolveThreshold({});
  return resolveThreshold({ configValue: typeof stored === 'number' ? stored : Number.NaN });
}

/** Load the shared config; never throws, never caches. */
export function loadMCPConfig(options: MCPConfigOptions = {}): Result<MCPConfig, StitchError> {
  const dir = options.dir ?? stitchHomeDir();
  const path = defaultMCPConfigPath(dir);
  const read = readConfigDocument(path);
  if (read.isErr()) return err(read.error);
  const document = read.value;
  const threshold = confidenceThresholdFrom(document);
  if (threshold.isErr()) return err(threshold.error);
  return ok({
    path,
    present: existsSync(path),
    github: githubFrom(document),
    ai: { providers: providerNamesFrom(document, options.env ?? process.env) },
    sandbox: sandboxFrom(document),
    confidenceThreshold: threshold.value,
    redacted: redactConfigValue(document) as Readonly<Record<string, unknown>>,
  });
}

/**
 * The fields an MCP session cannot work without, checked in the order the
 * phase names them: a GitHub credential, an AI provider, a sandbox section.
 * Refusing names the missing field; the list returned on success is what the
 * harness and the quickstart report.
 */
export function validateMCPConfig(config: MCPConfig): Result<readonly string[], StitchError> {
  if (!config.github.hasToken && !config.github.hasAppCredentials) {
    return err(
      configError(
        'github',
        'the shared config carries no GitHub credential: set github.token, or github.appId with github.privateKeyPath'
      )
    );
  }
  if (config.ai.providers.length === 0) {
    return err(
      configError(
        'ai.provider',
        `the shared config carries no AI provider credential: set a provider section's apiKey, or one of ${providerEnvNames().join(', ')}`
      )
    );
  }
  if (!config.sandbox.configured) {
    return err(
      configError(
        'sandbox',
        'the shared config carries no sandbox section: set sandbox.backend, sandbox.mode or sandbox.limits'
      )
    );
  }
  return ok(['github', 'ai', 'sandbox', 'confidence']);
}

/** A secret-free one-line description of the loaded config. */
export function describeMCPConfig(config: MCPConfig): string {
  const github = config.github.hasToken
    ? 'token'
    : config.github.hasAppCredentials
      ? 'app'
      : 'none';
  const ai = config.ai.providers.length === 0 ? 'none' : config.ai.providers.join(', ');
  const sandbox = config.sandbox.configured ? (config.sandbox.backend ?? 'configured') : 'none';
  const where = config.present ? config.path : `${config.path} (absent)`;
  return `${where} — github: ${github}, ai: ${ai}, sandbox: ${sandbox}, threshold: ${config.confidenceThreshold}`;
}

/**
 * Report the loaded config through the shared logger (P-010/P-037), whose pino
 * `redact` paths already cover the raw secret fields, and hand it the
 * already-redacted snapshot on top. Returns the same secret-free summary so a
 * caller (or a test) can assert nothing sensitive reached it.
 */
export function logMCPConfig(config: MCPConfig): string {
  const summary = describeMCPConfig(config);
  logger.info({ config: config.redacted, path: config.path }, `mcp: shared config ${summary}`);
  return summary;
}

/** Report an unusable config without failing startup: the tools stay visible. */
export function logMCPConfigProblem(error: StitchError): void {
  const detail = 'message' in error ? error.message : error.code;
  logger.warn(
    { code: error.code, ...('field' in error ? { field: error.field } : {}) },
    `mcp: shared config unavailable: ${detail}`
  );
}
