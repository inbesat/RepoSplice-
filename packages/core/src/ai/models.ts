// Model Registry (P-135) + Tool-Calling Policy (P-143).
//
// Central registry of model capabilities (context window, tool support, cost,
// tool-calling policy) with helpers for task-based recommendation and capability validation.

/**
 * Tool-calling policy for a model.
 * - 'allowed': tool calling works normally
 * - 'blocked-by-default': tool calling disabled unless explicitly opted in via config
 * - 'unknown': model not in registry, conservative default (warn but allow)
 */
export type ToolCallingPolicy = 'allowed' | 'blocked-by-default' | 'unknown';

/**
 * Specification for a language model's capabilities and pricing.
 */
export interface ModelSpec {
  /** Unique id in format `provider/model` (e.g., `anthropic/claude-3.5-sonnet`). */
  id: string;
  /** Provider id (openrouter, openai, anthropic, ollama, mock). */
  provider: string;
  /** Maximum context window in tokens. */
  contextWindow: number;
  /** Whether the model supports function/tool calling. */
  supportsTools: boolean;
  /** Tool-calling policy (default 'allowed'). */
  toolCalling: ToolCallingPolicy;
  /** Maximum output tokens in a single response. */
  maxOutput: number;
  /** Cost per 1M input / 1M output tokens in USD. */
  cost: { input: number; output: number };
  /** Task tags this model is recommended for (e.g., 'resolve_deps', 'generate_code'). */
  recommendedFor: string[];
}

/**
 * Curated registry of known models.
 * IDs follow `provider/model` format.
 * Update pricing when vendor prices change.
 */
export const MODELS: readonly ModelSpec[] = [
  // OpenRouter models
  {
    id: 'openrouter/anthropic/claude-3.5-sonnet',
    provider: 'openrouter',
    contextWindow: 200000,
    supportsTools: true,
    toolCalling: 'allowed',
    maxOutput: 8192,
    cost: { input: 3.0, output: 15.0 },
    recommendedFor: ['resolve_deps', 'generate_code', 'analyze_code', 'general'],
  },
  {
    id: 'openrouter/openai/gpt-4o',
    provider: 'openrouter',
    contextWindow: 128000,
    supportsTools: true,
    toolCalling: 'allowed',
    maxOutput: 16384,
    cost: { input: 5.0, output: 15.0 },
    recommendedFor: ['generate_code', 'analyze_code', 'general'],
  },
  {
    id: 'openrouter/google/gemini-2.5-pro',
    provider: 'openrouter',
    contextWindow: 2000000,
    supportsTools: false, // P-143: tool-calling default blocked for Gemini
    toolCalling: 'blocked-by-default',
    maxOutput: 8192,
    cost: { input: 1.25, output: 10.0 },
    recommendedFor: ['analyze_code', 'large_context', 'summarize'],
  },
  {
    id: 'openrouter/anthropic/claude-3-opus',
    provider: 'openrouter',
    contextWindow: 200000,
    supportsTools: true,
    toolCalling: 'allowed',
    maxOutput: 4096,
    cost: { input: 15.0, output: 75.0 },
    recommendedFor: ['complex_reasoning', 'analyze_code'],
  },
  {
    id: 'openrouter/anthropic/claude-3-haiku',
    provider: 'openrouter',
    contextWindow: 200000,
    supportsTools: true,
    toolCalling: 'allowed',
    maxOutput: 4096,
    cost: { input: 0.25, output: 1.25 },
    recommendedFor: ['quick_tasks', 'summarize', 'generate_code'],
  },
  {
    id: 'openrouter/meta-llama/llama-3.1-405b',
    provider: 'openrouter',
    contextWindow: 128000,
    supportsTools: true,
    toolCalling: 'allowed',
    maxOutput: 4096,
    cost: { input: 3.0, output: 3.0 },
    recommendedFor: ['generate_code', 'analyze_code'],
  },
  {
    id: 'openrouter/mistralai/mistral-large',
    provider: 'openrouter',
    contextWindow: 128000,
    supportsTools: true,
    toolCalling: 'allowed',
    maxOutput: 8192,
    cost: { input: 3.0, output: 9.0 },
    recommendedFor: ['generate_code', 'analyze_code'],
  },

  // OpenAI direct
  {
    id: 'openai/gpt-4o',
    provider: 'openai',
    contextWindow: 128000,
    supportsTools: true,
    toolCalling: 'allowed',
    maxOutput: 16384,
    cost: { input: 5.0, output: 15.0 },
    recommendedFor: ['generate_code', 'analyze_code', 'general'],
  },
  {
    id: 'openai/gpt-4o-mini',
    provider: 'openai',
    contextWindow: 128000,
    supportsTools: true,
    toolCalling: 'allowed',
    maxOutput: 16384,
    cost: { input: 0.15, output: 0.6 },
    recommendedFor: ['quick_tasks', 'generate_code', 'summarize'],
  },
  {
    id: 'openai/gpt-4-turbo',
    provider: 'openai',
    contextWindow: 128000,
    supportsTools: true,
    toolCalling: 'allowed',
    maxOutput: 4096,
    cost: { input: 10.0, output: 30.0 },
    recommendedFor: ['analyze_code', 'complex_reasoning'],
  },

  // Anthropic native
  {
    id: 'anthropic/claude-3.5-sonnet',
    provider: 'anthropic',
    contextWindow: 200000,
    supportsTools: true,
    toolCalling: 'allowed',
    maxOutput: 8192,
    cost: { input: 3.0, output: 15.0 },
    recommendedFor: ['resolve_deps', 'generate_code', 'analyze_code', 'general'],
  },
  {
    id: 'anthropic/claude-3-opus',
    provider: 'anthropic',
    contextWindow: 200000,
    supportsTools: true,
    toolCalling: 'allowed',
    maxOutput: 4096,
    cost: { input: 15.0, output: 75.0 },
    recommendedFor: ['complex_reasoning', 'analyze_code'],
  },
  {
    id: 'anthropic/claude-3-haiku',
    provider: 'anthropic',
    contextWindow: 200000,
    supportsTools: true,
    toolCalling: 'allowed',
    maxOutput: 4096,
    cost: { input: 0.25, output: 1.25 },
    recommendedFor: ['quick_tasks', 'summarize', 'generate_code'],
  },

  // Ollama local models
  {
    id: 'ollama/llama3.1:8b',
    provider: 'ollama',
    contextWindow: 128000,
    supportsTools: true,
    toolCalling: 'allowed',
    maxOutput: 4096,
    cost: { input: 0, output: 0 }, // local
    recommendedFor: ['local_dev', 'generate_code', 'privacy'],
  },
  {
    id: 'ollama/llama3.1:70b',
    provider: 'ollama',
    contextWindow: 128000,
    supportsTools: true,
    toolCalling: 'allowed',
    maxOutput: 4096,
    cost: { input: 0, output: 0 },
    recommendedFor: ['local_dev', 'complex_reasoning', 'privacy'],
  },
  {
    id: 'ollama/codellama:34b',
    provider: 'ollama',
    contextWindow: 16384,
    supportsTools: true,
    toolCalling: 'allowed',
    maxOutput: 4096,
    cost: { input: 0, output: 0 },
    recommendedFor: ['generate_code', 'local_dev'],
  },

  // Mock for testing
  {
    id: 'mock/mock-model',
    provider: 'mock',
    contextWindow: 4096,
    supportsTools: true,
    toolCalling: 'allowed',
    maxOutput: 1024,
    cost: { input: 0, output: 0 },
    recommendedFor: ['test'],
  },
] as const;

/**
 * Look up a model by its id (`provider/model`).
 * @throws {Error} UNKNOWN_MODEL if not found
 */
export function getModel(id: string): ModelSpec {
  const model = MODELS.find(m => m.id === id);
  if (!model) {
    const err = new Error(`Unknown model: ${id}`);
    (err as Error & { code: string }).code = 'UNKNOWN_MODEL';
    throw err;
  }
  return model;
}

/**
 * Get the recommended model for a given agent task.
 * Matches against `recommendedFor` tags; falls back to default model.
 * Can be overridden by config.ai.preferredModel (P-009).
 */
export function getRecommendedFor(task: string): ModelSpec {
  // Task-to-tag mapping
  const taskTags: Record<string, string[]> = {
    resolve_deps: ['resolve_deps'],
    generate_code: ['generate_code'],
    analyze_code: ['analyze_code'],
    summarize: ['summarize'],
    complex_reasoning: ['complex_reasoning'],
    quick_tasks: ['quick_tasks'],
    large_context: ['large_context'],
    local_dev: ['local_dev'],
    privacy: ['privacy'],
    general: ['general'],
    test: ['test'],
  };

  const tags = taskTags[task] ?? ['general'];

  // Find first model matching any tag
  for (const tag of tags) {
    const match = MODELS.find(m => m.recommendedFor.includes(tag));
    if (match) return match;
  }

  // Fallback to a sensible default (first general-purpose model)
  const fallback = MODELS.find(m => m.recommendedFor.includes('general'));
  return fallback ?? MODELS[0]!;
}

/**
 * Assert that a model meets the required capabilities for a task.
 * @throws {Error} MODEL_INCAPABLE if model doesn't meet requirements
 */
export function assertModelCapable(
  model: ModelSpec,
  requirements: { needsTools?: boolean; contextNeeded?: number }
): void {
  if (requirements.needsTools && !model.supportsTools) {
    const err = new Error(`Model ${model.id} does not support tool calling (supportsTools=false)`);
    (err as Error & { code: string }).code = 'MODEL_INCAPABLE';
    throw err;
  }
  if (
    requirements.contextNeeded !== undefined &&
    model.contextWindow < requirements.contextNeeded
  ) {
    const err = new Error(
      `Model ${model.id} context window (${model.contextWindow}) is less than required (${requirements.contextNeeded})`
    );
    (err as Error & { code: string }).code = 'MODEL_INCAPABLE';
    throw err;
  }
}

/**
 * Policy override input (P-143). Mirrors `[ai].overrideToolModels` from
 * stitch.toml (P-009): ids listed here are explicitly opted in to tool
 * calling even on a `blocked-by-default` model.
 */
export interface ToolCallPolicyConfig {
  overrideToolModels?: string[];
}

/**
 * Check if tool calling is blocked for a model.
 *
 * True iff `model.toolCalling === 'blocked-by-default'` AND the id is NOT in
 * `config.overrideToolModels`. `'allowed'` models are never blocked;
 * `'unknown'` models are not blocked either — P-143 acceptance criteria
 * require "no crash for unknown/future models (warn, no hard block)".
 */
export function isToolCallingBlocked(model: ModelSpec, config: ToolCallPolicyConfig = {}): boolean {
  if (model.toolCalling !== 'blocked-by-default') return false;
  return !(config.overrideToolModels ?? []).includes(model.id);
}
