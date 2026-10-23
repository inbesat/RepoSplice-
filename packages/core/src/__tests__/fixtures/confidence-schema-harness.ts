// P-346 — the harness the mandated python tests drive.
//
// It exercises the SemanticConfidence schema, the weighting formula and the
// bounds through the real module and prints ONE `CONFIDENCE {json}` line.

import {
  CONFIDENCE_COMPONENTS,
  DEFAULT_CONFIDENCE_WEIGHTS,
  RUBRIC_COMPATIBILITY,
  buildSemanticConfidence,
  compositeScore,
  compositeToRubricScore,
  confidenceComponentScoresSchema,
  semanticConfidenceSchema,
  type ConfidenceComponentScores,
} from '../../confidence/schema.js';

const STRONG: ConfidenceComponentScores = {
  sandbox_pass: 1,
  self_confidence: 80,
  resolver_confidence: 90,
  license_risk: 10,
  test_coverage: 70,
};

const WORST: ConfidenceComponentScores = {
  sandbox_pass: 0,
  self_confidence: 0,
  resolver_confidence: 0,
  license_risk: 100,
  test_coverage: 0,
};

const BEST: ConfidenceComponentScores = {
  sandbox_pass: 1,
  self_confidence: 100,
  resolver_confidence: 100,
  license_risk: 0,
  test_coverage: 100,
};

function scoreOf(components: ConfidenceComponentScores): number | null {
  const result = compositeScore(components);
  return result.isOk() ? result.value : null;
}

const built = buildSemanticConfidence({
  components: STRONG,
  contributing_factors: { fixture: 'confidence-schema', files: 4 },
});

const weighted = scoreOf(STRONG);
let sweepInBounds = true;
for (const sandbox of [0, 1] as const) {
  for (const value of [0, 13, 25, 50, 77, 100]) {
    const score = scoreOf({
      sandbox_pass: sandbox,
      self_confidence: value,
      resolver_confidence: 100 - value,
      license_risk: value,
      test_coverage: 100 - value,
    });
    if (score === null || score < 0 || score > 100) sweepInBounds = false;
  }
}

const badWeights = compositeScore(STRONG, {
  sandbox_pass: 0.5,
  self_confidence: 0.5,
  resolver_confidence: 0.5,
  license_risk: 0,
  test_coverage: 0,
});

const negativeWeight = compositeScore(STRONG, {
  ...DEFAULT_CONFIDENCE_WEIGHTS,
  sandbox_pass: -0.3,
  test_coverage: 0.4,
});

const report = {
  mode: 'confidence-schema',
  components: CONFIDENCE_COMPONENTS,
  weights: DEFAULT_CONFIDENCE_WEIGHTS,
  weightsSum: Number(
    CONFIDENCE_COMPONENTS.reduce(
      (total, component) => total + DEFAULT_CONFIDENCE_WEIGHTS[component],
      0
    ).toFixed(6)
  ),
  valid: { ok: semanticConfidenceSchema.safeParse(built.isOk() ? built.value : {}).success },
  built: built.isOk()
    ? {
        composite: built.value.composite_score,
        flags: built.value.flags,
        rationale: built.value.rationale,
        factors: built.value.contributing_factors,
      }
    : { error: 'the document could not be built' },
  weighted: { composite: weighted },
  clamp: {
    worst: scoreOf(WORST),
    best: scoreOf(BEST),
    sweepInBounds,
  },
  invalid: {
    selfConfidence: !confidenceComponentScoresSchema.safeParse({
      ...STRONG,
      self_confidence: 101,
    }).success,
    sandboxPass: !confidenceComponentScoresSchema.safeParse({ ...STRONG, sandbox_pass: 2 }).success,
    weightsSum: badWeights.isErr(),
    negativeWeight: negativeWeight.isErr(),
    emptyRationale: !semanticConfidenceSchema.safeParse({
      composite_score: 50,
      components: STRONG,
      rationale: '',
      flags: [],
      contributing_factors: {},
    }).success,
  },
  rubric: {
    composite: weighted,
    score: compositeToRubricScore(weighted ?? 0),
    dimensions: Object.keys(RUBRIC_COMPATIBILITY).sort(),
  },
};

process.stdout.write(`CONFIDENCE ${JSON.stringify(report)}\n`);
