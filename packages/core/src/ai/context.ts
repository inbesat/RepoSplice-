// Context Window Management (P-142).
//
// Estimates token usage, trims/summarizes message history to fit within
// model context window with safety margin, and prioritizes repo context.

import type { ChatMessage } from './types.js';
import type { ModelSpec } from './models.js';
import { countTokens } from './cost.js';

/** Default safety factor: use 80% of context window for messages. */
export const DEFAULT_SAFETY_FACTOR = 0.8;

/** Estimated token overhead per tool schema in the request. */
export const TOOL_SCHEMA_OVERHEAD = 500;

/**
 * Estimate total token usage for a message array + tool schemas.
 * @param messages - Chat messages
 * @param model - Model spec with contextWindow
 * @param toolCount - Number of tools available (default 0)
 * @returns Estimated token count
 */
export function estimateWindowUsage(
  messages: ChatMessage[],
  _model: ModelSpec,
  toolCount: number = 0
): number {
  let total = 0;
  for (const msg of messages) {
    total += countTokens([msg]);
  }
  // Add tool schema overhead
  total += toolCount * TOOL_SCHEMA_OVERHEAD;
  return total;
}

/** Options for trimMessages. */
export interface TrimOptions {
  /** Fraction of contextWindow to target (default 0.8). */
  safetyFactor?: number;
  /** Max output tokens to reserve for response (default model.maxOutput). */
  reservedOutput?: number;
  /** Callback when messages are dropped. */
  onContextTrim?: (dropped: number) => void;
}

/**
 * Trim messages to fit within context window budget.
 * Strategy: keep system message, drop oldest non-system messages first.
 * If a single message remains and is still too large, truncate its content.
 */
export function trimMessages(
  messages: ChatMessage[],
  model: ModelSpec,
  opts: TrimOptions = {}
): { messages: ChatMessage[]; dropped: number } {
  const {
    safetyFactor = DEFAULT_SAFETY_FACTOR,
    reservedOutput = model.maxOutput,
    onContextTrim,
  } = opts;

  const budget = Math.floor(model.contextWindow * safetyFactor) - reservedOutput;
  if (budget <= 0) {
    // Budget too small, return just system message if any
    const systemMsg = messages.find(m => m.role === 'system');
    return {
      messages: systemMsg ? [systemMsg] : [],
      dropped: messages.length - (systemMsg ? 1 : 0),
    };
  }

  const currentMessages = [...messages];
  let dropped = 0;

  // Protect system messages (all of them at the start)
  const systemMessages = currentMessages.filter(m => m.role === 'system');
  const nonSystemMessages = currentMessages.filter(m => m.role !== 'system');

  // While over budget and have non-system messages to drop (keep at least one to truncate if needed)
  while (
    estimateWindowUsage([...systemMessages, ...nonSystemMessages], model) > budget &&
    nonSystemMessages.length > 1
  ) {
    // Drop oldest non-system message
    nonSystemMessages.shift();
    dropped++;
  }

  // If still over budget and we have messages, truncate the oldest non-system
  const combined = [...systemMessages, ...nonSystemMessages];
  if (estimateWindowUsage(combined, model) > budget && nonSystemMessages.length > 0) {
    // Truncate the oldest non-system message
    const oldestIdx = systemMessages.length;
    const msg = combined[oldestIdx];
    const maxChars = Math.floor(budget * 4); // rough char estimate
    if (msg && msg.content.length > maxChars) {
      combined[oldestIdx] = {
        ...msg,
        content: msg.content.slice(0, maxChars) + ' [truncated]',
      };
    }
  }

  // Final check - if still over, truncate all non-system messages proportionally
  if (estimateWindowUsage(combined, model) > budget && combined.length > systemMessages.length) {
    const nonSystemCount = combined.length - systemMessages.length;
    const tokensPerMsg = Math.floor(budget / Math.max(1, nonSystemCount));
    const charsPerMsg = tokensPerMsg * 4;
    for (let i = systemMessages.length; i < combined.length; i++) {
      const entry = combined[i];
      if (entry && entry.content.length > charsPerMsg) {
        combined[i] = {
          ...entry,
          content: entry.content.slice(0, charsPerMsg) + ' [truncated]',
        };
      }
    }
  }

  if (onContextTrim && dropped > 0) {
    onContextTrim(dropped);
  }

  return { messages: combined, dropped };
}

/** Context blocks for repo context injection. */
export interface ContextBlock {
  /** Priority: higher = more important (kept first). */
  priority: number;
  /** Human-readable label for logging. */
  label: string;
  /** Content to inject. */
  content: string;
}

/**
 * Add repo context blocks to messages, respecting priority and budget.
 * Prepends context as system/user messages after existing system messages.
 */
export function addRepoContext(
  messages: ChatMessage[],
  contextBlocks: ContextBlock[],
  model: ModelSpec,
  opts: { safetyFactor?: number; reservedOutput?: number } = {}
): ChatMessage[] {
  const { safetyFactor = DEFAULT_SAFETY_FACTOR, reservedOutput = model.maxOutput } = opts;
  const budget = Math.floor(model.contextWindow * safetyFactor) - reservedOutput;

  // Sort by priority descending
  const sortedBlocks = [...contextBlocks].sort((a, b) => b.priority - a.priority);

  // Find insertion point (after last system message)
  let insertIdx = 0;
  while (insertIdx < messages.length && messages[insertIdx]?.role === 'system') {
    insertIdx++;
  }

  const currentMessages = [...messages];
  let currentUsage = estimateWindowUsage(currentMessages, model);

  for (const block of sortedBlocks) {
    const blockTokens = countTokens([{ role: 'user', content: block.content }]);
    if (currentUsage + blockTokens <= budget) {
      currentMessages.splice(insertIdx, 0, {
        role: 'user',
        content: `[Context: ${block.label}]\n${block.content}`,
      });
      currentUsage += blockTokens;
      insertIdx++;
    } else {
      // Skip lower-priority blocks
      continue;
    }
  }

  return currentMessages;
}

/**
 * Manage context for a provider call: trim messages, add repo context if provided.
 * Returns the final message array ready for the model.
 */
export async function manageContext(
  _provider: unknown,
  messages: ChatMessage[],
  ctx: {
    model: ModelSpec;
    repoContext?: ContextBlock[];
    toolCount?: number;
    onContextTrim?: (dropped: number) => void;
    safetyFactor?: number;
  }
): Promise<ChatMessage[]> {
  let currentMessages = [...messages];

  // Add repo context first (before trimming, so it can be trimmed if needed)
  if (ctx.repoContext && ctx.repoContext.length > 0) {
    currentMessages = addRepoContext(currentMessages, ctx.repoContext, ctx.model, {
      ...(ctx.safetyFactor !== undefined ? { safetyFactor: ctx.safetyFactor } : {}),
    });
  }

  // Trim to fit budget
  const { messages: trimmed } = trimMessages(currentMessages, ctx.model, {
    ...(ctx.safetyFactor !== undefined ? { safetyFactor: ctx.safetyFactor } : {}),
    ...(ctx.onContextTrim !== undefined ? { onContextTrim: ctx.onContextTrim } : {}),
  });

  return trimmed;
}
