// P-161 — the undo stack.
//
// "Auto-fix mechanical issues" is only safe if a mistake is reversible. This is
// the safety net that makes the `auto` autonomy class acceptable: a tool that
// changes the working tree records enough about its prior state that the change
// can be rolled back, and a gated `revert_last` tool lets a human ask for that
// roll-back.
//
// A REVERT IS A FORWARD WRITE, NOT A GIT REVERT. The spec's step 2 says each
// revert uses `ctx.git.writeFile` / `move` "so it lands as a reversible commit".
// That is deliberate: the undo stack restores *content* through the same facade
// the tool used, so it needs no access to the commit history and cannot itself
// become the thing that has to be reverted. What the facade does with those
// writes (staging, committing) is the facade's business.
//
// THE STACK IS BOUNDED, AND SAYS SO. `maxDepth` (50, per the spec) caps how far
// back a human can roll. When the cap is reached the OLDEST record is dropped,
// not the newest: the newest is the one a human most likely wants to undo. The
// number dropped is exposed rather than hidden, because a silently truncated
// undo history is worse than a short one — it looks like there is nothing to
// undo when there is.
//
// WRITE AND DELETE ARE BOTH OPTIONAL AND BOTH CHECKED. `GitFacade.writeFile?`
// and the P-161 `deleteFile?` are optional (ADR-021), so the reverter checks for
// each capability it needs *before* making any change. A revert that half
// applied would be worse than one that refused: the stack has already been
// popped, so the record is gone and the tree is inconsistent with the history.

import { ok, err, type Result } from 'neverthrow';
import { type ToolContext, type UndoRecorder } from '../ai/types.js';
import { type StitchError } from '../result/index.js';
import { rewriteImportRefs } from './tools/move_file.js';
import type { FileSnapshot, ImportRewrite, UndoKind, UndoRecord } from './types.js';

/** How far back the stack keeps, per the spec's `maxDepth=50`. */
export const MAX_UNDO_DEPTH = 50;

/** The repository label the facade addresses. Matches P-154's `applyProposal`. */
const REVERT_REPO = 'A' as const;

// ---------------------------------------------------------------------------
// Record construction — the loop derives records from tool results
// ---------------------------------------------------------------------------

/** Injectable clock and id source, so tests are deterministic. */
export interface UndoClock {
  now: () => string;
  newId: () => string;
}

function defaultClock(): UndoClock {
  return {
    now: () => new Date().toISOString(),
    newId: () => `undo_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`,
  };
}

/** A reverter reverses one kind. Return the record's own errors unchanged. */
export type Reverter = (record: UndoRecord, ctx: ToolContext) => Promise<Result<void, StitchError>>;

/** Narrow an unknown `before` to `FileSnapshot[]`, or explain why it is not. */
function asSnapshots(record: UndoRecord): Result<FileSnapshot[], StitchError> {
  if (!Array.isArray(record.before)) {
    return err({
      code: 'CONFIG_ERROR',
      field: 'before',
      message: `Undo record ${record.id} (${record.kind}) needs a FileSnapshot[] before-state`,
    });
  }
  const out: FileSnapshot[] = [];
  for (const entry of record.before) {
    if (entry === null || typeof entry !== 'object') continue;
    const candidate = entry as { path?: unknown; content?: unknown };
    if (typeof candidate.path !== 'string') continue;
    // `content: null` is meaningful (the file did not exist) and is preserved.
    const content = typeof candidate.content === 'string' ? candidate.content : null;
    out.push({ path: candidate.path, content });
  }
  return ok(out);
}

/** `writeFile` is optional; refuse rather than half-apply. */
function requireWrite(ctx: ToolContext, record: UndoRecord): Result<true, StitchError> {
  if (ctx.git.writeFile === undefined) {
    return err({
      code: 'CONFIG_ERROR',
      field: 'git.writeFile',
      message: `Reverting ${record.tool} requires GitFacade.writeFile, which is not wired`,
    });
  }
  return ok(true);
}

/** `deleteFile` is optional; refuse rather than half-apply. */
function requireDelete(ctx: ToolContext, record: UndoRecord): Result<true, StitchError> {
  if (ctx.git.deleteFile === undefined) {
    return err({
      code: 'CONFIG_ERROR',
      field: 'git.deleteFile',
      message: `Reverting ${record.tool} requires GitFacade.deleteFile, which is not wired`,
    });
  }
  return ok(true);
}

/**
 * Restore a set of files: write back prior content, or delete the ones that did
 * not exist before.
 *
 * Every capability is checked before the first write, so this either restores
 * the whole set or refuses it.
 */
async function restoreSnapshots(
  snapshots: readonly FileSnapshot[],
  ctx: ToolContext,
  record: UndoRecord
): Promise<Result<void, StitchError>> {
  const needsWrite = snapshots.some(s => s.content !== null);
  const needsDelete = snapshots.some(s => s.content === null);
  if (needsWrite) {
    const writable = requireWrite(ctx, record);
    if (writable.isErr()) return err(writable.error);
  }
  if (needsDelete) {
    const deletable = requireDelete(ctx, record);
    if (deletable.isErr()) return err(deletable.error);
  }

  for (const snapshot of snapshots) {
    if (snapshot.content === null) {
      const removed = await ctx.git.deleteFile?.(ctx.cwd, REVERT_REPO, snapshot.path);
      if (removed === undefined) {
        return err({
          code: 'CONFIG_ERROR',
          field: 'git.deleteFile',
          message: 'GitFacade.deleteFile disappeared mid-revert',
        });
      }
      if (removed.isErr()) return err(removed.error);
      continue;
    }
    const written = await ctx.git.writeFile?.(
      ctx.cwd,
      REVERT_REPO,
      snapshot.path,
      snapshot.content
    );
    if (written === undefined) {
      return err({
        code: 'CONFIG_ERROR',
        field: 'git.writeFile',
        message: 'GitFacade.writeFile disappeared mid-revert',
      });
    }
    if (written.isErr()) return err(written.error);
  }
  return ok(undefined);
}

// ---------------------------------------------------------------------------
// Reverters
// ---------------------------------------------------------------------------

/**
 * Reverse a content change: a write, a config edit, a manifest edit, a dep fix.
 *
 * All four are the same operation with different bookkeeping, so they share one
 * implementation rather than four near-identical ones.
 */
const restoreContent: Reverter = async (record, ctx) => {
  const snapshots = asSnapshots(record);
  if (snapshots.isErr()) return err(snapshots.error);
  if (snapshots.value.length === 0) {
    return err({
      code: 'CONFIG_ERROR',
      field: 'before',
      message: `Undo record ${record.id} carries no file snapshots to restore`,
    });
  }
  return restoreSnapshots(snapshots.value, ctx, record);
};

/**
 * Reverse a staged relocation, including the import rewrites it implied.
 *
 * The rewrites are inverted by swapping `oldRef` and `newRef` and re-running
 * P-153's `rewriteImportRefs`, rather than by restoring whole-file content. That
 * is deliberate: a rewrite touches only the import specifiers, so restoring
 * entire files would revert *unrelated* edits made to those files after the move
 * — a revert that silently destroys work is worse than no revert.
 */
const revertMove: Reverter = async (record, ctx) => {
  const before = record.before as { from?: unknown; to?: unknown } | null;
  const from = before?.from;
  const to = before?.to;
  if (typeof from !== 'string' || typeof to !== 'string') {
    return err({
      code: 'CONFIG_ERROR',
      field: 'before',
      message: `Undo record ${record.id} (file_move) needs {from,to} before-state`,
    });
  }
  if (ctx.git.move === undefined) {
    return err({
      code: 'CONFIG_ERROR',
      field: 'git.move',
      message: `Reverting ${record.tool} requires GitFacade.move, which is not wired`,
    });
  }
  const moved = await ctx.git.move(ctx.cwd, REVERT_REPO, to, from);
  if (moved.isErr()) return err(moved.error);

  // Invert each rewrite and re-apply it, grouping by file so one pass per file
  // rewrites every specifier in it.
  const rewrites = record.importRewrites ?? [];
  if (rewrites.length === 0) return ok(undefined);
  if (ctx.git.readStagedFile === undefined) {
    return err({
      code: 'CONFIG_ERROR',
      field: 'git.readStagedFile',
      message: `Reverting ${record.tool} needs GitFacade.readStagedFile to invert import rewrites`,
    });
  }

  const byFile = new Map<string, Map<string, string>>();
  for (const rewrite of rewrites) {
    const existing = byFile.get(rewrite.file) ?? new Map<string, string>();
    // oldRef becomes the new target: that is what inverting a rewrite means.
    existing.set(rewrite.newRef, rewrite.oldRef);
    byFile.set(rewrite.file, existing);
  }

  for (const [file, replacements] of byFile) {
    const current = await ctx.git.readStagedFile(file);
    if (current.isErr()) return err(current.error);
    const restored = rewriteImportRefs(current.value, replacements);
    if (restored === current.value) continue;
    const written = await ctx.git.writeFile?.(ctx.cwd, REVERT_REPO, file, restored);
    if (written === undefined) {
      return err({
        code: 'CONFIG_ERROR',
        field: 'git.writeFile',
        message: 'GitFacade.writeFile disappeared mid-revert',
      });
    }
    if (written.isErr()) return err(written.error);
  }
  return ok(undefined);
};

/**
 * Reverse an applied component proposal: delete the files it created and
 * restore whatever it appended to.
 *
 * The created files need no snapshot because P-154's collision check already
 * guarantees they did not exist before. The registration file is different —
 * it is an append target, so it usually *did* exist and its prior content must
 * come from the record.
 */
const revertProposal: Reverter = async (record, ctx) => {
  const snapshots = asSnapshots(record);
  if (snapshots.isErr()) return err(snapshots.error);
  const deletable = requireDelete(ctx, record);
  if (deletable.isErr()) return err(deletable.error);
  // `paths` holds the created files; the snapshots hold the appended-to file.
  for (const path of record.paths) {
    const removed = await ctx.git.deleteFile?.(ctx.cwd, REVERT_REPO, path);
    if (removed === undefined) {
      return err({
        code: 'CONFIG_ERROR',
        field: 'git.deleteFile',
        message: 'GitFacade.deleteFile disappeared mid-revert',
      });
    }
    if (removed.isErr()) return err(removed.error);
  }
  if (snapshots.value.length === 0) return ok(undefined);
  return restoreSnapshots(snapshots.value, ctx, record);
};

/**
 * The reverter registry, keyed by the record's `kind`.
 *
 * A registry rather than a `switch` so a new kind is added by registering it,
 * and an unregistered kind is a typed refusal instead of a silent no-op.
 */
export const REVERTERS: Readonly<Record<UndoKind, Reverter>> = {
  file_write: restoreContent,
  config_edit: restoreContent,
  manifest: restoreContent,
  dep_fix: restoreContent,
  file_move: revertMove,
  proposal_apply: revertProposal,
};

// ---------------------------------------------------------------------------
// The stack
// ---------------------------------------------------------------------------

/** Construction options. */
export interface UndoStackOptions {
  /** How many records to keep. Defaults to {@link MAX_UNDO_DEPTH}. */
  maxDepth?: number;
  /** Injectable clock/id source. */
  clock?: Partial<UndoClock>;
}

/**
 * A bounded, newest-first stack of reversible tool actions.
 *
 * `undo()` pops and reverts. **A failed revert pushes the record back**, because
 * the tree was not restored and the history must not claim otherwise; a human
 * who sees the failure can retry, and a record silently lost on a transient
 * git error would be unrecoverable.
 */
export class UndoStack {
  readonly #records: UndoRecord[] = [];
  readonly #maxDepth: number;
  readonly #clock: UndoClock;
  #dropped = 0;

  constructor(options: UndoStackOptions = {}) {
    this.#maxDepth = Math.max(1, options.maxDepth ?? MAX_UNDO_DEPTH);
    this.#clock = { ...defaultClock(), ...(options.clock ?? {}) };
  }

  /** How many records are currently held. */
  get depth(): number {
    return this.#records.length;
  }

  /** How many records the cap has discarded. Surfaced, never hidden. */
  get dropped(): number {
    return this.#dropped;
  }

  /** The cap in force. */
  get maxDepth(): number {
    return this.#maxDepth;
  }

  /** The newest record, without removing it. */
  peek(): UndoRecord | undefined {
    return this.#records[this.#records.length - 1];
  }

  /** Every held record, oldest first. */
  history(): readonly UndoRecord[] {
    return [...this.#records];
  }

  /** The clock this stack stamps records with — exposed so the loop can match. */
  get clock(): UndoClock {
    return this.#clock;
  }

  /**
   * Record a reversible action.
   *
   * The record is stamped with an id and a timestamp here rather than by the
   * caller, so every record in the history is identifiable the same way.
   *
   * @param record - What changed; `id` and `ts` are filled in if absent
   * @returns `ok` with the stored record, or `CONFIG_ERROR` for a record whose
   *   `kind` has no registered reverter (an unrevertable record must never sit
   *   in a stack that claims to be able to undo it)
   */
  push(
    record: Omit<UndoRecord, 'id' | 'ts'> & { id?: string; ts?: string }
  ): Result<UndoRecord, StitchError> {
    if (REVERTERS[record.kind] === undefined) {
      return err({
        code: 'CONFIG_ERROR',
        field: 'kind',
        message: `No reverter is registered for undo kind "${record.kind}"`,
      });
    }
    const stored: UndoRecord = {
      ...record,
      id: record.id ?? this.#clock.newId(),
      ts: record.ts ?? this.#clock.now(),
    };
    this.#records.push(stored);
    // Drop the OLDEST, so the record a human most likely wants is the one kept.
    while (this.#records.length > this.#maxDepth) {
      this.#records.shift();
      this.#dropped += 1;
    }
    return ok(stored);
  }

  /**
   * Revert the most recent action.
   *
   * @param ctx - The context whose facades perform the writes
   * @returns `NOTHING_TO_UNDO` on an empty stack, the reverter's own error if
   *   the revert failed (with the record left in place), or the reverted record
   */
  async undo(ctx: ToolContext): Promise<Result<UndoRecord, StitchError>> {
    const record = this.#records[this.#records.length - 1];
    if (record === undefined) {
      return err({
        code: 'NOTHING_TO_UNDO',
        message: 'The undo stack is empty: no tool action has been recorded to roll back',
      });
    }
    const reverter = REVERTERS[record.kind];
    const reverted = await reverter(record, ctx);
    if (reverted.isErr()) {
      // The tree was not restored, so the record stays: dropping it would make
      // the history claim a clean state that does not exist.
      return err(reverted.error);
    }
    this.#records.pop();
    return ok(record);
  }

  /** Drop every record, e.g. once a job's writes have been committed. */
  clear(): void {
    this.#records.length = 0;
  }
}

// ---------------------------------------------------------------------------
// Deriving records from tool results
// ---------------------------------------------------------------------------

/** Derives an undo record from one tool's successful result, or `null`. */
export type UndoDeriver = (
  tool: string,
  result: unknown,
  clock: UndoClock
) => Omit<UndoRecord, 'id' | 'ts'> | null;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * `edit_config` (P-152) already returns its own `before`/`after`, so its undo
 * record is a direct projection — no changes to the tool were needed.
 */
const deriveConfigEdit: UndoDeriver = (tool, result) => {
  const r = asRecord(result);
  if (r === null) return null;
  const { path, before, after } = r;
  if (typeof path !== 'string' || typeof before !== 'string') return null;
  return {
    tool,
    kind: 'config_edit',
    before: [{ path, content: before } satisfies FileSnapshot],
    after: [{ path, content: typeof after === 'string' ? after : null } satisfies FileSnapshot],
    paths: [path],
  };
};

/**
 * `move_file` (P-153) returns its `MovePlan`, which already carries `from`,
 * `to` and every `ImportRewrite` the move performed — enough to invert it
 * exactly, including the third-party files it rewrote.
 */
const deriveMove: UndoDeriver = (tool, result) => {
  const r = asRecord(result);
  if (r === null) return null;
  const { from, to, importRewrites } = r;
  if (typeof from !== 'string' || typeof to !== 'string') return null;
  const rewrites: ImportRewrite[] = [];
  if (Array.isArray(importRewrites)) {
    for (const entry of importRewrites) {
      const rewrite = asRecord(entry);
      if (rewrite === null) continue;
      const { file, oldRef, newRef } = rewrite;
      if (typeof file !== 'string' || typeof oldRef !== 'string' || typeof newRef !== 'string') {
        continue;
      }
      rewrites.push({ file, oldRef, newRef });
    }
  }
  return {
    tool,
    kind: 'file_move',
    before: { from, to },
    after: { from: to, to: from },
    paths: [from, to, ...rewrites.map(rw => rw.file)],
    ...(rewrites.length > 0 ? { importRewrites: rewrites } : {}),
  };
};

/**
 * Derivers keyed by tool name.
 *
 * Only tools whose result already carries their before-state appear here.
 * `fix_dependency` and `applyProposal` are deliberately absent: neither returns
 * the prior content of the file it wrote, so an honest undo record cannot be
 * built from their results. Recording them anyway would put an entry in a stack
 * that claims reversibility it does not have. See ADR-034.
 */
export const UNDO_DERIVERS: Readonly<Record<string, UndoDeriver>> = {
  edit_config: deriveConfigEdit,
  move_file: deriveMove,
};

/** Build an undo record for a successful tool result, or `null` if unsupported. */
export function deriveUndoRecord(
  tool: string,
  result: unknown,
  clock: UndoClock = defaultClock()
): UndoRecord | null {
  const deriver = UNDO_DERIVERS[tool];
  if (deriver === undefined) return null;
  const partial = deriver(tool, result, clock);
  if (partial === null) return null;
  return { ...partial, id: clock.newId(), ts: clock.now() };
}

/**
 * The `UndoRecorder` the loop drives, bound to one stack.
 *
 * The null-handling lives HERE rather than in each caller: `deriveUndoRecord`
 * returns `null` for a tool that is not reversible, and spreading that into
 * `push` would throw before `push` could return its error. Callers get a plain
 * boolean — "was this recorded?" — and never have to think about it.
 *
 * A `null` return is a normal outcome, not a failure: most tools do not
 * mutate the tree, and recording them would fill the stack with entries that
 * could never be reverted.
 */
export function createUndoRecorder(stack: UndoStack): UndoRecorder {
  return {
    record(tool: string, result: unknown): boolean {
      const derived = deriveUndoRecord(tool, result, stack.clock);
      if (derived === null) return false;
      // `push` keeps a supplied id/ts and only mints one when absent, so the
      // derived record goes in as-is.
      return stack.push(derived).isOk();
    },
  };
}

// ---------------------------------------------------------------------------
// The tool
// ---------------------------------------------------------------------------

/**
 * Roll back the most recent tool action.
 *
 * `gated` because a revert is itself a mutation: it needs the same human
 * approval as the change being undone, and P-160's queue is what asks.
 */
export async function revertLastToolAction(
  stack: UndoStack,
  ctx: ToolContext
): Promise<Result<{ reverted: UndoRecord }, StitchError>> {
  const undone = await stack.undo(ctx);
  if (undone.isErr()) return err(undone.error);
  return ok({ reverted: undone.value });
}
