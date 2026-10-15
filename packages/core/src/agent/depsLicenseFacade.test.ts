// P-166 — DepsFacade / LicenseFacade integration tests.
//
// Real modules, no mocks for the facades themselves: every assertion compares
// the facade's output against the module it delegates to, and the license
// fixtures are written with the P-118 `writeFixturePkg` helper the license
// suite uses. The one scripted object is the provider in the loop test, which
// is how every P-140+ loop test drives `runToolLoop` offline.
//
// The four required scenarios from the phase spec:
//
//   it('deps union/resolve match modules')   (spec: 'deps union/resolve match modules')
//   it('license scan/compat match modules')  (spec: 'license scan/compat match modules')
//   it('complianceGate blocks on deny')      (spec: 'complianceGate blocks on deny')
//   it('loop uses real facades')             (spec: 'loop uses real facades')

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ok } from 'neverthrow';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MockProvider } from '../ai/mock.js';
import { runToolLoop } from '../ai/loop.js';
import { logger } from '../logger/index.js';
import type { ChatMessage, ToolContext, ToolDefinition } from '../ai/types.js';
import type { ChatProvider } from '../ai/provider.js';
import {
  parsePackageJson,
  parseCargoToml,
  parseGoMod,
  unionManifests,
  resolveCollision,
  maxSatisfying,
  chooseDedupeStrategy,
  mergeScripts,
  generateDepReport,
  type MergeResult,
} from '../deps/index.js';
import {
  scanDeclaredLicenses,
  checkCompatibility,
  normalizeToSPDX,
  writeFixturePkg,
  type LicensePolicy,
} from '../license/index.js';
import {
  createDepsFacade,
  createLicenseFacade,
  createDepsLicenseFacades,
  manifestDependencyMap,
  DEFAULT_LICENSE_POLICY,
  type LicenseAggregateFieldsLike,
} from './depsLicenseFacade.js';

let root: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'stitch-facade-dl-'));
}, 30_000);

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

/** A stage directory (repo C) with optional root-level files. */
async function makeStage(name: string, files: Record<string, string> = {}): Promise<string> {
  const dir = join(root, name);
  await mkdir(dir, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    await writeFile(join(dir, rel), content, 'utf8');
  }
  return dir;
}

const PKG = (deps: Record<string, string>): string =>
  JSON.stringify({ name: 'stage', version: '1.0.0', dependencies: deps });

const PERMISSIVE_ONLY: LicensePolicy = {
  allow: ['permissive'],
  denyUnknown: true,
  requireAttribution: true,
  targetLicense: 'MIT',
};

// ---------------------------------------------------------------------------
// DepsFacade
// ---------------------------------------------------------------------------

describe('P-166 DepsFacade', () => {
  it('deps union/resolve match modules', () => {
    const facade = createDepsFacade({ stage: root });

    const a = parsePackageJson(
      JSON.stringify({ name: 'a', dependencies: { lodash: '^4.17.0' } }),
      'a/package.json'
    )._unsafeUnwrap();
    const b = parsePackageJson(
      JSON.stringify({ name: 'b', dependencies: { lodash: '^4.17.21' } }),
      'b/package.json'
    )._unsafeUnwrap();

    // union
    const viaFacade = facade.union([a, b])._unsafeUnwrap();
    const viaModule = unionManifests([a, b])._unsafeUnwrap();
    expect(viaFacade).toEqual(viaModule);
    const merged = viaFacade.merged as { dependencies?: Record<string, string> };
    expect(merged.dependencies?.['lodash']).toBeDefined();

    // resolve
    expect(facade.resolve('^1.0.0', '^1.5.0')._unsafeUnwrap()).toEqual(
      resolveCollision('^1.0.0', '^1.5.0')._unsafeUnwrap()
    );
    const disjoint = facade.resolve('^1.0.0', '^2.0.0')._unsafeUnwrap();
    expect(disjoint.kind).toBe('disjoint');

    // maxSatisfying + dedupe, same modules
    expect(facade.maxSatisfying(['1.2.0', '1.3.0'], '^1.0.0')._unsafeUnwrap()).toBe(
      maxSatisfying(['1.2.0', '1.3.0'], '^1.0.0')._unsafeUnwrap()
    );
    expect(facade.dedupe(['1.2.0', '1.2.3'], { lodash: '^1.2.0' })).toEqual(
      chooseDedupeStrategy(['1.2.0', '1.2.3'], { lodash: '^1.2.0' })
    );

    // mergeScripts + report, same modules
    expect(
      facade.mergeScripts({ build: 'a' }, { build: 'b' }, { prefixA: 'a', prefixB: 'b' })
    ).toEqual(mergeScripts({ build: 'a' }, { build: 'b' }, { prefixA: 'a', prefixB: 'b' }));

    const report: MergeResult = viaFacade;
    const sources = [{ repoName: 'a', manifestPath: 'a/package.json' }];
    const facadeReport = { ...facade.report(report, null, sources) } as Record<string, unknown>;
    const moduleReport = { ...generateDepReport(report, null, sources) } as Record<string, unknown>;
    // `generateDepReport` stamps a fresh `generatedAt` per call; compare the
    // deterministic remainder, which is the whole point of the delegate.
    delete facadeReport['generatedAt'];
    delete moduleReport['generatedAt'];
    expect(facadeReport).toEqual(moduleReport);
  });

  it('analyze aggregates every install section of the stage', async () => {
    const dir = await makeStage('deps-analyze', {
      'package.json': JSON.stringify({
        name: 'stage',
        version: '1.0.0',
        dependencies: { left: '^1.0.0' },
        devDependencies: { vitest: '^5.0.0' },
        peerDependencies: { react: '^19.0.0' },
        optionalDependencies: { fsevents: '^2.0.0' },
      }),
    });
    const facade = createDepsFacade({ stage: dir });
    const deps = await facade.analyze();
    expect(deps).toMatchObject({
      left: '^1.0.0',
      vitest: '^5.0.0',
      react: '^19.0.0',
      fsevents: '^2.0.0',
    });
  });

  it('analyze returns an empty map for a stage with no manifest', async () => {
    const dir = await makeStage('deps-empty');
    const facade = createDepsFacade({ stage: dir });
    await expect(facade.analyze()).resolves.toEqual({});
  });

  it('install refuses to run a package manager on the host', async () => {
    const facade = createDepsFacade({ stage: root });
    await expect(facade.install('lodash')).rejects.toThrow(/sandbox/);
  });

  it('lockfile maps a failed regeneration to a typed error', async () => {
    const facade = createDepsFacade({ stage: root });
    const manifest = parsePackageJson(PKGTEXT, 'package.json')._unsafeUnwrap().manifest;
    const result = await facade.lockfile(manifest, root, {
      execImpl: async () => ({ exitCode: 1, stdout: '', stderr: 'boom' }),
    });
    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.code).toBe('LOCKFILE_GENERATION_FAILED');
  });

  it('manifestDependencyMap flattens each ecosystem', () => {
    const npm = parsePackageJson(
      JSON.stringify({ name: 'n', dependencies: { a: '1' }, devDependencies: { b: '2' } }),
      'package.json'
    )._unsafeUnwrap();
    expect(manifestDependencyMap(npm)).toEqual({ a: '1', b: '2' });

    const cargo = parseCargoToml(
      '[package]\nname = "c"\nversion = "0.1.0"\n\n[dependencies]\nserde = "1"\nrand = { version = "0.8" }\n',
      'Cargo.toml'
    )._unsafeUnwrap();
    expect(manifestDependencyMap(cargo)).toEqual({ serde: '1', rand: '0.8' });

    const go = parseGoMod(
      'module example.com/m\n\ngo 1.21\n\nrequire (\n\texample.com/dep v1.2.3\n)\n',
      'go.mod'
    )._unsafeUnwrap();
    expect(manifestDependencyMap(go)).toEqual({ 'example.com/dep': 'v1.2.3' });
  });
});

const PKGTEXT = JSON.stringify({ name: 'stage', version: '1.0.0', license: 'MIT' });

// ---------------------------------------------------------------------------
// LicenseFacade
// ---------------------------------------------------------------------------

describe('P-166 LicenseFacade', () => {
  it('license scan/compat match modules', async () => {
    const dir = await makeStage('lic-scan', { 'package.json': PKGTEXT });
    await writeFixturePkg(dir, 'left-pad', '1.3.0', 'MIT');
    await writeFixturePkg(dir, 'gpl-lib', '2.0.0', 'GPL-3.0-only');

    const facade = createLicenseFacade({ stage: dir });

    const viaFacade = await facade.scanDeclared();
    const viaModule = await scanDeclaredLicenses(dir);
    expect(viaFacade.isOk()).toBe(true);
    expect(viaModule.isOk()).toBe(true);
    if (viaFacade.isOk() && viaModule.isOk()) {
      expect(viaFacade.value).toEqual(viaModule.value);
      // license-checker also reports the stage's own root package.
      expect(viaFacade.value.map(d => d.package)).toEqual(
        expect.arrayContaining(['gpl-lib', 'left-pad'])
      );
    }

    // The declared P-140 `scan()` returns distinct normalized SPDX ids.
    const ids = await facade.scan();
    expect(ids).toContain('MIT');
    expect(ids).toContain('GPL-3.0-only');
    expect([...ids].sort()).toEqual(ids); // sorted

    // compat + normalize, same modules
    expect(facade.compat(['GPL-3.0-only'], PERMISSIVE_ONLY)).toEqual(
      checkCompatibility(['GPL-3.0-only'], PERMISSIVE_ONLY)
    );
    expect(facade.normalize('mit')).toBe(normalizeToSPDX('mit'));
  });

  it('complianceGate blocks on deny', async () => {
    const dir = await makeStage('lic-block', { 'package.json': PKGTEXT });
    await writeFixturePkg(dir, 'gpl-lib', '2.0.0', 'GPL-3.0-only');

    const facade = createLicenseFacade({ stage: dir });
    const gate = await facade.complianceGate(PERMISSIVE_ONLY);
    expect(gate.blocking).toBe(true);
    expect(['deny', 'review']).toContain(gate.report.verdict);
    expect(gate.report.declared.length).toBeGreaterThan(0);

    // The declared `check()` mirrors the gate.
    expect(await facade.check()).toBe(false);
  });

  it('complianceGate allows a permissive-only stage', async () => {
    const dir = await makeStage('lic-allow', { 'package.json': PKGTEXT });
    await writeFixturePkg(dir, 'left-pad', '1.3.0', 'MIT');

    const facade = createLicenseFacade({ stage: dir });
    const gate = await facade.complianceGate(PERMISSIVE_ONLY);
    expect(gate.blocking).toBe(false);
    expect(gate.report.verdict).toBe('allow');
    expect(await facade.check()).toBe(true);
  });

  it('complianceGate fails closed when the scan cannot run', async () => {
    const facade = createLicenseFacade({ stage: join(root, 'does-not-exist') });
    const gate = await facade.complianceGate();
    expect(gate.blocking).toBe(true);
    expect(gate.report.reasons.join(' ')).toMatch(/scan failed/);
  });

  it('gpl/dual/unknown/policy/reportData delegate to the real modules', async () => {
    const dir = await makeStage('lic-verbs', { 'package.json': PKGTEXT });
    await writeFixturePkg(dir, 'dual-lib', '1.0.0', 'MIT OR GPL-3.0-only');
    await writeFixturePkg(dir, 'weird-lib', '1.0.0', 'Custom-Unknown');

    const facade = createLicenseFacade({ stage: dir });
    const declared = (await facade.scanDeclared())._unsafeUnwrap();

    expect(facade.gpl(declared, true).length).toBeGreaterThan(0);
    expect(facade.dual('MIT OR GPL-3.0-only', PERMISSIVE_ONLY).recommended).toBe('MIT');
    expect(facade.unknown(declared).some(u => u.package === 'weird-lib')).toBe(true);

    const fields: LicenseAggregateFieldsLike = {
      declared,
      unknown: facade.unknown(declared),
      gplWarnings: facade.gpl(declared, true),
      matrix: facade.compat(
        declared.map(d => facade.normalize(d.licenses)),
        PERMISSIVE_ONLY
      ),
      dual: [],
      deep: null,
    };
    const report = facade.policy(fields, PERMISSIVE_ONLY);
    expect(report.declared).toEqual(declared);

    const data = facade.reportData(declared, report, {
      dual: [],
      gpl: fields.gplWarnings,
      unknown: fields.unknown,
    });
    expect(data.reportVersion).toBe(1);
    expect(data.rows.length).toBe(declared.length);
  });

  it('DEFAULT_LICENSE_POLICY is a permissive-only bar', () => {
    expect(DEFAULT_LICENSE_POLICY.allow).toContain('permissive');
    expect(DEFAULT_LICENSE_POLICY.allow).not.toContain('strong-copyleft');
    expect(DEFAULT_LICENSE_POLICY.denyUnknown).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Loop integration
// ---------------------------------------------------------------------------

describe('P-166 loop wiring', () => {
  it('loop uses real facades', async () => {
    const dir = await makeStage('loop-stage', { 'package.json': PKG({ 'left-pad': '^1.3.0' }) });
    await writeFixturePkg(dir, 'left-pad', '1.3.0', 'MIT');

    const { deps, license } = createDepsLicenseFacades({ stage: dir });

    const seen: { deps?: Record<string, string>; license?: string[] } = {};
    const tool: ToolDefinition = {
      name: 'read_stage',
      description: 'read C dependencies and licenses through the real facades',
      schema: {},
      autonomy: 'auto',
      execute: async (_args, ctx: ToolContext) => {
        seen.deps = await ctx.deps.analyze();
        seen.license = await ctx.license.scan();
        return ok({ deps: seen.deps });
      },
    };

    // Two scripted turns: a tool call, then a stop (the P-140 test pattern).
    const first = new MockProvider({
      script: [
        { kind: 'tool_call', toolCall: { id: 'c1', name: 'read_stage', arguments: {} } },
        { kind: 'finish', finishReason: 'tool_calls' },
      ],
    });
    const second = new MockProvider({
      script: [
        { kind: 'text', text: 'done' },
        { kind: 'finish', finishReason: 'stop', usage: { input: 1, output: 1, total: 2 } },
      ],
    });
    let turn = 0;
    const provider: ChatProvider = {
      name: 'mock',
      model: 'mock-model',
      provider: 'mock',
      id: 'mock/mock-model',
      chat: (...args: Parameters<MockProvider['chat']>) =>
        (turn++ === 0 ? first : second).chat(...args),
      countTokens: (messages: ChatMessage[]) =>
        messages.reduce((n, m) => n + Math.ceil(m.content.length / 4), 0),
      isRetryable: () => false,
    };

    // The real facades are wired into the ToolContext the loop hands to tools.
    const context = {
      cwd: dir,
      config: { stageRoot: 'C' },
      logger,
      costTracker: { add: () => {}, totalTokens: { input: 0, output: 0, total: 0 } },
      git: {
        diff: async () => '',
        status: async () => '',
        commit: async () => {},
        add: async () => {},
      },
      deps,
      license,
    } as unknown as ToolContext;

    const result = await runToolLoop(provider, [tool], [{ role: 'user', content: 'go' }], {
      maxIterations: 3,
      context,
    });

    expect(result.isOk()).toBe(true);
    expect(seen.deps).toMatchObject({ 'left-pad': '^1.3.0' });
    expect(seen.license).toContain('MIT');
  }, 30_000);
});
