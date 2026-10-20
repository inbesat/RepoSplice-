# Eval results

The baseline artifacts of the eval harness live here. One file per run:
`baseline-<timestamp>.json` for a real corpus run, `baseline-dryrun-<date>.json`
for the fixture dry run that ships with the repo.

## What a baseline file holds

The metrics the roadmap gates on (see `packages/core/src/eval/baseline.ts`):

- `build_pass_rate` — the share of corpus pairs whose build AND tests passed
  in the sandbox.
- `rubric_avg` — the mean human-rubric score over the rated pairs (the mean of
  the three `SemanticRubric` dimensions, per rater, averaged over the raters).
  `null` when nobody scored a pair — a number nobody gave is never invented.
- `resolve_rate` — the share of pairs that build AND average 4 or more.
- `decision` — `go` when the import-resolution failures are among the top-2
  failure categories (the cross-language epic is then warranted), `no-go`
  otherwise, `pending` while no pair carries a rating.
- `categories` — the preliminary failure taxonomy (P-331 formalizes it).
- `per_pair` — the per-pair view: the build verdict, the rubric average, the
  resolution verdict and the failure category.

## The shipped dry run

`baseline-dryrun-20261021.json` is a DRY RUN over the P-324 fixture corpus
(three synthetic pairs, real local builds). It is NOT a corpus measurement:
`rated` is 0, so `rubric_avg` is `null` and the decision is `pending`. It
exists to prove the machinery end to end (the runner writes the per-pair
results, the baseline command reads them and writes the artifact).

## Running the real baseline

The full 20-pair run needs three things this machine does not have:

1. **Docker** — the sandbox (P-168) builds and tests each merged repo in a
   container. `stitch doctor` reports the daemon as optional; without it the
   sandbox falls back to the GitHub Actions path (P-178), which needs a token.
2. **An AI provider key** — the agent stage (P-148-P-167) that produces the
   merged child repo. Without a key every pipeline stage is `skipped` and no
   merge happens.
3. **Wall clock** — the run is 20 pairs; the sandbox dominates (30-60 min).

With all three in place:

```sh
# 1. run the corpus (the per-pair results land in the output dir)
bun run --cwd packages/cli eval run eval/corpus --parallel 4 --output-dir eval/results/baseline-<ts>

# 2. both owners score every pair (the scores are written back into the
#    per-pair result files)
bun run --cwd packages/cli eval rate <pair-id> --result-dir eval/results/baseline-<ts> --rater <you>

# 3. compute the metrics + the GO/NO-GO decision
bun run --cwd packages/cli eval baseline --result-dir eval/results/baseline-<ts> --corpus eval/corpus --out eval/results/baseline-<ts>.json
```

Step 3 exits 1 when a corpus pair has no result (an incomplete run can never
report a flattering number) and 0 on a complete one. The decision is
`pending` until the ratings are in — the gate is not decidable without them.
