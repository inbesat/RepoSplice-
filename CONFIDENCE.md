# CONFIDENCE.md — what the confidence score means

Every proposal the agent makes is scored from 0 to 100 before it is auto-approved.
This document explains what that number is built from, how to read it, when it
forces human review, and — most importantly — what it does **not** tell you.

## Overview

The confidence score is a **single number per proposed change**, computed from five
factors: the sandbox result, the agent's own second read of its diff, the resolver
confidence of the imports the change rests on, the license risk of the files it
touches, and the test coverage those files carry.

It exists so a reviewer can triage without reading every diff, and so the tool can
respect a policy: a proposal that scores below the configured threshold goes to
human review even when its tool is normally auto-approved.

The score is produced by the composite scoring model (`core/src/confidence/scoring.ts`)
and the per-factor values are recorded with it, so any score can be decomposed.
The score is a signal about the change, not a substitute for reading it.

## Score Interpretation

Bands, matching the web badges, the CREDITS.md table and the CLI summary:

| Score | Band | Meaning |
|-------|------|---------|
| 80–100 | high (green) | The sandbox passed and the supporting signals are strong. |
| 60–79 | medium (yellow) | The change looks reasonable, but at least one factor is soft. |
| 0–59 | low (red) | At least one factor is weak enough that a human should look. |

The bands are presentation only: the threshold that routes to human review is
configurable (see *Threshold Policy*) and defaults to 75, which sits inside the
medium band on purpose — the band tells you the shape of the score, the threshold
tells you the policy.

A score is never a percentage of "correctness". Two changes with the same score
can be entirely different in character; the per-factor breakdown is what makes the
number actionable.

## Factor Descriptions

The five factors and their defaults weights (the finalized P-349 set):

| Factor | Source | Range | Weight |
|--------|--------|-------|--------|
| `sandbox_pass` | The sandbox build + test run (P-176) | 0 or 1 | 30% |
| `self_confidence` | The agent's self-critique of its own diff (P-347) | 0–100 | 25% |
| `resolver_confidence` | The import-resolution tags (P-342) | 0–100 | 20% |
| `license_risk` | The license scan (P-127) | 0–100 (risk) | 15% |
| `test_coverage` | The coverage the changed files carry (P-259) | 0–100 | 10% |

The weights sum to 1 and live in one place (`DEFAULT_COMPOSITE_WEIGHTS`); the
rationale for each is recorded in the code (`COMPOSITE_WEIGHT_RATIONALE`) and in
the ADR log:

- **sandbox_pass (30%)** — the outcome proxy. A proposal that does not build is
  not a proposal, so the one measured fact counts most.
- **self_confidence (25%)** — the agent's second read of its own diff, using the
  same dimensions a human reviewer uses.
- **resolver_confidence (20%)** — the technical correctness of the imports the
  change rests on: an edge the language server resolved outranks a heuristic one.
- **license_risk (15%)** — the compliance exposure, scored **as its complement**:
  less risk scores higher. A `license_risk` of 0 contributes the full 15 points.
- **test_coverage (10%)** — the regression safety the change carries with it.

Because `license_risk` is *risk*, the formula uses `100 - license_risk`. This is
why an all-zero input does not score 0 (it scores 15: no risk is the safest input)
and an all-hundred input does not score 100 (it scores 85: maximal recorded risk
costs 15 points).

## Threshold Policy

The auto-approve threshold is configuration, read as
`confidence.auto_approve_threshold` (default **75**, range 0–100):

```jsonc
{
  "confidence": {
    "auto_approve_threshold": 75
  }
}
```

Precedence, highest first: the per-run CLI flag (`stitch merge --confidence-threshold`,
and the seam `resolveThreshold` exposes), the config file, then the default. Whichever
value wins is validated: a threshold that is not a number in 0–100 is refused with a
`CONFIG_ERROR` naming the field, never silently clamped.

The boundary is inclusive: a composite **equal** to the threshold is auto-approvable,
and only a strictly lower score forces review. A below-threshold proposal carries
`requires_human_review: true` and a reason naming the gap, and it is routed to the
human-in-the-loop queue with its breakdown attached.

The default of 75 is documented in `THRESHOLD_RATIONALE` and is **provisional**:
it was chosen because the sandbox plus the agent/resolver reads carry 75% of the
weight, but it is not yet calibrated against a live corpus (see below).

## Calibration Methodology

Two questions are measured separately and must not be confused:

1. **Is the agent's self-assessment aligned with a human?** The calibration check
   (`core/src/confidence/calibration.ts`) compares the agent's self-confidence with
   the human rubric mean over a set of rated proposals and reports the Pearson and
   Spearman coefficients, the scatter data and a per-ecosystem breakdown. The bar
   is `CALIBRATION_CORRELATION_THRESHOLD = 0.5`; below it the result is a critical
   finding and the recalibration loop runs.
2. **Is the composite weighting reasonable?** The recalibration loop
   (`core/src/confidence/recalibration.ts`) can re-measure candidate prompt versions
   and weight sets and freezes whichever wins — or records a documented limitation
   if none does.

The measurement currently published is over the **recorded reference set**
(`eval/self_critique/calibration.json`, 10 cases): Spearman ≈ 0.985, which clears
the 0.5 bar, so the prompt and the weights are frozen and unchanged. The live
ten-proposal inspection is **deferred** — it needs an AI provider key and human
raters — and the report says so. The artifact `eval/calibration/report.json` is
generated, never hand-authored.

A coefficient that cannot be computed is reported as `null`, never as zero, and the
"critical" flag is `true`/`false`/`null` so "we could not tell" is never presented
as "not critical".

## Limitations

- **The score is a heuristic, not a correctness guarantee.** It orders proposals by
  how much evidence supports them; it does not decide whether a merge is right.
  A high score is never proof that a merge is correct, and a low score is not proof
  that it is wrong.
- **It is not yet calibrated on a live corpus.** The published coefficients come
  from a recorded reference set; the full provider-backed run is deferred.
- **The weights are documented judgements.** They are transparent and configurable,
  but they encode opinions (that a passing sandbox matters most, that the agent's
  self-read outranks the resolver tags) rather than a fitted result.
- **License risk dominates nothing — but it is scored as risk.** A change that is
  clean everywhere else can still be capped by a license finding, and that is
  intentional.
- **Missing measurements are never invented.** A factor with no measurement makes the
  assessment refuse (`CONFIG_ERROR` naming the missing port) rather than contribute a
  zero to a number that looks confident.
- **The score is about the change, not about the person or the repository.** It says
  nothing about downstream consumers of the merged child repository.

## How to Improve Scores

- **Make the sandbox pass.** It carries 30% and a failure is a hard signal.
- **Resolve imports through a language server where one exists.** `lsp-high` edges
  score 100, `heuristic-medium` 60, unresolved 0.
- **Keep the diff small and pattern-respecting.** That is what the self-critique
  scores, and what a human reviewer scores too.
- **Avoid touching files with license findings.** Risk is subtracted at its
  complement, so a clean license scan is worth real points.
- **Bring tests with the change.** Coverage is the smallest weight but the one the
  author controls directly.

## Version History

| Version | Change |
|---------|--------|
| P-346 | The `SemanticConfidence` schema: five components, the composite, the flags and the rationale. |
| P-347 | The self-critique prompt, giving the agent a second read of its own diff. |
| P-348 | The `assess_confidence` tool: the five factors gathered through injected ports and folded into one composite per proposal. |
| P-349 | The weights finalized: sandbox 30%, self 25%, resolver 20%, license 15%, tests 10%, each with a documented rationale. |
| P-350 | The threshold policy: `confidence.auto_approve_threshold` (default 75) routes low scores to human review. |
| P-351 | The CREDITS.md confidence and flags columns. |
| P-352 | The web confidence badges in the diff viewer and the provenance table. |
| P-353 | The one-line confidence summary in `stitch merge` and `stitch status`. |
| P-354 | The calibration check: Pearson + Spearman over the rated set, with the critical flag. |
| P-355 | The recalibration loop, and the frozen prompt version + weights. |
| P-356 | This document, the scoring and threshold edge-case tests, and the CI check that they stay true. |

The self-critique prompt's version is its content hash
(`promptVersion('self-critique')`), so editing the prompt changes the version
without anyone bumping a constant; the weights' version is the `DEFAULT_COMPOSITE_WEIGHTS`
set recorded alongside each assessment.

## Privacy and telemetry

The confidence numbers above are computed locally and are never sent anywhere.
The MCP server (P-366) is the only component with a telemetry switch, it is
**off unless you opt in** by setting `telemetry.enabled: true` in
`~/.stitch/config.json`, and even then it records three events with fixed
fields only:

| Event | Fields |
|---|---|
| `session_start` | `host` (the MCP client's name) |
| `tool_called` | `tool`, `duration_ms`, `success` |
| `session_end` | `duration_s`, `tools_used` |

No repository URL, file path, file content, prompt, dependency name or
credential has a field to travel in: an event is rebuilt from that whitelist
before it is written, so extra keys are dropped rather than stored. The default
sink is the append-only local file `~/.stitch/telemetry.log` — nothing leaves
the machine unless you set `telemetry.endpoint` yourself. A telemetry failure
never fails a tool call, and a usage report (`summarizeTelemetry`) can compare
MCP, CLI and Web volumes only once the CLI and Web engines emit events of their
own, which they do not yet (ADR-175).
