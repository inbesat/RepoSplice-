// P-148 — agent tool `select_files`.
//
// The model proposes *which* files from source repos A and B should land in
// child repo C. This tool does not move anything: it validates the proposal
// against the scanned listing of the named source repo and returns a
// structured `FileSelection` that the merge writer (P-076) and provenance
// mapper (P-181) consume verbatim. Keeping it pure-proposal means a bad
// selection is rejected before any worktree mutation happens.
//
// AUTONOMY: `auto`. Selecting files is a read-only proposal — nothing is
// written, moved, or deleted — so it needs no human approval. P-154
// (`propose_component`) is the first `gated` tool in the epic.

import { z } from 'zod';
import picomatch from 'picomatch';
import { ok, err, type Result } from 'neverthrow';
import type { StitchError } from '../../result/index.js';
import type { ToolDefinition, ToolContext } from '../../ai/types.js';
import {
  MAX_SELECTED_FILES,
  type FileSelection,
  type SelectedFile,
  type SelectionFilter,
  type SourceRepo,
} from '../types.js';

/**
 * The tool schema, in the `Record<string, ZodTypeAny>` shape `ToolDefinition`
 * (P-140) and `parseToolArgs` (P-139) expect.
 *
 * `paths` is capped at 2000 to bound loop memory and the CLI/web selection UI
 * (large real repos are selected in batches by the caller).
 */
export const selectFilesSchema = {
  repo: z.enum(['A', 'B']),
  paths: z.array(z.string()).min(1).max(MAX_SELECTED_FILES),
  filter: z
    .object({
      glob: z.string().optional(),
      excludeDirs: z.array(z.string()).optional(),
    })
    .optional(),
  reason: z.string().optional(),
} satisfies Record<string, z.ZodTypeAny>;

/** The same schema as a standalone object, for direct validation in tests. */
const selectFilesObject = z.object(selectFilesSchema);

/**
 * The parsed-args type, inferred from the schema itself.
 *
 * Deliberately inferred rather than hand-asserted as `SelectFilesArgs`: under
 * `exactOptionalPropertyTypes` zod emits `glob?: string | undefined`, which is
 * not assignable to the interface's `glob?: string`. The schema is the single
 * source of truth; `SelectFilesArgs` (agent/types.ts) documents the same shape
 * for consumers.
 */
type ParsedSelectFiles = z.infer<typeof selectFilesObject>;

/** Result shape returned by `select_files`. */
export interface SelectFilesResult extends FileSelection {
  repo: SourceRepo;
  reason?: string;
}

/** Strip a leading `./` and any trailing slash so lookups match the listing. */
function normalizeSelectionPath(path: string): string {
  let out = path.replace(/\\/g, '/');
  while (out.startsWith('./')) out = out.slice(2);
  return out.replace(/\/+$/, '');
}

/** True when `path` sits under one of `dirs` (prefix match on a segment). */
function isUnderExcludedDir(path: string, dirs: readonly string[]): boolean {
  return dirs.some(dir => {
    const normalized = normalizeSelectionPath(dir);
    if (normalized === '') return false;
    return path === normalized || path.startsWith(`${normalized}/`);
  });
}

/**
 * Validate already-parsed arguments against the tool schema.
 *
 * The P-140 loop parses args with `parseToolArgs` before calling `execute`, but
 * `execute` is a public entry point too. Re-validating here means a direct
 * caller gets a typed `TOOL_ARGS_VALIDATION` instead of a TypeError on
 * `args.paths.filter(...)`.
 */
function validateArgs(args: unknown): Result<ParsedSelectFiles, StitchError> {
  const parsed = selectFilesObject.safeParse(args);
  if (parsed.success) return ok(parsed.data);
  const issues = parsed.error.issues
    .map(i => `${i.path.length > 0 ? '/' + i.path.join('/') : '(root)'}: ${i.message}`)
    .join('; ');
  return err({
    code: 'TOOL_ARGS_VALIDATION',
    message: `select_files arguments validation failed: ${issues}`,
  });
}

/** The `select_files` tool (P-148). `autonomy: 'auto'` — read-only proposal. */
export const selectFilesTool: ToolDefinition = {
  name: 'select_files',
  description:
    'Propose which files from source repos A and B to include in child repo C. Validates every path against the source repo listing.',
  schema: selectFilesSchema,
  autonomy: 'auto',
  execute: async (args: unknown, ctx: ToolContext): Promise<Result<unknown, StitchError>> => {
    const validated = validateArgs(args);
    if (validated.isErr()) return validated;
    const { repo, paths, filter, reason } = validated.value;

    // The blueprint's call: ctx.git.listFiles(ctx.cwd, args.repo). `listFiles`
    // is optional on GitFacade so P-140-era facades still compile; its absence
    // is a wiring fault, which is a different failure from a missing path.
    const listFiles = ctx.git.listFiles;
    if (listFiles === undefined) {
      return err({
        code: 'CONFIG_ERROR',
        field: 'git.listFiles',
        message:
          'select_files requires GitFacade.listFiles; the caller did not provide a source-repo file listing',
      });
    }

    const listing = await listFiles.call(ctx.git, ctx.cwd, repo);
    if (listing.isErr()) return listing;

    // Index the listing once; both explicit validation and glob expansion read
    // it. Normalize to repo-relative POSIX so a model-supplied `./src/app.ts`
    // still resolves against a listing that says `src/app.ts`.
    const known = new Set(listing.value.map(normalizeSelectionPath));

    // --- 1. Validate every explicitly requested path. -------------------
    const missing: string[] = [];
    const selected: SelectedFile[] = [];
    const seen = new Set<string>();
    for (const rawPath of paths) {
      const path = normalizeSelectionPath(rawPath);
      if (!known.has(path)) {
        missing.push(rawPath);
        continue;
      }
      if (seen.has(path)) continue;
      seen.add(path);
      selected.push({
        repo,
        path,
        ...(reason !== undefined ? { reason } : {}),
      });
    }

    // --- 2. Expand filter.glob against the same listing. -----------------
    // picomatch (P-036) matches the repo-relative paths. `excludeDirs` is
    // applied after matching so a broad glob cannot drag in build output.
    let truncated = 0;
    const glob = filter?.glob;
    if (glob !== undefined) {
      const excludes = filter?.excludeDirs ?? [];
      const matches = picomatch(glob, { dot: true, posix: true });
      const expanded = listing.value
        .map(normalizeSelectionPath)
        .filter(p => matches(p))
        .filter(p => !isUnderExcludedDir(p, excludes))
        .sort();

      for (const path of expanded) {
        if (seen.has(path)) continue;
        if (selected.length >= MAX_SELECTED_FILES) {
          truncated++;
          continue;
        }
        seen.add(path);
        selected.push({
          repo,
          path,
          ...(reason !== undefined ? { reason } : {}),
        });
      }

      // A glob that matches nothing is an unresolvable selector. Report the
      // glob itself in `missing` so the caller always gets an actionable list.
      if (expanded.length === 0) {
        missing.push(glob);
      }
    }

    if (missing.length > 0) {
      return err({
        code: 'SELECT_PATH_NOT_FOUND',
        repo,
        missing,
        ...(glob !== undefined ? { glob } : {}),
        message: `select_files: ${missing.length} selector(s) not found in repo ${repo}: ${missing.join(', ')}`,
      });
    }

    // Bounded expansion is reported, never silently dropped: the spec's own
    // `notes` field exists for operator-facing remarks.
    const notes =
      truncated > 0
        ? `Glob "${glob}" matched more than ${MAX_SELECTED_FILES} files; selection truncated (${truncated} omitted). Select in batches.`
        : undefined;

    // Rebuild the filter explicitly rather than forwarding zod's output, whose
    // optionals carry `| undefined` and so do not satisfy `SelectionFilter`
    // under `exactOptionalPropertyTypes`.
    const selectionFilter: SelectionFilter | undefined =
      filter === undefined
        ? undefined
        : {
            ...(filter.glob !== undefined ? { glob: filter.glob } : {}),
            ...(filter.excludeDirs !== undefined ? { excludeDirs: filter.excludeDirs } : {}),
          };

    const result: SelectFilesResult = {
      repo,
      files: selected,
      ...(selectionFilter !== undefined ? { filter: selectionFilter } : {}),
      ...(reason !== undefined ? { reason } : {}),
      ...(notes !== undefined ? { notes } : {}),
    };
    return ok(result);
  },
};
