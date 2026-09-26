import { describe, it, expect } from 'vitest';
import { getModel, getRecommendedFor, assertModelCapable, MODELS } from './models.js';

describe('P-135 models: registry', () => {
  it('resolves known model', () => {
    const model = getModel('anthropic/claude-3.5-sonnet');
    expect(model).toBeDefined();
    expect(model.id).toBe('anthropic/claude-3.5-sonnet');
    expect(model.provider).toBe('anthropic');
    expect(model.contextWindow).toBe(200000);
    expect(model.supportsTools).toBe(true);
    expect(model.maxOutput).toBe(8192);
    expect(model.cost.input).toBe(3.0);
    expect(model.cost.output).toBe(15.0);
    expect(model.recommendedFor).toContain('resolve_deps');
  });

  it('throws on unknown model', () => {
    expect(() => getModel('nope')).toThrow();
    try {
      getModel('nope');
    } catch (e) {
      const err = e as Error & { code: string };
      expect(err.code).toBe('UNKNOWN_MODEL');
      expect(err.message).toContain('Unknown model');
    }
  });
});

describe('P-135 models: recommendations', () => {
  it('recommends per task', () => {
    const resolveDepsModel = getRecommendedFor('resolve_deps');
    expect(resolveDepsModel.recommendedFor).toContain('resolve_deps');

    const codeModel = getRecommendedFor('generate_code');
    expect(codeModel.recommendedFor).toContain('generate_code');

    const unknownTask = getRecommendedFor('unknown_task');
    // Should fallback to a general model
    expect(unknownTask).toBeDefined();
  });
});

describe('P-135 models: capability validation', () => {
  it('rejects tools-incapable model', () => {
    const gemini = MODELS.find(m => m.id === 'openrouter/google/gemini-2.5-pro')!;
    expect(gemini.supportsTools).toBe(false);

    expect(() => assertModelCapable(gemini, { needsTools: true })).toThrow();
    try {
      assertModelCapable(gemini, { needsTools: true });
    } catch (e) {
      const err = e as Error & { code: string };
      expect(err.code).toBe('MODEL_INCAPABLE');
      expect(err.message).toContain('does not support tool calling');
    }
  });

  it('rejects context-window-incapable model', () => {
    const smallModel = MODELS.find(m => m.contextWindow < 100000)!;
    expect(() => assertModelCapable(smallModel, { contextNeeded: 200000 })).toThrow();
    try {
      assertModelCapable(smallModel, { contextNeeded: 200000 });
    } catch (e) {
      const err = e as Error & { code: string };
      expect(err.code).toBe('MODEL_INCAPABLE');
      expect(err.message).toContain('context window');
    }
  });

  it('passes for capable model', () => {
    const capable = MODELS.find(m => m.supportsTools && m.contextWindow >= 100000)!;
    expect(() =>
      assertModelCapable(capable, { needsTools: true, contextNeeded: 100000 })
    ).not.toThrow();
  });
});

describe('P-135 models: gemini blocked for tools', () => {
  it('gemini blocked for tools by default', () => {
    const gemini = MODELS.find(m => m.id === 'openrouter/google/gemini-2.5-pro')!;
    expect(gemini.supportsTools).toBe(false);
    expect(gemini.id).toContain('gemini');

    // Should throw when tools are required
    expect(() => assertModelCapable(gemini, { needsTools: true })).toThrow();
    try {
      assertModelCapable(gemini, { needsTools: true });
    } catch (e) {
      const err = e as Error & { code: string };
      expect(err.code).toBe('MODEL_INCAPABLE');
    }
  });

  it('gemini allowed for non-tool tasks', () => {
    const gemini = MODELS.find(m => m.id === 'openrouter/google/gemini-2.5-pro')!;
    expect(() => assertModelCapable(gemini, { needsTools: false })).not.toThrow();
  });
});

describe('P-135 models: registry completeness', () => {
  it('all models have required fields', () => {
    for (const model of MODELS) {
      expect(model.id).toBeTruthy();
      expect(model.provider).toBeTruthy();
      expect(model.contextWindow).toBeGreaterThan(0);
      expect(typeof model.supportsTools).toBe('boolean');
      expect(model.maxOutput).toBeGreaterThan(0);
      expect(model.cost).toBeDefined();
      expect(model.cost.input).toBeGreaterThanOrEqual(0);
      expect(model.cost.output).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(model.recommendedFor)).toBe(true);
      expect(model.recommendedFor.length).toBeGreaterThan(0);
    }
  });
});
