// P-360 - the bun harness behind `packages/mcp/test_check_license.py`.
//
// The four mandated python ids need a real licence scan of two fixture
// repositories, all three verdicts, a cached second read and the SPDX detail
// listing. Each fixture is a real temp directory holding a manifest licence
// plus a `node_modules` dependency licence - the two sources the P-118 scan
// reads. The compatible, conditional and incompatible cases drive the REAL
// default ports; only the cache case wraps the scan port, because the P-303
// repo-metadata cache is not exported by the core barrel (ADR-169).

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { ok, type Result } from 'neverthrow';
import type { StitchError } from '@repo-stitcher/core';

import {
  createCheckLicenseHandler,
  loadCheckLicensePorts,
  type CheckLicenseOutput,
  type CheckLicensePorts,
  type LicenseScan,
} from '../check-license.js';

type AnyResult = Result<CheckLicenseOutput, StitchError>;
type ToolArgs = Readonly<Record<string, unknown>>;
type ToolCall = (args: ToolArgs) => unknown;

const DEPENDENCY = 'sample-dep';

async function writeJson(absolute: string, value: unknown): Promise<void> {
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

/** A repository with a manifest licence and one declared dependency licence. */
async function makeRepo(name: string, license: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'stitch-check-license-'));
  await writeJson(join(root, 'package.json'), { name, version: '1.0.0', license });
  await writeJson(join(root, 'node_modules', DEPENDENCY, 'package.json'), {
    name: DEPENDENCY,
    version: '9.9.9',
    license,
  });
  return root;
}

function handlerOutcome(outcome: AnyResult): Record<string, unknown> {
  if (outcome.isErr()) {
    const error = outcome.error;
    return {
      ok: false,
      code: error.code,
      ...('field' in error && typeof error.field === 'string' ? { field: error.field } : {}),
      ...('message' in error ? { message: error.message } : {}),
    };
  }
  return { ok: true, payload: outcome.value };
}

async function call(handler: ToolCall, args: ToolArgs): Promise<AnyResult> {
  return (await handler(args)) as AnyResult;
}

function sideFlags(outcome: AnyResult): readonly boolean[] {
  return outcome.isOk()
    ? [outcome.value.details.repo_a.cached, outcome.value.details.repo_b.cached]
    : [];
}

async function main(): Promise<void> {
  const temporary: string[] = [];
  try {
    const ports = await loadCheckLicensePorts();

    const mit = await makeRepo('sample-mit', 'MIT');
    temporary.push(mit);
    const apache = await makeRepo('sample-apache', 'Apache-2.0');
    temporary.push(apache);
    const gpl = await makeRepo('sample-gpl', 'GPL-3.0-only');
    temporary.push(gpl);
    const proprietary = await makeRepo('sample-proprietary', 'Proprietary');
    temporary.push(proprietary);

    const handler = createCheckLicenseHandler(ports);

    // 1. compatible: two permissive licences.
    const compatible = await call(handler, { repo_a: mit, repo_b: apache });
    // 2. conditional: a copyleft licence the default policy admits with review.
    const conditional = await call(handler, { repo_a: mit, repo_b: gpl });
    // 3. incompatible: an undeterminable licence, which the policy denies.
    const incompatible = await call(handler, { repo_a: mit, repo_b: proprietary });

    // 4. the cache contract: a scan port wrapping the real one.
    const remembered = new Map<string, LicenseScan>();
    let coldMs = 0;
    let cachedMs = 0;
    const cachingPorts: CheckLicensePorts = {
      ...ports,
      scan: async repo => {
        const started = performance.now();
        const hit = remembered.get(repo);
        if (hit !== undefined) {
          cachedMs = Math.max(cachedMs, performance.now() - started);
          return ok({ ...hit, cached: true });
        }
        const scanned = await ports.scan(repo);
        coldMs = Math.max(coldMs, performance.now() - started);
        if (scanned.isErr()) return scanned;
        remembered.set(repo, scanned.value);
        return ok({ ...scanned.value, cached: false });
      },
    };
    const cachingHandler = createCheckLicenseHandler(cachingPorts);
    const firstRead = await call(cachingHandler, { repo_a: mit, repo_b: apache });
    const secondRead = await call(cachingHandler, { repo_a: mit, repo_b: apache });

    // 5. the refusals.
    const missingA = await call(handler, { repo_b: apache });
    const missingB = await call(handler, { repo_a: mit, repo_b: '' });

    process.stdout.write(
      `CHECK_LICENSE ${JSON.stringify({
        compatible: handlerOutcome(compatible),
        conditional: handlerOutcome(conditional),
        incompatible: handlerOutcome(incompatible),
        cache: {
          verdict: secondRead.isOk() ? secondRead.value.verdict : null,
          cold_flags: sideFlags(firstRead),
          cached_flags: sideFlags(secondRead),
          cold_ms: coldMs,
          cached_ms: cachedMs,
        },
        errors: {
          missing_a: handlerOutcome(missingA),
          missing_b: handlerOutcome(missingB),
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
