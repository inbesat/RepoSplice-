// P-330 — the cost harness: the REAL cost module over a fixed set of
// audited provider calls (the P-145 rows). The python test drives this
// script because the CI is bun-only.
//
//   bun cost-harness.ts   ->   COST {json}

import {
  budgetAlert,
  costFor,
  costPerSuccessfulMerge,
  priceFor,
  summarizeCalls,
} from '../../eval/cost.js';
import { MODELS } from '../../ai/models.js';
import type { AiCallAudit } from '../../ai/audit.js';

const model = MODELS[0];
if (model === undefined) throw new Error('the model registry is empty');

const calls: AiCallAudit[] = [
  {
    id: 'call-1',
    ts: '2026-10-21T00:00:00.000Z',
    provider: model.provider,
    model: model.id,
    promptVersion: 'v1',
    task: 'merge',
    inputTokens: 1_000,
    outputTokens: 500,
    costUsd: 0.01,
    latencyMs: 120,
    finishReason: 'stop',
    toolNames: [],
  },
  {
    id: 'call-2',
    ts: '2026-10-21T00:00:01.000Z',
    provider: model.provider,
    model: model.id,
    promptVersion: 'v1',
    task: 'merge',
    inputTokens: 2_000,
    outputTokens: 1_000,
    costUsd: 0.02,
    latencyMs: 200,
    finishReason: 'stop',
    toolNames: [],
  },
];

const usage = summarizeCalls(calls);
const price = priceFor(model.id);
const priced = costFor({ inputTokens: 1_000_000, outputTokens: 1_000_000 }, model.id);
const unknown = costFor({ inputTokens: 1_000, outputTokens: 500 }, 'not-a-model');

const report = {
  model: { id: model.id, cost: model.cost },
  usage,
  price: price ?? null,
  priced,
  unknown,
  per_success: costPerSuccessfulMerge(usage.costUsd, 1),
  per_success_none: costPerSuccessfulMerge(usage.costUsd, 0),
  budget: {
    off: budgetAlert(usage.costUsd, 0),
    within: budgetAlert(usage.costUsd, 1),
    over: budgetAlert(usage.costUsd, 0.001),
  },
};

process.stdout.write(`COST ${JSON.stringify(report)}\n`);
