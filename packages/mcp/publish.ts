// P-364 - the MCP registry submission for this server.
//
// The registry entry is DERIVED, never hand-written: name, version, description
// and license come from `packages/mcp/package.json`, the repository URL from the
// git remote the checkout was cloned from, and the tool list from the very
// loaders `startMcpServer` registers with (P-357-P-361), so the entry cannot
// describe a server that does not exist. `--print` writes
// `MCP_REGISTRY_ENTRY.json`; `--check` fails when the committed file is stale,
// which is what CI gates on.
//
// Step 2 of the phase (submit to the public registry, then verify the entry is
// discoverable by name) needs a registry this checkout holds no credentials for,
// and step 1 is blocked outright because the package is `private: true`, its
// license is `UNLICENSED` and no LICENSE file exists. `--publish` therefore does
// the real HTTP POST when both MCP_REGISTRY_URL and MCP_REGISTRY_TOKEN are
// present and otherwise REFUSES naming every missing prerequisite: it never
// reports a submission that did not happen (ADR-173).

import { execFile } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { err, ok, type Result } from 'neverthrow';
import type { StitchError } from '@repo-stitcher/core';

import { loadCheckLicensePorts, registerCheckLicenseTool } from './src/tools/check-license.js';
import { loadCoreToolPorts, registerCoreTools } from './src/tools/core-tools.js';
import { registerJobStatusTools } from './src/tools/job-status.js';
import { loadMergePorts, registerMergeTool } from './src/tools/merge.js';
import { createToolRegistry } from './src/tools/registry.js';
import { loadSelectFilesPorts, registerSelectFilesTool } from './src/tools/select-files.js';

const PACKAGE_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(PACKAGE_DIR, '..', '..');
const GIT_MAX_BUFFER = 1024 * 1024;

const execFileAsync = promisify(execFile);

/** The name `mcp install <name>` uses, which is not the npm package name. */
export const REGISTRY_ENTRY_NAME = 'repo-stitcher';

/** The committed artifact, addressed from the repository root. */
export const REGISTRY_ENTRY_FILENAME = 'MCP_REGISTRY_ENTRY.json';
export const REGISTRY_ENTRY_PATH = join(REPO_ROOT, REGISTRY_ENTRY_FILENAME);

/** Where the registry and its credential are configured, as CI exports them. */
export const REGISTRY_URL_ENV = 'MCP_REGISTRY_URL';
export const REGISTRY_TOKEN_ENV = 'MCP_REGISTRY_TOKEN';

/** The entry is generated and validated here; submitting it is a separate act. */
export const REGISTRY_STATUS = 'not submitted';

/** The manifest the entry's identity is read from. */
export const PACKAGE_MANIFEST = join(PACKAGE_DIR, 'package.json');

/** The tools a host will look for, from the P-358-P-360 phases. */
export const REGISTRY_PRIMARY_TOOLS = [
  'stitch_select_files',
  'stitch_merge',
  'stitch_job_status',
  'stitch_check_license',
] as const;

/** Install commands measured in the P-363 host compatibility pass. */
export const REGISTRY_STDIO_INSTALL =
  'claude mcp add repo-stitcher -- bun run --filter @repo-stitcher/mcp server';
export const REGISTRY_HTTP_INSTALL =
  'opencode mcp add repo-stitcher -- bun run --filter @repo-stitcher/mcp server --http';

/**
 * Why the entry cannot be submitted from this checkout yet. A host reading the
 * file must be able to tell a generated entry from a published one.
 */
export const REGISTRY_PUBLISH_NOTE =
  'the entry is generated from the checkout, and it is not submitted: the package is private, its license is UNLICENSED, no LICENSE file exists, and neither MCP_REGISTRY_URL nor MCP_REGISTRY_TOKEN is configured (ADR-173)';

export interface RegistryEntryInstallation {
  readonly stdio: string;
  readonly http: string;
}

export interface RegistryEntry {
  readonly name: string;
  readonly description: string;
  readonly version: string;
  readonly repository: string;
  readonly homepage: string;
  readonly license: string;
  readonly tools: readonly string[];
  readonly installation: RegistryEntryInstallation;
  readonly status: string;
}

export interface RegistryPackageFacts {
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly license: string;
  readonly private: boolean;
  readonly hasLicenseFile: boolean;
}

export interface RegistryPublishOutcome {
  readonly submitted: boolean;
  readonly status: number;
  readonly url: string;
}

/** Everything the publisher needs from outside: no network or git in tests. */
export interface RegistryPorts {
  readonly readPackage: () => Result<RegistryPackageFacts, StitchError>;
  readonly remoteUrl: () => Promise<Result<string, StitchError>>;
  readonly listTools: () => Promise<Result<readonly string[], StitchError>>;
  readonly post: (
    url: string,
    token: string,
    entry: RegistryEntry
  ) => Promise<Result<number, StitchError>>;
  readonly env: Readonly<Record<string, string | undefined>>;
}

function configError(field: string, message: string): StitchError {
  return { code: 'CONFIG_ERROR', field, message };
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

/** Read the identity of the package the entry describes. */
export function readPackageFacts(
  manifestPath: string,
  repoRoot: string
): Result<RegistryPackageFacts, StitchError> {
  let text: string;
  try {
    text = readFileSync(manifestPath, 'utf8');
  } catch (cause) {
    return err(configError('registry.package', `cannot read ${manifestPath}: ${messageOf(cause)}`));
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    return err(
      configError('registry.package', `${manifestPath} is not valid JSON: ${messageOf(cause)}`)
    );
  }
  const manifest = asRecord(parsed);
  const name = manifest['name'];
  const version = manifest['version'];
  const description = manifest['description'];
  if (typeof name !== 'string' || name === '') {
    return err(configError('registry.package', `${manifestPath} declares no name`));
  }
  if (typeof version !== 'string' || version === '') {
    return err(configError('registry.package', `${manifestPath} declares no version`));
  }
  if (typeof description !== 'string' || description === '') {
    return err(configError('registry.package', `${manifestPath} declares no description`));
  }
  const license = manifest['license'];
  return ok({
    name,
    version,
    description,
    license: typeof license === 'string' ? license : '',
    private: manifest['private'] === true,
    hasLicenseFile: existsSync(join(repoRoot, 'LICENSE')),
  });
}

/**
 * Turn the git remote into the repository URL the entry publishes. A remote
 * that embeds credentials is refused rather than redacted, because a public
 * entry must never carry them and a silent rewrite would hide the leak.
 */
export function toRepositoryUrl(remote: string): Result<string, StitchError> {
  const trimmed = remote.trim();
  if (trimmed === '') {
    return err(
      configError(
        'registry.repository',
        'the git remote is empty: the entry needs the canonical URL'
      )
    );
  }
  const schemeEnd = trimmed.indexOf('://');
  if (schemeEnd > 0) {
    const authority = trimmed.slice(schemeEnd + 3);
    const slash = authority.indexOf('/');
    const host = slash >= 0 ? authority.slice(0, slash) : authority;
    if (host.includes('@')) {
      return err(
        configError(
          'registry.repository',
          'the git remote embeds credentials, which the entry must not carry'
        )
      );
    }
    if (!/^https?:\/\//i.test(trimmed)) {
      return err(
        configError(
          'registry.repository',
          `the git remote uses the ${trimmed.slice(0, schemeEnd)} scheme: the entry needs an http(s) URL`
        )
      );
    }
    return ok(trimmed);
  }
  // git@github.com:owner/repo.git -> https://github.com/owner/repo.git
  const at = trimmed.indexOf('@');
  const colon = at > 0 ? trimmed.indexOf(':', at) : -1;
  if (at > 0 && colon > at) {
    return ok(`https://${trimmed.slice(at + 1, colon)}/${trimmed.slice(colon + 1)}`);
  }
  return err(
    configError(
      'registry.repository',
      `the git remote ${trimmed} is not a recognisable repository URL`
    )
  );
}

/** The entry, assembled from the package, the remote and the live tool list. */
export async function buildRegistryEntry(
  ports: RegistryPorts
): Promise<Result<RegistryEntry, StitchError>> {
  const facts = ports.readPackage();
  if (facts.isErr()) return err(facts.error);
  const remote = await ports.remoteUrl();
  if (remote.isErr()) return err(remote.error);
  const repository = toRepositoryUrl(remote.value);
  if (repository.isErr()) return err(repository.error);
  const tools = await ports.listTools();
  if (tools.isErr()) return err(tools.error);
  return ok({
    name: REGISTRY_ENTRY_NAME,
    description: facts.value.description,
    version: facts.value.version,
    repository: repository.value,
    homepage: `${repository.value}#readme`,
    license: facts.value.license,
    tools: [...tools.value].sort((left, right) => left.localeCompare(right)),
    installation: {
      stdio: REGISTRY_STDIO_INSTALL,
      http: REGISTRY_HTTP_INSTALL,
    },
    status: REGISTRY_STATUS,
  });
}

/** Refuse an entry a registry could not index, in the order it would notice. */
export function validateRegistryEntry(
  entry: RegistryEntry
): Result<readonly string[], StitchError> {
  if (entry.name !== REGISTRY_ENTRY_NAME) {
    return err(configError('registry.name', `the registry name must be ${REGISTRY_ENTRY_NAME}`));
  }
  if (!/^\d+\.\d+\.\d+/.test(entry.version)) {
    return err(
      configError('registry.version', `the version ${entry.version} is not a release version`)
    );
  }
  if (entry.description.trim().length < 20) {
    return err(
      configError(
        'registry.description',
        'the description is too short to identify the server in a search'
      )
    );
  }
  const missing = REGISTRY_PRIMARY_TOOLS.filter(tool => !entry.tools.includes(tool));
  if (entry.tools.length === 0 || missing.length > 0) {
    return err(
      configError(
        'registry.tools',
        `the tool list is missing ${missing.join(', ') || 'every tool'}`
      )
    );
  }
  if (entry.installation.stdio.trim() === '' || entry.installation.http.trim() === '') {
    return err(
      configError('registry.install', 'the entry needs both a stdio and an http install command')
    );
  }
  return ok(['name', 'version', 'description', 'tools', 'installation']);
}

/** Every reason a public submission must not be attempted right now. */
export function submissionBlockers(
  facts: RegistryPackageFacts,
  env: Readonly<Record<string, string | undefined>>
): readonly string[] {
  const blockers: string[] = [];
  if (facts.private) blockers.push('the package is private');
  if (facts.license === '' || facts.license === 'UNLICENSED') {
    blockers.push(`the package license is ${facts.license === '' ? 'unset' : facts.license}`);
  }
  if (!facts.hasLicenseFile) blockers.push('the repository has no LICENSE file');
  if ((env[REGISTRY_URL_ENV] ?? '') === '') blockers.push(`${REGISTRY_URL_ENV} is not set`);
  if ((env[REGISTRY_TOKEN_ENV] ?? '') === '') blockers.push(`${REGISTRY_TOKEN_ENV} is not set`);
  return blockers;
}

/** Submit the entry, or refuse naming exactly what is missing. */
export async function publishRegistryEntry(
  entry: RegistryEntry,
  facts: RegistryPackageFacts,
  ports: RegistryPorts
): Promise<Result<RegistryPublishOutcome, StitchError>> {
  const validated = validateRegistryEntry(entry);
  if (validated.isErr()) return err(validated.error);
  const blockers = submissionBlockers(facts, ports.env);
  if (blockers.length > 0) {
    return err(
      configError(
        'registry.submission',
        `the registry submission cannot proceed: ${blockers.join('; ')}`
      )
    );
  }
  const url = ports.env[REGISTRY_URL_ENV] ?? '';
  const token = ports.env[REGISTRY_TOKEN_ENV] ?? '';
  const posted = await ports.post(url, token, entry);
  if (posted.isErr()) return err(posted.error);
  if (posted.value < 200 || posted.value >= 300) {
    return err(
      configError('registry.submission', `the registry answered ${posted.value} for ${url}`)
    );
  }
  return ok({ submitted: true, status: posted.value, url });
}

/** The exact bytes committed to `MCP_REGISTRY_ENTRY.json`. */
export function renderRegistryEntry(entry: RegistryEntry): string {
  return `${JSON.stringify(entry, null, 2)}\n`;
}

/** Fail the build when the committed entry no longer matches the generator. */
export function checkRegistryEntry(
  committed: string,
  entry: RegistryEntry
): Result<void, StitchError> {
  if (committed !== renderRegistryEntry(entry)) {
    return err(
      configError(
        'registry.file',
        `${REGISTRY_ENTRY_FILENAME} is out of date: run "bun run registry:print" and commit the result`
      )
    );
  }
  return ok(undefined);
}

async function gitRemoteUrl(): Promise<Result<string, StitchError>> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['-C', REPO_ROOT, 'remote', 'get-url', 'origin'],
      { maxBuffer: GIT_MAX_BUFFER, windowsHide: true }
    );
    return ok(stdout.trim());
  } catch (cause) {
    return err(
      configError('registry.repository', `the git remote could not be read: ${messageOf(cause)}`)
    );
  }
}

/**
 * The tool list a host will see. Built from the same loaders the server uses,
 * so a tool added by a later phase shows up on the next `registry:print`, and
 * `registry:check` fails until the committed entry catches up.
 */
async function listRegisteredToolNames(): Promise<Result<readonly string[], StitchError>> {
  const registry = createToolRegistry();
  const corePorts = await loadCoreToolPorts();
  if (corePorts.isErr()) return err(corePorts.error);
  const core = registerCoreTools(registry, corePorts.value);
  if (core.isErr()) return err(core.error);
  const selectPorts = await loadSelectFilesPorts();
  if (selectPorts.isErr()) return err(selectPorts.error);
  const select = registerSelectFilesTool(registry, selectPorts.value);
  if (select.isErr()) return err(select.error);
  const mergePorts = await loadMergePorts();
  const merge = registerMergeTool(registry, mergePorts);
  if (merge.isErr()) return err(merge.error);
  const jobs = registerJobStatusTools(registry, mergePorts);
  if (jobs.isErr()) return err(jobs.error);
  const licensePorts = await loadCheckLicensePorts();
  const license = registerCheckLicenseTool(registry, licensePorts);
  if (license.isErr()) return err(license.error);
  return ok(registry.names());
}

/** The real submission: a JSON POST, with the token only in the header. */
async function postToRegistry(
  url: string,
  token: string,
  entry: RegistryEntry
): Promise<Result<number, StitchError>> {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: `${JSON.stringify(entry, null, 2)}\n`,
    });
    return ok(response.status);
  } catch (cause) {
    return err(
      configError(
        'registry.submission',
        `the registry at ${url} is unreachable: ${messageOf(cause)}`
      )
    );
  }
}

/** The ports a real run uses; a test injects its own. */
export function loadRegistryPorts(): RegistryPorts {
  return {
    readPackage: () => readPackageFacts(PACKAGE_MANIFEST, REPO_ROOT),
    remoteUrl: () => gitRemoteUrl(),
    listTools: () => listRegisteredToolNames(),
    post: (url, token, entry) => postToRegistry(url, token, entry),
    env: process.env,
  };
}

function readEntryFile(): Result<string, StitchError> {
  try {
    return ok(readFileSync(REGISTRY_ENTRY_PATH, 'utf8'));
  } catch (cause) {
    return err(
      configError('registry.file', `cannot read ${REGISTRY_ENTRY_PATH}: ${messageOf(cause)}`)
    );
  }
}

function fail(error: StitchError): void {
  const detail = 'message' in error ? error.message : error.code;
  process.stderr.write(`registry: ${detail}\n`);
}

/**
 * `--print` (default) writes the entry, `--check` fails on drift, and
 * `--publish` submits it or refuses with the missing prerequisites.
 */
export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  const ports = loadRegistryPorts();
  const built = await buildRegistryEntry(ports);
  if (built.isErr()) {
    fail(built.error);
    return 1;
  }
  const facts = ports.readPackage();
  if (facts.isErr()) {
    fail(facts.error);
    return 1;
  }
  const entry = built.value;
  if (argv.includes('--check')) {
    const committed = readEntryFile();
    if (committed.isErr()) {
      fail(committed.error);
      return 1;
    }
    const checked = checkRegistryEntry(committed.value, entry);
    if (checked.isErr()) {
      fail(checked.error);
      return 1;
    }
    process.stderr.write(`registry: ${REGISTRY_ENTRY_FILENAME} is current\n`);
    return 0;
  }
  if (argv.includes('--publish')) {
    const published = await publishRegistryEntry(entry, facts.value, ports);
    if (published.isErr()) {
      fail(published.error);
      return 1;
    }
    process.stderr.write(
      `registry: submitted ${REGISTRY_ENTRY_NAME} to ${published.value.url} (${published.value.status})\n`
    );
    return 0;
  }
  const validated = validateRegistryEntry(entry);
  if (validated.isErr()) {
    fail(validated.error);
    return 1;
  }
  const text = renderRegistryEntry(entry);
  const outIndex = argv.indexOf('--out');
  const out = outIndex >= 0 ? argv[outIndex + 1] : undefined;
  if (out === undefined) {
    process.stdout.write(text);
    return 0;
  }
  try {
    writeFileSync(out, text, 'utf8');
  } catch (cause) {
    fail(configError('registry.file', `cannot write ${out}: ${messageOf(cause)}`));
    return 1;
  }
  const blockers = submissionBlockers(facts.value, ports.env);
  process.stderr.write(
    `registry: wrote ${out} (${entry.status}${blockers.length > 0 ? `; ${blockers.length} blocker(s): ${blockers.join('; ')}` : ''})\n`
  );
  return 0;
}

const invokedDirectly = (process.argv[1] ?? '').endsWith('publish.ts');
if (invokedDirectly) {
  process.exitCode = await main();
}
