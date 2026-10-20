# Pair go-gin-chi (go)

**Merge intent.** Two router frameworks with different philosophies (heavy vs minimal).

| Side | Repository | Tag | Commit SHA | License |
| --- | --- | --- | --- | --- |
| A | [gin-gonic/gin](https://github.com/gin-gonic/gin) | `v1.10.0` | `75ccf94d605a05fe24817fc2f166f6f2959d5cea` | MIT |
| B | [go-chi/chi](https://github.com/go-chi/chi) | `v5.0.12` | `1191921289e82fdc56f298a76ff254742f568ece` | MIT |

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