export const CORE_NAME = '@repo-stitcher/core';

export {
  GitHubAuthTypeSchema,
  GitHubConfigSchema,
  OpenRouterConfigSchema,
  AnthropicConfigSchema,
  OllamaConfigSchema,
  SandboxBackendSchema,
  SandboxLimitsSchema,
  SandboxConfigSchema,
  PathsConfigSchema,
  LicensePolicySchema,
  AutonomySchema,
  ConfigSchema,
  defaultConfig,
  loadConfig,
} from './config/schema.js';
export type {
  GitHubAuthType,
  GitHubConfig,
  OpenRouterConfig,
  AnthropicConfig,
  OllamaConfig,
  SandboxBackend,
  SandboxLimits,
  SandboxConfig,
  PathsConfig,
  LicensePolicy,
  Autonomy,
  Config,
  ConfigLayer,
} from './config/schema.js';
export { configJsonSchema } from './config/jsonSchema.js';

export { logger, createJobLogger } from './logger/index.js';
export { redactPaths } from './logger/redact.js';

export {
  Result,
  ResultAsync,
  ok,
  err,
  okAsync,
  errAsync,
  fromPromise,
  fromSafePromise,
  fromThrowable,
  fromAsyncThrowable,
  fromInternalPromise,
  match,
  stitchOk,
  stitchErr,
  STITCH_ERROR_CODES,
} from './result/index.js';
export type { Ok, Err, ResultType, StitchError, StitchErrorCode } from './result/index.js';

export {
  monotonicId,
  shortId,
  longId,
  _resetIdCountersForTests,
  toPosix,
  normalizePath,
  trimTrailingSep,
  resolveWithin,
  safeJoin,
  buildIgnoreMatcher,
  shouldIgnore,
  createLimiter,
  withLimit,
  mapLimit,
  parseYaml,
  parseYamlDocument,
  stringifyYaml,
  Document,
  YAMLError,
  parseIni,
  stringifyIni,
  listFiles,
  ensureDir,
  emptyDir,
  removePath,
  pathExists,
  copyTree,
  movePath,
} from './util/index.js';
export type {
  IgnoreMatcher,
  BuildIgnoreMatcherOptions,
  Limiter,
  LimitedTask,
  ParseOptions,
  DocumentOptions,
  ToStringOptions,
  IniValue,
  ListFilesOptions,
  CopyMoveOptions,
} from './util/index.js';

export {
  createGit,
  checkGitAvailable,
  isRepo,
  getStatus,
  getLog,
  initRepo,
  MIN_GIT_VERSION,
  parseGitVersion,
  isGitVersionSupported,
  checkGitVersionOutput,
  localGitVersion,
  checkFilterRepoStatus,
  cloneRepo,
  redactUrlCredentials,
  DEFAULT_CLONE_DEPTH,
  DEFAULT_CLONE_TIMEOUT_MS,
  extractPathsViaFilterRepo,
  DEFAULT_FILTER_REPO_TIMEOUT_MS,
  listTags,
  renameTags,
  mergeRepos,
  MERGE_AUTHOR_NAME,
  MERGE_AUTHOR_EMAIL,
  MERGE_FIXED_DATE,
  subtreeAdd,
  selectExtractStrategy,
  DEFAULT_SUBTREE_TIMEOUT_MS,
  SUBTREE_AUTHOR_NAME,
  SUBTREE_AUTHOR_EMAIL,
  cherryPickRange,
  DEFAULT_CHERRY_PICK_TIMEOUT_MS,
  detectConflicts,
  resolveConflicts,
  classifyStages,
  unionGitignoreSides,
  resolveTargetPath,
  DEFAULT_CONFLICT_TIMEOUT_MS,
  writeToWorktree,
  removeWorktree,
  parseWorktreeList,
  samePath,
  DEFAULT_WORKTREE_TIMEOUT_MS,
  commitWithTrailers,
  buildCommitMessage,
  DEFAULT_COMMIT_TIMEOUT_MS,
  pushToRemote,
  parseGitHubRemote,
  DEFAULT_PUSH_TIMEOUT_MS,
  DEFAULT_PROTECTED_BRANCHES,
  buildBlameMap,
  saveBlameMap,
  loadBlameMap,
  parseBlamePorcelain,
  DEFAULT_BLAME_TIMEOUT_MS,
  createBranch,
  deleteBranch,
  renameBranch,
  DEFAULT_BRANCH_TIMEOUT_MS,
  safeStash,
  safeStashPop,
  DEFAULT_STASH_TIMEOUT_MS,
  DEFAULT_STASH_MESSAGE,
  isBinary,
  classifyFiles,
  parseCheckAttr,
  saveSkipList,
  loadSkipList,
  DEFAULT_BINARY_TIMEOUT_MS,
  mergeGitignores,
  collectGitignores,
  mergeIgnoreTexts,
  rebasePattern,
  DEFAULT_GITIGNORE_GENERATED_AT,
  isClean,
  assertClean,
  parsePorcelainStatus,
  DEFAULT_CLEAN_TIMEOUT_MS,
  abortGitOp,
  resetTo,
  rollbackJob,
  DEFAULT_ROLLBACK_TIMEOUT_MS,
  DEFAULT_RESET_STASH_MESSAGE,
  mapParallel,
  createRefCache,
  fetchCached,
  runExclusive,
  withBloblessFilter,
  cloneMany,
  BLOBLESS_FILTER_ARG,
  DEFAULT_PERF_CONCURRENCY,
} from './git/index.js';
export type {
  Git,
  GitFactoryOptions,
  FilterRepoStatus,
  CloneCredentials,
  CloneGit,
  CloneOptions,
  CloneRuntime,
  FilterRepoOptions,
  FilterRepoOutput,
  FilterRepoRunner,
  FilterRepoRuntime,
  RenameTagsOptions,
  RenameTagsResult,
  TagRenameRuntime,
  MergeSource,
  MergeAuthor,
  MergeOptions,
  MergeResult,
  MergeGit,
  MergeStatus,
  MergeLog,
  MergeRuntime,
  ConflictInput,
  ConflictResolver,
  CloneLike,
  FilterRepoLike,
  ListTagsLike,
  SubtreeOpts,
  SubtreeGit,
  SubtreeRuntime,
  ExtractStrategy,
  StrategyInput,
  CherryPickOpts,
  CherryPickResolveInput,
  CherryPickResolver,
  CherryPickStatus,
  CherryPickGit,
  CherryPickRuntime,
  Conflict,
  ConflictGate,
  ConflictKind,
  ConflictOpts,
  ConflictProposal,
  ConflictRecommendation,
  ConflictRunResult,
  ConflictRunner,
  ConflictRuntime,
  ConflictStages,
  GatedConflict,
  GateDecision,
  ManifestMerge,
  ResolvedConflict,
  ResolutionStrategy,
  ResolveReport,
  VerifyVerdict,
  VerifyTree,
  WorktreeFile,
  WriteWorktreeOpts,
  WriteWorktreeResult,
  RemoveWorktreeOpts,
  WorktreeRunResult,
  WorktreeRunner,
  WorktreeFs,
  WorktreeRuntime,
  CoAuthor,
  CommitOpts,
  CommitRunner,
  CommitRunResult,
  CommitRuntime,
  PushOpts,
  PushRunner,
  PushRunResult,
  PushRuntime,
  RemoteRepoCheck,
  RepoCreator,
  GitHubRemote,
  BlameSource,
  LineOrigin,
  FileBlame,
  BlameMap,
  BlameOpts,
  BlameRunner,
  BlameRunResult,
  BlameRuntime,
  BranchOpts,
  BranchRunner,
  BranchRunResult,
  BranchRuntime,
  StashOpts,
  PopOpts,
  StashOutcome,
  PopOutcome,
  StashRunner,
  StashRunResult,
  StashRuntime,
  SkipReason,
  SkipDecision,
  BinaryOpts,
  BinaryRuntime,
  BinaryFs,
  BinaryRunResult,
  BinaryRunner,
  BinaryVerdict,
  ClassifiedFiles,
  SkipList,
  GitignoreSource,
  GitignoreRoot,
  GitignoreMergeOpts,
  MergedGitignore,
  MergeEntry,
  MergedIgnoreTexts,
  CleanOpts,
  PorcelainEntry,
  PorcelainState,
  CleanRunResult,
  CleanRunner,
  CleanRuntime,
  AbortKind,
  AbortOpts,
  ResetStashOpts,
  ResetOpts,
  ResetOutcome,
  JobSnapshot,
  RollbackOutcome,
  RollbackOpts,
  RollbackRunResult,
  RollbackRunner,
  RollbackRuntimes,
  RefEntry,
  RefCache,
  CachedValue,
  CloneSpec,
  CloneManyOpts,
} from './git/index.js';

export { createOctokit, request, getRepo, statusToStitchError } from './github/factory.js';
export type {
  OctokitPatAuth,
  OctokitAppAuth,
  OctokitAuth,
  OctokitFactoryOptions,
} from './github/factory.js';
export {
  createValidatedClient,
  resolveAuth,
  clientFromConfig,
  validateAuth,
} from './github/auth.js';
export type {
  AuthClient,
  AuthContext,
  AuthEndpoint,
  AuthenticatedUser,
  ClientFromConfigOpts,
  ResolveAuthSecrets,
  ValidateAuthOpts,
} from './github/auth.js';
export { listRepos, searchRepos } from './github/list.js';
export type {
  RepoClient,
  RepoListEndpoint,
  RepoSearchEndpoint,
  RepoSearchResult,
  RepoSort,
  RepoSummary,
  RepoVisibility,
  ListReposOpts,
  SearchReposOpts,
} from './github/list.js';
export { getRepoTree, buildNestedTree } from './github/tree.js';
export type {
  TreeClient,
  TreeEndpoint,
  RepoMetaEndpoint,
  TreeEntryType,
  TreeNode,
  NestedKind,
  NestedEntry,
  RepoTree,
  GetRepoTreeOpts,
} from './github/tree.js';
export { getFileContent, getFileContentsBatch } from './github/content.js';
export type {
  BlobContent,
  FileContentOpts,
  BatchSpec,
  BatchOpts,
  ContentClient,
  ContentMetaEndpoint,
} from './github/content.js';
export { createRepoC } from './github/create.js';
export type { CreateSpec, CreatedRepo, CreateClient, RepoCreateEndpoint } from './github/create.js';
export {
  createBranch as createRemoteBranch,
  deleteBranch as deleteRemoteBranch,
  renameBranch as renameRemoteBranch,
  protectBranch,
  setStatus,
} from './github/branches.js';
export type {
  BranchClient,
  BranchGitEndpoint,
  BranchReposEndpoint,
  CommitState,
  CreatedBranch,
  ProtectOpts,
  ProtectionRules,
  RequiredStatusChecks,
  StatusOpts,
} from './github/branches.js';
export { openPR, buildPrBody } from './github/pr.js';
export type {
  PrBodySections,
  PrSpec,
  PrStatusOpts,
  PrOpts,
  OpenedPr,
  PrPullsEndpoint,
  PrClient,
} from './github/pr.js';
export { graphqlTree, buildTreeQuery } from './github/graphql.js';
export type { GraphqlOpts, GraphqlClient, GraphqlEndpoint } from './github/graphql.js';
export {
  relayWorkflowRun,
  findRunsForSha,
  verifyWebhookSignature,
  mapWebhookEvent,
  correlateRunToJob,
} from './github/actionsStatus.js';
export type {
  RunKind,
  WorkflowRunEvent,
  JobRef,
  FindRunsOpts,
  ActionsRunsEndpoint,
  ActionsClient,
} from './github/actionsStatus.js';
export { withRateLimit, parseRateHeaders } from './github/rateLimit.js';
export type { RetryInfo, RateLimitOpts, RateState } from './github/rateLimit.js';
export {
  mapGitHubError,
  mapGitHubStatus,
  rateLimitExhausted,
  GITHUB_LOGIN_HINT,
  GITHUB_CONFLICT_HINT,
  GITHUB_NETWORK_HINT,
  GITHUB_NOT_FOUND_HINT,
  GITHUB_BACKOFF_HINT,
} from './github/errors.js';
export type { GitHubErrorContext } from './github/errors.js';
export { detectRepoLicense } from './github/license.js';
export type {
  DetectedLicense,
  DetectLicenseOpts,
  LicensesEndpoint,
  LicenseClient,
} from './github/license.js';
export {
  ensureFork,
  forkPrHead,
  DEFAULT_FORK_POLL_ATTEMPTS,
  DEFAULT_FORK_POLL_INTERVAL_MS,
} from './github/fork.js';
export type {
  ForkInfo,
  ForkUpstream,
  EnsureForkOpts,
  ForkReposEndpoint,
  ForkClient,
} from './github/fork.js';
export {
  triggerSandbox,
  monitorSandboxRun,
  DEFAULT_SANDBOX_EVENT_TYPE,
} from './github/sandboxTrigger.js';
export type {
  SandboxDispatchKind,
  TriggerSandboxOpts,
  SandboxDispatch,
  MonitorSandboxOpts,
  SandboxRunVerdict,
  SandboxReposEndpoint,
  SandboxActionsEndpoint,
  SandboxTriggerClient,
} from './github/sandboxTrigger.js';

export { validRange, coerce, satisfies, intersects, semver } from './deps/semver.js';
export type { SemVer, RangeOptions } from './deps/semver.js';
export { resolveCollision, toSuggestedResolution, maxSatisfying } from './deps/semver.js';
export type { CollisionBasis, CollisionResolution } from './deps/semver.js';
// Deps merge taxonomy keeps its spec names (`Conflict`, `MergeResult`)
// inside `deps/*`; the public barrel aliases them because git already
// owns those identifiers (merge-op result, file-conflict shape).
// cli/web import `DepsConflict`/`DepsMergeResult` for P-116/P-219.
export type {
  NpmManifest,
  PythonManifest,
  CargoManifest,
  GoManifest,
  ParsedManifest,
  Conflict as DepsConflict,
  UnifiedManifest,
  MergeResult as DepsMergeResult,
} from './deps/types.js';
export { parsePackageJson, serializePackageJson } from './deps/parse/index.js';
export {
  parseRequirementsTxt,
  parsePyprojectToml,
  parsePythonManifest,
  parseCargoToml,
  parseGoMod,
  serializeGoMod,
} from './deps/parse/index.js';
export { recordMerge, sourceLabel, unionManifests } from './deps/merge.js';
export type { RecordMergeOptions, RecordMergeResult } from './deps/merge.js';
export { detectPeerConflicts, suggestPeerFix } from './deps/peer.js';
export type { PeerConflict } from './deps/peer.js';
export { chooseDedupeStrategy } from './deps/dedupe.js';
export type { DedupeStrategy, DedupeResult, DedupeOptions } from './deps/dedupe.js';
export { mergeScripts } from './deps/scripts.js';
export {
  mergeTsConfig,
  mergeViteConfig,
  mergeEslintConfig,
  mergeGenericJson,
} from './deps/config.js';
export type { ConfigMergeResult } from './deps/config.js';
export { regenerateLockfile, buildLockfileCommand } from './deps/lockfile.js';
export type {
  LockfileResult,
  RegenerateLockfileOptions,
  LockfileCommand,
} from './deps/lockfile.js';
export { generateDepReport, renderReportJson } from './deps/report.js';
export type { DependencyReport, ConflictStatus } from './deps/types.js';
export { detectEcosystems, classifyManifest, DEFAULT_ECOSYSTEM_IGNORE } from './deps/ecosystem.js';
export type {
  Ecosystem,
  EcosystemParser,
  DetectedEcosystem,
  DetectEcosystemsOptions,
} from './deps/ecosystem.js';

export { initTreeSitter, loadLanguage, parse, isSupportedLanguage } from './analysis/treeSitter.js';
export type { SupportedLanguage, Language, Tree } from './analysis/treeSitter.js';

export { findCycles, hasCycles, filesInCycles } from './analysis/circular.js';
export type { FindCyclesOptions } from './analysis/circular.js';

export { scanDeclared, writeFixturePkg } from './license/scan.js';
export type { DeclaredLicense, ScanDeclaredOptions } from './license/scan.js';

// License compliance surface (P-119-P-124) through the license barrel.
// The compliance `LicensePolicy` is aliased to avoid colliding with the
// config schema's `LicensePolicy` already exported above.
export {
  normalizeToSPDX,
  isValidSPDX,
  normalizeExpression,
  parseLicenses,
  LICENSE_CATEGORIES,
  checkCompatibility,
  parseOrExpression,
  chooseDualLicense,
  checkGpl,
  GPL_REMEDIATIONS,
  detectUnknown,
  recordLicenseDecision,
  getPendingUnknown,
  clearLicenseDecisionsForTests,
  getAllUnknownForTests,
  aggregateLicenseReport,
  aggregateLicenseReportWithGplOpts,
  runScanCode,
  setDeepScanConfigForTests,
  clearDeepScanConfigForTests,
  setDeepScanExecForTests,
} from './license/index.js';
export type {
  DualDecision,
  GplWarning,
  GplSeverity,
  UnknownLicense,
  LicenseReport,
  LicenseCategory,
  CompatibilityResult,
  LicensePolicy as LicenseCompliancePolicy,
  DeepScanFile,
  DeepScanResult,
} from './license/index.js';

export { parseExpr, collectLicenses } from './license/expr.js';
export type { LicenseExpr } from './license/expr.js';

export { normalizeLicense, UNKNOWN_LICENSE } from './license/normalize.js';
export { lookupLicense, isKnown, size as spdxRegistrySize } from './license/spdxIndex.js';
export type { LicenseInfo } from './license/spdxIndex.js';

export { createOpenAICompatible, resolveBaseURL, DEFAULT_BASE_URLS, OpenAI } from './ai/openai.js';
export type {
  OpenAICompatibleProviderId,
  OpenAICompatibleOptions,
  OpenAICompatibleClient,
  ClientOptions,
} from './ai/openai.js';

export {
  createAnthropicClient,
  resolveAnthropicBaseURL,
  ANTHROPIC_DEFAULT_BASE_URL,
  ANTHROPIC_DEFAULT_BASE_URLS,
  Anthropic,
  AnthropicError,
} from './ai/anthropic.js';
export type {
  AnthropicProviderId,
  AnthropicClientOptions,
  AnthropicClient,
} from './ai/anthropic.js';
export { conformsToChatProvider, isRetryableError } from './ai/provider.js';
export type { ChatProvider } from './ai/provider.js';
export type { OpenAICompatibleConfig } from './ai/config.js';
export { OpenAICompatibleProvider, mapSdkError } from './ai/openaiCompatible.js';
export type { ChatCompletionsPort, PortCreateArgs } from './ai/openaiCompatible.js';
export { AnthropicProvider } from './ai/anthropicProvider.js';
export {
  createProvider,
  registerProvider,
  getProviderFactory,
  providerRegistry,
  resolveApiKey,
  setActiveProvider,
  getActiveProvider,
  clearActiveProviderForTests,
} from './ai/registry.js';
export type { ProviderConfig, ProviderFactory } from './ai/registry.js';
export { ProviderConfigSchema, PROVIDER_ENV_KEYS } from './ai/config.js';
export { getModel, getRecommendedFor, assertModelCapable, MODELS } from './ai/models.js';
export type { ModelSpec } from './ai/models.js';
export { MockProvider, createMockProvider, mockScriptFromText } from './ai/mock.js';
export type { MockConfig, MockStep } from './ai/mock.js';
export {
  AiAuditLog,
  redactAuditText,
  redactProviderError,
  newAuditId,
  nowIso,
  AI_CALLS_TABLE_SQL,
  DEFAULT_FLUSH_EVERY,
  DEFAULT_QUERY_LIMIT,
  MAX_QUERY_LIMIT,
} from './ai/audit.js';
export type {
  AiCallAudit,
  AiCallQuery,
  AiAuditLogOptions,
  AiUserQuestion,
  AiUserQuestionRecord,
  AiPolicyDecision,
  AiPolicyDecisionRecord,
  AiValidationFailure,
  AiValidationFailureRecord,
} from './ai/audit.js';
export {
  ProviderManager,
  switchProvider,
  buildFailoverOrder,
  isFailoverCandidate,
  shouldFailover,
  DEFAULT_MAX_FAILOVER_SWITCHES,
} from './ai/switch.js';
export type { ProviderSwitchInfo, SwitchProviderOptions } from './ai/switch.js';
export { PROVIDER_SWITCH_TASK, ASK_USER_TASK, POLICY_TASK, VALIDATION_TASK } from './ai/audit.js';
export type { AiProviderSwitch, AiProviderSwitchRecord } from './ai/audit.js';
export { promptVersion } from './ai/prompts.js';
export { openSqlite, STITCH_DB_FILENAME } from './db/sqlite.js';
export type { SqliteHandle, OpenSqliteOptions } from './db/sqlite.js';
export { streamChat, streamChatToString } from './ai/stream.js';
export type { ReasoningChunk } from './ai/types.js';
export {
  countTokens,
  countTokensAccurate,
  estimateCost,
  CostTracker,
  estimateCallCost,
  shouldRequestApproval,
} from './ai/cost.js';
export type { CostBudget } from './ai/cost.js';
export {
  backoffDelay,
  withRetry,
  retryProviderCall,
  isProviderErrorRetryable,
} from './ai/retry.js';
export type { RetryOpts, RetryInfo as RetryAttemptInfo } from './ai/retry.js';
export { zodToJsonSchema, parseToolArgs, toolSchemaToProvider } from './ai/toolAdapter.js';
export { runToolLoop } from './ai/loop.js';
export type {
  ToolDefinition,
  ToolContext,
  LoopConfig,
  LoopResult,
  GitFacade,
  DepsFacade,
  LicenseFacade,
  StagingFacade,
  SandboxRunner,
  SandboxRunRequest,
  SandboxRunResult,
  HumanQuestion,
  HumanResponse,
  HumanResponder,
  PolicyVerdict,
  ToolPolicyEvaluator,
  ToolValidator,
  AgentStateController,
  HilGate,
  HilGateRequest,
  HilGateOutcome,
  UndoRecorder,
  ReasoningEventLike,
  AgentErrorRouter,
  LoopCapLike,
} from './ai/types.js';
export type { AgentStateName } from './ai/types.js';
export {
  render,
  systemPrompt,
  resolveDepsPrompt,
  generateComponentPrompt,
  detectGapsPrompt,
} from './ai/prompts.js';
export { estimateWindowUsage, trimMessages, manageContext, addRepoContext } from './ai/context.js';
export type { TrimOptions, ContextBlock } from './ai/context.js';
export { isToolCallingBlocked, enforceToolCallPolicy } from './ai/block.js';
export type { ToolCallPolicyConfig, ToolCallingPolicy } from './ai/block.js';
export type {
  ChatMessage,
  ChatOptions,
  ChatResponse,
  ChatRole,
  FinishReason,
  ProviderError,
  TokenUsage,
  ToolCall,
  ToolSchema,
} from './ai/types.js';

// P-148 agent tools (Epic 7). Re-exported through the public barrel so
// cli/web import from `@repo-stitcher/core`, never from `core/src/agent/*`.
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
  unifiedDiff,
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
  registerAgentTool,
  getAgentTool,
  listAgentTools,
  hasAgentTool,
  clearAgentToolsForTests,
  MAX_SELECTED_FILES,
  emptyDepClosure,
  GAP_KINDS,
  MAX_BUILD_LOG_LINES,
  DEFAULT_MAX_ASK_TIMEOUT_MS,
  // P-157 autonomy policy. The agent module's per-tool `Autonomy` is
  // re-exported as `ToolAutonomy` because the P-009 config block above already
  // owns the plain `Autonomy` name (same disambiguation as LicenseCompliancePolicy).
  AutonomyPolicy,
  defaultAutonomyPolicy,
  policyFromAgentConfig,
  DEFAULT_GATED_TOOLS,
  ALWAYS_ALLOWED_TOOLS,
  // P-158 tool args/result validation.
  validateToolResult,
  sanitizeToolArgs,
  validateToolCall,
  createToolValidator,
  auditValidationFailure,
  MAX_TOOL_RESULT_BYTES,
  MAX_TOOL_ARGS_DEPTH,
  FORBIDDEN_ARG_KEYS,
  STRICT_PATH_SAFE,
  // P-159 agent state machine.
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
  // P-160 HIL approval queue.
  HilQueue,
  HIL_TABLES_SQL,
  // P-161 undo stack.
  UndoStack,
  REVERTERS,
  UNDO_DERIVERS,
  MAX_UNDO_DEPTH,
  deriveUndoRecord,
  createUndoRecorder,
  revertLastToolAction,
  createRevertLastTool,
  revertLastSchema,
  // P-162 reasoning stream.
  ReasoningStream,
  MAX_REASONING_HISTORY,
  reasoningText,
  // P-163 error classification.
  classifyError,
  handleError,
  friendlyError,
  fromUnknownThrow,
  CLASSIFIED_CODES,
  // P-164 loop cap.
  LoopCapGuard,
  resolveCap,
  readCapConfig,
  DEFAULT_MAX_ITERATIONS,
  parseJsImports,
  parsePythonImports,
  jsPackageName,
  pythonPackageName,
  classifyJsSpecifier,
  resolveRelativeImport,
  // P-166 deps/license facades. The `ai/types` `DepsFacade`/`LicenseFacade`
  // interfaces are already exported above, so the agent-side implementations
  // are aliased here (same disambiguation as `LicenseCompliancePolicy`).
  DepsFacade as AgentDepsFacade,
  LicenseFacade as AgentLicenseFacade,
  createDepsFacade,
  createLicenseFacade,
  createDepsLicenseFacades,
  manifestDependencyMap,
  DEFAULT_LICENSE_POLICY,
} from './agent/index.js';
export type {
  SourceRepo,
  SelectedFile,
  SelectionFilter,
  FileSelection,
  SelectFilesArgs,
  SelectFilesResult,
  DepClosure,
  DepSeverity,
  Gap,
  GapKind,
  DetectGapsOptions,
  DepSection,
  FixResult,
  LatestVersionResolver,
  ApplyDependencyFixOptions,
  DependencyFixPlan,
  FixDependencyOutcome,
  FixDependencyOptions,
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
  ToolAutonomy,
  AutonomyOverride,
  PolicyDecision,
  AutonomyPolicyConfig,
  PolicyContext,
  ValidationLimits,
  ValidationStage,
  ValidationKind,
  ValidationFailureDetail,
  ToolValidatorOptions,
  AgentState,
  StateChange,
  AgentStateStore,
  AgentStateMachineOptions,
  HilKind,
  HilStatus,
  HilRequest,
  HilResolution,
  HilEnqueue,
  HilQueueOptions,
  HilWaitOptions,
  UndoKind,
  UndoRecord,
  FileSnapshot,
  Reverter,
  UndoClock,
  UndoDeriver,
  UndoStackOptions,
  ReasoningEvent,
  ReasoningListener,
  ErrorClass,
  RecoveryAction,
  ErrorClassification,
  ErrorBudget,
  RecoveryDecision,
  LoopCap,
  LoopContext,
  CapKind,
  CapStop,
  CapConfigInput,
  AskUserOptions,
  RunBuildOptions,
  PlanMoveOptions,
  ApplyConfigEditOptions,
  ConfigValidator,
  UndoEntry,
  DiffHunk,
  DiffLine,
  SpecifierKind,
  DepsLicensePaths,
  DependencyMap,
  LicenseAggregateFieldsLike,
  PolicyOverridesLike,
  ComplianceGateResult,
} from './agent/index.js';

export { createDockerClient, pingDocker, defaultDockerSocket } from './sandbox/docker.js';
export type {
  DockerPingable,
  DockerClientOptions,
  DockerSandboxClient,
  DockerReachability,
} from './sandbox/docker.js';
export {
  SandboxClient,
  demuxDockerLogs,
  MAX_CONTAINER_LOG_LINES,
  DEFAULT_RUN_TIMEOUT_MS,
} from './sandbox/client.js';
export type {
  ContainerSpec,
  ContainerRun,
  SandboxStats,
  SandboxClientOptions,
  SandboxClientFactoryOptions,
  PullOptions,
  BuildImageOptions,
  RunOptions,
  DockerLike,
  ContainerLike,
  ContainerCreateOptionsLike,
  ImageBuildOptionsLike,
  HostConfigLike,
} from './sandbox/client.js';
export {
  ECOSYSTEM_IMAGES,
  EPHEMERAL_PREFIX,
  SANDBOX_IMAGES_TABLE_SQL,
  imageFor,
  isEphemeralTag,
  ephemeralTagFor,
  ensureImage,
  clearImageCacheForTests,
} from './sandbox/images.js';
export type { ImageClient, EnsureImageOptions } from './sandbox/images.js';
export {
  installDeps,
  countInstalled,
  WORKSPACE_MOUNT,
  DEFAULT_INSTALL_TIMEOUT_MS,
  NODE_LOCKFILES,
} from './sandbox/install.js';
export type {
  InstallSpec,
  InstallResult,
  InstallOptions,
  InstallClient,
} from './sandbox/install.js';
export {
  runBuild,
  BUILD_COMMANDS,
  DEFAULT_OUTPUT_DIRS,
  DEFAULT_BUILD_TIMEOUT_MS,
  BUILDOUT_MOUNT,
} from './sandbox/build.js';
export type { BuildResult, BuildClient } from './sandbox/build.js';
export {
  runTests,
  parseTestOutput,
  parseJunitXml,
  looksLikeJunit,
  TEST_COMMANDS,
  DEFAULT_TEST_TIMEOUT_MS,
  MAX_TEST_FAILURES,
} from './sandbox/test.js';
export type { TestResult, TestFailure, TestClient, ParsedTestCounts } from './sandbox/test.js';
export {
  CaptureManager,
  hostArtifactPath,
  sanitizeSegment,
  DEFAULT_LOG_CAPACITY,
  DEFAULT_MAX_ARTIFACT_BYTES,
  CAPTURE_RUNS_TABLE_SQL,
} from './sandbox/capture.js';
export type {
  LogEntry,
  LogSink,
  CaptureResult,
  CaptureRunRecord,
  CaptureOptions,
  CaptureClient,
} from './sandbox/capture.js';
export {
  DEFAULT_LIMITS,
  STRICT_LIMITS,
  applyLimits,
  enforceTimeout,
  defaultLimits,
  limitsToCaptureOptions,
  parseMemoryToMb,
  parseCpuCount,
} from './sandbox/limits.js';
export type { LimitsConfig, LimitsConfigSource } from './sandbox/limits.js';
export { parseDockerEngineVersion, checkDockerDaemon } from './sandbox/dockerProbe.js';
export type { DockerDaemonStatus } from './sandbox/dockerProbe.js';

export {
  buildDoctorChecks,
  makeDockerCheck,
  makeFilterRepoCheck,
  makeGitCheck,
  makeGitHubTokenCheck,
  makeOllamaCheck,
  runDoctor,
} from './system/doctor.js';
export type {
  CheckResult,
  DependencyCheck,
  CheckOutcome,
  DoctorReport,
  DockerCheckSeams,
  DoctorCheckOptions,
  OllamaProbe,
  ProcessRunner,
  RunDoctorOptions,
} from './system/doctor.js';

export { openDb, defaultStorePath, stitchHomeDir, STITCH_STORE_FILENAME } from './store/db.js';
export type { OpenDbOptions, StitchDb } from './store/db.js';
export { migrate, dbAll, dbGet, dbRun, migrations, SCHEMA_VERSION } from './store/schema.js';
export type {
  DbLike,
  StatementLike,
  Migration,
  SQLiteValue,
  SQLiteRow,
  SQLiteRunInfo,
} from './store/schema.js';
