// P-347 — the self-critique harness the python ids drive.
//
// It exercises the prompt + the parser + the mapper + a scripted provider run,
// then measures the rank correlation between the self scores and the recorded
// human rubric scores in eval/self_critique/calibration.json. The calibration
// set is a hand-authored reference (provenance recorded in the artifact): the
// live ten-proposal inspection needs an AI provider key and human raters, so
// the harness measures the METHOD honestly instead of claiming the inspection.
//
// One line of output: `SELF_CRITIQUE {json}`

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mockScriptFromText } from '../../ai/mock.js';
import { promptVersion, selfCritiquePrompt } from '../../ai/prompts.js';
import {
  parseSelfCritique,
  runSelfCritique,
  toSelfCritiqueComponents,
} from '../../confidence/self-critique.js';

const REPO_ROOT = join(import.meta.dirname, '..', '..', '..', '..', '..');
const CALIBRATION = join(REPO_ROOT, 'eval', 'self_critique', 'calibration.json');
const COMPARISON = join(REPO_ROOT, 'eval', 'self_critique', 'comparison.json');

const VALID = {
  self_confidence: 82,
  wiring_self_score: 5,
  unnecessary_changes_self_score: 4,
  patterns_self_score: 4,
  self_rationale: 'The wiring is complete; one helper could be folded into its caller.',
  self_flags: ['helper extraction may be unnecessary'],
};

interface CalibrationCase {
  readonly id: string;
  readonly proposal: string;
  readonly self: {
    readonly self_confidence: number;
    readonly wiring_self_score: number;
    readonly unnecessary_changes_self_score: number;
    readonly patterns_self_score: number;
  };
  readonly human: {
    readonly wiring_correctness: number;
    readonly unnecessary_changes: number;
    readonly respects_patterns: number;
  };
}

interface Calibration {
  readonly version: number;
  readonly kind: string;
  readonly prompt: string;
  readonly provenance: string;
  readonly cases: readonly CalibrationCase[];
}

/** Average ranks, so ties do not distort the coefficient. */
function ranks(values: readonly number[]): number[] {
  const order = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const result: number[] = values.map(() => 0);
  let cursor = 0;
  while (cursor < order.length) {
    const head = order[cursor];
    if (head === undefined) break;
    let last = cursor;
    while (last + 1 < order.length && order[last + 1]?.value === head.value) last += 1;
    const average = (cursor + last) / 2 + 1;
    for (let index = cursor; index <= last; index += 1) {
      const entry = order[index];
      if (entry !== undefined) result[entry.index] = average;
    }
    cursor = last + 1;
  }
  return result;
}

/** Spearman's rho (Pearson on ranks). */
function spearman(first: readonly number[], second: readonly number[]): number {
  if (first.length !== second.length || first.length === 0) return 0;
  const rankedFirst = ranks(first);
  const rankedSecond = ranks(second);
  const meanFirst = rankedFirst.reduce((sum, value) => sum + value, 0) / rankedFirst.length;
  const meanSecond = rankedSecond.reduce((sum, value) => sum + value, 0) / rankedSecond.length;
  let covariance = 0;
  let varianceFirst = 0;
  let varianceSecond = 0;
  for (let index = 0; index < rankedFirst.length; index += 1) {
    const a = (rankedFirst[index] ?? 0) - meanFirst;
    const b = (rankedSecond[index] ?? 0) - meanSecond;
    covariance += a * b;
    varianceFirst += a * a;
    varianceSecond += b * b;
  }
  if (varianceFirst === 0 || varianceSecond === 0) return 0;
  return covariance / Math.sqrt(varianceFirst * varianceSecond);
}

const calibration = JSON.parse(readFileSync(CALIBRATION, 'utf8')) as Calibration;

const selfConfidence = calibration.cases.map(item => item.self.self_confidence);
const humanMean = calibration.cases.map(
  item =>
    (item.human.wiring_correctness +
      item.human.unnecessary_changes +
      item.human.respects_patterns) /
    3
);
const selfWiring = calibration.cases.map(item => item.self.wiring_self_score);
const humanWiring = calibration.cases.map(item => item.human.wiring_correctness);

const overall = spearman(selfConfidence, humanMean);
const wiring = spearman(selfWiring, humanWiring);

const validReply = '```json\n' + JSON.stringify(VALID) + '\n```';
const valid = parseSelfCritique(validReply);
const noJson = parseSelfCritique('It looks fine to me.');
const outOfRange = parseSelfCritique(JSON.stringify({ ...VALID, self_confidence: 101 }));
const missingField = parseSelfCritique(JSON.stringify({ self_confidence: 80 }));
const mockRun = await runSelfCritique(mockScriptFromText(JSON.stringify(VALID)), {
  diff: '+const x = 1;',
  context: 'add x',
});

const report = {
  mode: 'self-critique',
  promptVersion: promptVersion('self-critique'),
  promptPreview: selfCritiquePrompt('+const x = 1;', 'add x').user.includes('+const x = 1;'),
  valid: {
    ok: valid.isOk(),
    selfConfidence: valid.isOk() ? valid.value.self_confidence : null,
    flags: valid.isOk() ? valid.value.self_flags : [],
  },
  invalid: {
    noJson: noJson.isErr(),
    outOfRange: outOfRange.isErr(),
    missingField: missingField.isErr(),
    field: noJson.isErr() && 'field' in noJson.error ? noJson.error.field : null,
  },
  mapped: valid.isOk() ? toSelfCritiqueComponents(valid.value) : null,
  mock: {
    ok: mockRun.isOk(),
    selfConfidence: mockRun.isOk() ? mockRun.value.self_confidence : null,
  },
  correlation: {
    cases: calibration.cases.length,
    overall: Number(overall.toFixed(4)),
    wiring: Number(wiring.toFixed(4)),
    setKind: calibration.kind,
    deferred: calibration.provenance.includes('needs an AI provider key'),
    provenance: calibration.provenance,
  },
};

await Bun.write(
  COMPARISON,
  `${JSON.stringify({ promptVersion: report.promptVersion, correlation: report.correlation }, null, 2)}\n`
);

process.stdout.write(`SELF_CRITIQUE ${JSON.stringify(report)}\n`);
