# EVAL.md - the stitch evaluation methodology

This document explains what the evaluation corpus measures, how a run is produced, and how to read the numbers. It is generated from the committed artifacts by `python eval/scripts/render_eval_md.py`, so the published numbers cannot drift from the measurements they describe.

## Overview

The corpus is a set of real repository pairs. For each pair the harness clones both sides at their pinned commits, extracts the selected paths, runs the agent loop, builds and tests the merged child in a sandbox, and then a human rates the merge with the semantic rubric. Three numbers summarise a run: the **build-pass rate** (the pairs whose merged child builds and tests clean), the **rubric average** (the mean of the three rubric dimensions over both raters) and the **resolve rate** (the pairs that build AND average at least 4).

The corpus holds 20 pairs. The baseline below was produced by a dry run over the fixture corpus (the full provider-backed run needs Docker and an AI key - see ADR-135); it exercises the whole pipeline and the metric maths, and it is NOT a corpus measurement.

## Corpus Composition

Every pair pins both repositories to an immutable commit and uses a permissive license on both sides.

| pair_id | ecosystem | repo A | repo B | licenses | expected outcome |
| --- | --- | --- | --- | --- | --- |
| js-axios-ky | js | https://github.com/axios/axios | https://github.com/sindresorhus/ky | MIT / MIT | clean |
| js-express-fastify | js | https://github.com/expressjs/express | https://github.com/fastify/fastify | MIT / MIT | semantic_drift |
| js-react-preact | js | https://github.com/facebook/react | https://github.com/preactjs/preact | MIT / MIT | semantic_drift |
| js-vue-svelte | js | https://github.com/vuejs/core | https://github.com/sveltejs/svelte | MIT / MIT | semantic_drift |
| js-axios-versions | js | https://github.com/axios/axios | https://github.com/axios/axios | MIT / MIT | conflicts |
| py-requests-httpx | python | https://github.com/psf/requests | https://github.com/encode/httpx | Apache-2.0 / BSD-3-Clause | clean |
| py-flask-django | python | https://github.com/pallets/flask | https://github.com/django/django | BSD-3-Clause / BSD-3-Clause | semantic_drift |
| py-fastapi-sanic | python | https://github.com/fastapi/fastapi | https://github.com/sanic-org/sanic | MIT / MIT | clean |
| py-numpy-scipy | python | https://github.com/numpy/numpy | https://github.com/scipy/scipy | BSD-3-Clause / BSD-3-Clause | clean |
| py-requests-versions | python | https://github.com/psf/requests | https://github.com/psf/requests | Apache-2.0 / Apache-2.0 | conflicts |
| go-gin-chi | go | https://github.com/gin-gonic/gin | https://github.com/go-chi/chi | MIT / MIT | clean |
| go-cobra-cli | go | https://github.com/spf13/cobra | https://github.com/urfave/cli | Apache-2.0 / MIT | semantic_drift |
| go-testify-mock | go | https://github.com/stretchr/testify | https://github.com/uber-go/mock | MIT / Apache-2.0 | clean |
| go-mux-echo | go | https://github.com/gorilla/mux | https://github.com/labstack/echo | BSD-3-Clause / MIT | semantic_drift |
| go-k8s-etcd | go | https://github.com/kubernetes/client-go | https://github.com/etcd-io/etcd | Apache-2.0 / Apache-2.0 | clean |
| rs-tokio-hyper | rust | https://github.com/tokio-rs/tokio | https://github.com/hyperium/hyper | MIT / MIT | clean |
| rs-serde-clap | rust | https://github.com/serde-rs/serde | https://github.com/clap-rs/clap | MIT / MIT | clean |
| rs-axum-actix | rust | https://github.com/tokio-rs/axum | https://github.com/actix/actix-web | MIT / MIT | semantic_drift |
| rs-rust-cargo | rust | https://github.com/rust-lang/rust | https://github.com/rust-lang/cargo | MIT / MIT | clean |
| rs-ripgrep-fd | rust | https://github.com/BurntSushi/ripgrep | https://github.com/sharkdp/fd | MIT / MIT | clean |

## Evaluation Methodology

The harness (`stitch eval run <corpus>`) runs five steps per pair:

1. **Clone** both repositories at the pinned commits.
2. **Extract** the selected paths with `git filter-repo`.
3. **Agent loop** - the merge is produced by the pipeline stages.
4. **Sandbox** - the merged child is built and tested in a container.
5. **Rate** - a human fills the rubric for the pair.

The rubric has three dimensions, each scored 1-5 (a 0 or a 6 is rejected by the schema):

- `wiring_correctness`
- `unnecessary_changes`
- `respects_patterns`

The mean of the three dimensions is the pair's rubric score; a pair resolves when it builds AND averages at least 4. Both owners rate the same pairs independently, and the inter-rater reliability (Cohen's kappa) must stay at or above 0.6 for the rubric to be trusted.

## Baseline Results

Measured at 2026-10-20T20:54:43.746Z on commit `75b6645`.

| metric | value |
| --- | --- |
| pairs | 3 |
| rated pairs | 0 |
| build-pass count | 2 |
| build-pass rate | 0.6667 |
| rubric average | n/a |
| resolve count | 0 |
| resolve rate | 0 |
| decision | pending |

- no pair carries a human rating - the decision stays pending

<!-- eval-baseline
{
  "build_pass_count": 2,
  "build_pass_rate": 0.6667,
  "commit": "75b6645",
  "corpus_pairs": 20,
  "decision": "pending",
  "generated_at": "2026-10-20T20:54:43.746Z",
  "pairs": 3,
  "rated": 0,
  "resolve_rate": 0,
  "resolved_count": 0,
  "rubric_avg": null
}
-->

## Failure Taxonomy

Every failed pair is classified into one category so the roadmap can be decided on data instead of anecdotes.

| category | count |
| --- | --- |
| import-resolution | 0 |
| semver-conflict | 0 |
| license-block | 0 |
| loop-cap-exceeded | 0 |
| sandbox-timeout | 0 |
| semantic-wrong-but-builds | 0 |
| unknown | 1 |
| none | 2 |

Current decision: **epic17-deferred** (import-resolution share 0.0%).

- import-resolution failures: 0 of 1 (0.0%)
- the top categories are none
- the cross-language epic (Epic 17) is deferred

## Per-Ecosystem Breakdown

Which language drags the average down. The mean and the median of every metric are reported, and a metric nobody measured stays `n/a`.

| ecosystem | pairs | build-pass | rubric | resolve | tokens | cost | duration |
| --- | --- | --- | --- | --- | --- | --- | --- |
| js | 1 | 100.0% | n/a | n/a | 12 | 0.01 | 345 |
| python | 1 | 0.0% | n/a | n/a | 12 | 0.01 | 172 |
| go | 1 | 100.0% | n/a | n/a | 12 | 0.01 | 328 |
| rust | 0 | n/a | n/a | n/a | 0 | 0 | 0 |
| all | 3 | 66.7% | n/a | n/a | 36 | 0.03 | 845 |

## Cost Analysis

The cost numbers come from the provider audit log (P-145): the module never re-prices a call it did not make. Prices are the core model registry (USD per 1M tokens); a model that is not in the registry costs 0 while its tokens are still counted. The report shows the cost-per-successful-merge per ecosystem (that is the number that matters for a budget), and the CLI takes `--budget <usd>` (0 = off) to raise an alert when a run exceeds it.

## How to Run Locally

```sh
# 1. the harness (needs Docker for the sandbox and an AI key)
bun run --cwd packages/cli eval run eval/corpus --parallel 4 \
  --output-dir eval/results/baseline-$(date +%s)

# 2. rate the pairs (both owners, independently)
bun run --cwd packages/cli eval rate <pair-id> \
  --result-dir eval/results/baseline-$(date +%s) --rater <you>

# 3. the metrics + the go/no-go decision
bun run --cwd packages/cli eval baseline \
  --result-dir eval/results/baseline-$(date +%s) --corpus eval/corpus

# 4. the per-ecosystem table + the taxonomy
bun run --cwd packages/cli eval report --result-dir <dir>
bun run --cwd packages/cli eval taxonomy --result-dir <dir>

# 5. regenerate this document
python eval/scripts/render_eval_md.py
```

## How to Contribute Pairs

New pairs come from outside. [eval/corpus/CONTRIBUTING.md](eval/corpus/CONTRIBUTING.md) has the selection criteria, the schema, the license rules, the diversity rule and the pull request template; `eval/scripts/validate_contribution.py` checks a contribution against the schema, the permissive license list, the pinned commits and the diversity rule, and the `eval-corpus-pr` workflow runs it on every pull request that touches the corpus.

## Versioning & Updates

This document is regenerated on every `v*` tag by the release workflow and committed back to `main`, so the published numbers always describe the tagged tree. The schema of the corpus, the rubric and the taxonomy are frozen contracts: changing one needs an ADR and a refreshed `eval/corpus/schema.json` (or `eval/rubric/schema.json`) in the same commit.

The confidence score that sits alongside these numbers is documented separately in [CONFIDENCE.md](CONFIDENCE.md): it is a heuristic signal about a proposed merge, not a correctness guarantee.
