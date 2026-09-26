export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ChatMessage {
  role: ChatRole;
  content: string;
  name?: string;
  toolCallId?: string;
  toolCalls?: ToolCall[];
}

export interface ToolSchema {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface TokenUsage {
  input: number;
  output: number;
  total: number;
}

export type FinishReason = 'stop' | 'tool_calls' | 'length' | 'content_filter' | 'error';

export interface ProviderError {
  kind: 'rate_limit' | 'auth' | 'timeout' | 'network' | 'invalid_request' | 'unknown';
  message: string;
  providerName: string;
  retryable: boolean;
}

export interface ChatResponse {
  content: string;
  toolCalls: ToolCall[];
  finishReason: FinishReason;
  usage: TokenUsage;
}

export interface ChatOptions {
  stream?: boolean;
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}

// P-136 Streaming Support
export type ReasoningChunk =
  | { type: 'text'; text: string }
  | { type: 'tool_call'; toolCall: ToolCall }
  | { type: 'done'; finishReason: FinishReason; usage?: TokenUsage }
  | { type: 'error'; error: ProviderError };

// P-140 Tool Loop Executor
import type { z } from 'zod';
import type { CostTracker } from './cost.js';
import type { RetryOpts } from './retry.js';
import type { AiAuditLog } from './audit.js';
import type { ProviderManager, ProviderSwitchInfo } from './switch.js';
import type { ToolCallPolicyConfig } from './block.js';
import type { Result, StitchError } from '../result/index.js';
import type { Logger } from '../logger/index.js';

// Model capability types live in models.ts; re-exported here so consumers of
// this contract can import everything from one place without a cycle
// (models.ts does not import this module).
export type { ModelSpec, ToolCallingPolicy } from './models.js';

// Facade interfaces for core tools (kept thin for testability)
export interface GitFacade {
  // Minimal methods needed by tools
  diff(): Promise<string>;
  status(): Promise<string>;
  commit(message: string): Promise<void>;
  add(files: string[]): Promise<void>;
  /**
   * P-148: repo-relative file listing for one source repo, used by
   * `select_files` to validate a proposed selection before the merge writer
   * (P-076) or provenance mapper (P-181) touches the worktree.
   *
   * Argument order matches the P-148 blueprint verbatim
   * (`ctx.git.listFiles(ctx.cwd, args.repo)`): the tool knows only the working
   * directory and the `A`/`B` source label, never the underlying checkout
   * paths — the orchestrator that injects this facade owns that mapping.
   *
   * Optional so P-140-era facades keep compiling. A tool that needs it
   * reports a typed `CONFIG_ERROR` when it is absent (a wiring fault) rather
   * than pretending a path is missing.
   */
  listFiles?(cwd: string, repo: 'A' | 'B'): Promise<Result<string[], StitchError>>;
  /**
   * P-149: read one repo-relative file's text from a source repo.
   *
   * `resolve_dependency_closure` must parse import statements out of selected
   * files, and a subset selection can pull in internal files the caller never
   * named — both need content, not just a listing. Argument order follows the
   * P-148 `listFiles` convention (`cwd`, repo label, then path).
   *
   * Optional for the same reason `listFiles` is: a P-140/P-148-era facade
   * still compiles. A tool needing it reports `CONFIG_ERROR` when absent.
   */
  readFile?(cwd: string, repo: 'A' | 'B', path: string): Promise<Result<string, StitchError>>;
  /**
   * P-152: read one file from child repo C's stage.
   *
   * Preferred over `readFile(..., 'A', ...)` for child-repo work: it names the
   * actual target instead of borrowing a source label for repo C. Optional;
   * `edit_config` falls back to `readFile` when it is absent.
   */
  readStagedFile?(path: string): Promise<Result<string, StitchError>>;
  /**
   * P-152: write one file into child repo C's stage, producing a staged change.
   *
   * The first write surface on `GitFacade`, and the backing for the mutating
   * agent tools (P-151 returns a manifest change; P-152 persists one). P-076's
   * `writeToWorktree` is the production implementation the orchestrator
   * injects here.
   *
   * Optional so every pre-P-152 facade still compiles; a tool needing it
   * reports `CONFIG_ERROR` rather than pretending the write succeeded.
   */
  writeFile?(
    cwd: string,
    repo: 'A' | 'B',
    path: string,
    content: string
  ): Promise<Result<void, StitchError>>;
  /**
   * P-153: relocate a staged file within child repo C.
   *
   * Backs the `move_file` agent tool, which needs an atomic rename rather than
   * a read-then-write pair so a crash cannot leave content at both paths.
   * Rollback calls the same method in reverse, so it must be symmetric.
   *
   * Optional, same compatibility rationale as the methods above.
   */
  move?(cwd: string, repo: 'A' | 'B', from: string, to: string): Promise<Result<void, StitchError>>;
  /**
   * P-161: remove a file.
   *
   * Added for the undo stack, because reverting a file a tool *created* means
   * deleting it, and there was no capability for that anywhere on the context.
   * Optional for the same reason `writeFile?` is (ADR-021): the agent layer must
   * never be able to assume it can destroy something, so an absent `deleteFile`
   * has to be a typed error rather than a silent no-op or a crash.
   */
  deleteFile?(cwd: string, repo: 'A' | 'B', path: string): Promise<Result<void, StitchError>>;
}

export interface DepsFacade {
  analyze(): Promise<Record<string, string>>;
  install(spec: string): Promise<void>;
}

export interface LicenseFacade {
  scan(): Promise<string[]>;
  check(): Promise<boolean>;
}

/** Context passed to every tool execution. */
export interface ToolContext {
  cwd: string;
  config: Record<string, unknown>;
  logger: Logger;
  costTracker: CostTracker;
  git: GitFacade;
  deps: DepsFacade;
  license: LicenseFacade;
  /**
   * P-150: read-only view of child repo C's staging state.
   *
   * Distinct from `GitFacade`, which addresses the *source* repos `A`/`B`
   * (ADR-021). `detect_gaps` inspects what has been composed into C so far,
   * which is a third thing with its own lifecycle. Kept optional so every
   * pre-P-150 context still satisfies the type; checks that need it report a
   * typed `CONFIG_ERROR` rather than silently reporting no gaps.
   */
  staging?: StagingFacade;
  /**
   * P-155: the sandbox backend that executes builds and tests.
   *
   * Injected, never constructed: the agent tool layer must not be able to run
   * a host build, and a type-level seam is what makes that structural rather
   * than a convention. P-168's Docker client and P-175's GH Actions fallback
   * are the production implementations the orchestrator wires in.
   */
  sandbox?: SandboxRunner;
  /**
   * P-156: the channel to a human (CLI TUI P-198 or web gate P-218).
   *
   * Injected, like every other capability here. P-160's HIL queue is the
   * production implementation; the agent layer must not reach into the CLI or
   * the web directly, and it must not block forever if nobody is listening.
   */
  human?: HumanResponder;
}

/**
 * A question put to a human (P-156).
 *
 * Declared here, in the contract module, because `HumanResponder` is part of
 * the `ToolContext` surface. The agent module's `UserQuestion` satisfies this
 * structurally, so there is one runtime shape and no import cycle.
 */
export interface HumanQuestion {
  id: string;
  prompt: string;
  options?: readonly string[];
  defaultValue?: string;
  freeForm?: boolean;
}

/**
 * How a human exchange ended.
 *
 * `cancelled` (actively declined) and `timeout` (never answered) are separate
 * outcomes because the agent loop must react differently to them, and P-156
 * maps them to distinct error codes.
 */
export type HumanResponse =
  { kind: 'answered'; value: string } | { kind: 'cancelled' } | { kind: 'timeout' };

/** A channel to a human that can block until answered. */
export interface HumanResponder {
  present(question: HumanQuestion): Promise<HumanResponse>;
}

/**
 * The agent lifecycle states (P-159).
 *
 * Declared here as well as in `agent/state.ts` because the loop drives these
 * states. The two declarations are unions of identical string literals, so
 * TypeScript treats them as the *same* type — no import, no cycle. The agent
 * module owns the definition (the phase spec puts `AgentState` there); this copy
 * exists purely so `ai/` can talk about states without importing `agent/`.
 * `agent/state.test.ts` asserts the two stay assignment-compatible, so drift
 * is a test failure rather than a silent type mismatch.
 *
 * FROZEN: the handoff note says web P-216 maps these names, so the literals are
 * a public contract and adding one is an ADR, not a rename.
 */
export type AgentStateName =
  | 'idle'
  | 'loading'
  | 'preparing'
  | 'tool_executing'
  | 'waiting_approval'
  | 'waiting_user'
  | 'streaming'
  | 'iterating'
  | 'done'
  | 'error';

/**
 * The agent state machine, as the loop sees it (P-159).
 *
 * Same injection seam as {@link ToolPolicyEvaluator} and {@link ToolValidator}:
 * the agent module owns the implementation and already imports this one, so
 * `ai/loop.ts` cannot import it back without closing an `agent -> ai -> agent`
 * cycle.
 */
export interface AgentStateController {
  /** The current state. */
  readonly state: AgentStateName;
  /** Is a transition to `to` legal from the current state? */
  canTransition(to: AgentStateName): boolean;
  /**
   * May a tool execution START right now (P-159)?
   *
   * Separate from {@link canTransition} on purpose. `waiting_user ->
   * tool_executing` is a legal move — it is the *return* from a human round
   * trip that a tool started. This asks the different question the phase's
   * guard actually cares about: is it safe to BEGIN a new tool call while a
   * human decision is still outstanding? That is false in both `waiting_*`
   * states, and the loop refuses to execute when it is.
   */
  canStartTool(): boolean;
  /** Move to `to`, or return `ILLEGAL_TRANSITION`. */
  transition(to: AgentStateName): Result<void, StitchError>;
  /** Restore the persisted state, if any. Called once at loop entry. */
  restore(): Result<AgentStateName | null, StitchError>;
}

/**
 * The HIL approval queue, as the loop sees it (P-160).
 *
 * Declared structurally for the same module-cycle reason as
 * {@link ToolPolicyEvaluator}: the agent module owns `HilQueue` and already
 * imports this one. The `kind` and `resolution` unions are repeated rather than
 * imported; `hil.test.ts` asserts they stay the same types.
 */
export interface HilGateRequest {
  kind: 'component' | 'question' | 'permission';
  toolName: string;
  payload: unknown;
  /** The lifecycle state recorded with the request (P-159). */
  agentState: AgentStateName;
}

/** A human's decision, as the loop consumes it. */
export interface HilGateOutcome {
  resolution: 'approved' | 'rejected';
  by: string;
  note?: string;
}

/** The approval queue, as the loop sees it (P-160). */
export interface HilGate {
  /** Park a request and return its id. */
  enqueue(request: HilGateRequest): Result<string, StitchError>;
  /**
   * Wait for a human. Resolves when someone answers, and returns
   * `USER_TIMEOUT` if nobody does in time or `ABORTED` if the wait is stopped.
   */
  waitForResolution(
    id: string,
    options: { timeoutMs?: number; signal?: AbortSignal }
  ): Promise<Result<HilGateOutcome, StitchError>>;
}

/**
 * The undo stack, as the loop sees it (P-161).
 *
 * Injected for the same module-cycle reason as `policy`, `validation`,
 * `stateMachine` and `hilQueue`. The agent module owns `UndoStack`.
 */
export interface UndoRecorder {
  /** Record a reversible action. A `null` return means the tool is not reversible. */
  record(tool: string, result: unknown): boolean;
}

/**
 * The reasoning sink, as the loop sees it (P-162).
 *
 * The agent module owns `ReasoningStream` and already imports this one, so
 * `ai/loop.ts` cannot import it back. The event union below is the ai-side
 * spelling: built from `PolicyVerdict` and `AgentStateName`, which are the
 * loop's own types, so the loop can construct events without reaching into the
 * agent module. The agent's `ReasoningEvent` is structurally identical.
 */
export type ReasoningEventLike =
  | { type: 'plan'; text: string }
  | { type: 'tool_call'; tool: string; args: unknown; gate: 'auto' | 'gated' }
  | { type: 'tool_result'; tool: string; ok: boolean; summary: string }
  | { type: 'policy'; decision: PolicyVerdict; tool: string }
  | { type: 'state'; from: AgentStateName; to: AgentStateName }
  | { type: 'failover'; from: string; to: string; reason: string }
  | { type: 'cost'; totalCost: number; tokens: TokenUsage }
  | { type: 'complete'; finishReason: FinishReason };

/** The reasoning stream, as the loop sees it (P-162). */
export interface ReasoningSink {
  emit(event: ReasoningEventLike): void;
}

/**
 * An autonomy verdict (P-157).
 *
 * Declared here because the loop consumes it. The agent module's
 * `PolicyDecision` satisfies this structurally, so the loop can consume the
 * policy engine without importing it — which matters because the agent module
 * already imports this one, and a direct import would create a cycle.
 */
export interface AgentErrorRouter {
  fromUnknownThrow(caught: unknown): { action: string; message: string };
}

export interface PolicyVerdict {
  action: 'allow' | 'ask' | 'deny';
  reason: string;
}

/** The autonomy policy, as the loop sees it (P-157). */
export interface ToolPolicyEvaluator {
  evaluate(toolName: string, toolAutonomy: 'auto' | 'gated'): PolicyVerdict;
}

/**
 * The tool validation layer, as the loop sees it (P-158).
 *
 * Declared structurally for the same reason as {@link ToolPolicyEvaluator}: the
 * agent module owns the implementation and already imports this one, so
 * importing it back would close an `agent -> ai -> agent` cycle. The concrete
 * `AutonomyPolicy`-style binding is `createToolValidator` in
 * `agent/validation.ts`, which the caller injects through `LoopConfig`.
 */
export interface ToolValidator {
  /**
   * Check raw tool arguments before `execute`. Runs in addition to P-139's
   * `parseToolArgs`, and must not replace it.
   */
  sanitizeToolArgs<T extends Record<string, unknown>>(
    tool: ToolDefinition,
    args: unknown
  ): Result<T, StitchError>;
  /** Check a tool's result before it is handed back to the model. */
  validateToolResult(
    tool: ToolDefinition,
    result: Result<unknown, StitchError>
  ): Result<unknown, StitchError>;
  /** Record a rejection on the P-145 audit trail. Called only on failure. */
  audit(error: StitchError, toolName: string, stage: 'args' | 'result'): void;
}

/** What the agent asks the sandbox to execute. */
export interface SandboxRunRequest {
  /** The command line, run inside the sandbox image, never on the host. */
  command: string;
  /** Which phase this run belongs to, for outcome attribution. */
  step: 'build' | 'test';
  /** Repo-relative, used by the runner to scope the staged tree. */
  repoPath: string;
}

/** What the sandbox reports back. */
export interface SandboxRunResult {
  exitCode: number;
  stdout: string[];
  stderr: string[];
  durationMs: number;
}

/**
 * A sandbox backend (P-155 seam; implementations arrive in P-168/P-175).
 *
 * `available()` is separate from `run()` so a caller can distinguish "no
 * backend configured" from "the build failed" — the agent loop must not treat a
 * missing verdict as a failing verdict.
 */
export interface SandboxRunner {
  /** Backend label, surfaced in the UI and audit trail. */
  backend: 'docker' | 'github-actions';
  available(): Promise<boolean>;
  run(request: SandboxRunRequest): Promise<Result<SandboxRunResult, StitchError>>;
}

/**
 * Read-only access to child repo C's staging state (P-150).
 *
 * Deliberately has no write methods: P-150 is a read-only battery of checks,
 * and the auto-fix tools (P-151–P-153) get their own mutation surface so the
 * "nothing here can write" property is enforced by the type, not by discipline.
 */
export interface StagingFacade {
  /** Repo-relative paths currently staged in C, sorted or not. */
  listStagedFiles(): Promise<Result<string[], StitchError>>;
  /** Read one staged file's text. */
  readStagedFile(path: string): Promise<Result<string, StitchError>>;
}

/** Tool definition with execution handler. */
export interface ToolDefinition {
  name: string;
  description: string;
  schema: Record<string, z.ZodTypeAny>;
  execute: (args: unknown, ctx: ToolContext) => Promise<Result<unknown, StitchError>>;
  autonomy: 'auto' | 'gated';
}

/** Configuration for the tool loop. */
/**
 * A resolved loop cap, as the loop sees it (P-164).
 *
 * The concrete `LoopCap` and `LoopCapGuard` live in `agent/cap.ts`, which is
 * the eighth use of the ADR-030 structural seam: the loop needs the shape, not
 * the machinery, and importing the module would invert the established
 * agent -> ai direction. Structural typing means a real `LoopCap` satisfies
 * this without a nominal link (asserted in `cap.test.ts`).
 */
export interface LoopCapLike {
  /** Iterations allowed. Exactly this many are permitted; the next is refused. */
  maxIterations: number;
  /** Token budget. `0` or absent means OFF. */
  maxTokens?: number;
  /** USD budget. `0` or absent means OFF. */
  maxCostUsd?: number;
  /**
   * P-164 step 5: on hitting a budget, ask a human whether to raise it.
   * Default OFF. Even when ON, the cap is never widened without that answer.
   */
  autoRaiseBudget?: boolean;
  /** P-164: how many times the budget may be widened in one run. Default 1. */
  maxRaises?: number;
}

export interface LoopConfig {
  maxIterations: number;
  /**
   * P-148: the context handed to every tool's `execute`. Before P-148 the loop
   * passed an empty cast, so any tool reading `ctx` (e.g. `select_files`
   * reading `ctx.git.listFiles`) had nothing real to work with. Optional so
   * pre-P-148 callers keep the previous empty-context behavior.
   */
  context?: ToolContext;
  cost?: CostTracker;
  retry?: RetryOpts;
  signal?: AbortSignal;
  onReasoning?: (r: ReasoningChunk) => void;
  approvalGate?: (toolName: string) => Promise<boolean>;
  /** P-143: allow the loop to pass tool schemas to the provider. */
  allowTools?: boolean;
  /**
   * P-145: audit sink. Every provider call this loop makes is recorded
   * (success and failure) before the loop continues or returns.
   */
  audit?: AiAuditLog;
  /** P-145: task label stored on each audit row (cost dashboard grouping). */
  task?: string;
  /** P-145: prompt version stored on each audit row. Defaults to the P-141 template hash. */
  promptVersion?: string;
  /**
   * P-146: runtime provider switch. When set, the loop calls the manager's
   * active provider and fails over to the next candidate on a retryable
   * provider error instead of aborting the job.
   */
  providerManager?: ProviderManager;
  /** P-156: notified on every failover so CLI/web can show "switched to ...". */
  onProviderSwitch?: (info: ProviderSwitchInfo) => void;
  /**
   * P-157: the autonomy policy. Injected rather than imported so this module
   * stays independent of the agent module (which imports this one).
   *
   * When set, the loop asks the policy before EVERY tool execution instead of
   * hardcoding "gated means ask". When absent, the loop keeps its P-140
   * behaviour exactly, so callers that predate the policy engine are
   * unaffected.
   */
  policy?: ToolPolicyEvaluator;
  /**
   * P-158: the tool validation layer. Injected rather than imported for the
   * same module-cycle reason as `policy`.
   *
   * When set, the loop checks arguments before `execute` and results after it.
   * When absent, the loop behaves exactly as it did through P-157, so callers
   * that predate validation are unaffected.
   */
  validation?: ToolValidator;
  /**
   * P-159: the agent state machine. Injected for the same cycle reason as
   * `policy` and `validation`.
   *
   * When set, the loop drives the lifecycle and refuses to start a tool
   * execution while a human decision is outstanding. When absent, the loop
   * behaves exactly as it did through P-158.
   */
  stateMachine?: AgentStateController;
  /**
   * P-160: the durable approval queue.
   *
   * Injected for the same cycle reason as `policy`, `validation` and
   * `stateMachine`. When set, a gated tool's approval is parked in the queue
   * and awaited there, so the decision survives the process and can be made
   * from the CLI (P-198) or the web (P-218).
   *
   * When absent, the loop keeps its P-140 `approvalGate` callback, so callers
   * that predate the queue are unaffected.
   */
  hilQueue?: HilGate;
  /**
   * P-160: how long a human has to answer a parked request. `undefined` waits
   * indefinitely, which is correct for an interactive session and wrong for a
   * batch job — P-156's `DEFAULT_MAX_ASK_TIMEOUT_MS` is the sensible default
   * for the latter.
   */
  hilTimeoutMs?: number;
  /**
   * P-161: the undo stack.
   *
   * When set, a tool whose successful result carries its own before-state
   * (`edit_config`, `move_file`) is recorded automatically, so a human can roll
   * it back with `revert_last`. When absent, nothing is recorded.
   */
  undoStack?: UndoRecorder;
  /**
   * P-162: the reasoning stream.
   *
   * When set, the loop publishes what it is doing — policy verdicts, tool
   * calls and results, state transitions, failovers, cost, and the final
   * finish reason — so the CLI (P-199) and web (P-216) can show the agent's
   * reasoning live. When absent, nothing is published and the loop is otherwise
   * unchanged.
   */
  reasoning?: ReasoningSink;
  /**
   * P-163: the error router. Injected for the same cycle reason as every other
   * agent seam. When set, anything that escapes a tool despite its `Result`
   * contract becomes a classified abort instead of an exception.
   */
  errorRouter?: AgentErrorRouter;
  /**
   * P-164: a per-task cap that supersedes both the `[agent]` config defaults
   * and `maxIterations`. Omit it to use the configured budgets; set it to bound
   * one specific run.
   */
  cap?: LoopCapLike;
  /** P-146: per-job switch budget (default 2) so providers cannot bounce forever. */
  maxFailoverSwitches?: number;
  /**
   * P-143 override list (`[ai].overrideToolModels`), consulted when deciding
   * whether a failover candidate may serve a tools task.
   */
  toolPolicy?: ToolCallPolicyConfig;
}

/** Result of a tool loop execution. */
export interface LoopResult {
  finishReason: FinishReason;
  iterations: number;
  toolCalls: ToolCall[];
  messages: ChatMessage[];
  finalContent?: string;
  error?: ProviderError;
  /** P-138: number of provider-call retries performed across the whole job. */
  retryCount?: number;
  /** P-146: number of runtime provider switches performed. */
  failoverCount?: number;
}
