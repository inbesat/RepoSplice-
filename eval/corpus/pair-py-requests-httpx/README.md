# Pair py-requests-httpx (python)

**Merge intent.** A classic requests session and its async successor: disjoint files, a clean overlay merge.

| Side | Repository | Tag | Commit SHA | License |
| --- | --- | --- | --- | --- |
| A | [psf/requests](https://github.com/psf/requests) | `v2.32.3` | `61e2240f283f15780ac2d0e2cfefb0fd6fdab627` | Apache-2.0 |
| B | [encode/httpx](https://github.com/encode/httpx) | `0.27.0` | `326b9431c761e1ef1e00b9f760d1f654c8db48c6` | BSD-3-Clause |

**Extract paths.** A: `./` - B: `./` (the whole repository).

**Expected outcome.** `clean` - Disjoint file sets: the merge applies cleanly and the result still builds.

**Expected conflicts.** Disjoint file sets: the merge applies cleanly and the result still builds.

**Success criteria.**

- Both pinned commits are cloned and the extract paths exist.
- The merge runs on the pinned SHAs and lands in the `clean` category.
- No license block: both sides are permissive (Apache-2.0, BSD-3-Clause).

**Provenance.** The SHAs are the real immutable tag commits of the tags above, resolved with
`git ls-remote --tags --refs`. The licenses were read from each repository's license file
(source: `raw-file` / `raw-file`).