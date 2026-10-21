# Adding a pair to the eval corpus

The corpus is a benchmark. A pair that adds nothing but another instance of
what is already there dilutes the signal, so every contribution is checked
on four axes before it lands: the schema, the license, the pin and the
diversity.

This document is the whole process. If you can follow it, you can add a
pair without asking anyone.

## 1. Pick a real merge scenario

* Both repositories must be **public** and **real** - no toy repos, no
  fixtures, no forks of the corpus itself.
* The pair must be a **merge scenario**: two projects where a human would
  actually try to merge them (a shared library and an application, two
  implementations of one protocol, a library and its plugin).
* The pair must be **clonable** at the commits you pin - check before you
  write the PR.
* Both sides must carry a **permissive** license (see below).

## 2. Pin both sides

Pin the exact commit, never a branch:

```bash
git ls-remote --tags --refs https://github.com/<owner>/<repo> | grep '<tag>'
```

The SHA is the 40 character lowercase hex commit the tag points at. Record
the tag you pinned in `repo_a_tag` / `repo_b_tag` so a human can see the
provenance.

## 3. The schema

Every entry in `eval/corpus/pairs.json` matches the schema in
`eval/corpus/schema.json` (the P-320 contract). The required fields:

| field | meaning |
| --- | --- |
| `pair_id` | unique, kebab-case (`js-axios-ky`) |
| `repo_a_url`, `repo_b_url` | the GitHub urls |
| `repo_a_sha`, `repo_b_sha` | the pinned 40 hex commits |
| `extract_paths_a`, `extract_paths_b` | the paths to extract (usually `["./"]`) |
| `ecosystem` | `js`, `python`, `go` or `rust` |
| `license_a`, `license_b` | the SPDX ids |
| `expected_outcome` | `clean`, `conflicts`, `license_block` or `semantic_drift` |

Allowed extras: `repo_a_tag`, `repo_b_tag`, `license_a_source`,
`license_b_source`, `note`, and `failure_mode` (one of the P-331 taxonomy
categories: `import-resolution`, `semver-conflict`, `license-block`,
`loop-cap-exceeded`, `sandbox-timeout`, `semantic-wrong-but-builds`).

## 4. The license check

Both sides must carry a **permissive** license:

`MIT`, `Apache-2.0`, `BSD-2-Clause`, `BSD-3-Clause`, `ISC`, `0BSD`,
`BlueOak-1.0.0`, `Unlicense`, `CC0-1.0`, `WTFPL`, `Zlib`

The list lives in `packages/core/src/license/categories.ts` (the policy of
P-127) and is mirrored in `eval/scripts/validate_contribution.py`. Read the
license file of each repo, record the SPDX id, and record where you read it
in `license_a_source` / `license_b_source` (for example `raw-file`).

A copyleft or proprietary license disqualifies the pair - do not ask for an
exception, the corpus policy (P-127) has none.

## 5. The diversity rule

A **new** pair must add coverage the corpus does not have yet. It passes the
diversity check when it brings at least one of:

* a **new ecosystem** (one of the four is already covered - a pair outside
  them is not accepted, the schema pins the four),
* a **new expected outcome** (an outcome no pair declares yet), or
* a **new failure mode** from the taxonomy that no pair uses yet.

A pair that only repeats an existing ecosystem, outcome and failure mode is
rejected: it would move the averages without making the benchmark broader.

## 6. Check it locally

```bash
# the whole corpus
python eval/scripts/validate_corpus.py

# your new pair (the corpus as it is today, your candidate alone)
python eval/scripts/validate_contribution.py \
  --corpus eval/corpus/pairs.json \
  --candidate path/to/your/candidate.json
```

The contribution check is hermetic by default. To also verify that the
pinned commits are still reachable upstream:

```bash
STITCH_EVAL_VERIFY_NETWORK=1 python eval/scripts/validate_contribution.py \
  --corpus eval/corpus/pairs.json --candidate path/to/your/candidate.json
```

## 7. Open the pull request

The pull request touches `eval/corpus/`:

* add your entry to `eval/corpus/pairs.json`,
* add `eval/corpus/pair-<pair_id>/` with `README.md` (the merge intent, the
  expected conflicts, the success criteria), `repo-a-url.txt`,
  `repo-b-url.txt` and `expected-outcome.md` (the P-321 layout),
* keep the entries in the same order (grouped by ecosystem) and the file
  formatted with two spaces of indentation.

Use this template:

```markdown
### Pair: <pair_id>

- **Ecosystem:** <js|python|go|rust>
- **A:** <owner/repo> @ <tag> (`<sha>`) - <license>
- **B:** <owner/repo> @ <tag> (`<sha>`) - <license>
- **Expected outcome:** <clean|conflicts|license_block|semantic_drift>
- **Failure mode:** <one of the taxonomy categories>
- **Why it adds coverage:** <the new ecosystem / outcome / failure mode>
- **Merge intent:** <what a human would try to merge>
- **Expected conflicts:** <what should conflict>
- **Success criteria:** <what a good merge looks like>
```

The `eval-corpus-pr` workflow runs the corpus validation plus the
contribution check on every pull request that touches `eval/corpus/`, and
it blocks an invalid submission.

## 8. The maintainer checklist

Before a pair is merged, a maintainer confirms:

* **difficulty calibration** - the pair is a real scenario and its expected
  outcome is not obviously trivial,
* **license confirmation** - both SPDX ids were read from the repositories
  themselves, not from a third party,
* **diversity confirmation** - the pair adds the coverage it claims, and the
  corpus does not already cover it.
