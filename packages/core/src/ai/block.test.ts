import { describe, it, expect } from 'vitest';
import { isToolCallingBlocked, enforceToolCallPolicy } from './block.js';
import { getModel, type ModelSpec } from './models.js';
import { createProvider } from './registry.js';

const GEMINI = 'openrouter/google/gemini-2.5-pro';

describe('P-143 block: tool calling policy', () => {
  it('blocks gemini-3 by default', () => {
    const model = getModel(GEMINI);
    expect(model.toolCalling).toBe('blocked-by-default');
    expect(model.supportsTools).toBe(false);
    expect(isToolCallingBlocked(model, { overrideToolModels: [] })).toBe(true);
    expect(isToolCallingBlocked(model, {})).toBe(true);
  });

  it('allows when overridden', () => {
    const model = getModel(GEMINI);
    expect(isToolCallingBlocked(model, { overrideToolModels: [GEMINI] })).toBe(false);
    const allowed = enforceToolCallPolicy(model, { overrideToolModels: [GEMINI] });
    expect(allowed.isOk()).toBe(true);
  });

  it('enforce returns typed error', () => {
    const model = getModel(GEMINI);
    const result = enforceToolCallPolicy(model, { overrideToolModels: [] });
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      const error = result.error;
      expect(error.code).toBe('TOOL_CALLING_BLOCKED');
      if (error.code === 'TOOL_CALLING_BLOCKED') {
        expect(error.model).toBe(GEMINI);
        expect(error.remedy).toContain('overrideToolModels');
        expect(error.message).toContain(GEMINI);
      }
    }
  });

  it('registry rejects tools on blocked model', async () => {
    // P-143 acceptance: createProvider refuses a tools task on the blocked
    // Gemini id unless it is opted in via overrideToolModels.
    const blocked = await createProvider(
      { provider: 'openrouter', model: GEMINI, apiKey: 'sk-or-test' },
      { needsTools: true, toolCallPolicy: { overrideToolModels: [] } }
    );
    expect(blocked.isErr()).toBe(true);
    if (blocked.isErr()) expect(blocked.error.code).toBe('TOOL_CALLING_BLOCKED');

    // Explicit opt-in lifts the block.
    const optedIn = await createProvider(
      { provider: 'openrouter', model: GEMINI, apiKey: 'sk-or-test' },
      { needsTools: true, toolCallPolicy: { overrideToolModels: [GEMINI] } }
    );
    expect(optedIn.isOk()).toBe(true);

    // Without a tools task the policy does not apply.
    const noTools = await createProvider({
      provider: 'openrouter',
      model: GEMINI,
      apiKey: 'sk-or-test',
    });
    expect(noTools.isOk()).toBe(true);
  });

  it('unknown models warn not block', () => {
    // P-143 acceptance: "no crash for unknown/future models
    // (toolCalling:'unknown' → conservative warning, no hard block)".
    const unknownModel: ModelSpec = {
      id: 'unknown/model',
      provider: 'unknown',
      contextWindow: 100000,
      supportsTools: true,
      toolCalling: 'unknown',
      maxOutput: 4096,
      cost: { input: 1, output: 2 },
      recommendedFor: [],
    };
    expect(isToolCallingBlocked(unknownModel, {})).toBe(false);
    expect(isToolCallingBlocked(unknownModel, { overrideToolModels: [] })).toBe(false);
    const enforced = enforceToolCallPolicy(unknownModel, {});
    expect(enforced.isOk()).toBe(true);
  });

  it('enforce passes for non-blocked models', () => {
    const model = getModel('openrouter/anthropic/claude-3.5-sonnet');
    expect(model.toolCalling).toBe('allowed');
    expect(isToolCallingBlocked(model, {})).toBe(false);
    expect(enforceToolCallPolicy(model, { overrideToolModels: [] }).isOk()).toBe(true);
  });
});
