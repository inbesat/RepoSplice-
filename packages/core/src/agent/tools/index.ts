// P-148 — agent tool registry.
//
// The tool-loop (P-140) consumes a flat `ToolDefinition[]`, but tools are
// authored one file at a time across Epic 7 (P-148–P-156). This registry is
// the single place that maps a tool name to its definition, so a tool can be
// registered once and offered to the loop (and to the provider's advertised
// tool schemas) without every caller assembling the list by hand.
//
// All mutations return `Result` rather than throwing: a duplicate or unknown
// name is a caller bug, and the registry reports it as a typed `StitchError`
// so it flows through the same error surface as every other core failure.

import { ok, err, type Result } from 'neverthrow';
import { stitchErrorMessage, type StitchError } from '../../result/index.js';
import type { ToolDefinition } from '../../ai/types.js';
import { selectFilesTool } from './select_files.js';
import { resolveDepsTool } from './resolve_deps.js';
import { detectGapsTool } from './detect_gaps.js';
import { fixDependencyTool } from './fix_dependency.js';
import { editConfigTool } from './edit_config.js';
import { moveFileTool } from './move_file.js';
import { proposeComponentTool } from './propose_component.js';
import { runBuildTool } from './run_build.js';
import { askUserTool } from './ask_user.js';

export { selectFilesTool, selectFilesSchema } from './select_files.js';
export type { SelectFilesResult } from './select_files.js';
export { resolveDepsTool, resolveDepsSchema, resolveDependenciesForFiles } from './resolve_deps.js';
export {
  detectGapsTool,
  detectGapsSchema,
  detectGaps,
  envUsages,
  declaredEnvVars,
  sortGaps,
} from './detect_gaps.js';
export {
  fixDependencyTool,
  fixDependencySchema,
  runFixDependency,
  applyDependencyFix,
  planDependencyFix,
  resolveFixRange,
  serializeFixedManifest,
  rangesEquivalent,
} from './fix_dependency.js';
export type {
  DependencyFixPlan,
  FixDependencyOutcome,
  FixDependencyOptions,
} from './fix_dependency.js';
export {
  editConfigTool,
  editConfigSchema,
  applyConfigEdit,
  revertConfigEdit,
  assertWithinRoot,
  getUndoEntry,
  listUndoEntries,
  clearUndoStackForTests,
} from './edit_config.js';
export type { ApplyConfigEditOptions, ConfigValidator, UndoEntry } from './edit_config.js';
export {
  moveFileTool,
  moveFileSchema,
  planMove,
  executeMove,
  rewriteSpecifier,
  rewriteImportRefs,
} from './move_file.js';
export type { PlanMoveOptions } from './move_file.js';
export {
  proposeComponentTool,
  proposeComponentSchema,
  draftComponent,
  applyProposal,
  normalizeComponentName,
  sourceExtension,
  siblingTestPath,
  scaffoldCode,
  scaffoldTests,
  registrationSnippet,
  appendSnippet,
} from './propose_component.js';
export {
  runBuildTool,
  runBuildSchema,
  runBuildForStage,
  inferEcosystem,
  commandsFor,
  boundLogs,
  detectEcosystemFromListing,
  describeOutcome,
  ECOSYSTEM_COMMANDS,
} from './run_build.js';
export type { RunBuildOptions } from './run_build.js';
export {
  askUserTool,
  askUserSchema,
  askUser,
  resolveAskTimeout,
  validateAnswer,
} from './ask_user.js';
export type { AskUserOptions } from './ask_user.js';

/** name -> definition, in registration order. */
const agentTools = new Map<string, ToolDefinition>();

/**
 * Register a tool definition.
 *
 * Rejects a duplicate name rather than silently overwriting: two tools
 * answering to one name would make the loop's dispatch ambiguous, and the
 * provider-facing schema list would advertise a nondeterministic contract.
 */
export function registerAgentTool(tool: ToolDefinition): Result<void, StitchError> {
  if (agentTools.has(tool.name)) {
    return err({
      code: 'CONFIG_ERROR',
      field: `agentTools.${tool.name}`,
      message: `Agent tool "${tool.name}" is already registered`,
    });
  }
  agentTools.set(tool.name, tool);
  return ok(undefined);
}

/** Look up one tool by name. */
export function getAgentTool(name: string): Result<ToolDefinition, StitchError> {
  const tool = agentTools.get(name);
  if (tool === undefined) {
    return err({ code: 'UNKNOWN_TOOL', message: `Unknown agent tool: ${name}` });
  }
  return ok(tool);
}

/** Every registered tool, in registration order — the shape `runToolLoop` wants. */
export function listAgentTools(): ToolDefinition[] {
  return [...agentTools.values()];
}

/** True when a tool with this name is registered. */
export function hasAgentTool(name: string): boolean {
  return agentTools.has(name);
}

/** Drop every registration. Test-only; production never unregisters a tool. */
export function clearAgentToolsForTests(): void {
  agentTools.clear();
}

// P-148's, P-149's, and P-150's tools are registered at module load so
// importing the registry is enough to offer them to the loop.
for (const tool of [
  selectFilesTool,
  resolveDepsTool,
  detectGapsTool,
  fixDependencyTool,
  editConfigTool,
  moveFileTool,
  proposeComponentTool,
  runBuildTool,
  askUserTool,
]) {
  const registered = registerAgentTool(tool);
  if (registered.isErr()) {
    // Unreachable: the map starts empty, so there is no name to collide with.
    // Surfaced as a thrown Error (not a literal) because a module-load
    // invariant violation must stop startup rather than ship a partial registry.
    throw new Error(
      `agent tool registry bootstrap failed: ${stitchErrorMessage(registered.error)}`
    );
  }
}
