# Pair py-fastapi-sanic (python)

**Merge intent.** Two async web frameworks with different routing styles.

| Side | Repository | Tag | Commit SHA | License |
| --- | --- | --- | --- | --- |
| A | [fastapi/fastapi](https://github.com/fastapi/fastapi) | `0.110.1` | `50a880b39f09217ccb9b4144f9f5c8439af54cfd` | MIT |
| B | [sanic-org/sanic](https://github.com/sanic-org/sanic) | `v23.6.0` | `205795d1e89f5b0f5f0339a1e6545bc1633074fe` | MIT |

**Extract paths.** A: `./` - B: `./` (the whole repository).

**Expected outcome.** `clean` - Disjoint file sets: the merge applies cleanly and the result still builds.

**Expected conflicts.** Disjoint file sets: the merge applies cleanly and the result still builds.

**Success criteria.**

- Both pinned commits are cloned and the extract paths exist.
- The merge runs on the pinned SHAs and lands in the `clean` category.
- No license block: both sides are permissive (MIT, MIT).

**Provenance.** The SHAs are the real immutable tag commits of the tags above, resolved with
`git ls-remote --tags --refs`. The licenses were read from each repository's license file
(source: `raw-file` / `raw-file`).