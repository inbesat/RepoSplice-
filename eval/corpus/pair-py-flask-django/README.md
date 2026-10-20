# Pair py-flask-django (python)

**Merge intent.** A microframework and a batteries-included framework: same goal, very different structure.

| Side | Repository | Tag | Commit SHA | License |
| --- | --- | --- | --- | --- |
| A | [pallets/flask](https://github.com/pallets/flask) | `3.0.3` | `85039283fc3e986cced4ab39a3fe2b39314d06bb` | BSD-3-Clause |
| B | [django/django](https://github.com/django/django) | `5.0.6` | `c990212568961233fbd11db8009f72a5cd79ff46` | BSD-3-Clause |

**Extract paths.** A: `./` - B: `./` (the whole repository).

**Expected outcome.** `semantic_drift` - The merge applies, but the two codebases solve the same problem differently, so the result must be reviewed for behaviour changes.

**Expected conflicts.** The merge applies, but the two codebases solve the same problem differently, so the result must be reviewed for behaviour changes.

**Success criteria.**

- Both pinned commits are cloned and the extract paths exist.
- The merge runs on the pinned SHAs and lands in the `semantic_drift` category.
- No license block: both sides are permissive (BSD-3-Clause, BSD-3-Clause).

**Provenance.** The SHAs are the real immutable tag commits of the tags above, resolved with
`git ls-remote --tags --refs`. The licenses were read from each repository's license file
(source: `raw-file` / `raw-file`).