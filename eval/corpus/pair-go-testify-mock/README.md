# Pair go-testify-mock (go)

**Merge intent.** A test framework and a mocking library, both by the same maintainers.

| Side | Repository | Tag | Commit SHA | License |
| --- | --- | --- | --- | --- |
| A | [stretchr/testify](https://github.com/stretchr/testify) | `v1.9.0` | `bb548d0473d4e1c9b7bbfd6602c7bf12f7a84dd2` | MIT |
| B | [uber-go/mock](https://github.com/uber-go/mock) | `v0.4.0` | `e9f4675deaed5e5239ed94b03b65b16f6cbff4dc` | Apache-2.0 |

**Extract paths.** A: `./` - B: `./` (the whole repository).

**Expected outcome.** `clean` - Disjoint file sets: the merge applies cleanly and the result still builds.

**Expected conflicts.** Disjoint file sets: the merge applies cleanly and the result still builds.

**Success criteria.**

- Both pinned commits are cloned and the extract paths exist.
- The merge runs on the pinned SHAs and lands in the `clean` category.
- No license block: both sides are permissive (MIT, Apache-2.0).

**Provenance.** The SHAs are the real immutable tag commits of the tags above, resolved with
`git ls-remote --tags --refs`. The licenses were read from each repository's license file
(source: `raw-file` / `raw-file`).