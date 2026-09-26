// Tool-Calling Block Policy (P-143).
//
// Enforces the blocked-by-default policy for models whose tool calling is
// unreliable (notably certain Gemini-3 variants): a tools task refuses to run
// on such a model unless the id is explicitly listed in
// `[ai].overrideToolModels` (P-009).

import { ok, err, type Result } from 'neverthrow';
import { isToolCallingBlocked, type ModelSpec, type ToolCallPolicyConfig } from './models.js';
import { type StitchError } from '../result/index.js';

// Re-exported so consumers of the policy get one import surface (the shape
// lives in models.ts next to ModelSpec / ToolCallingPolicy).
export { isToolCallingBlocked } from './models.js';
export type { ToolCallingPolicy, ToolCallPolicyConfig, ModelSpec } from './models.js';

/**
 * Enforce tool-calling policy for a model.
 *
 * @param model - Model being asked to run a tools task
 * @param config - Policy overrides (`[ai].overrideToolModels`)
 * @returns `ok(undefined)` when tools are permitted, otherwise
 *   `err('TOOL_CALLING_BLOCKED')` carrying the offending model id and the
 *   remedy (how to opt in).
 */
export function enforceToolCallPolicy(
  model: ModelSpec,
  config: ToolCallPolicyConfig
): Result<void, StitchError> {
  if (!isToolCallingBlocked(model, config)) {
    return ok(undefined);
  }
  return err({
    code: 'TOOL_CALLING_BLOCKED',
    message: `Tool calling is blocked by default for model ${model.id}`,
    model: model.id,
    remedy: 'Add model to [ai].overrideToolModels in stitch.toml to opt in',
  });
}

/** Default policy config (empty overrides — nothing opted in). */
export const defaultToolCallPolicyConfig: ToolCallPolicyConfig = {
  overrideToolModels: [],
};
