# Pair go-mux-echo (go)

**Merge intent.** A small HTTP router and a full framework: disjoint files, a clean overlay merge.

| Side | Repository | Tag | Commit SHA | License |
| --- | --- | --- | --- | --- |
| A | [gorilla/mux](https://github.com/gorilla/mux) | `v1.8.1` | `b4617d0b9670ad14039b2739167fd35a60f557c5` | BSD-3-Clause |
| B | [labstack/echo](https://github.com/labstack/echo) | `v5.4.0` | `fc410094b2f3415cf2bf5204082137b205bfd5af` | MIT |

**Extract paths.** A: `./` - B: `./` (the whole repository).

**Expected outcome.** `semantic_drift` - The merge applies, but the two codebases solve the same problem differently, so the result must be reviewed for behaviour changes.

**Expected conflicts.** The merge applies, but the two codebases solve the same problem differently, so the result must be reviewed for behaviour changes.

**Success criteria.**

- Both pinned commits are cloned and the extract paths exist.
- The merge runs on the pinned SHAs and lands in the `semantic_drift` category.
- No license block: both sides are permissive (BSD-3-Clause, MIT).

**Provenance.** The SHAs are the real immutable tag commits of the tags above, resolved with
`git ls-remote --tags --refs`. The licenses were read from each repository's license file
(source: `raw-file` / `raw-file`).