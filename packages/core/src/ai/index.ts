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
} from './types.js';
export { conformsToChatProvider, isRetryableError } from './provider.js';
export type { ChatProvider } from './provider.js';
export type { OpenAICompatibleConfig } from './config.js';
export { OpenAICompatibleProvider, mapSdkError } from './openaiCompatible.js';
export type {
  ChatCompletionsPort,
  PortCreateArgs,
  SdkMessage,
  SdkMessageTool,
} from './openaiCompatible.js';
export type { AnthropicConfig } from './config.js';
export { AnthropicProvider } from './anthropicProvider.js';
export {
  createProvider,
  registerProvider,
  getProviderFactory,
  providerRegistry,
  resolveApiKey,
  setActiveProvider,
  getActiveProvider,
  clearActiveProviderForTests,
} from './registry.js';
export type { ProviderConfig, ProviderFactory } from './registry.js';
export { ProviderConfigSchema, PROVIDER_ENV_KEYS } from './config.js';
export { getModel, getRecommendedFor, assertModelCapable, MODELS } from './models.js';
export type { ModelSpec } from './models.js';
export { streamChat, streamChatToString } from './stream.js';
export type { ReasoningChunk } from './types.js';
export {
  countTokens,
  countTokensAccurate,
  estimateCost,
  CostTracker,
  estimateCallCost,
  shouldRequestApproval,
} from './cost.js';
export type { CostBudget } from './cost.js';
export { backoffDelay, withRetry, retryProviderCall, isProviderErrorRetryable } from './retry.js';
export type { RetryOpts, RetryInfo } from './retry.js';
export { zodToJsonSchema, parseToolArgs, toolSchemaToProvider } from './toolAdapter.js';
export { runToolLoop } from './loop.js';
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
} from './types.js';
export type { ReasoningEventLike, ReasoningSink, AgentErrorRouter, LoopCapLike } from './types.js';
export type { AgentStateName } from './types.js';
export {
  render,
  systemPrompt,
  resolveDepsPrompt,
  generateComponentPrompt,
  detectGapsPrompt,
} from './prompts.js';
export { estimateWindowUsage, trimMessages, manageContext, addRepoContext } from './context.js';
export type { TrimOptions, ContextBlock } from './context.js';
export { isToolCallingBlocked, enforceToolCallPolicy } from './block.js';
export type { ToolCallPolicyConfig, ToolCallingPolicy } from './block.js';
export { MockProvider, createMockProvider, mockScriptFromText } from './mock.js';
export type { MockConfig, MockStep } from './mock.js';
export { AiAuditLog, redactAuditText, redactProviderError, newAuditId, nowIso } from './audit.js';
export type { AiCallAudit, AiCallQuery, AiAuditLogOptions } from './audit.js';
export {
  AI_CALLS_TABLE_SQL,
  DEFAULT_FLUSH_EVERY,
  DEFAULT_QUERY_LIMIT,
  MAX_QUERY_LIMIT,
} from './audit.js';
export { promptVersion } from './prompts.js';
export {
  ProviderManager,
  switchProvider,
  buildFailoverOrder,
  isFailoverCandidate,
  shouldFailover,
  DEFAULT_MAX_FAILOVER_SWITCHES,
} from './switch.js';
export type { ProviderSwitchInfo, SwitchProviderOptions } from './switch.js';
export { PROVIDER_SWITCH_TASK, ASK_USER_TASK, POLICY_TASK, VALIDATION_TASK } from './audit.js';
export type {
  AiProviderSwitch,
  AiProviderSwitchRecord,
  AiUserQuestion,
  AiUserQuestionRecord,
  AiPolicyDecision,
  AiPolicyDecisionRecord,
  AiValidationFailure,
  AiValidationFailureRecord,
} from './audit.js';
export { openSqlite, STITCH_DB_FILENAME } from '../db/sqlite.js';
export type { SqliteHandle, OpenSqliteOptions } from '../db/sqlite.js';
