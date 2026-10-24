# Confidence prompt (self-critique)

The agent's second pass over its own proposed diff (P-347). It re-reads the
change it just produced and rates it on the same three dimensions a human
reviewer uses (the P-325 rubric), plus one overall confidence.

## The prompt

- Template: `packages/core/src/ai/prompts/self-critique.txt`
- Loaded by the P-141 registry in `packages/core/src/ai/prompts.ts`; build the
  prompt pair with `selfCritiquePrompt(diff, context)`.
- Variables: `{{diff}}` (the proposed change) and `{{context}}` (the goal the
  change was asked to serve).

The file is `.txt` because that is the path the phase spec names; the rest of
the prompt set is `.md`. The raw loader treats them identically.

## Version

The version is the content hash, not a hand-bumped number:

```
bun -e "import {promptVersion} from './packages/core/src/ai/prompts.ts'; console.log(promptVersion('self-critique'))"
```

`promptVersion('self-critique')` returns the first 12 hex characters of the
template's sha256. Editing the template changes the version automatically, so a
score recorded against an older prompt is identifiable by its version rather
than guessed at.

## The output contract

The model answers with one JSON object and nothing else. The schema lives in
`packages/core/src/confidence/self-critique.ts` (`selfCritiqueSchema`):

| field | range | meaning |
|---|---|---|
| `self_confidence` | 0-100 integer | overall confidence the change is correct and mergeable |
| `wiring_self_score` | 1-5 integer | is everything it must connect to wired, and nothing else |
| `unnecessary_changes_self_score` | 1-5 integer | is every edited line needed for the goal |
| `patterns_self_score` | 1-5 integer | does it follow the surrounding conventions |
| `self_rationale` | non-empty string | the strongest and weakest part, in a sentence or two |
| `self_flags` | array of strings | anything a reviewer must double-check |

The prompt tells the model **not** to score sandbox execution, license risk or
test coverage. Those come from their own phases (P-176, P-127, P-347's own
test-coverage input) and are measured, not estimated; letting a model guess
them would put a fabricated number where a measurement belongs.

`toSelfCritiqueComponents` maps the self scores onto the 0-100 component scale
(`(score - 1) / 4 * 100`) and leaves the measured components alone.

## Calibration

The phase's acceptance criteria ask for ten manually inspected self-critiques
showing a plausible correlation with the human rubric. A live inspection needs
two things this environment does not have: an AI provider key to generate the
critiques and human raters to score them. So the shipped evidence is a
**recorded reference set**, and it says so:

- Artifact: `eval/self_critique/calibration.json` — ten documented proposals
  with their self scores and their recorded human rubric scores, marked
  `kind: "recorded-reference-set"` with its provenance in the artifact itself.
- Measurement: `packages/core/src/__tests__/fixtures/self-critique-harness.ts`
  computes Spearman's rho (average ranks, so ties do not distort it) between
  `self_confidence` and the human mean, and between the wiring self score and
  the recorded wiring score. The result is written to
  `eval/self_critique/comparison.json`.
- `core/test_self_critique.py::test_manual_correlation` asserts the measured
  facts: the set size, that the correlation is directionally correct and
  strong, and that the artifact declares its own deferral.

### Replacing the reference set with live data

1. Run the pass on real proposals: `runSelfCritique(provider, { diff, context })`
   (through the P-140 tool loop, or directly with a configured P-131 provider).
2. Have a human rate the same proposals with the P-325 rubric / P-326 rater
   tool, so the human scores land next to the self scores.
3. Replace the `cases` array in `eval/self_critique/calibration.json`, change
   `kind` to `"live-inspection"`, and update `provenance` to say who rated them
   and when.
4. Re-run `core/test_self_critique.py`. If the correlation is weak, adjust the
   template — the version hash changes with it, which is the point.

A correlation that has not been measured is not a passing correlation; the
artifact states which one it is.

### Frozen version (P-355)

P-354 measured the recorded set at Spearman 0.9848, which clears the 0.5 bar, so
P-355's step 1 applied: the prompt and the weights are validated and unchanged.

- Prompt version: the `promptVersion('self-critique')` content hash above.
- Weights: the finalized P-349 set (`DEFAULT_COMPOSITE_WEIGHTS`), frozen.
- Recalibration loop: `packages/core/src/confidence/recalibration.ts` measures a
  baseline, walks candidate variants (a prompt version, a weight set, or a
  self-score transform), and either validates, recalibrates, or records the
  limitation. It is one call away the day the live corpus says the correlation is
  weak.
