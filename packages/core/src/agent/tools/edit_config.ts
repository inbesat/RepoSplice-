// P-152 — agent tool `edit_config`.
//
// Applies one targeted, validated change to a config file under child repo C,
// returning a before/after pair plus a unified diff (P-217 renders it).
//
// SAFETY MODEL
// - `autonomy: 'auto'`: a config edit is mechanical and fully reversible via
//   the undo stack, so it needs no human approval.
// - Path containment: the target must resolve inside the stage root. Traversal
//   (`../`) and absolute paths are refused BEFORE any read or write.
// - Rollback: the prior content is captured first. A failed validation hook
//   restores it, so a rejected edit leaves the file exactly as it was.
// - Undo stack: the last edit per path is retained so `revertConfigEdit` can
//   put it back. P-161 wires full reversion across a job.

import { z } from 'zod';
import { ok, err, type Result } from 'neverthrow';
import type { StitchError } from '../../result/index.js';
import type { ToolDefinition, ToolContext } from '../../ai/types.js';
import { unifiedDiff } from '../diff.js';
import {
  assertSafeKeyPath,
  deepMerge,
  detectConfigFormat,
  getAtPath,
  parseConfig,
  parseKeyPath,
  removeAtPath,
  serializeConfig,
  setAtPath,
} from '../configDoc.js';
import type { ConfigEdit, ConfigEditResult, ConfigFormat } from '../types.js';

/** Optional post-edit validation hook (P-152 step 2). */
export type ConfigValidator = (parsed: unknown) => Result<void, string>;

/** Options accepted by `applyConfigEdit`. */
export interface ApplyConfigEditOptions {
  validate?: ConfigValidator;
  /** Override the detected format (tests use this for opaque fixtures). */
  format?: ConfigFormat;
}

/** An entry in the per-path undo stack. */
export interface UndoEntry {
  path: string;
  before: string;
  after: string;
}

/**
 * Last edit per path, newest wins.
 *
 * Keyed by path so repeated edits to one file collapse to a single undo step,
 * matching P-152's "short undo stack (last edit per path)".
 */
const undoStack = new Map<string, UndoEntry>();

/** The recorded undo entry for a path, if any. */
export function getUndoEntry(path: string): UndoEntry | undefined {
  return undoStack.get(path);
}

/** Drop all undo state. Test-only. */
export function clearUndoStackForTests(): void {
  undoStack.clear();
}

/** Snapshot the undo stack, newest-first per path, for the CLI/web. */
export function listUndoEntries(): UndoEntry[] {
  return [...undoStack.values()].sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Reject a path that escapes the stage root.
 *
 * Resolves `..` and absolute paths textually (no filesystem access), then
 * requires the result to still be inside `root`. A leading `/` is treated as
 * root-relative rather than filesystem-absolute, because the tool addresses
 * repo-relative paths everywhere else (P-148 `SelectedFile.path`).
 */
export function assertWithinRoot(path: string, root: string): Result<string, StitchError> {
  const normalizedRoot = root.replace(/\\/g, '/').replace(/\/+$/, '');
  let candidate = path.replace(/\\/g, '/');
  if (candidate.startsWith('/')) candidate = candidate.slice(1);
  const out: string[] = [];
  for (const segment of candidate.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (out.length === 0) {
        return err({
          code: 'CONFIG_ERROR',
          field: 'path',
          message: `Refusing to edit "${path}": resolves outside the stage root`,
        });
      }
      out.pop();
      continue;
    }
    out.push(segment);
  }
  const resolved = out.join('/');
  if (resolved === '') {
    return err({
      code: 'CONFIG_ERROR',
      field: 'path',
      message: `Refusing to edit "${path}": resolves to the stage root itself`,
    });
  }
  if (!resolved.startsWith(`${normalizedRoot}/`) && resolved !== normalizedRoot) {
    return err({
      code: 'CONFIG_ERROR',
      field: 'path',
      message: `Refusing to edit "${resolved}": outside stage root ${normalizedRoot}`,
    });
  }
  return ok(resolved.slice(normalizedRoot.length + 1));
}

/** Read the current file content through the facade. */
async function readCurrent(ctx: ToolContext, path: string): Promise<Result<string, StitchError>> {
  const git = ctx.git;
  if (git.readStagedFile !== undefined) {
    return git.readStagedFile(path);
  }
  if (git.readFile !== undefined) {
    return git.readFile(ctx.cwd, 'A', path);
  }
  return err({
    code: 'CONFIG_ERROR',
    field: 'git.readStagedFile',
    message: 'edit_config requires GitFacade.readStagedFile (or readFile) to read the target',
  });
}

/** Write the file through the facade. */
async function writeCurrent(
  ctx: ToolContext,
  path: string,
  content: string
): Promise<Result<void, StitchError>> {
  const git = ctx.git;
  if (git.writeFile !== undefined) {
    return git.writeFile(ctx.cwd, 'A', path, content);
  }
  return err({
    code: 'CONFIG_ERROR',
    field: 'git.writeFile',
    message: 'edit_config requires GitFacade.writeFile to persist the edit',
  });
}

/**
 * Apply one `ConfigEdit` to a config file under the stage root.
 *
 * Order of operations is deliberate: containment and key safety are checked
 * first, the original is captured second, and only then is anything parsed,
 * mutated, serialized, or written. Every error path after the capture can
 * therefore restore the file exactly.
 */
export async function applyConfigEdit(
  path: string,
  edit: ConfigEdit,
  ctx: ToolContext,
  opts: ApplyConfigEditOptions = {}
): Promise<Result<ConfigEditResult, StitchError>> {
  const stageRoot = String(ctx.config['stageRoot'] ?? 'C');
  const contained = assertWithinRoot(path, stageRoot);
  if (contained.isErr()) return err(contained.error);
  const relativePath = contained.value;

  const format = opts.format ?? detectConfigFormat(relativePath);
  if (format === undefined) {
    return err({
      code: 'UNSUPPORTED_ECOSYSTEM',
      ecosystem: 'config',
      message: `Cannot determine config format for "${relativePath}"`,
    });
  }

  const segments = parseKeyPath(edit.key);
  if (segments.isErr()) return err(segments.error);
  const safe = assertSafeKeyPath(segments.value, edit.key);
  if (safe.isErr()) return err(safe.error);

  const current = await readCurrent(ctx, relativePath);
  if (current.isErr()) return err(current.error);
  const before = current.value;

  const parsed = parseConfig(relativePath, format, before);
  if (parsed.isErr()) return err(parsed.error);
  const document = parsed.value;

  // Apply the operation, building a new document rather than mutating.
  let next: unknown;
  switch (edit.op) {
    case 'set':
      next = setAtPath(document, segments.value, edit.value);
      break;
    case 'merge': {
      // Merge into whatever is already at the path, then write the merged
      // subtree BACK at that path. Returning the bare subtree here would drop
      // every sibling of the key, which is the opposite of "merge".
      const existing = getAtPath(document, segments.value);
      const merged = isPlainRecord(existing) ? deepMerge(existing, edit.value) : edit.value;
      next = setAtPath(document, segments.value, merged);
      break;
    }
    case 'append': {
      const existing = getAtPath(document, segments.value);
      const asArray = Array.isArray(existing) ? [...existing] : [];
      asArray.push(edit.value);
      next = setAtPath(document, segments.value, asArray);
      break;
    }
    case 'remove':
      next = removeAtPath(document, segments.value);
      break;
  }

  const serialized = serializeConfig(format, next, before);
  if (serialized.isErr()) return err(serialized.error);
  const after = serialized.value;

  // No-op edits short-circuit: identical content is not written and not
  // recorded, so a repeated edit does not churn the file.
  if (after === before) {
    return ok({
      path: relativePath,
      before,
      after,
      diff: '',
      op: edit.op,
      key: edit.key,
    });
  }

  // Run the validation hook against the parsed POST-edit document.
  if (opts.validate !== undefined) {
    const reparse = parseConfig(relativePath, format, after);
    if (reparse.isErr()) return err(reparse.error);
    const validation = opts.validate(reparse.value);
    if (validation.isErr()) {
      // Roll back: the file was never written, but the prior content is
      // rewritten defensively so a partially-applied write cannot survive.
      const restored = await writeCurrent(ctx, relativePath, before);
      if (restored.isErr()) return err(restored.error);
      return err({
        code: 'CONFIG_ERROR',
        field: edit.key,
        message: `Config edit rejected by validator: ${validation.error}`,
      });
    }
  }

  const written = await writeCurrent(ctx, relativePath, after);
  if (written.isErr()) {
    // The write failed; restore the prior content so C is never left partial.
    const restored = await writeCurrent(ctx, relativePath, before);
    if (restored.isErr()) return err(restored.error);
    return err(written.error);
  }

  undoStack.set(relativePath, { path: relativePath, before, after });

  return ok({
    path: relativePath,
    before,
    after,
    diff: unifiedDiff(relativePath, before, after),
    op: edit.op,
    key: edit.key,
  });
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Revert the last recorded edit for a path (P-161 wires full job reversion). */
export async function revertConfigEdit(
  path: string,
  ctx: ToolContext
): Promise<Result<ConfigEditResult, StitchError>> {
  const stageRoot = String(ctx.config['stageRoot'] ?? 'C');
  const contained = assertWithinRoot(path, stageRoot);
  if (contained.isErr()) return err(contained.error);
  const relativePath = contained.value;
  const entry = undoStack.get(relativePath);
  if (entry === undefined) {
    return err({
      code: 'CONFIG_ERROR',
      field: 'path',
      message: `No recorded edit to revert for ${relativePath}`,
    });
  }
  const written = await writeCurrent(ctx, relativePath, entry.before);
  if (written.isErr()) return err(written.error);
  undoStack.delete(relativePath);
  return ok({
    path: relativePath,
    before: entry.after,
    after: entry.before,
    diff: unifiedDiff(relativePath, entry.after, entry.before),
    op: 'set',
    key: entry.path,
  });
}

/** Tool schema (P-152 step 3). */
export const editConfigSchema = {
  path: z.string().min(1),
  op: z.enum(['set', 'append', 'merge', 'remove']),
  key: z.string().min(1),
  value: z.unknown().optional(),
} satisfies Record<string, z.ZodTypeAny>;

const editConfigObject = z.object(editConfigSchema);

/** `edit_config` — `autonomy: 'auto'`. */
export const editConfigTool: ToolDefinition = {
  name: 'edit_config',
  description:
    'Apply a targeted, validated edit to a config file under child repo C. Returns before/after content and a unified diff.',
  schema: editConfigSchema,
  autonomy: 'auto',
  execute: async (args: unknown, ctx: ToolContext): Promise<Result<unknown, StitchError>> => {
    const parsed = editConfigObject.safeParse(args);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map(i => `${i.path.length > 0 ? '/' + i.path.join('/') : '(root)'}: ${i.message}`)
        .join('; ');
      return err({
        code: 'TOOL_ARGS_VALIDATION',
        message: `edit_config arguments validation failed: ${issues}`,
      });
    }
    return applyConfigEdit(
      parsed.data.path,
      {
        path: parsed.data.path,
        op: parsed.data.op,
        key: parsed.data.key,
        ...(parsed.data.value !== undefined ? { value: parsed.data.value } : {}),
      },
      ctx
    );
  },
};
