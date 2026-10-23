// P-347 — the self-critique contract, exercised without a network: the
// provider is the house mock, so every case is hermetic and deterministic.

import { describe, expect, it } from 'vitest';
import { promptVersion, selfCritiquePrompt } from '../ai/prompts.js';
import { mockScriptFromText } from '../ai/mock.js';
import type { ChatProvider } from '../ai/provider.js';
import {
  extractJsonObject,
  parseSelfCritique,
  rubricScoreToConfidence,
  runSelfCritique,
  toSelfCritiqueComponents,
  SELF_CRITIQUE_TOOL,
  selfCritiqueSchema,
} from './self-critique.js';

const VALID = {
  self_confidence: 82,
  wiring_self_score: 5,
  unnecessary_changes_self_score: 4,
  patterns_self_score: 4,
  self_rationale: 'The wiring is complete; one helper could be folded into its caller.',
  self_flags: ['helper extraction may be unnecessary'],
};

/** A provider that fails the way a real backend fails (P-138 classification). */
function failingProvider(): ChatProvider {
  return {
    name: 'failing',
    model: 'failing-model',
    provider: 'failing',
    id: 'failing',

    chat: () => {
      // A real Error wearing the provider-error fields: `asProviderError` reads
      // them off and `no-throw-literal` stays satisfied.
      throw Object.assign(new Error(), {
        message: 'the connection dropped',
        kind: 'network',
        retryable: true,
      });
    },
    countTokens: () => 0,
    isRetryable: () => true,
  } as unknown as ChatProvider;
}

describe('self-critique (P-347)', () => {
  it('renders the prompt with the diff and the context', () => {
    const { system, user } = selfCritiquePrompt(
      '--- a/x\n+++ b/x\n+const x = 1;',
      'the goal was x'
    );
    expect(system.length).toBeGreaterThan(0);
    expect(user).toContain('const x = 1;');
    expect(user).toContain('the goal was x');
    expect(user).not.toContain('{{diff}}');
    expect(promptVersion('self-critique')).toMatch(/^[0-9a-f]{12}$/);
  });

  it('exposes the tool name and the score fields the rubric shares', () => {
    expect(SELF_CRITIQUE_TOOL).toBe('self_critique');
    expect(Object.keys(selfCritiqueSchema.shape)).toEqual([
      'self_confidence',
      'wiring_self_score',
      'unnecessary_changes_self_score',
      'patterns_self_score',
      'self_rationale',
      'self_flags',
    ]);
  });

  it('parses a fenced reply and a reply with prose around it', () => {
    const fenced = '```json\n' + JSON.stringify(VALID) + '\n```';
    const prose = `Here is my assessment.\n\n${JSON.stringify(VALID)}\n\nLet me know if you need more.`;
    for (const reply of [fenced, prose, JSON.stringify(VALID)]) {
      const result = parseSelfCritique(reply);
      expect(result.isOk()).toBe(true);
      if (result.isOk()) expect(result.value.self_confidence).toBe(82);
    }
  });

  it('extracts the first balanced object even with braces in the prose', () => {
    expect(extractJsonObject('{} and then {"a":1}')).toBe('{}');
    expect(extractJsonObject('no object here')).toBeUndefined();
  });

  it('rejects a reply that is not a usable document', () => {
    const noJson = parseSelfCritique('I think it is fine.');
    expect(noJson.isErr()).toBe(true);
    if (noJson.isErr()) {
      expect(noJson.error.code).toBe('CONFIG_ERROR');
      expect('field' in noJson.error && noJson.error.field).toBe('confidence.selfCritique');
    }
    const outOfRange = parseSelfCritique(JSON.stringify({ ...VALID, self_confidence: 101 }));
    expect(outOfRange.isErr()).toBe(true);
    const badScore = parseSelfCritique(JSON.stringify({ ...VALID, wiring_self_score: 0 }));
    expect(badScore.isErr()).toBe(true);
    const missing = parseSelfCritique(JSON.stringify({ self_confidence: 80 }));
    expect(missing.isErr()).toBe(true);
  });

  it('maps the 1-5 rubric scores onto the 0-100 scale', () => {
    expect(rubricScoreToConfidence(1)).toBe(0);
    expect(rubricScoreToConfidence(3)).toBe(50);
    expect(rubricScoreToConfidence(5)).toBe(100);
    const components = toSelfCritiqueComponents(VALID);
    expect(components).toEqual({
      self_confidence: 82,
      wiring_correctness: 100,
      unnecessary_changes: 75,
      respects_patterns: 75,
    });
  });

  it('runs the pass against the scripted provider', async () => {
    const provider = mockScriptFromText(JSON.stringify(VALID));
    const result = await runSelfCritique(provider, { diff: '+const x = 1;', context: 'add x' });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.self_confidence).toBe(82);
      expect(result.value.self_flags).toEqual(['helper extraction may be unnecessary']);
    }
  });

  it('reports a provider failure as AI_PROVIDER_ERROR, without throwing', async () => {
    const result = await runSelfCritique(failingProvider(), { diff: '+x', context: 'y' });
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.code).toBe('AI_PROVIDER_ERROR');
      expect('provider' in result.error && result.error.provider).toBe('failing');
    }
  });
});
