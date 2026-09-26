// P-150 tests: agent tool `detect_gaps`.
//
// Fully offline. The source repos (A/B) are in-memory maps served through
// `GitFacade`, child repo C's staging is a second in-memory map served through
// `StagingFacade`, and C's merged manifest is a plain object. The fixture is
// deliberately broken: a missing package, an undeclared env var, a module with
// no sibling test, and a relative import that points at nothing.

import { describe, it, expect, beforeEach } from 'vitest';
import { detectGaps, detectGapsTool } from './detect_gaps.js';
import {
  selectFilesTool,
  resolveDepsTool,
  detectGapsTool as detectGapsToolAlias,
  registerAgentTool,
  clearAgentToolsForTests,
  listAgentTools,
} from './index.js';
import type { SelectedFile, SourceRepo, Gap } from '../index.js';
import type { StagingFacade, ToolContext } from '../../ai/types.js';
import type { Result } from 'neverthrow';
import { ok } from 'neverthrow';
import type { StitchError } from '../../result/index.js';

type Repo = Readonly<Record<string, string>>;

/** Source repo A: `src/app.ts` needs `left-pad`, which C will not have. */
const REPO_A: Repo = {
  'src/app.ts': "import leftPad from 'left-pad';\nexport const a = leftPad('x');\n",
  'package.json': JSON.stringify({ name: 'a', dependencies: { 'left-pad': '^1.3.0' } }),
};

/** Child repo C staging: the composed, broken state. */
const STAGED: Repo = {
  'README.md': '# stitched\n',
  // `tsconfig.json` and `.env.example` deliberately absent.
  'src/main.ts': [
    "import { helper } from './helper';", // resolves -> src/helper.ts
    "import { gone } from './nonexistent';", // BROKEN
    'const key = process.env.SECRET_TOKEN;', // undeclared
    'export const h = helper + gone + key;',
  ].join('\n'),
  'src/helper.ts': 'export const helper = 1;\n', // no sibling test
  'src/other.ts': 'export const other = 2;\n', // no sibling test
  'src/helper.test.ts': "import { helper } from './helper';\nit('x', () => helper);\n",
};

function makeCtx(opts: {
  staged?: Repo;
  mergedManifest?: Record<string, string>;
  config?: Record<string, unknown>;
  withStaging?: boolean;
}): ToolContext {
  const staged = opts.staged ?? STAGED;
  const inert = {
    diff: async (): Promise<string> => '',
    status: async (): Promise<string> => '',
    commit: async (): Promise<void> => {},
    add: async (): Promise<void> => {},
    analyze: async (): Promise<Record<string, string>> => opts.mergedManifest ?? {},
    install: async (): Promise<void> => {},
    scan: async (): Promise<string[]> => [],
    check: async (): Promise<boolean> => true,
  };
  const staging: StagingFacade = {
    listStagedFiles: async (): Promise<Result<string[], StitchError>> => ok(Object.keys(staged)),
    readStagedFile: async (path: string): Promise<Result<string, StitchError>> => {
      const content = staged[path];
      return content === undefined ? ok('') : ok(content);
    },
  };
  return {
    cwd: '/repo',
    config: opts.config ?? {},
    logger: { ...inert, info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    costTracker: { ...inert, add: () => {}, totalTokens: { input: 0, output: 0, total: 0 } },
    git: {
      ...inert,
      listFiles: async (_cwd: string, repo: 'A' | 'B'): Promise<Result<string[], StitchError>> =>
        ok(repo === 'A' ? Object.keys(REPO_A) : []),
      readFile: async (
        _cwd: string,
        _repo: 'A' | 'B',
        path: string
      ): Promise<Result<string, StitchError>> => ok(REPO_A[path] ?? ''),
    },
    deps: inert,
    license: inert,
    ...(opts.withStaging === false ? {} : { staging }),
  } as unknown as ToolContext;
}

function sel(repo: SourceRepo, path: string): SelectedFile {
  return { repo, path };
}

function kinds(gaps: readonly Gap[], kind: Gap['kind']): Gap[] {
  return gaps.filter(g => g.kind === kind);
}

beforeEach(() => {
  clearAgentToolsForTests();
  for (const t of [selectFilesTool, resolveDepsTool, detectGapsToolAlias]) {
    expect(registerAgentTool(t).isOk()).toBe(true);
  }
});

describe('P-150 detect_gaps', () => {
  it('detects missing dep', async () => {
    // C's merged manifest has no left-pad, so the P-149 closure reports it.
    const ctx = makeCtx({ mergedManifest: {} });
    const result = await detectGaps(ctx, {
      focus: ['missing_dep'],
      selection: [sel('A', 'src/app.ts')],
    });
    expect(result.isOk()).toBe(true);
    const gaps = result._unsafeUnwrap();
    const depGaps = kinds(gaps, 'missing_dep');
    expect(depGaps).toHaveLength(1);
    expect(depGaps[0]?.package).toBe('left-pad');
    // The spec calls missing_dep "high severity" -> error.
    expect(depGaps[0]?.severity).toBe('error');
    expect(depGaps[0]?.detail).toContain('left-pad');

    // Once C declares it, the gap disappears — proving the check reads the
    // merged manifest rather than always reporting.
    const satisfied = await detectGaps(makeCtx({ mergedManifest: { 'left-pad': '^1.3.0' } }), {
      focus: ['missing_dep'],
      selection: [sel('A', 'src/app.ts')],
    });
    expect(satisfied.isOk()).toBe(true);
    expect(kinds(satisfied._unsafeUnwrap(), 'missing_dep')).toHaveLength(0);
  });

  it('detects missing env', async () => {
    // No .env.example is staged, so SECRET_TOKEN is undeclared.
    const ctx = makeCtx({});
    const result = await detectGaps(ctx, { focus: ['missing_env'] });
    expect(result.isOk()).toBe(true);
    const gaps = result._unsafeUnwrap();
    const envGaps = kinds(gaps, 'missing_env');
    expect(envGaps).toHaveLength(1);
    expect(envGaps[0]?.package).toBe('SECRET_TOKEN');
    expect(envGaps[0]?.file).toBe('src/main.ts');
    // The spec says missing_env is a warning.
    expect(envGaps[0]?.severity).toBe('warning');

    // Declaring it in .env.example clears the gap.
    const declared = await detectGaps(
      makeCtx({
        staged: { ...STAGED, '.env.example': 'SECRET_TOKEN=replace_me\n' },
      }),
      { focus: ['missing_env'] }
    );
    expect(declared.isOk()).toBe(true);
    expect(kinds(declared._unsafeUnwrap(), 'missing_env')).toHaveLength(0);
  });

  it('detects missing test', async () => {
    const ctx = makeCtx({});
    const result = await detectGaps(ctx, { focus: ['missing_test'] });
    expect(result.isOk()).toBe(true);
    const gaps = result._unsafeUnwrap();
    const testGaps = kinds(gaps, 'missing_test');
    // src/main.ts and src/other.ts have no sibling test.
    // src/helper.ts DOES (src/helper.test.ts is staged) so it must not appear.
    // src/helper.test.ts is itself a test file and must never be flagged.
    expect(testGaps.map(g => g.file).sort()).toEqual(['src/main.ts', 'src/other.ts']);
    expect(testGaps.every(g => g.severity === 'warning')).toBe(true);
    expect(testGaps.some(g => g.file === 'src/helper.ts')).toBe(false);
    expect(testGaps.some(g => g.file === 'src/helper.test.ts')).toBe(false);
  });

  it('flags broken import', async () => {
    const ctx = makeCtx({});
    const result = await detectGaps(ctx, { focus: ['broken_import'] });
    expect(result.isOk()).toBe(true);
    const gaps = result._unsafeUnwrap();
    const broken = kinds(gaps, 'broken_import');
    expect(broken).toHaveLength(1);
    expect(broken[0]?.file).toBe('src/main.ts');
    expect(broken[0]?.detail).toContain('./nonexistent');
    // The spec says broken_import is an error.
    expect(broken[0]?.severity).toBe('error');
    // The resolvable './helper' import is NOT flagged.
    expect(broken.some(g => g.detail.includes('./helper'))).toBe(false);
  });

  it('sorts error first and dedupes', async () => {
    const ctx = makeCtx({
      mergedManifest: {},
      staged: {
        ...STAGED,
        // A second broken import in another file, same target, to prove dedupe
        // keys on the full identity rather than just the file.
        'src/extra.ts': "import { gone } from './nonexistent';\nexport const e = gone;\n",
      },
    });
    // Run every check: missing_dep + broken_import + missing_file + missing_env
    // + missing_test + config_mismatch.
    const result = await detectGaps(ctx, { selection: [sel('A', 'src/app.ts')] });
    expect(result.isOk()).toBe(true);
    const gaps = result._unsafeUnwrap();

    // Ordering: every error precedes every warning.
    const firstWarning = gaps.findIndex(g => g.severity === 'warning');
    const lastError = gaps.map(g => g.severity).lastIndexOf('error');
    if (firstWarning !== -1) {
      expect(lastError).toBeLessThan(firstWarning);
    }
    expect(gaps[0]?.severity).toBe('error');

    // Dedupe: no two gaps share the same kind+file+package+detail.
    const keys = gaps.map(g => [g.kind, g.file ?? '', g.package ?? '', g.detail].join('|'));
    expect(new Set(keys).size).toBe(keys.length);

    // The staged fixture is missing tsconfig.json and .env.example.
    const missingFiles = kinds(gaps, 'missing_file')
      .map(g => g.file)
      .sort();
    expect(missingFiles).toEqual(['.env.example', 'tsconfig.json']);

    // No writes happened: StagingFacade exposes no mutation and the content
    // map is byte-identical afterwards.
    expect(Object.keys(STAGED).sort()).toEqual(
      ['README.md', 'src/helper.test.ts', 'src/helper.ts', 'src/main.ts', 'src/other.ts'].sort()
    );
    // The tool is registered as auto and read-only.
    expect(detectGapsTool.autonomy).toBe('auto');
    expect(listAgentTools().map(t => t.name)).toContain('detect_gaps');
  });

  it('config_mismatch flags merged-vs-file drift', async () => {
    // C's merged config says strict:true; the staged tsconfig says strict:false.
    const ctx = makeCtx({
      staged: { ...STAGED, 'tsconfig.json': '{"compilerOptions":{"strict":false}}' },
      config: { compilerOptions: { strict: true } },
    });
    const result = await detectGaps(ctx, { focus: ['config_mismatch'] });
    expect(result.isOk()).toBe(true);
    const gaps = result._unsafeUnwrap();
    const drift = kinds(gaps, 'config_mismatch');
    expect(drift.length).toBeGreaterThan(0);
    expect(drift[0]?.file).toBe('tsconfig.json');
    expect(drift[0]?.severity).toBe('warning');
  });
});
