// Tool-Loop Executor (P-140) + Context Management (P-142).
//
// Core execution engine: iterates model calls, executes tool calls,
// feeds results back, enforces caps, tracks cost, supports gated tools.
// Manages context window via trimMessages/manageContext before each call.

import { ok, err, type Result } from 'neverthrow';
import type { ChatProvider } from './provider.js';
import { asProviderError } from './provider.js';
import type {
  ChatMessage,
  ReasoningChunk,
  ToolCall,
  TokenUsage,
  FinishReason,
  ProviderError,
  ToolDefinition,
  ToolContext,
  LoopConfig,
  LoopResult,
  ModelSpec,
} from './types.js';
import { streamChat } from './stream.js';
import { zodToJsonSchema, parseToolArgs } from './toolAdapter.js';
import { manageContext } from './context.js';
import { newAuditId, nowIso } from './audit.js';
import { promptVersion } from './prompts.js';
import { estimateCost } from './cost.js';
import { MODELS } from './models.js';
import { DEFAULT_MAX_FAILOVER_SWITCHES, shouldFailover, switchProvider } from './switch.js';
import type { AgentStateName, HumanQuestion, HumanResponse } from './types.js';
import { withRetry, type RetryInfo } from './retry.js';
import { logger } from '../logger/index.js';
// P-164: the loop's cap guard. This is the one `agent/` module `ai/` imports,
// and it is safe precisely because `agent/cap.ts` imports nothing from `ai/` —
// the eight ADR-030 seams exist to break a cycle that does not exist here, and
// the spec puts the guard's construction and consultation in the loop.
import { LoopCapGuard, readCapConfig, resolveCap, type LoopContext } from '../agent/cap.js';
import { type StitchError, stitchErrorMessage } from '../result/index.js';

/**
 * The context handed to tools when the caller supplied none.
 *
 * Hoisted out of the loop body so every tool call shares one object rather than
 * allocating a fresh empty literal per call, and so a tool that mutates it
 * cannot leak that mutation into a sibling call.
 *
 * The cast is deliberate and pre-existing — it dates to before P-148, when
 * this was inline. Fabricating a real `GitFacade`/`CostTracker`/`Logger` here
 * would assert capabilities that do not exist in this process, and a tool that
 * needs one is expected to surface a typed `CONFIG_ERROR` rather than crash on
 * `undefined`. Centralising it here means one cast in the module instead of
 * one per tool call.
 */
const emptyCtx = {} as ToolContext;

/**
 * Serialize a tool result for the assistant message history.
 * ok -> content with value; err -> content with error message/code.
 */
function serializeToolResult(
  toolCallId: string,
  result: Result<unknown, StitchError>
): ChatMessage {
  if (result.isOk()) {
    return {
      role: 'tool',
      content: JSON.stringify(result._unsafeUnwrap()),
      toolCallId,
    };
  }
  const e = result._unsafeUnwrapErr();
  return {
    role: 'tool',
    content: JSON.stringify({ error: stitchErrorMessage(e), code: e.code }),
    toolCallId,
  };
}

/** What one provider call produced, before the loop commits it. */
interface TurnOutcome {
  text: string;
  toolCalls: ToolCall[];
  finishReason: FinishReason;
  usage: TokenUsage;
  error?: ProviderError;
}

/**
 * Main tool loop executor.
 * Iterates: model call -> tool executions -> feed results -> repeat.
 * Stops on 'stop' finishReason, maxIterations, abort, or error.
 * Manages context window before each model call.
 */
export async function runToolLoop(
  provider: ChatProvider,
  tools: ToolDefinition[],
  initialMessages: ChatMessage[],
  config: LoopConfig
): Promise<Result<LoopResult, StitchError>> {
  const {
    maxIterations,
    context,
    cost,
    signal,
    onReasoning,
    approvalGate = async () => true, // default allow
    audit,
    policy,
    validation,
    stateMachine,
    hilQueue,
    hilTimeoutMs,
    undoStack,
    reasoning,
    errorRouter,
    cap,
    task = 'agent-loop',
    promptVersion: promptVersionOverride,
  } = config;

  // P-159: the lifecycle. `move` is the single funnel for every transition, so
  // an illegal move is handled in exactly one place and a missing state machine
  // degrades to a no-op rather than a second code path through the loop.
  //
  // P-162: it is also the single place a `state` reasoning event is published,
  // so every transition is visible exactly once and in order. A refused move
  // publishes nothing — the agent did not go anywhere.
  const move = (to: AgentStateName): Result<void, StitchError> => {
    if (stateMachine === undefined) return ok(undefined);
    const from = stateMachine.state;
    const moved = stateMachine.transition(to);
    if (moved.isOk() && from !== to) {
      reasoning?.emit({ type: 'state', from, to });
    }
    return moved;
  };

  /**
   * P-162: summarise a tool result for the reasoning feed.
   *
   * Bounded and redacted at the source, because this text is rendered to a user
   * and a tool result is arbitrary text that can carry a credential shape.
   */
  const summarise = (value: unknown): string => {
    if (value === null || value === undefined) return 'no result';
    if (typeof value === 'string') return value;
    try {
      return JSON.stringify(value) ?? String(value);
    } catch {
      return '(unserialisable result)';
    }
  };

  // P-160: which flavour of human interaction a gated tool represents, so the
  // queue can render it appropriately. `propose_component` proposes a net-new
  // module (P-154), `ask_user` asks a question (P-156), and anything else
  // gated is a permission request.
  const hilKindFor = (toolName: string): 'component' | 'question' | 'permission' => {
    if (toolName === 'propose_component') return 'component';
    if (toolName === 'ask_user') return 'question';
    return 'permission';
  };

  /**
   * Park a gated tool and wait for a human, through the durable queue (P-160).
   *
   * Returns the decision, or an error the loop turns into a tool result. A
   * non-approval is NOT an error path: a rejection is a valid answer, and the
   * loop continues with a `TOOL_DENIED` result so the model can adapt.
   */
  const askHuman = async (
    tool: { name: string; description: string },
    args: unknown
  ): Promise<Result<'approved' | 'rejected', StitchError>> => {
    // Announce the wait FIRST, and for BOTH paths. P-159's contract is that a
    // gated tool parks in `waiting_approval` — that is a property of the tool
    // being gated, not of how the human is eventually reached. Doing this after
    // the queue branch would leave the inline `approvalGate` path (a
    // pre-P-160 caller) silently unobserved, and a request parked afterwards
    // would record the previous state (`streaming`) rather than the one it
    // exists to explain.
    await move('waiting_approval');
    if (hilQueue === undefined) {
      return (await approvalGate(tool.name)) ? ok('approved') : ok('rejected');
    }
    const parked = hilQueue.enqueue({
      kind: hilKindFor(tool.name),
      toolName: tool.name,
      payload: {
        args,
        description: tool.description,
        agentState: stateMachine?.state ?? 'waiting_approval',
      },
      agentState: stateMachine?.state ?? 'waiting_approval',
    });
    if (parked.isErr()) return err(parked.error);
    const decided = await hilQueue.waitForResolution(parked.value, {
      ...(hilTimeoutMs !== undefined ? { timeoutMs: hilTimeoutMs } : {}),
      ...(signal !== undefined ? { signal } : {}),
    });
    if (decided.isErr()) return err(decided.error);
    return ok(decided.value.resolution);
  };

  /**
   * Drive a tool's human round trip through the lifecycle (P-159/P-160).
   *
   * The tool layer must not know the state machine or the queue exist, so the
   * loop wraps whatever `HumanResponder` it was given. When a tool calls
   * `present()`, the agent is genuinely waiting on a person, and that is
   * exactly what `waiting_user` means.
   *
   * P-160: when a queue is wired, the question is parked as a `question` HIL
   * request and the answer comes back through the same durable channel as every
   * other gate. This is the consolidation ADR-029 asked for: previously the
   * loop asked the human to *approve* the question, and only then did the tool
   * ask it — two prompts for one answer. Now there is one, and its text lives
   * in the resolution's `note`.
   *
   * Returns the original context unchanged when no responder is wired, so a
   * tool that wants a human still gets its typed `CONFIG_ERROR` rather than
   * finding a responder that silently does nothing.
   */
  const withHumanTracking = (ctx: ToolContext | undefined): ToolContext | undefined => {
    if (stateMachine === undefined && hilQueue === undefined) return ctx;
    if (ctx === undefined || ctx.human === undefined) return ctx;
    const responder = ctx.human;
    return {
      ...ctx,
      human: {
        present: async (question: HumanQuestion): Promise<HumanResponse> => {
          if (hilQueue !== undefined) {
            // Same ordering rule as `askHuman`: transition first, so the
            // parked request records the state the job is actually in.
            await move('waiting_approval');
            const parked = hilQueue.enqueue({
              kind: 'question',
              toolName: 'ask_user',
              payload: question,
              agentState: stateMachine?.state ?? 'waiting_approval',
            });
            if (parked.isOk()) {
              const decided = await hilQueue.waitForResolution(parked.value, {
                ...(hilTimeoutMs !== undefined ? { timeoutMs: hilTimeoutMs } : {}),
                ...(signal !== undefined ? { signal } : {}),
              });
              if (decided.isOk()) {
                if (decided.value.resolution === 'approved') {
                  // The answer to a question is the resolver's note; a question
                  // approved with no note is an empty answer, not a guess.
                  return { kind: 'answered', value: decided.value.note ?? '' };
                }
                return { kind: 'cancelled' };
              }
              // A timeout or an abort is neither answered nor declined.
              return decided.error.code === 'USER_TIMEOUT'
                ? { kind: 'timeout' }
                : { kind: 'cancelled' };
            }
          }
          await move('waiting_user');
          try {
            return await responder.present(question);
          } finally {
            await move('tool_executing');
          }
        },
      },
    };
  };

  const toolContext: ToolContext | undefined = withHumanTracking(context);

  // P-159: adopt any persisted state before doing anything else, so a resumed
  // job starts from where it stopped rather than from `idle`. A store failure is
  // non-fatal — a job that cannot read its own history should still run.
  if (stateMachine !== undefined) {
    stateMachine.restore();
    await move('loading');
  }

  const messages = [...initialMessages];
  const allToolCalls: ToolCall[] = [];
  let finalContent = '';
  let iterations: number;

  // Build provider tool schemas (Zod -> JSON Schema, P-139)
  const providerTools = tools.map(t => ({
    name: t.name,
    description: t.description,
    parameters: zodToJsonSchema(t.schema),
  }));

  // Extract model from provider for context management
  const model: ModelSpec = {
    id: provider.id,
    provider: provider.provider,
    contextWindow: 128000, // default, could be enhanced
    supportsTools: true,
    toolCalling: 'allowed',
    maxOutput: 4096,
    cost: { input: 0, output: 0 },
    recommendedFor: [],
  };

  // P-145: real pricing when the provider's model is in the curated registry,
  // so audited cost is a real number rather than a zero-cost placeholder.
  const offeredToolNames = providerTools.map(t => t.name);
  const auditPromptVersion = promptVersionOverride ?? promptVersion();

  // P-146: per-job failover budget.
  const providerManager = config.providerManager;
  const onProviderSwitch = config.onProviderSwitch;
  const maxSwitches = config.maxFailoverSwitches ?? DEFAULT_MAX_FAILOVER_SWITCHES;
  let switches = 0;

  // P-138: retry config for each turn. `retryAttempts` accumulates the
  // per-attempt notifications across the whole job so callers can assert that
  // retries actually happened.
  const retryOpts = config.retry;
  const retryAttempts: RetryInfo[] = [];

  /** P-138/P-146 counters surfaced on every successful loop result. */
  const counters = (): { retryCount: number; failoverCount: number } => ({
    retryCount: retryAttempts.length,
    failoverCount: switches,
  });

  // ----- P-164: the cap is the loop's admission control -----
  //
  // The guard, not a `for` bound, decides whether an iteration may start. An
  // earlier shape (`iterations < maxIterations` as the loop condition with the
  // guard layered on top) would have made the guard's own iteration check
  // unreachable: the bound would fire first and the guard would only ever run
  // in unit tests. So the bound is gone and the guard is the single authority.
  //
  // Resolution order: an explicit per-task `cap`, then the `[agent]` config
  // budgets, then the caller's own `maxIterations` (which predates this phase
  // and is still authoritative when nothing else says otherwise), then 20.
  const capGuard = new LoopCapGuard(resolveCap(readCapConfig(context?.config), cap, maxIterations));
  // Tokens are accumulated by the loop itself rather than read off the tracker,
  // because providers report usage per turn whether or not a priced tracker was
  // injected. That keeps the token budget enforceable for every caller.
  let runTokens = 0;

  /** What the guard needs to know about the run so far. */
  const capContext = (): LoopContext => ({
    totalTokens: runTokens,
    // `null` when no priced tracker exists, which the guard reports rather than
    // treating as "under budget" — see the cap module header.
    totalCostUsd: cost === undefined ? null : cost.totalCost,
    provider: provider.provider,
  });

  for (iterations = 0; ; iterations++) {
    // ----- P-164: admission control, before anything else this iteration -----
    //
    // First, deliberately. If the cap refuses this iteration then no work
    // happens, so transitioning to `streaming` first would publish a P-162
    // `state` event for an iteration that never ran — the same
    // "it never happened" vs "it failed" confusion P-162 exists to prevent.
    const capCheck = capGuard.check(iterations, capContext());
    if (capCheck.isErr()) {
      const stop = capGuard.lastStop;
      // Step 5: never widen the budget on our own. If the operator opted in,
      // ASK — through the same P-160 queue and lifecycle as every other human
      // interaction — and widen only on an explicit yes. If they decline, or
      // there is no queue to ask through, the run stops here.
      if (stop !== undefined && capGuard.canRaise() && hilQueue !== undefined) {
        const asked = hilQueue.enqueue({
          kind: 'question',
          toolName: 'ask_user',
          payload: {
            question: `${stop.reason} Raise this budget and keep going?`,
            stop: { ...stop },
            proposedLimit: stop.limit * 2,
          },
          agentState: stateMachine?.state ?? 'iterating',
        });
        if (asked.isOk()) {
          const answered = await hilQueue.waitForResolution(asked.value, {
            ...(hilTimeoutMs !== undefined ? { timeoutMs: hilTimeoutMs } : {}),
            ...(signal !== undefined ? { signal } : {}),
          });
          if (answered.isOk() && answered.value.resolution === 'approved') {
            // `raise` mutates the guard in place, so the raise counter travels
            // with the cap and the bound on repeated raises cannot be lost.
            const raised = capGuard.raise(stop);
            logger.info(
              { kind: stop.kind, from: stop.limit, to: raised.maxIterations },
              'agent: budget raised by human approval'
            );
            continue;
          }
        }
      }
      // The handoff note asks for a `complete`-style event so a UI shows a
      // non-error termination. `length` is the honest `FinishReason`: the run
      // ended because a limit was reached, not because the model chose to stop.
      reasoning?.emit({ type: 'complete', finishReason: 'length' });
      await move('error');
      return err(capCheck.error);
    }

    // P-159: the first round streams from `preparing` (the entry move above);
    // every later round streams from `iterating` (set after the tools ran).
    // Both edges exist in the adjacency map, so this one call serves both.
    if (stateMachine !== undefined) {
      if (iterations === 0) await move('preparing');
      await move('streaming');
    }

    // Check for abort before each iteration
    if (signal?.aborted) {
      await move('error');
      return err({
        code: 'ABORTED',
        message: 'Tool loop aborted by signal',
      });
    }

    // Manage context window before model call (P-142)
    const managedMessages = await manageContext(provider, messages, {
      model,
      toolCount: providerTools.length,
      onContextTrim: dropped => {
        logger.debug({ dropped }, 'Context trimmed');
      },
    });

    // Stream chat with provider (conditional spreads satisfy
    // exactOptionalPropertyTypes on the stream opts)
    const streamOpts: {
      onReasoning?: (chunk: ReasoningChunk) => void;
      signal?: AbortSignal;
    } = {
      ...(onReasoning !== undefined ? { onReasoning } : {}),
      ...(signal !== undefined ? { signal } : {}),
    };

    // P-146: this turn runs on the manager's active provider, and is retried on
    // a new provider when a retryable error exhausts the retry budget. The turn
    // is restarted with the SAME messages, so `iterations` is not consumed by
    // a failover.
    let hasError = false;
    let providerError: ProviderError | undefined;
    let finishReason: FinishReason = 'stop';
    let usage: TokenUsage = { input: 0, output: 0, total: 0 };
    const toolCallsThisTurn: ToolCall[] = [];

    for (;;) {
      const turnProvider = providerManager ? providerManager.active : provider;

      /** One provider call. Audits itself; returns the collected turn. */
      const attemptTurn = async (): Promise<TurnOutcome> => {
        const callStartedAt = performance.now();
        let turnError: ProviderError | undefined;
        let turnText = '';
        let turnUsage: TokenUsage = { input: 0, output: 0, total: 0 };
        let turnFinish: FinishReason = 'stop';
        const turnToolCalls: ToolCall[] = [];

        // Collect one provider call. `streamChat` surfaces provider failures as
        // an error chunk rather than throwing, so both paths funnel into
        // `turnError` and the `finally` below audits either way.
        try {
          for await (const chunk of streamChat(
            turnProvider,
            managedMessages,
            providerTools,
            streamOpts
          )) {
            if (chunk.type === 'text') {
              turnText += chunk.text;
            } else if (chunk.type === 'tool_call') {
              turnToolCalls.push(chunk.toolCall);
            } else if (chunk.type === 'done') {
              turnFinish = chunk.finishReason;
              turnUsage = chunk.usage ?? { input: 0, output: 0, total: 0 };
              break;
            } else if (chunk.type === 'error') {
              turnError = chunk.error;
              break;
            }
          }
        } catch (e) {
          turnError = asProviderError(e, turnProvider.provider);
        } finally {
          // P-145: audit in `finally` so failed calls are recorded too. `record`
          // never throws, so this cannot mask the loop's own outcome.
          if (audit) {
            // Match on the provider's model as well as its instance id: a
            // provider's `id` is often namespaced (e.g. `name/model`) while the
            // curated registry keys the bare model id.
            const turnModel =
              MODELS.find(m => m.id === turnProvider.id) ??
              MODELS.find(m => m.id === turnProvider.model);
            audit.record({
              id: newAuditId(),
              ts: nowIso(),
              provider: turnProvider.provider,
              model: turnProvider.model,
              promptVersion: auditPromptVersion,
              task,
              inputTokens: turnUsage.input,
              outputTokens: turnUsage.output,
              costUsd: turnModel ? estimateCost(turnModel, turnUsage).total : 0,
              latencyMs: Math.round(performance.now() - callStartedAt),
              finishReason: turnError !== undefined ? 'error' : turnFinish,
              ...(turnError !== undefined ? { error: turnError } : {}),
              toolNames: [...offeredToolNames],
            });
          }
        }

        return {
          text: turnText,
          toolCalls: turnToolCalls,
          finishReason: turnFinish,
          usage: turnUsage,
          ...(turnError !== undefined ? { error: turnError } : {}),
        };
      };

      // P-138: retry the SAME call on the same provider before considering a
      // failover. `withRetry` needs a rejecting function, so the collected
      // outcome is re-thrown as the original ProviderError and caught again
      // here — a `throw` literal is never involved.
      let turn: TurnOutcome;
      if (retryOpts) {
        const attempts: RetryInfo[] = [];
        const retried = await withRetry(
          async () => {
            const outcome = await attemptTurn();
            if (outcome.error) {
              // `withRetry` classifies on the thrown value via the caller's
              // `retryable` predicate. Re-throwing the original `ProviderError`
              // object keeps that classification exact; wrap it in a real Error
              // only to satisfy the no-throw-literal rule, and carry the original
              // on `cause` so the predicate can still inspect `.retryable`.
              const wrapped = new Error(outcome.error.message, { cause: outcome.error });
              Object.assign(wrapped, outcome.error);
              throw wrapped;
            }
            return outcome;
          },
          {
            ...retryOpts,
            ...(signal !== undefined ? { signal } : {}),
            onAttempt: info => {
              attempts.push(info);
              retryOpts.onAttempt?.(info);
            },
          }
        );
        if (retried.isErr()) {
          // Budget spent on this provider: the real failure is the last one.
          const last = attempts[attempts.length - 1]?.error;
          turn = {
            text: '',
            toolCalls: [],
            finishReason: 'error',
            usage: { input: 0, output: 0, total: 0 },
            error: asProviderError(last ?? retried.error, turnProvider.provider),
          };
          retryAttempts.push(...attempts);
        } else {
          turn = retried.value;
          retryAttempts.push(...attempts);
        }
      } else {
        turn = await attemptTurn();
      }

      const {
        text: turnText,
        toolCalls: turnToolCalls,
        finishReason: turnFinish,
        usage: turnUsage,
        error: turnError,
      } = turn;

      // The turn succeeded — commit its state to the loop.
      if (turnError === undefined) {
        finalContent += turnText;
        toolCallsThisTurn.push(...turnToolCalls);
        finishReason = turnFinish;
        usage = turnUsage;
        // P-162: the model's stated plan for this turn, published once per turn
        // rather than per chunk. The spec points at P-141's `buildPrompt`, but
        // that function does not exist — `ai/prompts.ts` exports `render` and
        // four prompt builders, none of which carries agent intent. The honest
        // source of a plan is the text the model actually streamed back. See
        // ADR-035.
        if (reasoning !== undefined && turnText.trim().length > 0) {
          reasoning.emit({ type: 'plan', text: turnText });
        }
        break;
      }

      // P-146: a retryable failure may be recovered by failing over.
      const canFailover =
        providerManager !== undefined && shouldFailover(turnError) && switches < maxSwitches;
      if (!canFailover) {
        hasError = true;
        providerError = turnError;
        break;
      }

      const switched = switchProvider(providerManager, turnError.message, {
        needsTools: providerTools.length > 0,
        ...(audit !== undefined ? { audit } : {}),
        ...(config.toolPolicy !== undefined ? { toolPolicy: config.toolPolicy } : {}),
      });
      if (switched.isErr()) {
        // No usable provider left: the turn error is the real failure.
        hasError = true;
        providerError = turnError;
        break;
      }

      switches++;
      reasoning?.emit({
        type: 'failover',
        from: turnProvider.id,
        to: switched.value.id,
        reason: turnError.message,
      });
      onProviderSwitch?.({
        id: newAuditId(),
        ts: nowIso(),
        reason: turnError.message,
        from: turnProvider.id,
        to: switched.value.id,
        fromProvider: turnProvider.provider,
        toProvider: switched.value.provider,
        fromModel: turnProvider.model,
        toModel: switched.value.model,
      });
      // Restart this same turn on the new provider.
    }

    // Track cost
    if (usage.total > 0) {
      // P-164: the loop's own running token total, independent of whether a
      // tracker was injected. Providers report usage per turn, so the token
      // budget is enforceable for every caller rather than only the ones who
      // opted into `LoopConfig.cost`.
      runTokens += usage.total;
      if (cost !== undefined) cost.add(usage);
      // P-162: publish the running total, not just this turn, so a UI can show
      // spend as it happens rather than at the end. The tracked figure is the
      // priced one, so it is only published when a tracker exists.
      if (cost !== undefined) {
        reasoning?.emit({ type: 'cost', totalCost: cost.totalCost, tokens: cost.totalTokens });
      }
    }

    // A signal fired during this iteration (e.g. mid-stream abort): the
    // stream reports it as an error chunk, but ABORTED is the real cause.
    if (signal?.aborted) {
      await move('error');
      return err({
        code: 'ABORTED',
        message: 'Tool loop aborted by signal',
      });
    }

    // Handle provider error
    if (hasError) {
      // P-159: a fatal turn leaves the machine in `error`, never parked in
      // `streaming`/`iterating` — the acceptance criterion that a failed job is
      // not indistinguishable from a running one.
      await move('error');
      return err({
        code: 'AI_PROVIDER_ERROR',
        provider: provider.provider,
        message: providerError?.message ?? 'Provider error',
      });
    }

    // If stop, we're done
    if (finishReason === 'stop') {
      // Append assistant message with final content
      if (finalContent) {
        messages.push({ role: 'assistant', content: finalContent });
      }
      await move('done');
      // P-162: `complete` is the last event of a successful run, published after
      // the final state so a consumer that renders in order never shows "done"
      // while the lifecycle still says otherwise.
      reasoning?.emit({ type: 'complete', finishReason });
      return ok({
        finishReason,
        iterations: iterations + 1,
        toolCalls: allToolCalls,
        messages,
        finalContent,
        ...counters(),
      });
    }

    // If tool_calls, execute them
    if (finishReason === 'tool_calls' && toolCallsThisTurn.length > 0) {
      // Append assistant message with tool calls
      messages.push({
        role: 'assistant',
        content: '',
        toolCalls: toolCallsThisTurn,
      });

      // Execute each tool call
      for (const tc of toolCallsThisTurn) {
        allToolCalls.push(tc);

        // Find matching tool
        const tool = tools.find(t => t.name === tc.name);
        if (!tool) {
          // Unknown tool - append error result
          reasoning?.emit({
            type: 'tool_result',
            tool: tc.name,
            ok: false,
            summary: 'unknown tool',
          });
          messages.push(
            serializeToolResult(
              tc.id,
              err({
                code: 'UNKNOWN_TOOL',
                message: 'Unknown tool: ' + tc.name,
              })
            )
          );
          continue;
        }

        // P-158: arguments are untrusted input, and the hostile scan MUST see
        // them exactly as the model wrote them. Zod builds a fresh object for a
        // record and therefore *strips* a `__proto__` key — so scanning the
        // parsed value (the P-139 order) would find nothing to reject. The
        // validator does the scan on the raw value and then runs `parseToolArgs`
        // itself, so both checks happen in the right order.
        //
        // With no validator injected the loop keeps its P-140/P-139 order
        // exactly, so pre-P-158 callers are unaffected.
        let safeArgs: unknown;
        if (validation) {
          const validated = validation.sanitizeToolArgs(tool, tc.arguments);
          if (validated.isErr()) {
            validation.audit(validated.error, tool.name, 'args');
            reasoning?.emit({
              type: 'tool_result',
              tool: tool.name,
              ok: false,
              summary: stitchErrorMessage(validated.error),
            });
            messages.push(serializeToolResult(tc.id, validated));
            continue;
          }
          safeArgs = validated._unsafeUnwrap();
        } else {
          const parseResult = parseToolArgs(tool.schema, tc.arguments);
          if (parseResult.isErr()) {
            reasoning?.emit({
              type: 'tool_result',
              tool: tool.name,
              ok: false,
              summary: stitchErrorMessage(parseResult.error),
            });
            messages.push(serializeToolResult(tc.id, parseResult));
            continue;
          }
          safeArgs = parseResult._unsafeUnwrap();
        }

        // P-157: the autonomy policy is the single place these rules live.
        // With no policy injected the loop keeps its P-140 behaviour exactly
        // ("gated" means ask), so pre-P-157 callers are byte-identical.
        const verdict =
          policy === undefined
            ? tool.autonomy === 'gated'
              ? ({ action: 'ask', reason: 'gated tool (no policy configured)' } as const)
              : ({ action: 'allow', reason: 'auto tool (no policy configured)' } as const)
            : policy.evaluate(tool.name, tool.autonomy);

        // P-162: the policy verdict, published BEFORE the gate is consulted, so
        // the UI can show "waiting on a human" the moment that becomes true
        // rather than after the human has already answered.
        reasoning?.emit({ type: 'policy', decision: verdict, tool: tool.name });

        if (verdict.action === 'deny') {
          // A denied tool reports back to the model as a tool result rather
          // than aborting the whole job: one refused call should not end a
          // stitch that can still make progress.
          reasoning?.emit({
            type: 'tool_result',
            tool: tool.name,
            ok: false,
            summary: `denied by policy: ${verdict.reason}`,
          });
          await move('iterating');
          messages.push(
            serializeToolResult(
              tc.id,
              err({
                code: 'TOOL_DENIED',
                message: `Tool ${tool.name} denied by autonomy policy: ${verdict.reason}`,
              })
            )
          );
          continue;
        }

        if (verdict.action === 'ask') {
          // P-160: with a queue wired, the decision is parked durably and
          // awaited there, so it can be made from another process and survive a
          // restart. Without one, the P-140 `approvalGate` callback is used, so
          // pre-P-160 callers are unchanged.
          const decision = await askHuman(tool, safeArgs);
          if (decision.isErr()) {
            // Nobody answered, or the wait was stopped. The tool never runs and
            // the loop keeps going, so the model can try something else.
            await move('iterating');
            messages.push(serializeToolResult(tc.id, decision));
            continue;
          }
          if (decision.value === 'rejected') {
            // A rejection is a valid answer, not a failure: the model is told
            // and gets another turn.
            reasoning?.emit({
              type: 'tool_result',
              tool: tool.name,
              ok: false,
              summary: 'rejected by human review',
            });
            await move('iterating');
            messages.push(
              serializeToolResult(
                tc.id,
                err({
                  code: 'TOOL_DENIED',
                  message: `Tool ${tool.name} rejected by human review`,
                })
              )
            );
            continue;
          }
          // Approved. Control returns to the loop, which is the only thing
          // allowed to start an execution.
          await move('iterating');
        }

        // P-159: ENTERING the executing state is the guard. The machine refuses
        // the move whenever a human decision is still outstanding, and the
        // refusal — an `ILLEGAL_TRANSITION` carrying from/to — becomes the
        // tool's result. The tool never runs, and the loop keeps going.
        const entered = await move('tool_executing');
        if (entered.isErr()) {
          logger.warn(
            {
              tool: tool.name,
              from: entered.error.code === 'ILLEGAL_TRANSITION' && entered.error.from,
            },
            'refusing tool execution: lifecycle state forbids it'
          );
          reasoning?.emit({
            type: 'tool_result',
            tool: tool.name,
            ok: false,
            summary: stitchErrorMessage(entered.error),
          });
          messages.push(serializeToolResult(tc.id, entered));
          continue;
        }

        // Execute the tool. P-148: the caller-supplied `context` is threaded
        // through here; without it tools that read `ctx` (e.g. `select_files`
        // -> `ctx.git.listFiles`) would receive the pre-P-148 empty cast.
        // P-162: the call is announced with its gate class, so the UI can show
        // what the agent is about to touch before it does.
        reasoning?.emit({
          type: 'tool_call',
          tool: tool.name,
          args: safeArgs,
          gate: tool.autonomy,
        });
        let executed: Result<unknown, StitchError>;
        try {
          executed = await tool.execute(safeArgs, toolContext ?? emptyCtx);
        } catch (thrown) {
          // P-163: a tool is typed to return a `Result`, but a tool that throws
          // — a bug, or a facade that throws before its own guard — would
          // otherwise escape `runToolLoop` as an exception and take the whole
          // stitch with it. This is the acceptance criterion "loop never
          // crashes on unknown error", and it is the reason the catch sits here
          // rather than around the whole loop: everything outside this one call
          // already returns a Result and cannot throw.
          const decision = errorRouter?.fromUnknownThrow(thrown);
          const message =
            decision?.message ??
            `Tool ${tool.name} threw instead of returning a result: ${
              thrown instanceof Error ? thrown.message : String(thrown)
            }`;
          reasoning?.emit({ type: 'tool_result', tool: tool.name, ok: false, summary: message });
          messages.push(
            serializeToolResult(tc.id, err({ code: 'INTERNAL', message } satisfies StitchError))
          );
          await move('iterating');
          continue;
        }

        // P-158: the result flows straight back into the model's context, so it
        // is measured before it gets there. A tool that succeeds with a
        // megabyte of output does not fail loudly — it corrupts the next call.
        let checked: Result<unknown, StitchError> = executed;
        if (validation) {
          const verified = validation.validateToolResult(tool, executed);
          if (verified.isErr()) {
            validation.audit(verified.error, tool.name, 'result');
            reasoning?.emit({
              type: 'tool_result',
              tool: tool.name,
              ok: false,
              summary: stitchErrorMessage(verified.error),
            });
            messages.push(serializeToolResult(tc.id, verified));
            continue;
          }
          checked = verified;
        }

        // P-162: every exit path above has published a `tool_result` already,
        // so this is the only case left — and it is reached whether the tool
        // itself failed or succeeded, so the verdict is read from the result
        // rather than assumed. A tool that returned an `err` gets `ok:false` and
        // the error text, which is the difference between "it failed" and "it
        // never happened" to whoever is watching.
        if (checked.isOk()) {
          reasoning?.emit({
            type: 'tool_result',
            tool: tool.name,
            ok: true,
            summary: summarise(checked.value),
          });
        } else {
          reasoning?.emit({
            type: 'tool_result',
            tool: tool.name,
            ok: false,
            summary: stitchErrorMessage(checked.error),
          });
        }

        messages.push(serializeToolResult(tc.id, checked));

        // P-161: record the action so it can be rolled back. Recorded ONLY after
        // validation passed and ONLY on success, so the stack never holds an
        // entry for work that did not happen or whose result was rejected. A
        // tool that is not reversible simply returns false and nothing is
        // stored — better no record than a record that cannot be honoured.
        if (undoStack !== undefined && checked.isOk()) {
          undoStack.record(tool.name, checked.value);
        }
      }

      // P-159: every tool call has settled, so control is the loop's again.
      // The next iteration moves `iterating -> streaming`.
      await move('iterating');

      // Continue loop with tool results in messages
      continue;
    }

    // Other finish reasons (length, content_filter, error)
    // P-159: an `ok` return is a terminal outcome, so the lifecycle records
    // `done`. The truncated finishReason is carried in the result; conflating
    // "stopped early" with "failed" would hide a real signal from the UI.
    await move('done');
    reasoning?.emit({ type: 'complete', finishReason });
    return ok({
      finishReason,
      iterations: iterations + 1,
      toolCalls: allToolCalls,
      messages,
      finalContent,
      ...(providerError !== undefined ? { error: providerError } : {}),
      ...counters(),
    });
  }

  // No normal exit. P-164 moved the iteration cap out of the `for` condition and
  // into `LoopCapGuard`, so the loop runs `for (;;)` and the guard is the only
  // thing that ends it. Every path out of the body returns: a `stop` finish
  // reason returns `ok`, and a cap, abort, or error returns `err`. TypeScript
  // agrees — it does not require a return after this point, which is how the
  // previous `LOOP_LIMIT` fall-through became provably dead and was removed
  // rather than left behind as a second, unreachable answer to the same
  // question.
}
