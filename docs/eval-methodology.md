# Evaluation methodology (alias)

The evaluation methodology lives in **[EVAL.md](../EVAL.md)** at the repository
root. That file is the public reference: what the corpus measures, how a run is
produced, the baseline numbers, the failure taxonomy, the per-ecosystem
breakdown, the cost analysis, how to run the evaluation locally and how to
contribute a new pair.

This page exists so `docs/eval-methodology.md` resolves for links that expect
the methodology under `docs/`. It is generated alongside `EVAL.md` - do not
edit either file by hand; run:

```sh
python eval/scripts/render_eval_md.py
```

The renderer reads the committed artifacts (`eval/corpus/pairs.json`,
`eval/results/baseline-dryrun-20261021.json`,
`eval/report/ecosystem_breakdown.json`,
`eval/taxonomy/failure_categories.json`), so the published numbers always
describe the measurements that produced them.
