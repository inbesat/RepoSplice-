// P-355 — the recalibration harness the mandated python tests drive.
//
// It measures three outcomes over the SAME loop: the recorded reference set
// (which P-354 already validated, so P-355's step 1 applies), a deliberately
// inverted set that a flipping candidate rescues, and an inverted set no
// candidate rescues (the documented-limitation path). One line of output:
//   RECALIBRATION {json}

import { join } from 'node:path';
import { promptVersion } from '../../ai/prompts.js';
import { parseCalibrationSet, type CalibrationSample } from '../../confidence/calibration.js';
import {
  defaultRecalibrationBaseline,
  runRecalibration,
  type RecalibrationReport,
  type RecalibrationVariant,
} from '../../confidence/recalibration.js';

const REPO_ROOT = join(import.meta.dirname, '..', '..', '..', '..', '..');
const RECORDED_SET = 'eval/self_critique/calibration.json';
const FIXED_NOW = new Date('2026-10-24T00:00:00.000Z');

/** A small set whose self scores ascend while the human rubric descends. */
function inverted(): CalibrationSample[] {
  return [
    { id: 'case-01', selfConfidence: 10, humanRubric: 5 },
    { id: 'case-02', selfConfidence: 30, humanRubric: 4 },
    { id: 'case-03', selfConfidence: 50, humanRubric: 3 },
    { id: 'case-04', selfConfidence: 70, humanRubric: 2 },
    { id: 'case-05', selfConfidence: 90, humanRubric: 1 },
  ];
}

interface AttemptView {
  readonly iteration: number;
  readonly label: string;
  readonly pearson: number | null;
  readonly spearman: number | null;
  readonly meets: boolean;
  readonly improved: boolean;
}

interface ReportView {
  readonly decision: string;
  readonly samples: number;
  readonly threshold: number;
  readonly maxIterations: number;
  readonly baseline: {
    readonly promptVersion: string;
    readonly weights: Record<string, number>;
    readonly pearson: number | null;
    readonly spearman: number | null;
    readonly meets: boolean;
  };
  readonly attempts: readonly AttemptView[];
  readonly frozen: {
    readonly promptVersion: string;
    readonly weights: Record<string, number>;
    readonly pearson: number | null;
    readonly spearman: number | null;
  };
  readonly reason: string;
}

function view(report: RecalibrationReport): ReportView {
  return {
    decision: report.decision,
    samples: report.samples,
    threshold: report.threshold,
    maxIterations: report.maxIterations,
    baseline: {
      promptVersion: report.baseline.promptVersion,
      weights: { ...report.baseline.weights },
      pearson: report.baseline.pearson,
      spearman: report.baseline.spearman,
      meets: report.baseline.meets,
    },
    attempts: report.attempts.map(attempt => ({
      iteration: attempt.iteration,
      label: attempt.label,
      pearson: attempt.pearson,
      spearman: attempt.spearman,
      meets: attempt.meets,
      improved: attempt.improved,
    })),
    frozen: {
      promptVersion: report.frozen.promptVersion,
      weights: { ...report.frozen.weights },
      pearson: report.frozen.pearson,
      spearman: report.frozen.spearman,
    },
    reason: report.reason,
  };
}

const prompt = promptVersion('self-critique');
const baseline = defaultRecalibrationBaseline(prompt);

// The recorded reference set: P-354 already measured it at Spearman 0.9848.
const raw = (await Bun.file(join(REPO_ROOT, RECORDED_SET)).json()) as unknown;
const recorded = runRecalibration(parseCalibrationSet(raw), { baseline, now: () => FIXED_NOW });
if (recorded.isErr()) {
  process.stdout.write(
    `RECALIBRATION ${JSON.stringify({ mode: 'recalibration', ok: false, code: recorded.error.code })}\n`
  );
  process.exit(1);
}

// A candidate that flips the inverted set clears the bar.
const flip: RecalibrationVariant = {
  label: 'flip',
  transform: value => 100 - value,
};
const improved = runRecalibration(inverted(), { baseline, variants: [flip], now: () => FIXED_NOW });
if (improved.isErr()) {
  process.stdout.write(
    `RECALIBRATION ${JSON.stringify({ mode: 'recalibration', ok: false, code: improved.error.code })}\n`
  );
  process.exit(1);
}

// No candidate helps: the honest limitation, naming the P-350 fallback.
const limited = runRecalibration(inverted(), {
  baseline,
  variants: [
    { label: 'noop', transform: value => value },
    { label: 'noop-2', transform: value => value },
  ],
  now: () => FIXED_NOW,
});
if (limited.isErr()) {
  process.stdout.write(
    `RECALIBRATION ${JSON.stringify({ mode: 'recalibration', ok: false, code: limited.error.code })}\n`
  );
  process.exit(1);
}

const report = {
  mode: 'recalibration',
  ok: true,
  threshold: recorded.value.threshold,
  maxIterations: recorded.value.maxIterations,
  recorded: view(recorded.value),
  improved: view(improved.value),
  limited: view(limited.value),
};

process.stdout.write(`RECALIBRATION ${JSON.stringify(report)}\n`);
