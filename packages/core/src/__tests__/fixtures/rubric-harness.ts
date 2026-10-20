// P-325 — the trial harness: validates the rubric worksheet with the REAL
// zod schema and computes the REAL inter-rater kappa.
//
// It is a bun SCRIPT, not a test (the core vitest glob is
// src/**/*.{test,spec}.ts), so the python test can drive it: the CI is
// bun-only and cannot run python.
//
// Usage: bun packages/core/src/__tests__/fixtures/rubric-harness.ts
// Output: a single `RUBRIC {json}` line — {valid, rejections, kappa, trials}.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  cohensKappa,
  semanticRubricSchema,
  type RubricPair,
  type SemanticRubric,
} from '../../eval/rubric.js';

const REPO_ROOT = join(import.meta.dirname, '..', '..', '..', '..', '..');
const WORKSHEET_PATH = join(REPO_ROOT, 'eval', 'rubric', 'trial-worksheet.json');

interface WorksheetShape {
  readonly version?: number;
  readonly seeded?: boolean;
  readonly trials?: readonly { readonly a?: unknown; readonly b?: unknown }[];
}

function readWorksheet(): WorksheetShape {
  const raw = readFileSync(WORKSHEET_PATH, 'utf8');
  return JSON.parse(raw) as WorksheetShape;
}

function issueText(issues: readonly { message: string }[]): string {
  return issues.map(issue => issue.message).join('; ');
}

const worksheet = readWorksheet();
const trials = worksheet.trials ?? [];
const rejections: string[] = [];
const pairs: RubricPair[] = [];

trials.forEach((trial, index) => {
  const a = semanticRubricSchema.safeParse(trial.a);
  const b = semanticRubricSchema.safeParse(trial.b);
  if (!a.success) {
    rejections.push(`trials[${index}].a: ${issueText(a.error.issues)}`);
    return;
  }
  if (!b.success) {
    rejections.push(`trials[${index}].b: ${issueText(b.error.issues)}`);
    return;
  }
  pairs.push({ a: a.data as SemanticRubric, b: b.data as SemanticRubric });
});

const report = {
  valid: rejections.length === 0 && pairs.length === trials.length,
  rejections,
  kappa: pairs.length > 0 ? cohensKappa(pairs) : 0,
  trials: pairs.length,
  pair_ids: pairs.map(pair => pair.a.pair_id),
};

console.log(`RUBRIC ${JSON.stringify(report)}`);
