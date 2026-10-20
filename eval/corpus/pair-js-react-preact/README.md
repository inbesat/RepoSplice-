# Pair js-react-preact (js)

**Merge intent.** A large UI runtime and its lightweight alternative: same problem, different trade-offs.

| Side | Repository | Tag | Commit SHA | License |
| --- | --- | --- | --- | --- |
| A | [facebook/react](https://github.com/facebook/react) | `v18.3.1` | `f1338f8080abd1386454a10bbf93d67bfe37ce85` | MIT |
| B | [preactjs/preact](https://github.com/preactjs/preact) | `10.22.0` | `494f08460fbfa5bd653552912c923c7eab7b1c5e` | MIT |

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