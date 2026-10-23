// P-348 — the `assess_confidence` tool.
//
// The five factors arrive through injected ports, so the mirror is hermetic:
// the self-critique runs over a scripted mock provider and the four measured
// factors are plain functions. The tests pin the composite, the tag mapping,
// the refusal when a measurement is missing, the publication (store + emit)
// and the automatic invocation after a successful tool.

import { describe, expect, it } from 'vitest';
import { err, ok, type Result } from 'neverthrow';
import { mockScriptFromText } from '../ai/mock.js';
import { runSelfCritique } from '../confidence/self-critique.js';
import { DEFAULT_CONFIDENCE_WEIGHTS } from '../confidence/schema.js';
import type { ToolContext, ToolDefinition } from '../ai/types.js';
import type { AgentPayload } from '../events/topics.js';
import type { StitchError } from '../result/index.js';
import {
  ASSESS_CONFIDENCE_TOOL,
  assessConfidence,
  createAssessConfidenceTool,
  resolverConfidenceFromTags,
  RESOLVER_CONFIDENCE_SCORES,
  withConfidenceAssessment,
  type AssessConfidenceDeps,
  type ConfidenceProposal,
  type ConfidenceRecord,
  type ConfidencePorts,
} from './assess-confidence.js';

const VALID_SELF_CRITIQUE = {
  self_confidence: 82,
  wiring_self_score: 5,
  unnecessary_changes_self_score: 4,
  patterns_self_score: 4,
  self_rationale: 'The wiring is complete; one helper could be folded into its caller.',
  self_flags: ['helper extraction may be unnecessary'],
};

const PROPOSAL: ConfidenceProposal = {
  id: 'proposal-1',
  files: ['src/a.ts'],
  diff: '+export const a = 1;',
};

/** The self-critique port over a scripted provider. */
function scriptedSelfCritique(text: string): ConfidencePorts['selfCritique'] {
  const provider = mockScriptFromText(text);
  return input => runSelfCritique(provider, input);
}

/** A provider whose call fails the way a dropped connection does. */
function failingSelfCritique(): ConfidencePorts['selfCritique'] {
  const provider = {
    name: 'failing',
    model: 'failing',
    provider: 'failing',
    id: 'failing',

    chat(): AsyncIterable<never> {
      throw Object.assign(new Error(), {
        message: 'the connection dropped',
        kind: 'network',
        retryable: true,
      });
    },
    countTokens: () => 0,
    isRetryable: () => true,
  };
  return input => runSelfCritique(provider, input);
}

/** The four measured factors, deterministic. */
function measuredPorts(): ConfidencePorts {
  return {
    selfCritique: scriptedSelfCritique(JSON.stringify(VALID_SELF_CRITIQUE)),
    sandboxPass: async () => ok(true),
    resolverConfidence: async () => ok(60),
    licenseRisk: async () => ok(40),
    testCoverage: async () => ok(50),
  };
}

function depsWith(overrides: Partial<AssessConfidenceDeps> = {}): AssessConfidenceDeps {
  return { ports: measuredPorts(), ...overrides };
}

describe('assess_confidence (P-348)', () => {
  it('folds the five factors into a schema-valid record', async () => {
    const result = await assessConfidence(PROPOSAL, depsWith());
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    const record = result.value;
    expect(record.proposalId).toBe('proposal-1');
    expect(record.prompt.name).toBe('self-critique');
    expect(record.prompt.version).toMatch(/^[0-9a-f]{12}$/);
    expect(record.assessedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(record.weights).toEqual(DEFAULT_CONFIDENCE_WEIGHTS);
  });

  it('computes the composite through the P-346 weights', async () => {
    const result = await assessConfidence(PROPOSAL, depsWith());
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    // .30*100 + .25*82 + .20*60 + .15*60 + .10*50 = 76.5 -> 77
    expect(result.value.confidence.composite_score).toBe(77);
    expect(result.value.confidence.flags).toEqual([]);
    expect(result.value.confidence.rationale).toContain('77/100');
  });

  it('populates all five components from the port values', async () => {
    const result = await assessConfidence(PROPOSAL, depsWith());
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.components).toEqual({
      sandbox_pass: 1,
      self_confidence: 82,
      resolver_confidence: 60,
      license_risk: 40,
      test_coverage: 50,
    });
  });

  it('refuses when a port is missing rather than inventing a zero', async () => {
    const ports = measuredPorts();
    const result = await assessConfidence(PROPOSAL, {
      ports: {
        selfCritique: ports.selfCritique,
        sandboxPass: ports.sandboxPass,
        resolverConfidence: ports.resolverConfidence,
        testCoverage: ports.testCoverage,
      },
    });
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.code).toBe('CONFIG_ERROR');
      if (result.error.code === 'CONFIG_ERROR') {
        expect(result.error.field).toBe('confidence.ports');
        expect(result.error.message).toContain('licenseRisk');
      }
    }
  });

  it('reports a self-critique failure with the provider code', async () => {
    const result = await assessConfidence(PROPOSAL, {
      ports: { ...measuredPorts(), selfCritique: failingSelfCritique() },
    });
    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.code).toBe('AI_PROVIDER_ERROR');
  });

  it('publishes the verdict and persists the record', async () => {
    const emitted: AgentPayload[] = [];
    const stored: ConfidenceRecord[] = [];
    const result = await assessConfidence(
      PROPOSAL,
      depsWith({ emit: payload => emitted.push(payload), store: record => stored.push(record) })
    );
    expect(result.isOk()).toBe(true);
    expect(emitted).toHaveLength(1);
    expect(emitted[0]?.tool).toBe(ASSESS_CONFIDENCE_TOOL);
    expect(emitted[0]?.percent).toBe(77);
    expect(typeof emitted[0]?.detail).toBe('string');
    expect(stored).toHaveLength(1);
    expect(stored[0]?.proposalId).toBe('proposal-1');
  });

  it('maps the resolver tags onto 0-100 and means them', () => {
    expect(RESOLVER_CONFIDENCE_SCORES['lsp-high']).toBe(100);
    expect(RESOLVER_CONFIDENCE_SCORES['heuristic-medium']).toBe(60);
    expect(RESOLVER_CONFIDENCE_SCORES['unresolved']).toBe(0);
    expect(resolverConfidenceFromTags([])).toBe(0);
    expect(resolverConfidenceFromTags(['lsp-high'])).toBe(100);
    expect(resolverConfidenceFromTags(['heuristic-medium'])).toBe(60);
    expect(resolverConfidenceFromTags(['unresolved'])).toBe(0);
    expect(resolverConfidenceFromTags(['lsp-high', 'heuristic-medium'])).toBe(80);
  });

  it('assesses after a successful tool and passes a failure through', async () => {
    const emitted: AgentPayload[] = [];
    const stub: ToolDefinition = {
      name: 'propose_component',
      description: 'a stub',
      schema: {},
      autonomy: 'gated',
      execute: async () => ok({ files: ['src/a.ts'], diff: '+export const a = 1;' }),
    };
    const wrapped = withConfidenceAssessment(stub, depsWith({ emit: p => emitted.push(p) }));
    const produced = await wrapped.execute({ name: 'a' }, {} as unknown as ToolContext);
    expect(produced.isOk()).toBe(true);
    if (produced.isOk()) {
      expect(produced.value).toEqual({ files: ['src/a.ts'], diff: '+export const a = 1;' });
    }
    expect(emitted).toHaveLength(1);

    const failure: StitchError = { code: 'INTERNAL', message: 'the tool refused' };
    const broken: ToolDefinition = {
      ...stub,
      execute: async (): Promise<Result<unknown, StitchError>> => err(failure),
    };
    const wrappedBroken = withConfidenceAssessment(
      broken,
      depsWith({ emit: p => emitted.push(p) })
    );
    const passed = await wrappedBroken.execute({}, {} as unknown as ToolContext);
    expect(passed.isErr()).toBe(true);
    // The failed tool is passed through untouched: no second emission.
    expect(emitted).toHaveLength(1);
  });

  it('exposes a callable tool that validates its arguments', async () => {
    const tool = createAssessConfidenceTool(depsWith());
    expect(tool.name).toBe(ASSESS_CONFIDENCE_TOOL);
    expect(tool.autonomy).toBe('auto');
    const bad = await tool.execute({}, {} as unknown as ToolContext);
    expect(bad.isErr()).toBe(true);
    if (bad.isErr()) expect(bad.error.code).toBe('TOOL_ARGS_VALIDATION');
    const good = await tool.execute(
      { name: 'proposal-2', files: ['src/a.ts'], diff: '+x' },
      {} as unknown as ToolContext
    );
    expect(good.isOk()).toBe(true);
  });
});
