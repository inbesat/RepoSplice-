# Pair go-cobra-cli (go)

**Merge intent.** Two CLI frameworks whose command trees are shaped differently.

| Side | Repository | Tag | Commit SHA | License |
| --- | --- | --- | --- | --- |
| A | [spf13/cobra](https://github.com/spf13/cobra) | `v1.8.1` | `e94f6d0dd9a5e5738dca6bce03c4b1207ffbc0ec` | Apache-2.0 |
| B | [urfave/cli](https://github.com/urfave/cli) | `v3.14.0` | `236271c2829401155cb2044ad31ec15b91a3d226` | MIT |

**Extract paths.** A: `./` - B: `./` (the whole repository).

**Expected outcome.** `semantic_drift` - The merge applies, but the two codebases solve the same problem differently, so the result must be reviewed for behaviour changes.

**Expected conflicts.** The merge applies, but the two codebases solve the same problem differently, so the result must be reviewed for behaviour changes.

**Success criteria.**

- Both pinned commits are cloned and the extract paths exist.
- The merge runs on the pinned SHAs and lands in the `semantic_drift` category.
- No license block: both sides are permissive (Apache-2.0, MIT).

**Provenance.** The SHAs are the real immutable tag commits of the tags above, resolved with
`git ls-remote --tags --refs`. The licenses were read from each repository's license file
(source: `raw-file` / `raw-file`).