// P-161 — the `revert_last` agent tool.
//
// GATED, deliberately. A revert is itself a mutation of the working tree, so it
// needs the same human approval as the change it is undoing — the risk is
// symmetric, and P-160's HIL queue is what asks. An `auto` revert would let a
// model undo a human's deliberate fix by asking twice.
//
// The stack is INJECTED, never constructed. The tool layer must not be able to
// create its own undo history: a stack that a tool made up is a stack with no
// record of what actually happened, which is worse than no revert at all. The
// loop owns the stack and hands it in.

import { z } from 'zod';
import { ok, err, type Result } from 'neverthrow';
import type { ToolContext, ToolDefinition } from '../../ai/types.js';
import { type StitchError } from '../../result/index.js';
import { revertLastToolAction, type UndoStack } from '../revert.js';

/** The schema: no required arguments, because there is nothing to choose. */
export const revertLastSchema = {
  /** Optional label echoed back so a model can confirm what it undid. */
  reason: z.string().max(500).optional(),
} as const;

/** Build the `revert_last` tool over an injected stack. */
export function createRevertLastTool(stack: UndoStack): ToolDefinition {
  return {
    name: 'revert_last',
    description:
      'Roll back the most recent tool action that recorded undo state (currently edit_config and move_file). ' +
      'Requires human approval. Use this when a previous fix was wrong.',
    schema: revertLastSchema,
    // Gated: a revert mutates the tree and must be approved like any other
    // change. P-160's queue parks it for a human like any other gate.
    autonomy: 'gated',
    execute: async (args: unknown, ctx: ToolContext): Promise<Result<unknown, StitchError>> => {
      const candidate =
        args !== null && typeof args === 'object' ? (args as { reason?: unknown }) : {};
      const parsed = z.object(revertLastSchema).safeParse(candidate);
      if (!parsed.success) {
        return err({
          code: 'TOOL_ARGS_VALIDATION',
          message: `revert_last arguments validation failed: ${parsed.error.issues
            .map(i => `${i.path.length > 0 ? '/' + i.path.join('/') : '(root)'}: ${i.message}`)
            .join('; ')}`,
        });
      }
      const undone = await revertLastToolAction(stack, ctx);
      if (undone.isErr()) return err(undone.error);
      const record = undone.value.reverted;
      return ok({
        reverted: {
          tool: record.tool,
          kind: record.kind,
          paths: record.paths,
          ts: record.ts,
        },
        reason: parsed.data.reason ?? null,
      });
    },
  };
}
