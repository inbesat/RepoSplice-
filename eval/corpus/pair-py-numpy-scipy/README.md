# Pair py-numpy-scipy (python)

**Merge intent.** The numeric core and the scientific library built on top of it.

| Side | Repository | Tag | Commit SHA | License |
| --- | --- | --- | --- | --- |
| A | [numpy/numpy](https://github.com/numpy/numpy) | `v1.26.4` | `b5994f864bd2f3b0fe082fdd387637dd1e6858a9` | BSD-3-Clause |
| B | [scipy/scipy](https://github.com/scipy/scipy) | `v1.13.1` | `34a5ce2e0e51fc2005d3c2720bcd8296cd33af94` | BSD-3-Clause |

**Extract paths.** A: `./` - B: `./` (the whole repository).

**Expected outcome.** `clean` - Disjoint file sets: the merge applies cleanly and the result still builds.

**Expected conflicts.** Disjoint file sets: the merge applies cleanly and the result still builds.

**Success criteria.**

- Both pinned commits are cloned and the extract paths exist.
- The merge runs on the pinned SHAs and lands in the `clean` category.
- No license block: both sides are permissive (BSD-3-Clause, BSD-3-Clause).

**Provenance.** The SHAs are the real immutable tag commits of the tags above, resolved with
`git ls-remote --tags --refs`. The licenses were read from each repository's license file
(source: `raw-file` / `raw-file`).