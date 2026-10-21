# LSP viability spike (P-334)

**Status: NOT MEASURED — the phase's own gate is closed.**

The spike is conditional: it only runs when the P-331 failure taxonomy shows
the import-resolution failures as a top-2 category. The recorded taxonomy
(`eval/taxonomy/failure_categories.json`) carries the decision
**`epic17-deferred`** — import-resolution accounted for **0 of 1** recorded
failures (0.0%) and the top categories were `none`. The condition is not met,
so no latency, stability or accuracy number is claimed for any language.

The harness (`eval/scripts/lsp_spike.py`) is still shipped, so the spike is one
command away the day the gate opens.

## Per-language status

| Language | Server | License | Status | Cold start | Request latency | 100-request stability | Accuracy |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TypeScript / JavaScript | tsserver | MIT | not measured (the gate is closed) | not measured | not measured | not measured | not measured |
| Python | pyright | MIT | not measured (the gate is closed) | not measured | not measured | not measured | not measured |
| Go | gopls | MIT | not measured (the gate is closed) | not measured | not measured | not measured | not measured |
| Rust | rust-analyzer | MIT OR Apache-2.0 | not measured (the gate is closed) | not measured | not measured | not measured | not measured |

The **licensing** row is a static fact, not a measurement: all four servers ship
under MIT or Apache-2.0, so none of them carries a GPL-contamination risk for a
permissively-licensed corpus. That part of the spike's scope is settled.

The generated report (`eval/lsp_spike/results.json`) is the machine-readable
form of this table; every metric is `null` for a language that was not
measured, so a missing number can never be mistaken for a zero.

## The fallback

The standing plan is the tree-sitter heuristics (P-020 / P-021 / P-022). They
need no language server process, so they are the cheaper path for the
cross-language import work if it is ever warranted.

## Re-entry criteria

The spike (and the cross-language epic behind it) is re-opened when a
**provider-backed corpus baseline** — a real run over the 20-pair corpus with
Docker and an AI provider key (the three unblock conditions in
`eval/results/README.md`) — shows the import-resolution failures among the
top-2 categories (or at least 20% of the failures). The P-331 decision then
flips to `epic17-warranted` and the harness measures on the next run.

## How to run

From the repository root:

```bash
python eval/scripts/lsp_spike.py                       # the recorded report
python eval/scripts/lsp_spike.py --out /tmp/spike.json # a report elsewhere
python eval/scripts/lsp_spike.py --requests 100        # the stability burst size
```

The harness reads the gate from `eval/taxonomy/failure_categories.json`; it
probes each server binary (a missing binary is reported as `unavailable`, never
as a crash) and, when the gate is open, measures the cold start, one
`textDocument/definition` round trip, a burst of definition requests with the
error rate and the recovery probe. The report is written as JSON and the
script prints a per-language status line.

The tests that guard the report live in `eval/test_lsp_spike.py`:

```bash
python -m pytest eval/test_lsp_spike.py -q
```

They assert the *shape* — a latency only for a language that was actually
measured, the stability fields only for a measured language — so they stay
honest in both the closed-gate and the open-gate worlds.
