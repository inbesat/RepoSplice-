# Pair rs-tokio-hyper (rust)

**Merge intent.** The async runtime and the HTTP stack built on it.

| Side | Repository | Tag | Commit SHA | License |
| --- | --- | --- | --- | --- |
| A | [tokio-rs/tokio](https://github.com/tokio-rs/tokio) | `tokio-1.38.0` | `14c17fc09656a30230177b600bacceb9db33e942` | MIT |
| B | [hyperium/hyper](https://github.com/hyperium/hyper) | `v1.4.1` | `4fda6b3ef7da763623797af40aa51d764be3fd2c` | MIT |

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