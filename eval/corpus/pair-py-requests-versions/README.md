# Pair py-requests-versions (python)

**Merge intent.** The same client at two releases: overlapping files, so the merge is expected to conflict.

| Side | Repository | Tag | Commit SHA | License |
| --- | --- | --- | --- | --- |
| A | [psf/requests](https://github.com/psf/requests) | `v2.32.3` | `61e2240f283f15780ac2d0e2cfefb0fd6fdab627` | Apache-2.0 |
| B | [psf/requests](https://github.com/psf/requests) | `v2.31.0` | `0106aced5faa299e6ede89d1230bd6784f2c3660` | Apache-2.0 |

**Extract paths.** A: `./` - B: `./` (the whole repository).

**Expected outcome.** `conflicts` - The same paths exist on both sides, so the merge is expected to conflict; resolving them is the task.

**Expected conflicts.** The same paths exist on both sides, so the merge is expected to conflict; resolving them is the task.

**Success criteria.**

- Both pinned commits are cloned and the extract paths exist.
- The merge runs on the pinned SHAs and lands in the `conflicts` category.
- No license block: both sides are permissive (Apache-2.0, Apache-2.0).

**Provenance.** The SHAs are the real immutable tag commits of the tags above, resolved with
`git ls-remote --tags --refs`. The licenses were read from each repository's license file
(source: `raw-file` / `raw-file`).