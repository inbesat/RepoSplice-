// P-360 - unit tests for the `stitch_check_license` tool.
//
// The ports are the only seam, so every case here is deterministic and
// offline: the fakes stand in for the core licence scan (P-118) and the
// compatibility matrix (P-120).

import { err, ok, type Result } from 'neverthrow';
import type { StitchError } from '@repo-stitcher/core';
import { describe, expect, it } from 'vitest';
import { createMCPServer } from '../server.js';
import {
  createCheckLicenseHandler,
  loadCheckLicensePorts,
  registerCheckLicenseTool,
  STITCH_CHECK_LICENSE_TOOL_NAME,
  type CheckLicenseOutput,
  type CheckLicensePorts,
  type CompatibilityVerdict,
  type LicenseScan,
} from './check-license.js';
import { createToolRegistry, type ToolHandler } from './registry.js';

type AnyResult = Result<CheckLicenseOutput, StitchError>;

const REPO_A = 'https://example.invalid/a.git';
const REPO_B = 'https://example.invalid/b.git';

const COMPATIBLE: CompatibilityVerdict = {
  verdict: 'compatible',
  requirements: [],
  blockers: [],
  failing_categories: [],
};

function scan(ref: string, ids: readonly string[]): LicenseScan {
  return {
    ref,
    source: 'local',
    spdx_ids: ids,
    licenses: ids.map(spdx_id => ({
      spdx_id,
      name: `${spdx_id} License`,
      category: 'permissive',
    })),
    warnings: [],
    cached: false,
  };
}

interface FakeLicense {
  readonly ports: CheckLicensePorts;
  readonly scanned: string[];
  setVerdict(next: CompatibilityVerdict): void;
}

function createFakeLicense(): FakeLicense {
  const scanned: string[] = [];
  let verdict: CompatibilityVerdict = COMPATIBLE;
  const ports: CheckLicensePorts = {
    scan: async ref => {
      scanned.push(ref);
      return ok(scan(ref, ref === REPO_A ? ['MIT'] : ['GPL-3.0-only']));
    },
    compatibility: async () => ok(verdict),
  };
  return {
    ports,
    scanned,
    setVerdict: next => {
      verdict = next;
    },
  };
}

async function callOk(
  handler: ToolHandler,
  args: Record<string, unknown>
): Promise<CheckLicenseOutput> {
  const outcome = (await handler(args)) as AnyResult;
  if (outcome.isErr()) throw new Error(`expected a payload, got ${outcome.error.code}`);
  return outcome.value;
}

async function callErr(handler: ToolHandler, args: Record<string, unknown>): Promise<StitchError> {
  const outcome = (await handler(args)) as AnyResult;
  if (outcome.isOk()) throw new Error('expected an error, got a payload');
  return outcome.error;
}

function fieldOf(error: StitchError): string | undefined {
  return 'field' in error && typeof error.field === 'string' ? error.field : undefined;
}

describe('stitch_check_license (P-360)', () => {
  it('reports a compatible pair with the combined SPDX ids', async () => {
    const fake = createFakeLicense();
    const output = await callOk(createCheckLicenseHandler(fake.ports), {
      repo_a: REPO_A,
      repo_b: REPO_B,
    });

    expect(output.verdict).toBe('compatible');
    expect(output.spdx_ids).toEqual(['GPL-3.0-only', 'MIT']);
    expect(fake.scanned).toEqual([REPO_A, REPO_B]);
    expect(output.details.repo_a.spdx_ids).toEqual(['MIT']);
    expect(output.details.repo_a.source).toBe('local');
    expect(output.details.repo_b.spdx_ids).toEqual(['GPL-3.0-only']);
    expect(output.details.requirements).toEqual([]);
    expect(output.details.blockers).toEqual([]);
    expect(output.details.failing_categories).toEqual([]);
  });

  it('scans both repositories in parallel', async () => {
    const order: string[] = [];
    const ports: CheckLicensePorts = {
      scan: async ref => {
        order.push(`start:${ref}`);
        await Promise.resolve();
        order.push(`end:${ref}`);
        return ok(scan(ref, ['MIT']));
      },
      compatibility: async () => ok(COMPATIBLE),
    };

    await callOk(createCheckLicenseHandler(ports), { repo_a: REPO_A, repo_b: REPO_B });

    expect(order).toEqual([`start:${REPO_A}`, `start:${REPO_B}`, `end:${REPO_A}`, `end:${REPO_B}`]);
  });

  it('maps the compatibility decision onto the verdict', async () => {
    const fake = createFakeLicense();
    const handler = createCheckLicenseHandler(fake.ports);

    fake.setVerdict({
      verdict: 'conditional',
      requirements: ['attribute the dependency'],
      blockers: [],
      failing_categories: [],
    });
    const conditional = await callOk(handler, { repo_a: REPO_A, repo_b: REPO_B });
    expect(conditional.verdict).toBe('conditional');
    expect(conditional.details.requirements).toEqual(['attribute the dependency']);
    expect(conditional.details.blockers).toEqual([]);

    fake.setVerdict({
      verdict: 'incompatible',
      requirements: [],
      blockers: ['GPL-3.0-only is not allowed'],
      failing_categories: ['strong-copyleft'],
    });
    const incompatible = await callOk(handler, { repo_a: REPO_A, repo_b: REPO_B });
    expect(incompatible.verdict).toBe('incompatible');
    expect(incompatible.details.blockers).toEqual(['GPL-3.0-only is not allowed']);
    expect(incompatible.details.failing_categories).toEqual(['strong-copyleft']);
  });

  it('refuses an input without two repositories', async () => {
    const handler = createCheckLicenseHandler(createFakeLicense().ports);
    const cases: readonly (readonly [Record<string, unknown>, string])[] = [
      [{ repo_b: REPO_B }, 'stitch_check_license.repo_a'],
      [{ repo_a: REPO_A }, 'stitch_check_license.repo_b'],
      [{ repo_a: '   ', repo_b: REPO_B }, 'stitch_check_license.repo_a'],
      [{ repo_a: REPO_A, repo_b: 7 }, 'stitch_check_license.repo_b'],
    ];

    for (const [args, field] of cases) {
      const error = await callErr(handler, args);
      expect(error.code).toBe('CONFIG_ERROR');
      expect(fieldOf(error)).toBe(field);
    }
  });

  it('surfaces a provider failure', async () => {
    const scanning: CheckLicensePorts = {
      scan: async () =>
        err({ code: 'CONFIG_ERROR', field: 'mcp.core', message: 'no licence scan' }),
      compatibility: async () => ok(COMPATIBLE),
    };
    const refused = await callErr(createCheckLicenseHandler(scanning), {
      repo_a: REPO_A,
      repo_b: REPO_B,
    });
    expect(refused.code).toBe('CONFIG_ERROR');
    expect(fieldOf(refused)).toBe('mcp.core');

    const matrix: CheckLicensePorts = {
      scan: async ref => ok(scan(ref, ['MIT'])),
      compatibility: async () => err({ code: 'INTERNAL', message: 'the matrix failed' }),
    };
    const failed = await callErr(createCheckLicenseHandler(matrix), {
      repo_a: REPO_A,
      repo_b: REPO_B,
    });
    expect(failed.code).toBe('INTERNAL');
  });

  it('registers the tool and serves it through the MCP server', async () => {
    const registry = createToolRegistry();
    const registered = registerCheckLicenseTool(registry, createFakeLicense().ports);
    expect(registered.isOk()).toBe(true);
    expect(registered._unsafeUnwrap()).toEqual([STITCH_CHECK_LICENSE_TOOL_NAME]);
    expect(registry.names()).toEqual([STITCH_CHECK_LICENSE_TOOL_NAME]);
    expect(registry.list()[0]?.inputSchema.type).toBe('object');

    const server = createMCPServer({ registry });
    const response = await server.handleFrame(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: STITCH_CHECK_LICENSE_TOOL_NAME,
          arguments: { repo_a: REPO_A, repo_b: REPO_B },
        },
      })
    );
    expect(response).toBeDefined();
    const result = (
      response as { result: { content: readonly { text: string }[]; isError: boolean } }
    ).result;
    expect(result.isError).toBe(false);

    const payload = JSON.parse(result.content[0]?.text ?? '{}') as CheckLicenseOutput;
    expect(payload.verdict).toBe('compatible');
    expect(payload.spdx_ids).toEqual(['GPL-3.0-only', 'MIT']);
    expect(payload.details.repo_b.spdx_ids).toEqual(['GPL-3.0-only']);
  });

  it('loads the real ports from the core barrel', async () => {
    const ports = await loadCheckLicensePorts();
    expect(typeof ports.scan).toBe('function');
    expect(typeof ports.compatibility).toBe('function');
  });
});
