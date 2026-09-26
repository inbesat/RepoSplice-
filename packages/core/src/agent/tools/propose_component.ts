// P-154 — agent tool `propose_component` (gated).
//
// The FIRST `gated` tool of the epic, and the primary human-in-the-loop
// demonstration. Generating a net-new module is a high-impact, non-mechanical
// act, so it is drafted and RETURNED — never written — until a human approves.
//
// THE INVARIANT THIS TOOL EXISTS TO PROTECT
// `execute` writes nothing, ever. It crafts a `ComponentProposal` and hands it
// back. The P-140 loop sees `autonomy: 'gated'` and routes it through the HIL
// gate (P-157/P-160) instead of applying it. Only an explicit
// `applyProposal` call — post-approval — touches the filesystem. That split is
// what makes the approval meaningful rather than decorative.
//
// SCAFFOLD STYLE (P-154 handoff: must follow CODE_STYLE/TECH_STACK so approved
// code passes the P-204 build as-is): single quotes, 2-space indent, trailing
// commas, explicit JSDoc, `export function` over default exports, and Vitest
// (never Jest) for the sibling spec — matching TECH_STACK §7 and §11.

import { z } from 'zod';
import { ok, err, type Result } from 'neverthrow';
import type { StitchError } from '../../result/index.js';
import type { ToolDefinition, ToolContext } from '../../ai/types.js';
import { assertWithinRoot } from './edit_config.js';
import type { ComponentProposal, ComponentSpec } from '../types.js';

/** Barrel files a new component may need to register itself in. */
const BARREL_CANDIDATES = ['index.ts', 'index.tsx'] as const;

/** React components are PascalCase; plain modules are camelCase. */
export function normalizeComponentName(
  name: string,
  framework: ComponentSpec['framework']
): string {
  const trimmed = name.trim();
  if (framework === 'react') {
    // Preserve an already-PascalCase name; otherwise capitalize the first letter.
    if (/^[A-Z]/.test(trimmed)) return trimmed;
    return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  }
  return trimmed;
}

/** The source extension a spec implies. */
export function sourceExtension(spec: ComponentSpec): string {
  if (spec.language === 'python') return '.py';
  return spec.framework === 'react' ? '.tsx' : '.ts';
}

/** The sibling test path for a component path, matching P-152's convention. */
export function siblingTestPath(path: string): string {
  const ext = path.slice(path.lastIndexOf('.'));
  if (ext === '.tsx') return `${path.slice(0, -ext.length)}.test.tsx`;
  if (ext === '.ts') return `${path.slice(0, -ext.length)}.test.ts`;
  if (ext === '.js') return `${path.slice(0, -ext.length)}.test.js`;
  return `${path}.test`;
}

/** Draft the component source for the requested language/framework. */
export function scaffoldCode(spec: ComponentSpec, name: string): string {
  const { purpose, framework, language } = spec;
  const py = language === 'python';
  const js = language === 'javascript';

  if (py) {
    return [
      `"""${purpose}"""`,
      '',
      'def run(value: str) -> str:',
      '    """Entry point for the generated component.',
      '',
      '    Args:',
      '        value: Input to transform.',
      '',
      '    Returns:',
      '        The transformed value.',
      '    """',
      '    return value',
      '',
    ].join('\n');
  }

  if (framework === 'react') {
    return [
      '/**',
      ` * ${purpose}`,
      ' */',
      '',
      `export interface ${name}Props {`,
      '  /** Optional heading rendered above the content. */',
      '  title?: string;',
      '  children?: React.ReactNode;',
      '}',
      '',
      '/**',
      ` * ${name}`,
      ' */',
      `export function ${name}({ title, children }: ${name}Props) {`,
      '  return (',
      '    <section className="flex flex-col gap-2">',
      '      {title === undefined ? null : <h2 className="text-lg font-semibold">{title}</h2>}',
      '      {children}',
      '    </section>',
      '  );',
      '}',
      '',
      js ? '' : `export default ${name};\n`,
    ]
      .filter(line => line !== '')
      .join('\n');
  }

  return [
    '/**',
    ` * ${purpose}`,
    ' */',
    '',
    `export interface ${name.charAt(0).toUpperCase()}${name.slice(1)}Input {`,
    '  /** Value to transform. */',
    '  value: string;',
    '}',
    '',
    '/**',
    ` * Entry point for the generated component.`,
    ' *',
    ' * @param input - The input to transform.',
    ' * @returns The transformed value.',
    ' */',
    `export function ${name}(input: ${name.charAt(0).toUpperCase()}${name.slice(1)}Input): string {`,
    '  return input.value;',
    '}',
    '',
    js ? '' : `export default ${name};\n`,
  ]
    .filter(line => line !== '')
    .join('\n');
}

/** Draft the sibling test. Vitest only — TECH_STACK §11 forbids Jest. */
export function scaffoldTests(spec: ComponentSpec, name: string): string {
  if (spec.language === 'python') {
    return [
      '"""Tests for the generated component."""',
      '',
      'import pytest',
      '',
      'from run import run',
      '',
      'def test_run_returns_input():',
      '    assert run("x") == "x"',
      '',
    ].join('\n');
  }

  if (spec.framework === 'react') {
    return [
      "import { describe, expect, it } from 'vitest';",
      '',
      `import { ${name} } from './${name}';`,
      '',
      `describe('${name}', () => {`,
      `  it('is a function', () => {`,
      `    expect(typeof ${name}).toBe('function');`,
      '  });',
      '});',
      '',
    ].join('\n');
  }

  return [
    "import { describe, expect, it } from 'vitest';",
    '',
    `import { ${name} } from './${name}';`,
    '',
    `describe('${name}', () => {`,
    `  it('returns the input value', () => {`,
    `    expect(${name}({ value: 'stitch' })).toBe('stitch');`,
    '  });',
    '});',
    '',
  ].join('\n');
}

/**
 * The barrel export snippet for a component.
 *
 * Relative to the barrel, so the same snippet works whether the barrel is at
 * the repo root or nested beside the component.
 */
export function registrationSnippet(name: string): string {
  return `export { ${name} } from './${name}';\n`;
}

/** List staged paths, or an empty list when staging is unavailable. */
async function listStaged(ctx: ToolContext): Promise<ReadonlySet<string> | undefined> {
  const staging = ctx.staging;
  if (staging === undefined) return undefined;
  const listed = await staging.listStagedFiles();
  if (listed.isErr()) return undefined;
  return new Set(listed.value.map(p => p.replace(/\\/g, '/').replace(/^\.\//, '')));
}

/**
 * Draft a component proposal. **Writes nothing.**
 *
 * Validates that the target path resolves inside the stage root and does not
 * collide with an existing staged file, then builds code, a sibling test, and a
 * barrel registration snippet when the target directory already has one.
 */
export async function draftComponent(
  spec: ComponentSpec,
  ctx: ToolContext
): Promise<Result<ComponentProposal, StitchError>> {
  const stageRoot = String(ctx.config['stageRoot'] ?? 'C');
  const name = normalizeComponentName(spec.name, spec.framework);
  if (name === '') {
    return err({
      code: 'CONFIG_ERROR',
      field: 'name',
      message: 'Component name must not be empty',
    });
  }

  const joined = `${spec.targetDir.replace(/\/+$/, '')}/${name}${sourceExtension(spec)}`;
  const contained = assertWithinRoot(joined, stageRoot);
  if (contained.isErr()) return err(contained.error);
  const path = contained.value;

  const testPath = siblingTestPath(path);
  const staged = await listStaged(ctx);
  if (staged !== undefined) {
    if (staged.has(path)) {
      return err({
        code: 'CONFIG_ERROR',
        field: 'name',
        message: `Refusing to propose "${name}": "${path}" already exists in the staged repo`,
      });
    }
    if (staged.has(testPath)) {
      return err({
        code: 'CONFIG_ERROR',
        field: 'name',
        message: `Refusing to propose "${name}": sibling test "${testPath}" already exists`,
      });
    }
  }

  // A barrel in the same directory is the natural registration point.
  const dir = path.slice(0, path.lastIndexOf('/'));
  let registration: { file: string; snippet: string } | undefined;
  for (const candidate of BARREL_CANDIDATES) {
    const barrel = dir === '' ? candidate : `${dir}/${candidate}`;
    if (staged?.has(barrel) === true) {
      registration = { file: barrel, snippet: registrationSnippet(name) };
      break;
    }
  }

  const proposal: ComponentProposal = {
    name,
    path,
    summary: spec.purpose,
    code: scaffoldCode(spec, name),
    tests: scaffoldTests(spec, name),
    ...(registration !== undefined ? { registration } : {}),
    rationale:
      `${name} is needed because ${spec.purpose} It is a net-new module, so it is ` +
      'proposed for human approval rather than written automatically.',
    testPath,
  };
  return ok(proposal);
}

/**
 * Containment check for a path that is ALREADY repo-relative.
 *
 * `ComponentProposal.path` is repo-relative (ADR-023: the staging facade speaks
 * repo-relative paths), so it no longer carries the `C/` stage-root prefix.
 * Re-running `assertWithinRoot` on it would demand that prefix and reject every
 * legitimate proposal. This check answers the question that actually matters for
 * an already-relative path: can it escape the stage?
 */
function assertRelativeInside(path: string): Result<string, StitchError> {
  const out: string[] = [];
  for (const segment of path.replace(/\\/g, '/').split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (out.length === 0) {
        return err({
          code: 'CONFIG_ERROR',
          field: 'path',
          message: `Refusing to apply "${path}": resolves outside the stage root`,
        });
      }
      out.pop();
      continue;
    }
    out.push(segment);
  }
  if (out.length === 0) {
    return err({
      code: 'CONFIG_ERROR',
      field: 'path',
      message: `Refusing to apply "${path}": resolves to the stage root itself`,
    });
  }
  return ok(out.join('/'));
}

/**
 * Write an APPROVED proposal to the staged repo.
 *
 * Re-validates containment and non-collision at apply time, not just at draft
 * time. An approval queue means the world moves between the two: without this
 * check an approval granted minutes ago would silently clobber a file created
 * since the draft.
 *
 * P-161 owns cross-tool reversion; this applies forward only.
 */
export async function applyProposal(
  proposal: ComponentProposal,
  ctx: ToolContext
): Promise<Result<{ written: string[] }, StitchError>> {
  // The registration file is excluded from the collision check on purpose: it
  // is an APPEND target, and a barrel only exists if there is already a barrel.
  // Requiring it to be absent would make registration impossible by definition.
  const createPaths = [proposal.path, proposal.testPath];
  const allPaths = [...createPaths];
  if (proposal.registration !== undefined) allPaths.push(proposal.registration.file);

  for (const candidate of allPaths) {
    const contained = assertRelativeInside(candidate);
    if (contained.isErr()) return err(contained.error);
  }

  const staged = await listStaged(ctx);
  if (staged !== undefined) {
    for (const candidate of createPaths) {
      if (!staged.has(candidate)) continue;
      return err({
        code: 'CONFIG_ERROR',
        field: 'path',
        message: `Cannot apply proposal: "${candidate}" now exists in the staged repo`,
      });
    }
  }

  if (ctx.git.writeFile === undefined) {
    return err({
      code: 'CONFIG_ERROR',
      field: 'git.writeFile',
      message: 'applyProposal requires GitFacade.writeFile to persist an approved component',
    });
  }

  const written: string[] = [];
  const body =
    proposal.registration === undefined
      ? ([
          [proposal.path, proposal.code],
          [proposal.testPath, proposal.tests],
        ] as const)
      : ([
          [proposal.path, proposal.code],
          [proposal.testPath, proposal.tests],
          [
            proposal.registration.file,
            appendSnippet(
              await readOrEmpty(ctx, proposal.registration.file),
              proposal.registration.snippet
            ),
          ],
        ] as const);

  for (const [path, content] of body) {
    const result = await ctx.git.writeFile(ctx.cwd, 'A', path, content);
    if (result.isErr()) return err(result.error);
    written.push(path);
  }
  return ok({ written });
}

/** Read a file for append-style registration, defaulting to empty. */
async function readOrEmpty(ctx: ToolContext, path: string): Promise<string> {
  const git = ctx.git;
  const read =
    git.readStagedFile !== undefined
      ? await git.readStagedFile(path)
      : git.readFile !== undefined
        ? await git.readFile(ctx.cwd, 'A', path)
        : undefined;
  return read !== undefined && read.isOk() ? read.value : '';
}

/** Append a registration line to a barrel, preserving what is already there. */
export function appendSnippet(existing: string, snippet: string): string {
  if (existing === '') return snippet;
  return `${existing.replace(/\n+$/, '')}\n${snippet}`;
}

/** Tool schema. Mirrors `ComponentSpec`. */
export const proposeComponentSchema = {
  name: z.string().min(1),
  language: z.enum(['typescript', 'javascript', 'python']).default('typescript'),
  framework: z.enum(['none', 'react']).default('none'),
  purpose: z.string().min(1),
  targetDir: z.string().min(1),
} satisfies Record<string, z.ZodTypeAny>;

const proposeComponentObject = z.object(proposeComponentSchema);

/** `propose_component` — `autonomy: 'gated'`. Drafts, never writes. */
export const proposeComponentTool: ToolDefinition = {
  name: 'propose_component',
  description:
    'Draft a net-new component (code, sibling test, registration) for human approval. Returns a proposal without writing any files.',
  schema: proposeComponentSchema,
  autonomy: 'gated',
  execute: async (args: unknown, ctx: ToolContext): Promise<Result<unknown, StitchError>> => {
    const parsed = proposeComponentObject.safeParse(args);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map(i => `${i.path.length > 0 ? '/' + i.path.join('/') : '(root)'}: ${i.message}`)
        .join('; ');
      return err({
        code: 'TOOL_ARGS_VALIDATION',
        message: `propose_component arguments validation failed: ${issues}`,
      });
    }
    return draftComponent(parsed.data, ctx);
  },
};
