# Example EvalPair

This folder holds one hand-written corpus entry that shows every field of the
`EvalPair` schema. It is the reference the P-321 sourced pairs are copied from,
and the fixture the schema tests validate against.

The pair is also listed in [`../pairs.json`](../pairs.json) — the manifest is
the file the validator and the harness runner read.

## Fields

| Field | Meaning |
| --- | --- |
| `pair_id` | Stable identifier, `NNNN`-style, unique inside the manifest. |
| `repo_a_url` | Base source repository (the "A" side of the merge). |
| `repo_b_url` | Overlay source repository (the "B" side of the merge). |
| `repo_a_sha` | Pinned commit of repo A — 40 lowercase hex characters. |
| `repo_b_sha` | Pinned commit of repo B — 40 lowercase hex characters. |
| `extract_paths_a` | Sub-directories of repo A to extract (`.` = whole repo). |
| `extract_paths_b` | Sub-directories of repo B to extract. |
| `ecosystem` | Primary ecosystem: `js`, `python`, `go` or `rust`. |
| `license_a` | SPDX license id of repo A (e.g. `MIT`). |
| `license_b` | SPDX license id of repo B. |
| `expected_outcome` | Human-annotated expectation: `clean`, `conflicts`, `license_block` or `semantic_drift`. |
| `note` | Optional free-text note (the schema is loose, so extra fields are allowed). |

## The SHAs are placeholders

`repo_a_sha` is 40 zeros and `repo_b_sha` repeats `deadbeef` — **both are
placeholders**, not real commits. P-321 replaces them with the pinned commits
of the sourced repositories. Nothing in this example should be read as a claim
about a real commit.

## Validating

From the repository root:

```
python eval/scripts/validate_corpus.py
```

The validator reads `eval/corpus/schema.json` and `eval/corpus/pairs.json`,
prints one `path: message` line per violation and exits `0` when the corpus is
valid (non-zero otherwise). It uses the Python standard library only, so a
fresh clone can validate the corpus without installing anything.

The schema itself lives in `packages/core/src/eval/schema.ts`; regenerate the
JSON Schema with `bun run eval:schema` and check it is current with
`bun run eval:schema:check`.
