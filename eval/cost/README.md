# Cost and token tracking (P-330)

The eval harness reports what a run COST, not just what it built. The numbers
come from the AI provider audit log (P-145): every provider call already
carries its prompt tokens, its completion tokens and the cost that call
incurred, so the harness sums what was audited instead of re-pricing calls it
did not make.

## What the report shows

`stitch eval report` prints the per-ecosystem breakdown (P-329) with the cost
columns:

- **tokens** — the audited prompt + completion tokens of the run.
- **cost** — the audited cost in USD.
- **cost/success** — the cost of ONE successful merge (the run's cost divided
  by the merges that built). It is `n/a` when the language had no success: a
  number nobody can divide by is not a number.

The cost of an attempt and the cost of a SUCCESS are different numbers, and
only the second one tells you what a merge is worth.

## The pricing assumptions

- The pricing table is the core model registry
  (`packages/core/src/ai/models.ts`): `cost.input` and `cost.output` are
  **USD per 1M input / 1M output tokens**.
- A model that is NOT in the registry prices at **0**. Its tokens are still
  counted, so a run never hides its volume behind a missing price — the cost
  column reads 0 and the token column tells the truth.
- A run with no audited provider calls (the fixture corpus, or a run whose
  agent stage was skipped) reports 0 tokens and 0 cost.

## Updating the prices

Vendor prices change; the registry is the single place they live:

1. Edit the `cost` entry of the affected model in
   `packages/core/src/ai/models.ts` (the file's header says the same).
2. Re-run the corpus so the baseline picks the new prices up
   (`stitch eval run eval/corpus --output-dir eval/results/baseline-<ts>`).
3. Record the change in an ADR if it moves the baseline composite.

## The budget

`stitch eval report --budget <usd>` prints a budget line for the run:

- `--budget 0` (the default) means **off** — the same convention the config's
  `agent.maxCostUsd` uses (0 = off).
- A run at or under the budget passes; a run over it is reported as
  `EXCEEDS`.

The budget knob itself (a configured ceiling that the harness reads) lands
with the cost-budgets phase (P-302); until then the threshold is a parameter
on the command.

## Where the numbers live

- `packages/core/src/eval/cost.ts` — the pricing, the audited summary, the
  cost per successful merge and the budget check.
- `packages/core/src/eval/runner.ts` — stamps `tokens_total` and `cost_usd`
  on each result (the audited totals when the agent port supplies the audit
  rows, otherwise the numbers the port reported).
- `packages/core/src/eval/report.ts` — the per-ecosystem aggregation.
