// P-151 tests: agent tool `fix_dependency`.
//
// Fully offline. The version resolver is injected (a plain map), and C's
// merged manifest is a plain object served through `DepsFacade.analyze` — no
// registry, no network, no filesystem.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  applyDependencyFix,
  planDependencyFix,
  resolveFixRange,
  runFixDependency,
  serializeFixedManifest,
  fixDependencyTool,
  rangesEquivalent,
} from './fix_dependency.js';
import {
  selectFilesTool,
  resolveDepsTool,
  detectGapsTool,
  fixDependencyTool as fixToolAlias,
  registerAgentTool,
  clearAgentToolsForTests,
  listAgentTools,
} from './index.js';
import type { LatestVersionResolver, SelectedFile } from '../index.js';
import type { UnifiedManifest } from '../../deps/types.js';
import type { ToolContext } from '../../ai/types.js';
import { ok, err, type Result } from 'neverthrow';
import type { StitchError } from '../../result/index.js';

/** Deterministic "registry": a fixed version per package. */
const REGISTRY: Record<string, string> = {
  'left-pad': '1.3.0',
  chalk: '5.3.0',
  express: '4.19.2',
};

const resolver: LatestVersionResolver = async (
  pkg: string
): Promise<Result<string, StitchError>> => {
  const version = REGISTRY[pkg];
  return version === undefined
    ? err({ code: 'NOT_FOUND', status: 404, message: `no such package ${pkg}`, hint: '' })
    : ok(version);
};

function npmManifest(deps: Record<string, string>): UnifiedManifest {
  return { name: 'child-repo-c', dependencies: { ...deps } } as unknown as UnifiedManifest;
}

function makeCtx(deps: Record<string, string>): ToolContext {
  const inert = {
    diff: async (): Promise<string> => '',
    status: async (): Promise<string> => '',
    commit: async (): Promise<void> => {},
    add: async (): Promise<void> => {},
    analyze: async (): Promise<Record<string, string>> => ({ ...deps }),
    install: async (): Promise<void> => {},
    scan: async (): Promise<string[]> => [],
    check: async (): Promise<boolean> => true,
  };
  return {
    cwd: '/repo',
    config: {},
    logger: { ...inert, info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    costTracker: { ...inert, add: () => {}, totalTokens: { input: 0, output: 0, total: 0 } },
    git: inert,
    deps: inert,
    license: inert,
  } as unknown as ToolContext;
}

/** Source repo A: src/app.ts imports left-pad. */
const SELECTION: SelectedFile[] = [{ repo: 'A', path: 'src/app.ts' }];

const REPO_A_FILES: Record<string, string> = {
  'src/app.ts': "import leftPad from 'left-pad';\nexport const a = leftPad('x');\n",
  'package.json': JSON.stringify({ name: 'a', dependencies: { 'left-pad': '^1.3.0' } }),
};

/** A ctx whose A/B listing+reads back the closure over SELECTION. */
function makeClosureCtx(deps: Record<string, string>): ToolContext {
  const base = makeCtx(deps);
  return {
    ...base,
    git: {
      ...base.git,
      listFiles: async (): Promise<Result<string[], StitchError>> => ok(Object.keys(REPO_A_FILES)),
      readFile: async (
        _cwd: string,
        _repo: 'A' | 'B',
        path: string
      ): Promise<Result<string, StitchError>> => ok(REPO_A_FILES[path] ?? ''),
    },
  } as unknown as ToolContext;
}

beforeEach(() => {
  clearAgentToolsForTests();
  for (const t of [selectFilesTool, resolveDepsTool, detectGapsTool, fixToolAlias]) {
    expect(registerAgentTool(t).isOk()).toBe(true);
  }
});

describe('P-151 fix_dependency', () => {
  it('adds new dependency', async () => {
    const manifest = npmManifest({ express: '^4.19.2' });
    const result = await applyDependencyFix(
      manifest,
      'left-pad',
      '^1.3.0',
      'dependencies',
      resolver
    );
    expect(result.isOk()).toBe(true);
    const fix = result._unsafeUnwrap();
    expect(fix).toEqual({
      action: 'added',
      package: 'left-pad',
      version: '^1.3.0',
      section: 'dependencies',
    });

    // The input manifest is untouched (rollback is structural), and the plan
    // produces a new one carrying the addition.
    expect((manifest as unknown as { dependencies: Record<string, string> }).dependencies).toEqual({
      express: '^4.19.2',
    });
    const plan = planDependencyFix(manifest, 'left-pad', '^1.3.0', 'dependencies');
    expect(plan.isOk()).toBe(true);
    const newDeps = (
      plan._unsafeUnwrap().manifest as unknown as { dependencies: Record<string, string> }
    ).dependencies;
    expect(newDeps['left-pad']).toBe('^1.3.0');
    // Pre-existing entries survive.
    expect(newDeps['express']).toBe('^4.19.2');
  });

  it('updates existing', async () => {
    const manifest = npmManifest({ 'left-pad': '^1.0.0' });
    const result = await applyDependencyFix(
      manifest,
      'left-pad',
      '^1.3.0',
      'dependencies',
      resolver
    );
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().action).toBe('updated');
    expect(result._unsafeUnwrap().version).toBe('^1.3.0');

    // A genuinely different major is also an update.
    const major = await applyDependencyFix(
      npmManifest({ 'left-pad': '^1.0.0' }),
      'left-pad',
      '^2.0.0',
      'dependencies',
      resolver
    );
    expect(major.isOk()).toBe(true);
    expect(major._unsafeUnwrap().action).toBe('updated');
  });

  it('unchanged when satisfied', async () => {
    // Identical range.
    const same = await applyDependencyFix(
      npmManifest({ 'left-pad': '^1.3.0' }),
      'left-pad',
      '^1.3.0',
      'dependencies',
      resolver
    );
    expect(same.isOk()).toBe(true);
    expect(same._unsafeUnwrap().action).toBe('unchanged');

    // An exact pin satisfies a caret range for manifest purposes.
    const equivalent = await applyDependencyFix(
      npmManifest({ 'left-pad': '1.3.0' }),
      'left-pad',
      '^1.3.0',
      'dependencies',
      resolver
    );
    expect(equivalent.isOk()).toBe(true);
    expect(equivalent._unsafeUnwrap().action).toBe('unchanged');
    // The reported version is what the manifest already had.
    expect(equivalent._unsafeUnwrap().version).toBe('1.3.0');

    expect(rangesEquivalent('1.3.0', '^1.3.0')).toBe(true);
    expect(rangesEquivalent('^1.0.0', '^2.0.0')).toBe(false);
  });

  it('resolves auto range', async () => {
    // 'auto' prefers the range source repo A already pinned (as-authored).
    const authored = await resolveFixRange('left-pad', 'auto', resolver, {
      sourceRanges: { 'left-pad': '~1.2.0' },
    });
    expect(authored.isOk()).toBe(true);
    expect(authored._unsafeUnwrap()).toBe('~1.2.0');

    // 'auto' with no authored pin falls back to ^<latest> from the resolver.
    const fallback = await resolveFixRange('chalk', 'auto', resolver);
    expect(fallback.isOk()).toBe(true);
    expect(fallback._unsafeUnwrap()).toBe('^5.3.0');

    // 'latest' always uses the resolver.
    const latest = await resolveFixRange('express', 'latest', resolver);
    expect(latest.isOk()).toBe(true);
    expect(latest._unsafeUnwrap()).toBe('^4.19.2');

    // Deterministic: the same inputs always produce the same range.
    const again = await resolveFixRange('express', 'latest', resolver);
    expect(again._unsafeUnwrap()).toBe(latest._unsafeUnwrap());

    // An unknown package surfaces the resolver's error, not a guess.
    const unknown = await resolveFixRange('nope-not-real', 'latest', resolver);
    expect(unknown.isErr()).toBe(true);
    expect(unknown._unsafeUnwrapErr().code).toBe('NOT_FOUND');
  });

  it('validates with resolver', async () => {
    // A syntactically invalid range is rejected before any planning.
    const bad = await applyDependencyFix(
      npmManifest({}),
      'left-pad',
      'not-a-range!!',
      'dependencies',
      resolver
    );
    expect(bad.isErr()).toBe(true);
    expect(bad._unsafeUnwrapErr().code).toBe('CONFIG_ERROR');

    // With no resolver configured, a range that needs the registry fails
    // loudly rather than silently picking a version.
    const noResolver = await applyDependencyFix(
      npmManifest({}),
      'left-pad',
      'latest',
      'dependencies',
      async pkg =>
        err({ code: 'CONFIG_ERROR', field: 'resolver', message: `no resolver for ${pkg}` })
    );
    expect(noResolver.isErr()).toBe(true);
    expect(noResolver._unsafeUnwrapErr().code).toBe('CONFIG_ERROR');

    // A section the manifest shape does not have is refused, not invented.
    const goManifest = {
      module: 'example.com/b',
      require: { 'left-pad': '1.3.0' },
    } as unknown as UnifiedManifest;
    const badSection = planDependencyFix(goManifest, 'left-pad', '^1.3.0', 'dependencies');
    expect(badSection.isErr()).toBe(true);
    expect(badSection._unsafeUnwrapErr().code).toBe('UNSUPPORTED_ECOSYSTEM');

    // Bad tool args are rejected by the schema.
    const badArgs = await runFixDependency({ package: '' }, makeCtx({}), { resolver });
    expect(badArgs.isErr()).toBe(true);
    expect(badArgs._unsafeUnwrapErr().code).toBe('TOOL_ARGS_VALIDATION');
  });

  it('confirms via closure', async () => {
    // Before the fix, the closure reports left-pad as missing.
    const ctx = makeClosureCtx({});
    const before = await runFixDependency({ package: 'left-pad', range: '^1.3.0' }, ctx, {
      resolver,
      selection: SELECTION,
    });
    expect(before.isOk()).toBe(true);
    const outcome = before._unsafeUnwrap();
    expect(outcome.action).toBe('added');
    // The post-fix closure confirms the gap closed.
    expect(outcome.closure.satisfied).toBe(true);
    expect(outcome.closure.missing).not.toContain('left-pad');
    expect(outcome.closure.required).toContain('left-pad');

    // The serialized manifest is valid JSON carrying the new dependency.
    expect(outcome.serialized).toBeDefined();
    const roundTripped = JSON.parse(outcome.serialized ?? '{}') as {
      dependencies?: Record<string, string>;
    };
    expect(roundTripped.dependencies?.['left-pad']).toBe('^1.3.0');

    // Serialization round-trips: the fixed manifest re-serializes identically.
    expect(serializeFixedManifest(outcome.manifest)).toBe(outcome.serialized);

    // The tool is auto (no approval gate) and registered.
    expect(fixDependencyTool.autonomy).toBe('auto');
    expect(listAgentTools().map(t => t.name)).toContain('fix_dependency');
  });
});
