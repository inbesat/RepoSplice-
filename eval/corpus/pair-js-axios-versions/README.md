# Pair js-axios-versions (js)

**Merge intent.** The same client at two releases: overlapping files, so the merge is expected to conflict.

| Side | Repository | Tag | Commit SHA | License |
| --- | --- | --- | --- | --- |
| A | [axios/axios](https://github.com/axios/axios) | `v1.7.7` | `ea27b7b4b030dc91f8fddb08edcce207736855f0` | MIT |
| B | [axios/axios](https://github.com/axios/axios) | `v1.6.8` | `752b52e32453d9dc2d4449528d68d2ddf5337641` | MIT |

**Extract paths.** A: `./` - B: `./` (the whole repository).

**Expected outcome.** `conflicts` - The same paths exist on both sides, so the merge is expected to conflict; resolving them is the task.

**Expected conflicts.** The same paths exist on both sides, so the merge is expected to conflict; resolving them is the task.

**Success criteria.**

- Both pinned commits are cloned and the extract paths exist.
- The merge runs on the pinned SHAs and lands in the `conflicts` category.
- No license block: both sides are permissive (MIT, MIT).

**Provenance.** The SHAs are the real immutable tag commits of the tags above, resolved with
`git ls-remote --tags --refs`. The licenses were read from each repository's license file
(source: `raw-file` / `raw-file`).