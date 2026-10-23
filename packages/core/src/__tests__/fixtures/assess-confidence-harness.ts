// P-348 — the harness the mandated python ids drive.
//
// It exercises the real `assess_confidence` module: the five injected ports,
// the composite, the publication (store + emit), the refusal when a
// measurement is missing, the P-342 tag mapping and the automatic invocation
// after a successful proposal tool.

import { ok } from 'neverthrow';
import { mockScriptFromText } from '../../ai/mock.js';
import type { ToolContext, ToolDefinition } from '../../ai/types.js';
import { runSelfCritique } from '../../confidence/self-critique.js';
import type { AgentPayload } from '../../events/topics.js';
import {
  ASSESS_CONFIDENCE_TOOL,
  assessConfidence,
  resolverConfidenceFromTags,
  withConfidenceAssessment,
  type AssessConfidenceDeps,
  type ConfidenceProposal,
  type ConfidenceRecord,
  type ConfidencePorts,
} from '../../tools/assess-confidence.js';

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

function ports(): ConfidencePorts {
  const provider = mockScriptFromText(JSON.stringify(VALID_SELF_CRITIQUE));
  return {
    selfCritique: input => runSelfCritique(provider, input),
    sandboxPass: async () => ok(true),
    resolverConfidence: async () => ok(60),
    licenseRisk: async () => ok(40),
    testCoverage: async () => ok(50),
  };
}

const emitted: AgentPayload[] = [];
const stored: ConfidenceRecord[] = [];
const deps: AssessConfidenceDeps = {
  ports: ports(),
  emit: payload => emitted.push(payload),
  store: record => stored.push(record),
};

const assessed = await assessConfidence(PROPOSAL, deps);

const missingPort = await assessConfidence(PROPOSAL, {
  ports: (() => {
    const all = ports();
    return {
      selfCritique: all.selfCritique,
      sandboxPass: all.sandboxPass,
      resolverConfidence: all.resolverConfidence,
      testCoverage: all.testCoverage,
    };
  })(),
});

const stub: ToolDefinition = {
  name: 'propose_component',
  description: 'a stub proposal tool',
  schema: {},
  autonomy: 'gated',
  execute: async () => ok({ files: ['src/a.ts'], diff: '+export const a = 1;' }),
};
const wrapped = withConfidenceAssessment(stub, deps);
const autoInvoked = await wrapped.execute({ name: 'a' }, {} as unknown as ToolContext);

const report = {
  mode: 'assess-confidence',
  ok: assessed.isOk(),
  proposalId: assessed.isOk() ? assessed.value.proposalId : null,
  components: assessed.isOk() ? assessed.value.components : null,
  composite: assessed.isOk() ? assessed.value.confidence.composite_score : null,
  flags: assessed.isOk() ? assessed.value.confidence.flags : null,
  rationale: assessed.isOk() ? assessed.value.confidence.rationale : null,
  weights: assessed.isOk() ? assessed.value.weights : null,
  prompt: assessed.isOk() ? assessed.value.prompt : null,
  emitted: emitted.map(payload => ({
    tool: payload.tool ?? null,
    percent: payload.percent ?? null,
    hasDetail: typeof payload.detail === 'string',
  })),
  stored: stored.map(record => ({ proposalId: record.proposalId, assessedAt: record.assessedAt })),
  missingPort: missingPort.isErr()
    ? {
        code: missingPort.error.code,
        field: 'field' in missingPort.error ? missingPort.error.field : null,
      }
    : null,
  tagMapping: {
    'lsp-high': resolverConfidenceFromTags(['lsp-high']),
    'heuristic-medium': resolverConfidenceFromTags(['heuristic-medium']),
    unresolved: resolverConfidenceFromTags(['unresolved']),
    none: resolverConfidenceFromTags([]),
  },
  autoInvocation: {
    ok: autoInvoked.isOk(),
    tool: ASSESS_CONFIDENCE_TOOL,
  },
};

process.stdout.write(`ASSESS_CONFIDENCE ${JSON.stringify(report)}\n`);
