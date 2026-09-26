// P-153 — agent tool `move_file`.
//
// Relocates a staged file inside child repo C and repairs the relative imports
// that pointed at it, so a layout change does not silently break every
// dependent module.
//
// SAFETY MODEL
// - PLAN / EXECUTE SPLIT. `planMove` runs every check and computes every
//   rewrite without writing anything. A dry run is therefore the same code
//   path as a real plan, not a parallel implementation that can drift from it.
// - CONSERVATIVE REWRITES. P-153's handoff is explicit: "only rewrite known
//   relative refs, never substring-match unrelated text". Rewrites are anchored
//   to real import/export/require syntax and the exact old specifier, so the
//   string `"./util"` appearing in prose, a comment, or an unrelated literal
//   is never touched.
// - ATOMICITY. `executeMove` captures the prior content of every file it will
//   touch before touching anything, and any failure restores all of it and
//   moves the file back. A partially-rewritten tree is never observable.

import { z } from 'zod';
import { ok, err, type Result } from 'neverthrow';
import { stitchErrorMessage, type StitchError } from '../../result/index.js';
import type { ToolDefinition, ToolContext } from '../../ai/types.js';
import { classifyJsSpecifier, parseJsImports, resolveRelativeImport } from '../imports.js';
import { assertWithinRoot } from './edit_config.js';
import type { ImportRewrite, MovePlan } from '../types.js';

/** Extensions whose relative imports are repaired by a move. */
const JS_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']);

function extensionOf(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot === -1 ? '' : base.slice(dot);
}

function dirOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? '' : path.slice(0, i);
}

/** Read one staged file. */
async function readStaged(ctx: ToolContext, path: string): Promise<Result<string, StitchError>> {
  const git = ctx.git;
  if (git.readStagedFile !== undefined) return git.readStagedFile(path);
  if (git.readFile !== undefined) return git.readFile(ctx.cwd, 'A', path);
  return err({
    code: 'CONFIG_ERROR',
    field: 'git.readStagedFile',
    message: 'move_file requires GitFacade.readStagedFile (or readFile) to inspect importers',
  });
}

/** Write one staged file. */
async function writeStaged(
  ctx: ToolContext,
  path: string,
  content: string
): Promise<Result<void, StitchError>> {
  const git = ctx.git;
  if (git.writeFile === undefined) {
    return err({
      code: 'CONFIG_ERROR',
      field: 'git.writeFile',
      message: 'move_file requires GitFacade.writeFile to apply import rewrites',
    });
  }
  return git.writeFile(ctx.cwd, 'A', path, content);
}

/** Relocate a staged file. */
async function moveStaged(
  ctx: ToolContext,
  from: string,
  to: string
): Promise<Result<void, StitchError>> {
  const git = ctx.git;
  if (git.move === undefined) {
    return err({
      code: 'CONFIG_ERROR',
      field: 'git.move',
      message: 'move_file requires GitFacade.move to relocate a staged file',
    });
  }
  return git.move(ctx.cwd, 'A', from, to);
}

/** List the staged files, or the caller-supplied set when given one. */
async function stagedListing(
  ctx: ToolContext,
  stagedFiles: readonly string[] | undefined
): Promise<Result<string[], StitchError>> {
  if (stagedFiles !== undefined) return ok([...stagedFiles]);
  const staging = ctx.staging;
  if (staging === undefined) {
    return err({
      code: 'CONFIG_ERROR',
      field: 'staging',
      message: 'move_file requires a staged file listing (pass one or provide ToolContext.staging)',
    });
  }
  return staging.listStagedFiles();
}

/**
 * Build the new relative specifier for `target` as seen from `importer`.
 *
 * Preserves the author's extension style: an extensionless old ref stays
 * extensionless, an explicit extension is kept, and an `/index` suffix is
 * preserved. The result always starts with `./` or `../` so it stays a relative
 * import rather than silently becoming a bare package specifier.
 */
export function rewriteSpecifier(importer: string, target: string, oldRef: string): string {
  const fromDir = dirOf(importer);
  const targetSegments = target.split('/');
  const fromSegments = fromDir === '' ? [] : fromDir.split('/');

  // Longest common prefix, then `..` for each remaining `from` segment.
  let common = 0;
  while (
    common < fromSegments.length &&
    common < targetSegments.length - 1 &&
    fromSegments[common] === targetSegments[common]
  ) {
    common += 1;
  }
  const up = fromSegments.length - common;
  const down = targetSegments.slice(common);
  let spec = [...Array.from({ length: up }, () => '..'), ...down].join('/');
  if (spec === '') spec = '.';

  // Match the old ref's style rather than forcing one.
  const oldExt = extensionOf(oldRef);
  if (oldExt !== '') {
    // The author wrote an explicit extension, so keep THAT extension rather
    // than the target's. `./util.js` in a TypeScript source is a real and
    // common convention (NodeNext resolution), and silently rewriting it to
    // `./shared/util.ts` would change the author's intent.
    spec = `${spec.replace(/\.[^./]+$/, '')}${oldExt}`;
  } else {
    spec = spec.replace(/\.[^./]+$/, '');
  }
  if (/\/index$/.test(oldRef) && !/\/index$/.test(spec)) {
    spec = `${spec.replace(/\/index$/, '')}/index`;
  }
  if (!spec.startsWith('.')) spec = `./${spec}`;
  return spec;
}

/**
 * Rewrite only import-syntax occurrences of the given specifiers.
 *
 * Each replacement is applied through a regex anchored to real import/export/
 * require syntax, so a bare mention of the same text elsewhere is never
 * replaced. Quotes are matched so both `'./x'` and `"./x"` are handled.
 */
export function rewriteImportRefs(
  content: string,
  replacements: ReadonlyMap<string, string>
): string {
  let out = content;
  for (const [oldRef, newRef] of replacements) {
    if (oldRef === newRef) continue;
    const escaped = oldRef.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Only matches the specifier inside import/export/require syntax.
    const anchored = new RegExp(
      `((?:\\bfrom\\s*|\\bimport\\s*\\(\\s*|\\brequire\\s*\\(\\s*|\\bimport\\s*))(['"])${escaped}\\2`,
      'g'
    );
    out = out.replace(
      anchored,
      (_match, prefix: string, quote: string) => `${prefix}${quote}${newRef}${quote}`
    );
  }
  return out;
}

/** Options for `planMove`. */
export interface PlanMoveOptions {
  /** Permit a move onto an existing staged path. */
  overwrite?: boolean;
  /** Mark the plan as a dry run (no writes are performed either way). */
  dryRun?: boolean;
}

/**
 * Plan a staged-file relocation and every import rewrite it implies.
 *
 * Performs no writes. `from` must exist in the stage, `to` must not already
 * exist unless `overwrite` is set, and both must resolve inside the stage root.
 */
export async function planMove(
  from: string,
  to: string,
  stagedFiles: readonly string[] | undefined,
  ctx: ToolContext,
  opts: PlanMoveOptions = {}
): Promise<Result<MovePlan, StitchError>> {
  const stageRoot = String(ctx.config['stageRoot'] ?? 'C');
  const fromContained = assertWithinRoot(from, stageRoot);
  if (fromContained.isErr()) return err(fromContained.error);
  const toContained = assertWithinRoot(to, stageRoot);
  if (toContained.isErr()) return err(toContained.error);

  const source = fromContained.value;
  const destination = toContained.value;
  if (source === destination) {
    return err({
      code: 'CONFIG_ERROR',
      field: 'to',
      message: `Refusing to move ${source} onto itself`,
    });
  }

  const listed = await stagedListing(ctx, stagedFiles);
  if (listed.isErr()) return err(listed.error);
  const staged = listed.value.map(p => p.replace(/\\/g, '/').replace(/^\.\//, ''));
  const stagedSet = new Set(staged);

  if (!stagedSet.has(source)) {
    return err({
      code: 'FILE_NOT_FOUND',
      path: source,
      message: `Cannot move "${source}": it is not present in the staged repo`,
    });
  }
  if (stagedSet.has(destination) && opts.overwrite !== true) {
    return err({
      code: 'CONFIG_ERROR',
      field: 'to',
      message: `Refusing to move onto existing staged path "${destination}"; pass overwrite to replace it`,
    });
  }

  // Every staged JS/TS file that resolves a relative import to `source` needs a
  // rewrite. Non-JS files and the moved file itself are skipped.
  const importRewrites: ImportRewrite[] = [];
  for (const candidate of staged) {
    if (candidate === source) continue;
    if (!JS_EXTENSIONS.has(extensionOf(candidate))) continue;
    const read = await readStaged(ctx, candidate);
    if (read.isErr()) continue;
    const specifiers = parseJsImports(read.value);
    for (const specifier of specifiers) {
      if (classifyJsSpecifier(specifier) !== 'relative') continue;
      const target = resolveRelativeImport(candidate, specifier, stagedSet);
      if (target !== source) continue;
      importRewrites.push({
        file: candidate,
        oldRef: specifier,
        newRef: rewriteSpecifier(candidate, destination, specifier),
      });
    }
  }
  // Deterministic ordering so two runs produce an identical plan.
  importRewrites.sort((a, b) => a.file.localeCompare(b.file) || a.oldRef.localeCompare(b.oldRef));

  return ok({
    from: source,
    to: destination,
    ...(opts.dryRun === true ? { dryRun: true } : {}),
    importRewrites,
  });
}

/**
 * Execute a planned move atomically.
 *
 * Every file this will touch has its prior content captured first. On any
 * failure all of them are restored and the move is reversed, so the staged tree
 * is never left half-rewritten.
 */
export async function executeMove(
  plan: MovePlan,
  ctx: ToolContext
): Promise<Result<void, StitchError>> {
  // A dry-run plan is explicitly a no-op — the safest possible interpretation.
  if (plan.dryRun === true) return ok(undefined);

  // Capture prior content for every rewrite target before touching anything.
  const originals = new Map<string, string>();
  const perFile = new Map<string, Map<string, string>>();
  for (const rewrite of plan.importRewrites) {
    let fileMap = perFile.get(rewrite.file);
    if (fileMap === undefined) {
      fileMap = new Map<string, string>();
      perFile.set(rewrite.file, fileMap);
    }
    fileMap.set(rewrite.oldRef, rewrite.newRef);
    if (originals.has(rewrite.file)) continue;
    const read = await readStaged(ctx, rewrite.file);
    if (read.isErr()) return err(read.error);
    originals.set(rewrite.file, read.value);
  }

  const moved = await moveStaged(ctx, plan.from, plan.to);
  if (moved.isErr()) return err(moved.error);

  // Restore everything captured above, and undo the move.
  const rollback = async (): Promise<void> => {
    for (const [path, content] of originals) {
      const w = await writeStaged(ctx, path, content);
      if (w.isErr()) ctx.logger?.warn?.({ path }, 'move_file rollback rewrite failed');
    }
    const back = await moveStaged(ctx, plan.to, plan.from);
    if (back.isErr()) {
      ctx.logger?.error?.(
        { error: stitchErrorMessage(back.error) },
        'move_file rollback move failed'
      );
    }
  };

  for (const [path, replacements] of perFile) {
    const content = originals.get(path);
    if (content === undefined) continue;
    const updated = rewriteImportRefs(content, replacements);
    if (updated === content) continue;
    const written = await writeStaged(ctx, path, updated);
    if (written.isErr()) {
      await rollback();
      return err(written.error);
    }
  }

  return ok(undefined);
}

/** Tool schema (P-153 step 4). */
export const moveFileSchema = {
  from: z.string().min(1),
  to: z.string().min(1),
  dryRun: z.boolean().optional(),
  overwrite: z.boolean().optional(),
} satisfies Record<string, z.ZodTypeAny>;

const moveFileObject = z.object(moveFileSchema);

/** `move_file` — `autonomy: 'auto'`. */
export const moveFileTool: ToolDefinition = {
  name: 'move_file',
  description:
    'Relocate a staged file inside child repo C and rewrite the relative imports that pointed at it. Supports dryRun and overwrite.',
  schema: moveFileSchema,
  autonomy: 'auto',
  execute: async (args: unknown, ctx: ToolContext): Promise<Result<unknown, StitchError>> => {
    const parsed = moveFileObject.safeParse(args);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map(i => `${i.path.length > 0 ? '/' + i.path.join('/') : '(root)'}: ${i.message}`)
        .join('; ');
      return err({
        code: 'TOOL_ARGS_VALIDATION',
        message: `move_file arguments validation failed: ${issues}`,
      });
    }
    const { from, to, dryRun, overwrite } = parsed.data;
    const plan = await planMove(from, to, undefined, ctx, {
      ...(dryRun === undefined ? {} : { dryRun }),
      ...(overwrite === undefined ? {} : { overwrite }),
    });
    if (plan.isErr()) return err(plan.error);
    const applied = await executeMove(plan.value, ctx);
    if (applied.isErr()) return err(applied.error);
    return ok(plan.value);
  },
};
