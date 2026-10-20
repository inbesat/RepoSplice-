# Pair js-vue-svelte (js)

**Merge intent.** Two component frameworks whose reactive models differ (virtual DOM vs compiler).

| Side | Repository | Tag | Commit SHA | License |
| --- | --- | --- | --- | --- |
| A | [vuejs/core](https://github.com/vuejs/core) | `v3.4.31` | `f2acd51340b85ae88bfd16bf5e61df967e0b92ec` | MIT |
| B | [sveltejs/svelte](https://github.com/sveltejs/svelte) | `svelte@4.2.19` | `23ec635435ea4c4f51a6946cc9c1f1b351855f79` | MIT |

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