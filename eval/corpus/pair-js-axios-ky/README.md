# Pair js-axios-ky (js)

**Merge intent.** A popular HTTP client and a smaller modern one: disjoint files, a clean overlay merge.

| Side | Repository | Tag | Commit SHA | License |
| --- | --- | --- | --- | --- |
| A | [axios/axios](https://github.com/axios/axios) | `v1.7.7` | `ea27b7b4b030dc91f8fddb08edcce207736855f0` | MIT |
| B | [sindresorhus/ky](https://github.com/sindresorhus/ky) | `v1.7.2` | `9d624b29e3306149ea468ce878de2cd1e9fb9a19` | MIT |

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