# EVAL.md template (P-329)

The published `EVAL.md` (P-333) is rendered from this template after a
baseline run. Copy it, fill the numbers from
`eval/results/baseline-<timestamp>.json` and
`eval/report/ecosystem_breakdown.json`, and keep the prose honest: a number
nobody measured stays `n/a`.

## Run

- corpus: `eval/corpus` (20 pairs, 5 per ecosystem)
- command: `stitch eval run eval/corpus --parallel 4 --output-dir eval/results/baseline-<ts>`
- rated by: both owners (`stitch eval rate <pair-id> --result-dir eval/results/baseline-<ts>`)
- metrics: `stitch eval baseline --result-dir eval/results/baseline-<ts> --corpus eval/corpus --out eval/results/baseline-<ts>.json`

## Headline

| metric | value |
| --- | --- |
| build-pass rate | _n/a_ |
| rubric average (1-5) | _n/a_ |
| resolve rate | _n/a_ |
| composite (0-100) | _n/a_ |
| decision (go / no-go / pending) | _pending_ |

## Per-ecosystem breakdown

Rendered with `stitch eval report --result-dir eval/results/baseline-<ts>`
(writes `eval/report/ecosystem_breakdown.json` and prints the markdown table
the CI summary shows). Paste the table here:

| ecosystem | pairs | build-pass | rubric | resolve | tokens | cost | duration |
| --- | --- | --- | --- | --- | --- | --- | --- |
| js | 0 | n/a | n/a | n/a | 0 | 0 | 0 |
| python | 0 | n/a | n/a | n/a | 0 | 0 | 0 |
| go | 0 | n/a | n/a | n/a | 0 | 0 | 0 |
| rust | 0 | n/a | n/a | n/a | 0 | 0 | 0 |
| all | 0 | n/a | n/a | n/a | 0 | 0 | 0 |

The breakdown answers one question: is a weak ecosystem dragging the average
down? The mean AND the median are reported per metric, so a single outlier
cannot hide behind an average, and a metric nobody measured stays `n/a`
instead of a fake zero.

## Failure categories (preliminary)

| category | count |
| --- | --- |
| resolution | 0 |
| build | 0 |
| test | 0 |
| license | 0 |
| timeout | 0 |
| other | 0 |

The taxonomy is preliminary until P-331 formalizes it.

## Decision

_state the go / no-go call and the reason: the cross-language epic (Epic 17)
is warranted when the import-resolution failures sit in the TOP-TWO failure
categories. With no human rating yet the decision stays `pending` — a number
nobody gave is never invented._
