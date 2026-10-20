# Pair rs-axum-actix (rust)

**Merge intent.** Two Rust web frameworks with different middleware models.

| Side | Repository | Tag | Commit SHA | License |
| --- | --- | --- | --- | --- |
| A | [tokio-rs/axum](https://github.com/tokio-rs/axum) | `axum-v0.7.5` | `ef8a9e812c1b49b61d21813cb30f5982d8da56df` | MIT |
| B | [actix/actix-web](https://github.com/actix/actix-web) | `web-v4.9.0` | `e0918fb1795c899ac38fb903694ca1aa3b58d46d` | MIT |

**Extract paths.** A: `./` - B: `./` (the whole repository).

**Expected outcome.** `semantic_drift` - The merge applies, but the two codebases solve the same problem differently, so the result must be reviewed for behaviour changes.

**Expected conflicts.** The merge applies, but the two codebases solve the same problem differently, so the result must be reviewed for behaviour changes.

**Success criteria.**

- Both pinned commits are cloned and the extract paths exist.
- The merge runs on the pinned SHAs and lands in the `semantic_drift` category.
- No license block: both sides are permissive (MIT, MIT).

**Provenance.** The SHAs are the real immutable tag commits of the tags above, resolved with
`git ls-remote --tags --refs`. The licenses were read from each repository's license file
(source: `raw-file` / `raw-file`).