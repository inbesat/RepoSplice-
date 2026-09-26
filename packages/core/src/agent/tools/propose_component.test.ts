// P-154 tests: agent tool `propose_component` (gated).
//
// The central property under test is NEGATIVE: drafting a proposal must write
// nothing. Every test therefore asserts on the write journal, not just on the
// returned proposal.

import { describe, it, expect, beforeEach } from 'vitest';
import { ok, err, type Result } from 'neverthrow';
import {
  draftComponent,
  applyProposal,
  proposeComponentTool,
  normalizeComponentName,
  sourceExtension,
  siblingTestPath,
  scaffoldCode,
  scaffoldTests,
  appendSnippet,
} from './propose_component.js';
import {
  selectFilesTool,
  resolveDepsTool,
  detectGapsTool,
  fixDependencyTool,
  editConfigTool,
  moveFileTool,
  proposeComponentTool as proposeAlias,
  registerAgentTool,
  clearAgentToolsForTests,
  listAgentTools,
} from './index.js';
import type { ComponentSpec } from '../index.js';
import type { StagingFacade, ToolContext } from '../../ai/types.js';
import { stitchErrorMessage, type StitchError } from '../../result/index.js';

function makeCtx(opts: { staged?: Record<string, string> } = {}): {
  ctx: ToolContext;
  files: Record<string, string>;
  writes: string[];
} {
  const files: Record<string, string> = { ...(opts.staged ?? {}) };
  const writes: string[] = [];
  const inert = {
    diff: async (): Promise<string> => '',
    status: async (): Promise<string> => '',
    commit: async (): Promise<void> => {},
    add: async (): Promise<void> => {},
    analyze: async (): Promise<Record<string, string>> => ({}),
    install: async (): Promise<void> => {},
    scan: async (): Promise<string[]> => [],
    check: async (): Promise<boolean> => true,
  };
  const staging: StagingFacade = {
    listStagedFiles: async (): Promise<Result<string[], StitchError>> => ok(Object.keys(files)),
    readStagedFile: async (path: string): Promise<Result<string, StitchError>> => {
      const content = files[path];
      return content === undefined
        ? err({ code: 'FILE_NOT_FOUND', path, message: `no staged file ${path}` })
        : ok(content);
    },
  };
  const ctx = {
    cwd: '/repo',
    config: { stageRoot: 'C' },
    logger: { ...inert, info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    costTracker: { ...inert, add: () => {}, totalTokens: { input: 0, output: 0, total: 0 } },
    git: {
      ...inert,
      readStagedFile: staging.readStagedFile,
      writeFile: async (
        _cwd: string,
        _repo: 'A' | 'B',
        path: string,
        content: string
      ): Promise<Result<void, StitchError>> => {
        writes.push(path);
        files[path] = content;
        return ok(undefined);
      },
    },
    deps: inert,
    license: inert,
    staging,
  } as unknown as ToolContext;
  return { ctx, files, writes };
}

const REACT_SPEC: ComponentSpec = {
  name: 'UserCard',
  language: 'typescript',
  framework: 'react',
  purpose: 'Render a user summary card.',
  targetDir: 'C/src/components',
};

const MODULE_SPEC: ComponentSpec = {
  name: 'formatDate',
  language: 'typescript',
  framework: 'none',
  purpose: 'Format an ISO date for display.',
  targetDir: 'C/src/lib',
};

beforeEach(() => {
  clearAgentToolsForTests();
  for (const t of [
    selectFilesTool,
    resolveDepsTool,
    detectGapsTool,
    fixDependencyTool,
    editConfigTool,
    moveFileTool,
    proposeAlias,
  ]) {
    expect(registerAgentTool(t).isOk()).toBe(true);
  }
});

describe('P-154 propose_component', () => {
  it('drafts proposal without writing', async () => {
    const { ctx, files, writes } = makeCtx();
    const before = JSON.stringify(files);

    const result = await draftComponent(REACT_SPEC, ctx);
    expect(result.isOk()).toBe(true);
    const proposal = result._unsafeUnwrap();

    // Code, tests, and test path are all present.
    expect(proposal.name).toBe('UserCard');
    expect(proposal.path).toBe('src/components/UserCard.tsx');
    expect(proposal.testPath).toBe('src/components/UserCard.test.tsx');
    expect(proposal.code).toContain('export function UserCard');
    expect(proposal.tests).toContain("from 'vitest'");
    expect(proposal.tests).toContain("import { UserCard } from './UserCard';");

    // TECH_STACK §7: single quotes, not double, in the generated source.
    expect(proposal.code).toContain('className="flex');
    expect(proposal.tests).not.toContain('"');

    // THE POINT: nothing was written.
    expect(writes).toEqual([]);
    expect(JSON.stringify(files)).toBe(before);
    expect(files['src/components/UserCard.tsx']).toBeUndefined();

    // The tool's own execute path is equally write-free.
    const viaTool = await proposeComponentTool.execute(
      { ...REACT_SPEC, targetDir: 'C/src/components' },
      ctx
    );
    expect(viaTool.isOk()).toBe(true);
    expect(writes).toEqual([]);
    expect(JSON.stringify(files)).toBe(before);
  });

  it('marks gated autonomy', () => {
    // This is the first gated tool in the epic and the HIL anchor for P-157.
    expect(proposeComponentTool.autonomy).toBe('gated');
    expect(proposeComponentTool.name).toBe('propose_component');
    // Every other tool in the registry must remain auto.
    const gated = listAgentTools()
      .filter(t => t.autonomy === 'gated')
      .map(t => t.name);
    expect(gated).toEqual(['propose_component']);
  });

  it('applyProposal writes files', async () => {
    // A barrel exists in the target dir, so registration is generated.
    const { ctx, files, writes } = makeCtx({
      staged: { 'src/components/index.ts': "export { Existing } from './Existing';\n" },
    });
    const draft = await draftComponent(REACT_SPEC, ctx);
    expect(draft.isOk()).toBe(true);
    const proposal = draft._unsafeUnwrap();
    expect(proposal.registration?.file).toBe('src/components/index.ts');

    // Still nothing written before approval.
    expect(writes).toEqual([]);

    const applied = await applyProposal(proposal, ctx);
    expect(applied.isOk()).toBe(true);
    expect(applied._unsafeUnwrap().written).toEqual([
      'src/components/UserCard.tsx',
      'src/components/UserCard.test.tsx',
      'src/components/index.ts',
    ]);

    // The component and its sibling test landed.
    expect(files['src/components/UserCard.tsx']).toContain('export function UserCard');
    expect(files['src/components/UserCard.test.tsx']).toContain("describe('UserCard'");
    // The barrel kept its prior content and gained the export.
    expect(files['src/components/index.ts']).toContain("export { Existing } from './Existing';");
    expect(files['src/components/index.ts']).toContain("export { UserCard } from './UserCard';");

    // A late approval cannot clobber a file created since the draft.
    const stale = await applyProposal(proposal, ctx);
    expect(stale.isErr()).toBe(true);
    expect(stale._unsafeUnwrapErr().code).toBe('CONFIG_ERROR');
  });

  it('rejects collision path', async () => {
    const { ctx, writes } = makeCtx({
      staged: { 'src/components/UserCard.tsx': '// already here\n' },
    });
    const collision = await draftComponent(REACT_SPEC, ctx);
    expect(collision.isErr()).toBe(true);
    const error = collision._unsafeUnwrapErr();
    expect(error.code).toBe('CONFIG_ERROR');
    expect(stitchErrorMessage(error)).toContain('already exists');
    expect(writes).toEqual([]);

    // A colliding sibling test is refused too.
    const testCollision = await draftComponent(
      REACT_SPEC,
      makeCtx({
        staged: { 'src/components/UserCard.test.tsx': '// already here\n' },
      }).ctx
    );
    expect(testCollision.isErr()).toBe(true);
    expect(stitchErrorMessage(testCollision._unsafeUnwrapErr())).toContain('sibling test');

    // Path traversal out of the stage root is refused.
    for (const targetDir of ['C/../outside', '../outside', 'C/../../etc']) {
      const escaped = await draftComponent({ ...MODULE_SPEC, targetDir }, ctx);
      expect(escaped.isErr()).toBe(true);
      expect(escaped._unsafeUnwrapErr().code).toBe('CONFIG_ERROR');
    }
    expect(writes).toEqual([]);

    // An empty name is refused.
    const nameless = await draftComponent({ ...MODULE_SPEC, name: '  ' }, ctx);
    expect(nameless.isErr()).toBe(true);
  });

  it('includes rationale', async () => {
    const { ctx } = makeCtx();
    const result = await draftComponent(MODULE_SPEC, ctx);
    expect(result.isOk()).toBe(true);
    const proposal = result._unsafeUnwrap();

    // Both fields the approval UI renders are populated and meaningful.
    expect(proposal.summary).toBe(MODULE_SPEC.purpose);
    expect(proposal.summary.length).toBeGreaterThan(0);
    expect(proposal.rationale).toContain('formatDate');
    expect(proposal.rationale).toContain(MODULE_SPEC.purpose);
    // The rationale states why this is gated, so an approver understands.
    expect(proposal.rationale).toContain('human approval');
  });
});

describe('P-154 component scaffolds', () => {
  it('derives extensions and sibling test paths', () => {
    expect(sourceExtension({ ...MODULE_SPEC })).toBe('.ts');
    expect(sourceExtension({ ...MODULE_SPEC, framework: 'react' })).toBe('.tsx');
    expect(sourceExtension({ ...MODULE_SPEC, language: 'python', framework: 'none' })).toBe('.py');
    expect(siblingTestPath('src/a.ts')).toBe('src/a.test.ts');
    expect(siblingTestPath('src/a.tsx')).toBe('src/a.test.tsx');
    expect(siblingTestPath('src/a.js')).toBe('src/a.test.js');
  });

  it('normalizes names by framework', () => {
    expect(normalizeComponentName('userCard', 'react')).toBe('UserCard');
    expect(normalizeComponentName('UserCard', 'react')).toBe('UserCard');
    expect(normalizeComponentName('userCard', 'none')).toBe('userCard');
  });

  it('scaffolds code that matches TECH_STACK style', () => {
    const code = scaffoldCode(MODULE_SPEC, 'formatDate');
    // Named export, JSDoc, explicit return type, single quotes.
    expect(code).toContain('export function formatDate');
    expect(code).toContain('/**');
    expect(code).toContain('export interface FormatDateInput');
    // No double-quoted strings in generated source.
    expect(code).not.toContain('"');
    // Python scaffold uses docstrings, not comments.
    const py = scaffoldCode(
      { ...MODULE_SPEC, language: 'python', framework: 'none' },
      'format_date'
    );
    expect(py).toContain('def run(value: str) -> str:');
  });

  it('scaffolds Vitest tests, never Jest', () => {
    const tests = scaffoldTests(MODULE_SPEC, 'formatDate');
    expect(tests).toContain("from 'vitest'");
    expect(tests).not.toContain('jest');
    expect(tests).toContain("describe('formatDate'");
  });

  it('appends registration without clobbering', () => {
    expect(appendSnippet('', 'export { A };\n')).toBe('export { A };\n');
    expect(appendSnippet('export { B };\n', 'export { A };\n')).toBe(
      'export { B };\nexport { A };\n'
    );
  });
});
