// P-148 — agent module barrel.
//
// Epic 7 (P-148–P-167) grows under this barrel: tools, the autonomy policy
// engine (P-157), the agent state machine (P-159), the HIL approval queue
// (P-160), and tool rollback (P-161). Mirrors `ai/index.ts` so consumers have
// one import surface per module.

export type {
  SourceRepo,
  SelectedFile,
  SelectionFilter,
  FileSelection,
  SelectFilesArgs,
  DepClosure,
  DepSeverity,
  Gap,
  GapKind,
  DetectGapsOptions,
  DepSection,
  FixResult,
  LatestVersionResolver,
  ApplyDependencyFixOptions,
  ConfigEdit,
  ConfigEditResult,
  ConfigFormat,
  MovePlan,
  ImportRewrite,
  ComponentProposal,
  ComponentSpec,
  BuildOutcome,
  BuildCmd,
  BuildEcosystem,
  UserQuestion,
  UserAnswer,
  Autonomy as ToolAutonomy,
  AutonomyOverride,
  PolicyDecision,
  AutonomyPolicyConfig,
} from './types.js';
export {
  AutonomyPolicy,
  defaultAutonomyPolicy,
  policyFromAgentConfig,
  DEFAULT_GATED_TOOLS,
  ALWAYS_ALLOWED_TOOLS,
} from './policy.js';
export type { PolicyContext } from './policy.js';
// P-158 tool args/result validation.
export {
  validateToolResult,
  sanitizeToolArgs,
  validateToolCall,
  createToolValidator,
  auditValidationFailure,
  MAX_TOOL_RESULT_BYTES,
  MAX_TOOL_ARGS_DEPTH,
  FORBIDDEN_ARG_KEYS,
  STRICT_PATH_SAFE,
} from './validation.js';
export type {
  ValidationLimits,
  ValidationStage,
  ValidationKind,
  ValidationFailureDetail,
  ToolValidatorOptions,
} from './validation.js';
// P-159 agent state machine.
export {
  AgentStateMachine,
  AGENT_STATES,
  LEGAL_TRANSITIONS,
  canTransition,
  isTerminalState,
  isWaitingState,
  canStartToolFrom,
  isAgentState,
  memoryStateStore,
  MAX_STATE_HISTORY,
} from './state.js';
export type {
  AgentState,
  StateChange,
  AgentStateStore,
  AgentStateMachineOptions,
} from './state.js';
// P-160 HIL approval queue.
export { HilQueue, HIL_TABLES_SQL } from './hil.js';
export type {
  HilKind,
  HilStatus,
  HilRequest,
  HilResolution,
  HilEnqueue,
  HilQueueOptions,
  HilWaitOptions,
} from './hil.js';
// P-161 undo stack.
export {
  UndoStack,
  REVERTERS,
  UNDO_DERIVERS,
  MAX_UNDO_DEPTH,
  deriveUndoRecord,
  revertLastToolAction,
} from './revert.js';
export type { Reverter, UndoClock, UndoDeriver, UndoStackOptions } from './revert.js';
export { createRevertLastTool, revertLastSchema } from './tools/revert_last.js';
export type { UndoKind, UndoRecord, FileSnapshot } from './types.js';
// P-162 reasoning stream.
export { ReasoningStream, MAX_REASONING_HISTORY, reasoningText } from './reasoning.js';
export type { ReasoningEvent, ReasoningListener, ReasoningSink } from './reasoning.js';
// P-163 error classification and recovery.
export {
  classifyError,
  handleError,
  friendlyError,
  fromUnknownThrow,
  CLASSIFIED_CODES,
} from './errors.js';
export type {
  ErrorClass,
  RecoveryAction,
  ErrorClassification,
  ErrorBudget,
  RecoveryDecision,
} from './errors.js';
// P-164 loop cap.
export { LoopCapGuard, resolveCap, readCapConfig, DEFAULT_MAX_ITERATIONS } from './cap.js';
export type { LoopCap, LoopContext, CapKind, CapStop, CapConfigInput } from './cap.js';
export {
  MAX_SELECTED_FILES,
  emptyDepClosure,
  GAP_KINDS,
  MAX_BUILD_LOG_LINES,
  DEFAULT_MAX_ASK_TIMEOUT_MS,
} from './types.js';

export {
  selectFilesTool,
  selectFilesSchema,
  resolveDepsTool,
  resolveDepsSchema,
  resolveDependenciesForFiles,
  detectGapsTool,
  detectGapsSchema,
  detectGaps,
  envUsages,
  declaredEnvVars,
  sortGaps,
  fixDependencyTool,
  fixDependencySchema,
  runFixDependency,
  applyDependencyFix,
  planDependencyFix,
  resolveFixRange,
  serializeFixedManifest,
  rangesEquivalent,
  editConfigTool,
  editConfigSchema,
  applyConfigEdit,
  revertConfigEdit,
  assertWithinRoot,
  getUndoEntry,
  listUndoEntries,
  clearUndoStackForTests,
  moveFileTool,
  moveFileSchema,
  planMove,
  executeMove,
  rewriteSpecifier,
  rewriteImportRefs,
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
  runBuildTool,
  runBuildSchema,
  runBuildForStage,
  inferEcosystem,
  commandsFor,
  boundLogs,
  detectEcosystemFromListing,
  describeOutcome,
  ECOSYSTEM_COMMANDS,
  askUserTool,
  askUserSchema,
  askUser,
  resolveAskTimeout,
  validateAnswer,
  registerAgentTool,
  getAgentTool,
  listAgentTools,
  hasAgentTool,
  clearAgentToolsForTests,
} from './tools/index.js';
export type { SelectFilesResult } from './tools/index.js';
export type {
  DependencyFixPlan,
  FixDependencyOutcome,
  FixDependencyOptions,
  ApplyConfigEditOptions,
  ConfigValidator,
  UndoEntry,
  PlanMoveOptions,
  RunBuildOptions,
  AskUserOptions,
} from './tools/index.js';
export type { DiffHunk, DiffLine } from './diff.js';
export { unifiedDiff, buildHunks } from './diff.js';
export {
  detectConfigFormat,
  parseConfig,
  serializeConfig,
  stripJsonComments,
  parseKeyPath,
  assertSafeKeyPath,
  getAtPath,
  setAtPath,
  removeAtPath,
  deepMerge,
} from './configDoc.js';

// P-165 — the production git facade: agent tools address real git state.
export { GitFacade, createGitFacade, withinRepoRoot, parseOriginTrailer } from './gitFacade.js';
export type { FacadePaths, StitchOrigin, StageCommitOptions, CommitInfo } from './gitFacade.js';

// P-149 import extraction (pure, exported for reuse by P-150/P-151).
export {
  parseJsImports,
  parsePythonImports,
  jsPackageName,
  pythonPackageName,
  classifyJsSpecifier,
  resolveRelativeImport,
} from './imports.js';
export type { SpecifierKind } from './imports.js';
