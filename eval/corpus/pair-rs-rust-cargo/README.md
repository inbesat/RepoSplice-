# Pair rs-rust-cargo (rust)

**Merge intent.** The language and its package manager.

| Side | Repository | Tag | Commit SHA | License |
| --- | --- | --- | --- | --- |
| A | [rust-lang/rust](https://github.com/rust-lang/rust) | `1.79.0` | `a6af86c649426f1d6a0ec4b188f1f5ff097c5bb0` | MIT |
| B | [rust-lang/cargo](https://github.com/rust-lang/cargo) | `0.81.0` | `b74813d84bb7488fbd4ed8f5d00012a6e30eaa39` | MIT |

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