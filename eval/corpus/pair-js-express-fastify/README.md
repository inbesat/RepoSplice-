# Pair js-express-fastify (js)

**Merge intent.** Two Node HTTP frameworks with the same surface area but different internals: a merge that compiles yet changes behaviour.

| Side | Repository | Tag | Commit SHA | License |
| --- | --- | --- | --- | --- |
| A | [expressjs/express](https://github.com/expressjs/express) | `4.21.0` | `f1573b8ab10391f25475667a7c3ef70beeaf4db8` | MIT |
| B | [fastify/fastify](https://github.com/fastify/fastify) | `v4.26.2` | `5c263b4dc2cb6d5eda2df7b3602238ae24957c55` | MIT |

**Extract paths.** A: `./` - B: `./` (the whole repository).

**Expected outcome.** `semantic_drift` - The merge applies, but the two codebases solve the same problem differently, so the result must be reviewed for behaviour changes.

**Expected conflicts.** The merge applies, but the two codebases solve the same problem differently, so the result must be reviewed for behaviour changes.

**Success criteria.**

- Both pinned commits are cloned and the extract paths exist.
- The merge runs on the pinned SHAs and lands in the `semantic_drift` category.
- No license block: both sides are permissive (MIT, MIT).

**Provenance.** The SHAs are the real immutable tag commits of the tags above, resolved with
`git ls-remote --tags --refs`. The licenses were read from each repository's license file
(source: `raw-file` / `raw-file`).