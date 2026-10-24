// P-354 — the harness the three mandated python ids drive.
//
// It measures the calibration over the RECORDED reference set that already
// exists (eval/self_critique/calibration.json) and writes the report artifact
// (eval/calibration/report.json). The live Epic 16 corpus check is deferred —
// it needs a real baseline run plus human raters — and the report's provenance
// says so, because a missing measurement is never a zero.
//
// A deliberate DECORRELATED fixture proves the critical branch is real rather
// than a hardcoded boolean.
//
// One line of output: `CALIBRATION {json}`

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildCalibrationReport,
  parseCalibrationSet,
  type CalibrationSample,
} from '../../confidence/calibration.js';

const REPO_ROOT = join(import.meta.dirname, '..', '..', '..', '..', '..');
const SOURCE = join('eval', 'self_critique', 'calibration.json');
const ARTIFACT = join(REPO_ROOT, 'eval', 'calibration', 'report.json');
const FIXED_NOW = new Date('2026-10-24T00:00:00.000Z');

/** Self scores ascending against human rubric scores descending. */
const DECORRELATED: readonly CalibrationSample[] = [
  { id: 'd1', selfConfidence: 10, humanRubric: 5 },
  { id: 'd2', selfConfidence: 30, humanRubric: 4 },
  { id: 'd3', selfConfidence: 50, humanRubric: 3 },
  { id: 'd4', selfConfidence: 70, humanRubric: 2 },
  { id: 'd5', selfConfidence: 90, humanRubric: 1 },
];

const raw = (await Bun.file(join(REPO_ROOT, SOURCE)).json()) as unknown;
const samples = parseCalibrationSet(raw);
const built = buildCalibrationReport(samples, {
  source: SOURCE,
  now: () => FIXED_NOW,
});
if (built.isErr()) {
  process.stdout.write(
    `CALIBRATION ${JSON.stringify({ mode: 'calibration', ok: false, code: built.error.code })}\n`
  );
  process.exit(1);
}
const report = built.value;

mkdirSync(join(REPO_ROOT, 'eval', 'calibration'), { recursive: true });
const artifactText = `${JSON.stringify(report, null, 2)}\n`;
await Bun.write(ARTIFACT, artifactText);

const decorrelatedBuilt = buildCalibrationReport(DECORRELATED, { now: () => FIXED_NOW });
const decorrelated = decorrelatedBuilt.isOk()
  ? {
      samples: decorrelatedBuilt.value.samples,
      pearson: decorrelatedBuilt.value.pearson,
      spearman: decorrelatedBuilt.value.spearman,
      critical: decorrelatedBuilt.value.critical,
      requiresRecalibration: decorrelatedBuilt.value.requiresRecalibration,
    }
  : { samples: 0, pearson: null, spearman: null, critical: null, requiresRecalibration: false };

const written = (await Bun.file(ARTIFACT).json()) as {
  spearman?: unknown;
  samples?: unknown;
  threshold?: unknown;
};

const output = {
  mode: 'calibration',
  ok: true,
  source: report.source,
  set: report.set,
  samples: report.samples,
  threshold: report.threshold,
  primary: report.primary,
  pearson: report.pearson,
  spearman: report.spearman,
  critical: report.critical,
  requiresRecalibration: report.requiresRecalibration,
  scatterCount: report.scatter.length,
  scatter: report.scatter,
  perEcosystem: report.perEcosystem,
  provenance: report.provenance,
  decorrelated,
  artifact: ARTIFACT,
  artifactSpearman: written.spearman ?? null,
  artifactSamples: written.samples ?? null,
  artifactThreshold: written.threshold ?? null,
};

process.stdout.write(`CALIBRATION ${JSON.stringify(output)}\n`);
