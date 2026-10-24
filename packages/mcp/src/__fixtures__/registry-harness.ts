// P-364 - the bun harness behind `packages/mcp/test_registry.py`.
//
// The entry is built through the REAL ports (the package manifest, the git
// remote, the live tool loaders), so `test_entry_discoverable` measures the
// artifact a registry would actually index rather than a fixture. Only the
// HTTP POST and the environment are injected, because the submission needs a
// credential this checkout does not hold (ADR-173).

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { err, ok, type Result } from 'neverthrow';
import type { StitchError } from '@repo-stitcher/core';

import {
  buildRegistryEntry,
  checkRegistryEntry,
  loadRegistryPorts,
  publishRegistryEntry,
  REGISTRY_ENTRY_FILENAME,
  REGISTRY_ENTRY_PATH,
  REGISTRY_URL_ENV,
  REGISTRY_TOKEN_ENV,
  renderRegistryEntry,
  submissionBlockers,
  validateRegistryEntry,
  type RegistryEntry,
  type RegistryPackageFacts,
  type RegistryPorts,
} from '../../publish.js';

const REPO_ROOT = join(dirname(REGISTRY_ENTRY_PATH));
const RELEASE_WORKFLOW = join(REPO_ROOT, '.github', 'workflows', 'release.yml');

/** A Result, reported the way the python driver reads it. */
function outcome(result: Result<unknown, StitchError> | void): Record<string, unknown> {
  if (result !== undefined && typeof result === 'object' && 'isErr' in result) {
    const settled = result as Result<unknown, StitchError>;
    if (settled.isOk()) return { ok: true, value: settled.value };
    const error = settled.error;
    return { ok: false, code: error.code, ...('field' in error ? { field: error.field } : {}) };
  }
  return { ok: true };
}

function refusal(result: Result<unknown, StitchError>): Record<string, unknown> {
  if (result.isOk()) return { ok: true, value: result.value };
  const error = result.error;
  return {
    ok: false,
    code: error.code,
    ...('field' in error ? { field: error.field } : {}),
    message: 'message' in error ? error.message : '',
  };
}

function text(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

async function main(): Promise<void> {
  const real = loadRegistryPorts();

  // 1. the entry, built from the real package, remote and tool loaders.
  const noCreds: RegistryPorts = { ...real, env: {} };
  const built = await buildRegistryEntry(noCreds);
  if (built.isErr()) throw new Error(`the entry did not build: ${built.error.code}`);
  const entry: RegistryEntry = built.value;
  const facts = real.readPackage();
  if (facts.isErr()) throw new Error(`the package facts did not load: ${facts.error.code}`);
  const packageFacts: RegistryPackageFacts = facts.value;

  // 2. validation refusals, in the order a registry would notice them.
  const validate = {
    name: refusal(validateRegistryEntry({ ...entry, name: 'other' })),
    version: refusal(validateRegistryEntry({ ...entry, version: 'latest' })),
    description: refusal(validateRegistryEntry({ ...entry, description: 'too short' })),
    tools: refusal(
      validateRegistryEntry({
        ...entry,
        tools: entry.tools.filter(tool => tool !== 'stitch_merge'),
      })
    ),
    install: refusal(
      validateRegistryEntry({
        ...entry,
        installation: { ...entry.installation, http: '   ' },
      })
    ),
    ok: refusal(validateRegistryEntry(entry)),
  };

  // 3. the honest blockers, and the ones a configured registry would clear.
  const blockers = {
    none: submissionBlockers(packageFacts, {}),
    with_credentials: submissionBlockers(packageFacts, {
      [REGISTRY_URL_ENV]: 'https://registry.invalid/v0/servers',
      [REGISTRY_TOKEN_ENV]: 'fake-token',
    }),
    package: {
      private: packageFacts.private,
      license: packageFacts.license,
      has_license_file: packageFacts.hasLicenseFile,
    },
  };

  // 4. publish: refuses without credentials, otherwise posts for real.
  const publishableFacts: RegistryPackageFacts = {
    ...packageFacts,
    private: false,
    license: 'MIT',
    hasLicenseFile: true,
  };
  const credentialed: RegistryPorts = {
    ...real,
    env: {
      [REGISTRY_URL_ENV]: 'https://registry.invalid/v0/servers',
      [REGISTRY_TOKEN_ENV]: 'fake-token',
    },
  };
  const refused = await publishRegistryEntry(entry, packageFacts, noCreds);
  const accepted = await publishRegistryEntry(entry, publishableFacts, {
    ...credentialed,
    post: async () => ok(201),
  });
  const serverError = await publishRegistryEntry(entry, publishableFacts, {
    ...credentialed,
    post: async () => ok(500),
  });
  const unreachable = await publishRegistryEntry(entry, publishableFacts, {
    ...credentialed,
    post: async () =>
      err({
        code: 'CONFIG_ERROR',
        field: 'registry.submission',
        message: 'the registry is unreachable',
      } as StitchError),
  });

  // 5. drift: the committed file must equal the generator's bytes.
  const committed = text(REGISTRY_ENTRY_PATH);
  const drift = {
    in_sync: checkRegistryEntry(committed, entry).isOk(),
    stale: refusal(checkRegistryEntry('{}\n', entry)),
  };

  // 6. the artifact on disk, and the CI wiring that publishes it.
  const workflow = text(RELEASE_WORKFLOW);
  let artifact: Record<string, unknown>;
  try {
    const parsed = JSON.parse(committed) as { name?: string; tools?: readonly string[] };
    artifact = {
      exists: true,
      name: parsed.name ?? null,
      tools_count: parsed.tools?.length ?? 0,
      in_sync: committed === renderRegistryEntry(entry),
    };
  } catch {
    artifact = { exists: committed !== '', parsed: false };
  }

  const report = {
    entry: {
      ...outcome(built),
      name: entry.name,
      version: entry.version,
      description_length: entry.description.length,
      repository: entry.repository,
      homepage: entry.homepage,
      license: entry.license,
      status: entry.status,
      tool_count: entry.tools.length,
      tools: entry.tools,
      primary_present: [
        'stitch_select_files',
        'stitch_merge',
        'stitch_job_status',
        'stitch_check_license',
      ].every(tool => entry.tools.includes(tool)),
      installation: entry.installation,
    },
    validate,
    blockers,
    publish: {
      refused: refusal(refused),
      accepted: refusal(accepted),
      server_error: refusal(serverError),
      unreachable: refusal(unreachable),
    },
    drift,
    artifact,
    ci: {
      registry_job: workflow.includes('registry:'),
      has_token_secret: workflow.includes(REGISTRY_TOKEN_ENV),
      has_url_var: workflow.includes(REGISTRY_URL_ENV),
      guarded_skip: workflow.includes('::notice'),
      on_tag: workflow.includes("github.ref_type == 'tag'"),
      filename: REGISTRY_ENTRY_FILENAME,
    },
  };

  process.stdout.write(`REGISTRY ${JSON.stringify(report)}\n`);
}

try {
  await main();
} catch (cause) {
  process.stderr.write(
    `registry harness failed: ${cause instanceof Error ? cause.message : cause}\n`
  );
  process.exitCode = 1;
}
