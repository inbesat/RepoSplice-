# Semantic rubric (P-325)

The build-pass score (P-324) says **whether the merged tree compiles**. It says
nothing about whether the merge is *good*. The semantic rubric is the human
judgement on top: a pair can build cleanly and still be a bad merge.

The rubric scores three dimensions from **1 to 5** per pair, plus a free-text
note. The contract lives in one place — `packages/core/src/eval/rubric.ts` (a
zod schema) — and the JSON Schema is generated from it into
`eval/rubric/schema.json` by `bun scripts/emit-eval-schema.ts`. The generated
file is drift-checked in CI (`bun scripts/emit-eval-schema.ts --check`).

## The dimensions

### `wiring_correctness` — does the merge actually connect?

Does the merged code correctly connect A's exports to B's imports, and B's to
A's? Look at the call sites and the imports: are the seams real, or did the
agent produce two halves that merely sit next to each other?

| Score | Meaning |
| --- | --- |
| 5 | Every cross-boundary symbol is imported where it is used and behaves as the source repo intended. No dead imports, no duplicated helpers. |
| 4 | The seams work. One or two imports are more indirect than they should be, but nothing is broken or dead. |
| 3 | The seams work for the happy path. A secondary entry point or an edge-case branch is still unwired. |
| 2 | The merge builds but the wiring is wrong somewhere reachable: a symbol resolves to the wrong implementation, or a call site points at a stub. |
| 1 | The halves are not connected. The merge is two projects side by side; the "merged" path does not work. |

### `unnecessary_changes` — did the agent stay in scope?

Did the agent make gratuitous edits? Formatting sweeps, drive-by refactors,
renames, dependency bumps and comment rewrites that nobody asked for all lower
this score. The diff should contain the merge and little else.

| Score | Meaning |
| --- | --- |
| 5 | The diff is exactly the merge: the wiring plus the smallest change set that makes it work. |
| 4 | The merge plus cosmetic-only edits (whitespace, import order, a comment). |
| 3 | The merge plus local refactors of the touched code that a reviewer would accept but did not need. |
| 2 | Unrelated edits to files the merge did not require, or a formatting sweep across untouched files. |
| 1 | The diff is dominated by changes unrelated to the merge (renames, dependency bumps, wholesale rewrites). |

### `respects_patterns` — does it still look like the codebase?

Style, naming, architecture consistency. Did the merged code follow the
conventions of the repos it came from, or does it import a foreign idiom?

| Score | Meaning |
| --- | --- |
| 5 | Indistinguishable from hand-written code in these repos: the naming, error handling, module layout and test style all match. |
| 4 | Consistent with one of the two repos; a small stylistic mismatch with the other. |
| 3 | Mixed idioms in the same file or package — a new abstraction that neither repo uses. |
| 2 | The new code ignores the host repo's conventions (different error style, different naming, a parallel framework). |
| 1 | A foreign architecture dropped into the tree. |

### `notes`

Free text. Say *why* you scored what you scored — the one sentence a reviewer
would need to agree or disagree with you. This is the field the rater tool
(P-326) shows first.

## Scoring a pair

1. Score the three dimensions independently. Do not anchor on the build-pass
   result: a clean build with a 2 in `wiring_correctness` is a normal pair.
2. Write the note last, and make it specific ("B's `parseConfig` was renamed
   to `loadConfig` but A's call site still imports `parseConfig`") rather than
   a verdict ("looks fine").
3. The three scores are averaged into a single `rubric_score` (one decimal)
   — that is the number the harness records per pair.

## The trial worksheet

`eval/rubric/trial-worksheet.json` is the trial artefact: three corpus pairs
(`js-axios-ky`, `py-requests-httpx`, `go-gin-chi`) scored twice, once per
rater. The shipped columns are **seeded** — they are a starting point, not a
human trial.

The real trial: both owners score the same three pairs independently, replace
the seeded columns, and recompute the agreement:

```
bun packages/core/src/__tests__/fixtures/rubric-harness.ts
```

The harness prints one line: `RUBRIC {json}` with the validity report, the
rejections and Cohen's kappa.

## Inter-rater reliability

Cohen's kappa over the paired per-dimension scores (3 pairs x 3 dimensions = 9
paired observations per rater):

```
kappa = (po - pe) / (1 - pe)
```

- `po` — the proportion of agreeing dimension scores.
- `pe` — the agreement expected by chance, from the two raters' marginal
  distributions.

**The threshold is 0.6.** Below it, the rubric wording is ambiguous, not the
raters: tighten the anchors above (add an example, sharpen a boundary), then
re-trial. Do not lower the threshold.

The per-dimension form is deliberate. A total-score variant over three pairs
quantizes to steps of roughly 0.19, so a single disagreeing pair caps the
statistic below the threshold regardless of agreement elsewhere — the pooled
per-dimension form is what makes the statistic usable at this sample size.

## Freeze

This schema is frozen for:

- **P-326** — the rater review tool consumes it (the tool writes rubrics in
  this shape).
- **P-327** — the baseline run records `rubric_score` per pair from it.

Changing a dimension name, the 1-5 range or the field set is a contract
change: it needs an ADR, and the emitted `eval/rubric/schema.json` must be
refreshed with `bun scripts/emit-eval-schema.ts` in the same commit.
